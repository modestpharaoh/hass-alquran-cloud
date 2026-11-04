"""Playback sessions that advance one ayah at a time."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from homeassistant.components.media_player import (
    ATTR_MEDIA_CONTENT_ID,
    ATTR_MEDIA_CONTENT_TYPE,
    ATTR_MEDIA_DURATION,
    ATTR_MEDIA_POSITION,
    DOMAIN as MEDIA_PLAYER_DOMAIN,
    SERVICE_MEDIA_STOP,
    SERVICE_PLAY_MEDIA,
    MediaPlayerState,
)
from homeassistant.const import (
    ATTR_ENTITY_ID,
    EVENT_CALL_SERVICE,
    SERVICE_TURN_OFF,
    STATE_IDLE,
    STATE_OFF,
    STATE_UNAVAILABLE,
)
from homeassistant.core import Event, HomeAssistant, callback

from .api import Catalog
from .const import (
    CONTENT_TYPE_URL,
    END_OF_TRACK_RATIO,
    END_OF_TRACK_SLACK_SECONDS,
    get_cache_days,
    get_display_language,
)
from .kiosk import VIDEO_BROWSER_PLATFORMS, build_kiosk_url, hass_base_url, kiosk_language
from .video import PreparedMedia

_LOGGER = logging.getLogger(__name__)

_IDLE_STATES = {STATE_IDLE, STATE_OFF, MediaPlayerState.IDLE, MediaPlayerState.OFF}
_USER_STOP_SERVICES = {SERVICE_MEDIA_STOP, SERVICE_TURN_OFF, "media_pause"}
ATTR_MEDIA_EXTRA = "extra"

ListenerCallback = Callable[[], None]
AsyncButtonFactory = Callable[[str], Awaitable[None] | Coroutine[Any, Any, None]]
Preparer = Callable[..., Awaitable[PreparedMedia]]


def _same_track(content_id: str, expected_url: str, marker: str) -> bool:
    """Return True if a reported content id is still this ayah.

    Cast sometimes rewrites the URL. VLC often leaves the content id empty.
    """
    if not content_id:
        return True
    if content_id == expected_url:
        return True
    return bool(marker) and marker in content_id


@dataclass(slots=True)
class PlaybackSession:
    """Active ayah playback on one media player."""

    entity_id: str
    reciter_id: str
    chapter: int
    start_ayah: int
    end_ayah: int
    ayah: int
    full_surah: bool
    repeat: int
    plays_remaining: int
    continue_surah: bool
    loop: bool
    speed: float
    webapp: bool
    platform: str
    background_video: bool = False
    origin_chapter: int = 0
    origin_start: int = 1
    origin_end: int = 1
    expected_url: str = ""
    marker: str = ""
    title: str = ""
    artist: str = ""
    album: str = ""
    image_url: str = ""
    spans: tuple[tuple[int, float, float], ...] = ()
    active: bool = True
    last_position: float | None = None
    last_duration: float | None = None
    max_position: float = 0.0
    pending_play: bool = False
    user_interrupted: bool = False

    def as_attr_dict(self) -> dict[str, Any]:
        """Return a serializable attribute dict for sensors."""
        return {
            "reciter_id": self.reciter_id,
            "surah": self.chapter,
            "ayah": self.ayah,
            "start_ayah": self.start_ayah,
            "end_ayah": self.end_ayah,
            "verse_key": f"{self.chapter}:{self.start_ayah}-{self.end_ayah}",
            "full_surah": self.full_surah,
            "repeat": self.repeat,
            "plays_remaining": self.plays_remaining,
            "continue_surah": self.continue_surah,
            "loop": self.loop,
            "speed": self.speed,
            "webapp": self.webapp,
            "background_video": self.background_video,
            "url": self.expected_url,
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "image_url": self.image_url,
        }


class PlaybackSessionManager:
    """Track and advance Quran ayah playback on media players."""

    def __init__(self, hass: HomeAssistant, coordinator: Any) -> None:
        """Initialize the session manager."""
        self.hass = hass
        self.coordinator = coordinator
        self._sessions: dict[str, PlaybackSession] = {}
        self._unsub_state = hass.bus.async_listen(
            "state_changed",
            self._async_on_state_changed,
        )
        self._unsub_service = hass.bus.async_listen(
            EVENT_CALL_SERVICE,
            self._async_on_call_service,
        )
        self._advancing: set[str] = set()
        self._stopping: set[str] = set()
        self._listeners: list[ListenerCallback] = []
        self._ensure_stop_button: AsyncButtonFactory | None = None
        self._preparer: Preparer | None = None
        self._generation: dict[str, int] = {}

    @callback
    def async_unload(self) -> None:
        """Stop listening for state changes."""
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
        if self._unsub_service:
            self._unsub_service()
            self._unsub_service = None
        self._sessions.clear()
        self._notify_listeners()

    @property
    def catalog(self) -> Catalog | None:
        """Return the current catalog."""
        return self.coordinator.data

    @property
    def sessions(self) -> dict[str, PlaybackSession]:
        """Return active sessions keyed by media_player entity_id."""
        return self._sessions

    def set_preparer(self, preparer: Preparer) -> None:
        """Register the audio/video preparer used before each play."""
        self._preparer = preparer

    def async_add_listener(self, listener: ListenerCallback) -> Callable[[], None]:
        """Register a callback invoked when sessions change."""

        @callback
        def _remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        self._listeners.append(listener)
        return _remove

    def set_button_factory(self, factory: AsyncButtonFactory) -> None:
        """Register a factory that ensures a stop button exists for a player."""
        self._ensure_stop_button = factory

    def get_session(self, entity_id: str) -> PlaybackSession | None:
        """Return the active session for a media player, if any."""
        return self._sessions.get(entity_id)

    def _notify_listeners(self) -> None:
        for listener in list(self._listeners):
            listener()

    def _bump(self, entity_id: str) -> int:
        generation = self._generation.get(entity_id, 0) + 1
        self._generation[entity_id] = generation
        return generation

    def _labels(self, reciter: Any, chapter: Any, ayah: int) -> tuple[str, str, str]:
        language = get_display_language(self.coordinator.entry.options)
        title = chapter.ayah_title(ayah, language)
        artist = reciter.localized_name(language)
        if reciter.style:
            artist = f"{artist} · {reciter.style}"
        return title, artist, f"{reciter.id}-{chapter.number}-{ayah}"

    async def _async_prepare(self, session: PlaybackSession) -> PreparedMedia:
        catalog = self.catalog
        if catalog is None:
            raise ValueError("Al Quran Cloud catalog is not ready")
        reciter = catalog.get_reciter(session.reciter_id)
        chapter = catalog.get_chapter(session.chapter)
        if reciter is None or chapter is None:
            raise ValueError("Reciter or surah for this session is no longer available")
        if session.start_ayah < 1 or session.end_ayah > chapter.verses_count or session.end_ayah < session.start_ayah:
            raise ValueError(
                f"Ayah range {session.start_ayah}-{session.end_ayah} is outside surah {session.chapter}"
            )
        if self._preparer is None:
            raise ValueError("Playback is not ready")
        return await self._preparer(
            webapp=False,
            platform=session.platform,
            catalog=catalog,
            reciter=reciter,
            chapter=chapter,
            start_ayah=session.start_ayah,
            end_ayah=session.end_ayah,
            speed=session.speed,
            cache_days=get_cache_days(self.coordinator.entry.options),
        )

    async def async_start(
        self,
        entity_id: str,
        reciter: Any,
        chapter: Any,
        start_ayah: int,
        end_ayah: int | None = None,
        *,
        repeat: int = 1,
        continue_surah: bool,
        loop: bool,
        speed: float,
        webapp: bool,
        background_video: bool = False,
        platform: str = "",
    ) -> PlaybackSession:
        """Start or replace a session and play one cached surah or ayah range."""
        end = chapter.verses_count if end_ayah in (None, 0) else int(end_ayah)
        if start_ayah < 1 or end > chapter.verses_count or end < start_ayah:
            raise ValueError(
                f"Ayah range {start_ayah}-{end} is outside surah {chapter.number}"
            )
        full = start_ayah <= 1 and end >= chapter.verses_count
        count = max(1, int(repeat))
        session = PlaybackSession(
            entity_id=entity_id,
            reciter_id=reciter.id,
            chapter=chapter.number,
            start_ayah=start_ayah,
            end_ayah=end,
            ayah=start_ayah,
            full_surah=full,
            repeat=count,
            plays_remaining=count,
            continue_surah=continue_surah and full,
            loop=loop,
            speed=speed,
            webapp=webapp,
            background_video=bool(background_video) and webapp,
            platform=platform,
            origin_chapter=chapter.number,
            origin_start=start_ayah,
            origin_end=end,
            pending_play=True,
        )
        self._sessions[entity_id] = session
        if self._ensure_stop_button is not None:
            await self._ensure_stop_button(entity_id)
        self._notify_listeners()
        try:
            await self._async_play_current(session, blocking=True)
        except Exception:
            self.stop(entity_id)
            raise
        return session

    async def async_stop(self, entity_id: str, *, stop_media: bool = True) -> None:
        """Clear the session and optionally stop the player."""
        self._stopping.add(entity_id)
        self._bump(entity_id)
        removed = self._sessions.pop(entity_id, None)
        if removed:
            self._notify_listeners()
        try:
            if stop_media:
                await self._async_stop_player(entity_id, removed)
        finally:
            self._stopping.discard(entity_id)

    async def _async_stop_player(self, entity_id: str, session: PlaybackSession | None) -> None:
        """Stop audio, or send Home when a TV browser was opened."""
        if session is not None and session.webapp and session.platform == "androidtv":
            await self.hass.services.async_call(
                "androidtv",
                "adb_command",
                {ATTR_ENTITY_ID: entity_id, "command": "HOME"},
                blocking=False,
            )
            return
        if session is not None and session.webapp and session.platform == "webostv":
            await self.hass.services.async_call(
                "webostv",
                "button",
                {ATTR_ENTITY_ID: entity_id, "button": "HOME"},
                blocking=False,
            )
            return
        if session is not None and session.webapp:
            return
        await self.hass.services.async_call(
            MEDIA_PLAYER_DOMAIN,
            SERVICE_MEDIA_STOP,
            {ATTR_ENTITY_ID: entity_id},
            blocking=False,
        )

    def stop(self, entity_id: str) -> None:
        """Clear a session without stopping media."""
        self._bump(entity_id)
        if self._sessions.pop(entity_id, None):
            self._notify_listeners()

    @staticmethod
    def _is_natural_track_end(
        *,
        position: float | None,
        duration: float | None,
        max_position: float = 0.0,
        user_interrupted: bool,
    ) -> bool:
        """Return True if idle should complete the ayah cycle."""
        if user_interrupted:
            return False
        if position is None or duration is None:
            return True
        try:
            position_f = float(position)
            duration_f = float(duration)
            max_f = float(max_position or 0)
        except (TypeError, ValueError):
            return True
        if duration_f <= 0:
            return True
        if max(position_f, max_f) >= duration_f - END_OF_TRACK_SLACK_SECONDS:
            return True
        if max(position_f, max_f) / duration_f >= END_OF_TRACK_RATIO:
            return True
        if max_f < 15 and position_f < 15:
            return True
        return False

    def _cache_progress(self, session: PlaybackSession, state: Any) -> None:
        if state is None:
            return
        attrs = state.attributes or {}
        try:
            if attrs.get(ATTR_MEDIA_POSITION) is not None:
                position_f = float(attrs[ATTR_MEDIA_POSITION])
                session.last_position = position_f
                if position_f > session.max_position:
                    session.max_position = position_f
            if attrs.get(ATTR_MEDIA_DURATION) is not None:
                session.last_duration = float(attrs[ATTR_MEDIA_DURATION])
        except (TypeError, ValueError):
            return

    async def _async_on_call_service(self, event: Event) -> None:
        """Mark sessions interrupted when HA stops, pauses, or turns off a player."""
        if event.data.get("domain") != MEDIA_PLAYER_DOMAIN:
            return
        service = event.data.get("service")
        service_data = event.data.get("service_data") or {}
        entity_ids = service_data.get(ATTR_ENTITY_ID)
        if entity_ids is None:
            return
        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]
        if service == "media_play":
            for entity_id in entity_ids:
                session = self._sessions.get(entity_id)
                if session is not None:
                    session.user_interrupted = False
            return
        if service not in _USER_STOP_SERVICES:
            return
        for entity_id in entity_ids:
            if entity_id in self._stopping or entity_id in self._advancing:
                continue
            session = self._sessions.get(entity_id)
            if session is None:
                continue
            session.user_interrupted = True

    async def _async_on_state_changed(self, event: Event) -> None:
        """Advance when the current ayah finishes."""
        entity_id = event.data.get("entity_id")
        if not entity_id or not str(entity_id).startswith("media_player."):
            return
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if new_state is None:
            return
        session = self._sessions.get(entity_id)
        if session is None or not session.active or entity_id in self._stopping:
            return
        if session.webapp:
            return

        new_state_val = new_state.state
        if new_state_val in {
            MediaPlayerState.PLAYING,
            "playing",
            "paused",
            getattr(MediaPlayerState, "PAUSED", "paused"),
        }:
            session.pending_play = False
            self._cache_progress(session, new_state)
        if old_state is not None and old_state.state in {MediaPlayerState.PLAYING, "playing"}:
            self._cache_progress(session, old_state)

        old_state_val = old_state.state if old_state else None
        left_active = old_state_val in {MediaPlayerState.PLAYING, "playing", "paused"}
        now_idle = new_state_val in _IDLE_STATES or new_state_val == STATE_UNAVAILABLE
        if not (left_active and now_idle):
            return
        if session.pending_play or entity_id in self._advancing:
            return
        if old_state_val == "paused" and session.user_interrupted:
            self.stop(entity_id)
            return

        current_id = ""
        if old_state is not None:
            current_id = str((old_state.attributes or {}).get(ATTR_MEDIA_CONTENT_ID) or "")
        if current_id and not _same_track(current_id, session.expected_url, session.marker):
            self.stop(entity_id)
            return

        position = session.last_position
        duration = session.last_duration
        if not self._is_natural_track_end(
            position=position,
            duration=duration,
            max_position=session.max_position,
            user_interrupted=session.user_interrupted,
        ):
            self.stop(entity_id)
            return
        await self._async_advance(session)

    def _neighbor_surah(self, number: int, step: int) -> int | None:
        """Return the surah number step away, wrapping only when loop is on."""
        catalog = self.catalog
        if catalog is None:
            return None
        target = number + step
        count = len(catalog.chapters) or 114
        if 1 <= target <= count and catalog.get_chapter(target) is not None:
            return target
        return None

    def _assign_full_surah(self, session: PlaybackSession, number: int) -> None:
        catalog = self.catalog
        chapter = catalog.get_chapter(number) if catalog else None
        if chapter is None:
            raise ValueError(f"Unknown surah: {number}")
        session.chapter = number
        session.start_ayah = 1
        session.end_ayah = chapter.verses_count
        session.ayah = 1
        session.full_surah = True
        session.plays_remaining = session.repeat
        session.spans = ()
        session.last_position = None
        session.last_duration = None
        session.max_position = 0.0
        session.pending_play = True

    async def _async_advance(self, session: PlaybackSession) -> None:
        """Replay the range, or move to the next full surah."""
        entity_id = session.entity_id
        if entity_id in self._advancing:
            return
        self._advancing.add(entity_id)
        self._bump(entity_id)
        try:
            if session.user_interrupted:
                self.stop(entity_id)
                return
            session.user_interrupted = False
            session.plays_remaining -= 1
            session.last_position = None
            session.last_duration = None
            session.max_position = 0.0
            session.pending_play = True
            session.spans = ()
            if session.plays_remaining > 0:
                await self._async_play_current(session, blocking=False)
                self._notify_listeners()
                return
            if session.full_surah and session.continue_surah:
                target = self._neighbor_surah(session.chapter, 1)
                if target is None and session.loop:
                    target = 1
                if target is None:
                    self.stop(entity_id)
                    return
                self._assign_full_surah(session, target)
                await self._async_play_current(session, blocking=False)
                self._notify_listeners()
                return
            if session.loop:
                catalog = self.catalog
                origin = catalog.get_chapter(session.origin_chapter) if catalog else None
                if origin is None:
                    self.stop(entity_id)
                    return
                session.chapter = origin.number
                session.start_ayah = session.origin_start
                session.end_ayah = session.origin_end
                session.ayah = session.origin_start
                session.full_surah = session.origin_start <= 1 and session.origin_end >= origin.verses_count
                session.plays_remaining = session.repeat
                await self._async_play_current(session, blocking=False)
                self._notify_listeners()
                return
            self.stop(entity_id)
        finally:
            self._advancing.discard(entity_id)

    async def async_skip_surah(self, entity_id: str, *, step: int) -> None:
        """Play the next or previous full surah."""
        session = self._sessions.get(entity_id)
        if session is None or not session.active:
            raise ValueError("No active Al Quran Cloud session on this media player")
        if entity_id in self._advancing:
            return
        if self.catalog is None:
            raise ValueError("Al Quran Cloud catalog is not ready")
        target = self._neighbor_surah(session.chapter, step)
        if target is None and session.loop:
            count = len(self.catalog.chapters) or 114
            target = 1 if step > 0 else count
        if target is None:
            raise ValueError("This session has no further surah")
        self._advancing.add(entity_id)
        self._bump(entity_id)
        try:
            session.user_interrupted = False
            self._assign_full_surah(session, target)
            await self._async_play_current(session, blocking=False)
            self._notify_listeners()
        finally:
            self._advancing.discard(entity_id)

    async def _async_play_current(self, session: PlaybackSession, *, blocking: bool) -> None:
        if session.webapp:
            await self._async_open_webapp(session, blocking=blocking)
            return
        media = await self._async_prepare(session)
        session.expected_url = media.url
        session.marker = media.marker
        session.title = media.title
        session.artist = media.artist
        session.album = media.album
        session.image_url = media.image_url
        session.spans = media.spans
        self._bump(session.entity_id)
        await self._async_play_url(session, media, blocking=blocking)
        if media.seek:
            await self._async_seek(session.entity_id, media.seek)

    async def _async_open_webapp(self, session: PlaybackSession, *, blocking: bool) -> None:
        """Open the web app in a TV browser and leave playback there."""
        if session.platform not in VIDEO_BROWSER_PLATFORMS:
            raise ValueError(
                "The web app opens in a TV browser. Choose an LG webOS, Samsung, or Android TV player."
            )
        catalog = self.catalog
        if catalog is None:
            raise ValueError("Al Quran Cloud catalog is not ready")
        reciter = catalog.get_reciter(session.reciter_id)
        chapter = catalog.get_chapter(session.chapter)
        if reciter is None or chapter is None:
            raise ValueError("Reciter or surah for this session is no longer available")
        language = get_display_language(self.coordinator.entry.options)
        url = build_kiosk_url(
            hass_base_url(self.hass),
            surah=session.chapter,
            ayah=session.start_ayah,
            end_ayah=session.end_ayah,
            verses_count=chapter.verses_count,
            reciter=session.reciter_id,
            speed=session.speed,
            repeat=session.repeat,
            auto_surah=session.continue_surah,
            loop=session.loop,
            language=kiosk_language(language),
            background_video=session.background_video,
        )
        session.expected_url = url
        session.marker = ""
        session.title = self._video_title(chapter, session.start_ayah, session.end_ayah, language)
        session.artist = reciter.localized_name(language)
        session.album = ""
        session.image_url = ""
        session.spans = ()
        self._bump(session.entity_id)
        await self._async_launch_browser(session, url, blocking=blocking)

    def _video_title(self, chapter: Any, start_ayah: int, end_ayah: int, language: str) -> str:
        title = chapter.display_title(language)
        if start_ayah > 1 or end_ayah < chapter.verses_count:
            return f"{title} · {start_ayah}–{end_ayah}"
        return title

    async def _async_launch_browser(
        self, session: PlaybackSession, url: str, *, blocking: bool
    ) -> None:
        """Open a kiosk URL on LG, Samsung, or Android TV."""
        if session.platform == "webostv":
            await self._async_open_webos(session.entity_id, url, blocking=blocking)
            return
        if session.platform == "androidtv":
            await self.hass.services.async_call(
                "androidtv",
                "adb_command",
                {
                    ATTR_ENTITY_ID: session.entity_id,
                    "command": f'am start -a android.intent.action.VIEW -d "{url}"',
                },
                blocking=blocking,
            )
            return
        await self._async_open_samsung(session, url, blocking=blocking)

    async def _async_open_samsung(
        self, session: PlaybackSession, url: str, *, blocking: bool
    ) -> None:
        """Open the kiosk in the Samsung browser."""
        data = {
            ATTR_ENTITY_ID: session.entity_id,
            ATTR_MEDIA_CONTENT_ID: url,
            ATTR_MEDIA_CONTENT_TYPE: "browser",
        }
        try:
            await self.hass.services.async_call(
                MEDIA_PLAYER_DOMAIN,
                SERVICE_PLAY_MEDIA,
                data,
                blocking=blocking,
            )
        except Exception:
            if session.platform != "samsungtv":
                raise
            retry = dict(data)
            retry[ATTR_MEDIA_CONTENT_TYPE] = CONTENT_TYPE_URL
            await self.hass.services.async_call(
                MEDIA_PLAYER_DOMAIN,
                SERVICE_PLAY_MEDIA,
                retry,
                blocking=blocking,
            )

    async def _async_seek(self, entity_id: str, seconds: float) -> None:
        """Seek within the surah video."""
        try:
            await self.hass.services.async_call(
                MEDIA_PLAYER_DOMAIN,
                "media_seek",
                {ATTR_ENTITY_ID: entity_id, "seek_position": seconds},
                blocking=True,
            )
        except Exception:  # noqa: BLE001 - some players cannot seek
            _LOGGER.debug("media_seek unsupported on %s", entity_id)

    async def _async_clear_playlist(self, entity_id: str) -> None:
        try:
            await self.hass.services.async_call(
                MEDIA_PLAYER_DOMAIN,
                "clear_playlist",
                {ATTR_ENTITY_ID: entity_id},
                blocking=True,
            )
        except Exception:  # noqa: BLE001 - Cast and TVs have no playlist
            _LOGGER.debug("clear_playlist unsupported on %s", entity_id)

    async def _async_open_webos(self, entity_id: str, url: str, *, blocking: bool) -> None:
        """Open the ayah video in the LG browser."""
        await self.hass.services.async_call(
            "webostv",
            "command",
            {
                ATTR_ENTITY_ID: entity_id,
                "command": "system.launcher/open",
                "payload": {"target": url},
            },
            blocking=blocking,
        )

    async def _async_play_url(
        self,
        session: PlaybackSession,
        media: PreparedMedia,
        *,
        blocking: bool,
    ) -> None:
        """Play a URL, with Cast metadata and a Samsung content-type retry."""
        base: dict[str, Any] = {
            ATTR_ENTITY_ID: session.entity_id,
            ATTR_MEDIA_CONTENT_ID: media.url,
            ATTR_MEDIA_CONTENT_TYPE: media.content_type,
        }
        with_meta = dict(base)
        metadata = {
            "metadataType": 3,
            "title": media.title,
            "artist": media.artist,
        }
        if media.image_url:
            metadata["images"] = [{"url": media.image_url}]
        with_meta[ATTR_MEDIA_EXTRA] = {"metadata": metadata}

        await self._async_clear_playlist(session.entity_id)
        try:
            await self.hass.services.async_call(
                MEDIA_PLAYER_DOMAIN,
                SERVICE_PLAY_MEDIA,
                with_meta,
                blocking=blocking,
            )
        except Exception:
            if ATTR_MEDIA_EXTRA not in with_meta:
                raise
            _LOGGER.debug(
                "play_media with metadata failed on %s; retrying without extra",
                session.entity_id,
                exc_info=True,
            )
            await self.hass.services.async_call(
                MEDIA_PLAYER_DOMAIN,
                SERVICE_PLAY_MEDIA,
                base,
                blocking=blocking,
            )
