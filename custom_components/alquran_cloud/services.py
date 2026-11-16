"""Services for Al Quran Cloud ayah playback."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.service import async_extract_entity_ids

from .api import QuranApiError
from .const import (
    ATTR_CONTINUE_SURAH,
    ATTR_END_AYAH,
    ATTR_REPEAT,
    ATTR_START_AYAH,
    ATTR_LOOP,
    ATTR_RECITER_ID,
    ATTR_BACKGROUND_VIDEO,
    ATTR_SPEED,
    ATTR_SURAH,
    ATTR_COMMAND,
    ATTR_WEBAPP,
    DEFAULT_BACKGROUND_VIDEO,
    DEFAULT_CONTINUE_SURAH,
    DEFAULT_LOOP,
    DEFAULT_PLAYBACK_SPEED,
    DEFAULT_REPEAT,
    DEFAULT_WEBAPP,
    MAX_REPEAT,
    MIN_REPEAT,
    DOMAIN,
    PLAYBACK_SPEEDS,
    SERVICE_CLEAR_AUDIO_CACHE,
    SERVICE_CLEAR_CACHE,
    SERVICE_CLEAR_SOURCE_CACHE,
    SERVICE_CLEAR_VIDEO_CACHE,
    SERVICE_NEXT_SURAH,
    SERVICE_PLAY,
    SERVICE_PREVIOUS_SURAH,
    SERVICE_STOP,
    SERVICE_TRANSPORT,
    coerce_speed,
)
from .coordinator import QuranCoordinator
from .session import TRANSPORT_COMMANDS, PlaybackSessionManager
from .video import LocalMediaError

PLAY_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTITY_ID): cv.entity_ids,
        vol.Required(ATTR_RECITER_ID): vol.All(str, vol.Length(min=1)),
        vol.Optional(ATTR_SURAH, default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=114)),
        vol.Optional(ATTR_START_AYAH, default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=286)),
        vol.Optional(ATTR_END_AYAH): vol.All(vol.Coerce(int), vol.Range(min=1, max=286)),
        vol.Optional(ATTR_REPEAT, default=DEFAULT_REPEAT): vol.All(
            vol.Coerce(int), vol.Range(min=MIN_REPEAT, max=MAX_REPEAT)
        ),
        vol.Optional(ATTR_CONTINUE_SURAH, default=DEFAULT_CONTINUE_SURAH): cv.boolean,
        vol.Optional(ATTR_LOOP, default=DEFAULT_LOOP): cv.boolean,
        vol.Optional(ATTR_WEBAPP): cv.boolean,
        vol.Optional(ATTR_BACKGROUND_VIDEO, default=DEFAULT_BACKGROUND_VIDEO): cv.boolean,
        vol.Optional(ATTR_SPEED): vol.All(vol.Coerce(float), vol.In(PLAYBACK_SPEEDS)),
    },
    extra=vol.ALLOW_EXTRA,
)

STOP_SCHEMA = vol.Schema(
    {vol.Optional(ATTR_ENTITY_ID): cv.entity_ids},
    extra=vol.ALLOW_EXTRA,
)

TRANSPORT_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTITY_ID): cv.entity_ids,
        vol.Required(ATTR_COMMAND): vol.In(sorted(TRANSPORT_COMMANDS)),
        vol.Optional(ATTR_CONTINUE_SURAH): cv.boolean,
        vol.Optional(ATTR_LOOP): cv.boolean,
        vol.Optional(ATTR_BACKGROUND_VIDEO): cv.boolean,
        vol.Optional(ATTR_REPEAT): vol.All(vol.Coerce(int), vol.Range(min=MIN_REPEAT, max=MAX_REPEAT)),
        vol.Optional(ATTR_SPEED): vol.All(vol.Coerce(float), vol.In(PLAYBACK_SPEEDS)),
    },
    extra=vol.ALLOW_EXTRA,
)


def player_platform(hass: HomeAssistant, entity_id: str) -> str:
    """Return the integration platform that owns a media player."""
    try:
        registry = er.async_get(hass)
    except Exception:  # noqa: BLE001 - tests without a registry
        return ""
    getter = getattr(registry, "async_get", None)
    if getter is None:
        return ""
    entry = getter(entity_id)
    return str(getattr(entry, "platform", "") or "")


def async_register_services(
    hass: HomeAssistant,
    coordinator: QuranCoordinator,
    sessions: PlaybackSessionManager,
) -> None:
    """Register domain services once."""

    async def _entity_ids(call: ServiceCall) -> list[str]:
        extracted: set[str] = set()
        try:
            extracted.update(await async_extract_entity_ids(call))
        except TypeError:
            try:
                extracted.update(await async_extract_entity_ids(hass, call))
            except Exception:  # noqa: BLE001
                extracted = set()
        except Exception:  # noqa: BLE001
            extracted = set()

        raw = call.data.get(ATTR_ENTITY_ID)
        if raw:
            extracted.update([raw] if isinstance(raw, str) else list(raw))
        extracted.update(_media_players_from_registry(hass, call.data))
        media_players = sorted(
            entity_id
            for entity_id in extracted
            if isinstance(entity_id, str) and entity_id.startswith("media_player.")
        )
        if not media_players:
            raise HomeAssistantError(
                "No media_player target found. Select a media player entity "
                "(or a device that includes one)."
            )
        return media_players

    async def async_handle_play(call: ServiceCall) -> None:
        catalog = coordinator.data
        if catalog is None:
            raise HomeAssistantError("Al Quran Cloud catalog is not ready")

        reciter = catalog.get_reciter(str(call.data[ATTR_RECITER_ID]))
        if reciter is None:
            raise HomeAssistantError(f"Unknown reciter_id: {call.data[ATTR_RECITER_ID]}")
        surah = call.data.get(ATTR_SURAH, 1)
        chapter = catalog.get_chapter(surah)
        if chapter is None:
            raise HomeAssistantError(f"Unknown surah: {surah}")
        start_ayah = int(call.data.get(ATTR_START_AYAH, 1))
        end_ayah = call.data.get(ATTR_END_AYAH)
        end_value = chapter.verses_count if end_ayah in (None, "") else int(end_ayah)
        if start_ayah > chapter.verses_count or end_value > chapter.verses_count or end_value < start_ayah:
            raise HomeAssistantError(
                f"Surah {chapter.number} has {chapter.verses_count} ayahs"
            )
        full = start_ayah <= 1 and end_value >= chapter.verses_count
        repeat = int(call.data.get(ATTR_REPEAT, DEFAULT_REPEAT))

        try:
            speed = coerce_speed(call.data.get(ATTR_SPEED, DEFAULT_PLAYBACK_SPEED))
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        if ATTR_WEBAPP in call.data:
            webapp = bool(call.data[ATTR_WEBAPP])
        elif "show_picture" in call.data:
            webapp = bool(call.data["show_picture"])
        else:
            webapp = DEFAULT_WEBAPP
        background_video = bool(call.data.get(ATTR_BACKGROUND_VIDEO, DEFAULT_BACKGROUND_VIDEO))

        for entity_id in await _entity_ids(call):
            try:
                await sessions.async_start(
                    entity_id,
                    reciter,
                    chapter,
                    start_ayah,
                    end_value,
                    repeat=repeat,
                    continue_surah=bool(call.data.get(ATTR_CONTINUE_SURAH, DEFAULT_CONTINUE_SURAH)) and full,
                    loop=bool(call.data.get(ATTR_LOOP, DEFAULT_LOOP)),
                    speed=speed,
                    webapp=webapp,
                    background_video=background_video,
                    platform=player_platform(hass, entity_id),
                )
            except (ValueError, QuranApiError, LocalMediaError) as err:
                raise HomeAssistantError(str(err)) from err

    async def async_handle_stop(call: ServiceCall) -> None:
        for entity_id in await _entity_ids(call):
            await sessions.async_stop(entity_id, stop_media=True)

    async def _handle_skip(call: ServiceCall, step: int) -> None:
        for entity_id in await _entity_ids(call):
            try:
                await sessions.async_skip_surah(entity_id, step=step)
            except (ValueError, QuranApiError, LocalMediaError) as err:
                raise HomeAssistantError(str(err)) from err

    async def async_handle_next(call: ServiceCall) -> None:
        await _handle_skip(call, 1)

    async def async_handle_previous(call: ServiceCall) -> None:
        await _handle_skip(call, -1)

    async def async_handle_transport(call: ServiceCall) -> None:
        command = str(call.data[ATTR_COMMAND])
        for entity_id in await _entity_ids(call):
            if command == "settings":
                values = {
                    key: call.data[key]
                    for key in (
                        ATTR_CONTINUE_SURAH,
                        ATTR_LOOP,
                        ATTR_BACKGROUND_VIDEO,
                        ATTR_REPEAT,
                        ATTR_SPEED,
                    )
                    if key in call.data
                }
                if not values or not sessions.queue_settings(entity_id, values):
                    raise HomeAssistantError("The Quran page is not open on that player.")
                continue
            if not sessions.queue_transport(entity_id, command):
                raise HomeAssistantError("The Quran page is not open on that player.")

    async def _clear(kind: str) -> None:
        store = hass.data.get(DOMAIN, {}).get("store")
        if store is None:
            raise HomeAssistantError("Al Quran Cloud cache is not ready")
        await hass.async_add_executor_job(store.clear, kind)
        store.prune_idle_locks()

    async def async_handle_clear_cache(_call: ServiceCall) -> None:
        await _clear("all")

    async def async_handle_clear_audio(_call: ServiceCall) -> None:
        await _clear("audio")

    async def async_handle_clear_video(_call: ServiceCall) -> None:
        await _clear("video")

    async def async_handle_clear_sources(_call: ServiceCall) -> None:
        await _clear("sources")

    if not hass.services.has_service(DOMAIN, SERVICE_PLAY):
        hass.services.async_register(DOMAIN, SERVICE_PLAY, async_handle_play, schema=PLAY_SCHEMA)
    if not hass.services.has_service(DOMAIN, SERVICE_STOP):
        hass.services.async_register(DOMAIN, SERVICE_STOP, async_handle_stop, schema=STOP_SCHEMA)
    if not hass.services.has_service(DOMAIN, SERVICE_TRANSPORT):
        hass.services.async_register(
            DOMAIN, SERVICE_TRANSPORT, async_handle_transport, schema=TRANSPORT_SCHEMA
        )
    if not hass.services.has_service(DOMAIN, SERVICE_NEXT_SURAH):
        hass.services.async_register(DOMAIN, SERVICE_NEXT_SURAH, async_handle_next, schema=STOP_SCHEMA)
    if not hass.services.has_service(DOMAIN, SERVICE_PREVIOUS_SURAH):
        hass.services.async_register(
            DOMAIN, SERVICE_PREVIOUS_SURAH, async_handle_previous, schema=STOP_SCHEMA
        )
    if not hass.services.has_service(DOMAIN, SERVICE_CLEAR_CACHE):
        hass.services.async_register(DOMAIN, SERVICE_CLEAR_CACHE, async_handle_clear_cache)
    if not hass.services.has_service(DOMAIN, SERVICE_CLEAR_AUDIO_CACHE):
        hass.services.async_register(DOMAIN, SERVICE_CLEAR_AUDIO_CACHE, async_handle_clear_audio)
    if not hass.services.has_service(DOMAIN, SERVICE_CLEAR_VIDEO_CACHE):
        hass.services.async_register(DOMAIN, SERVICE_CLEAR_VIDEO_CACHE, async_handle_clear_video)
    if not hass.services.has_service(DOMAIN, SERVICE_CLEAR_SOURCE_CACHE):
        hass.services.async_register(DOMAIN, SERVICE_CLEAR_SOURCE_CACHE, async_handle_clear_sources)


def _as_id_list(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    return [item for item in value if isinstance(item, str)]


def _media_players_from_registry(hass: HomeAssistant, data: dict[str, Any]) -> set[str]:
    device_ids = _as_id_list(data.get("device_id"))
    area_ids = _as_id_list(data.get("area_id"))
    if not device_ids and not area_ids:
        return set()
    try:
        registry = er.async_get(hass)
    except Exception:  # noqa: BLE001
        return set()

    found: set[str] = set()
    entities = registry.entities

    def _add(entry: Any) -> None:
        entity_id = getattr(entry, "entity_id", "")
        if not entity_id.startswith("media_player."):
            return
        if getattr(entry, "disabled_by", None):
            return
        found.add(entity_id)

    for device_id in device_ids:
        getter = getattr(entities, "get_entries_for_device_id", None)
        for entry in getter(device_id) if getter else []:
            _add(entry)
    for area_id in area_ids:
        getter = getattr(entities, "get_entries_for_area_id", None)
        for entry in getter(area_id) if getter else []:
            _add(entry)
    return found


def async_unregister_services(hass: HomeAssistant) -> None:
    """Unregister domain services when the last entry unloads."""
    for service in (
        SERVICE_PLAY,
        SERVICE_STOP,
        SERVICE_TRANSPORT,
        SERVICE_NEXT_SURAH,
        SERVICE_PREVIOUS_SURAH,
        SERVICE_CLEAR_CACHE,
        SERVICE_CLEAR_AUDIO_CACHE,
        SERVICE_CLEAR_VIDEO_CACHE,
        SERVICE_CLEAR_SOURCE_CACHE,
        "next_ayah",
        "previous_ayah",
    ):
        if hass.services.has_service(DOMAIN, service):
            hass.services.async_remove(DOMAIN, service)
