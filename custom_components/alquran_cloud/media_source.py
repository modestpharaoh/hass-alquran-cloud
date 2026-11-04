"""Media source for browsing Quran.com ayah recitations."""

from __future__ import annotations

from homeassistant.components.media_player import BrowseError, MediaClass, MediaType
from homeassistant.components.media_source import (
    BrowseMediaSource,
    MediaSource,
    MediaSourceItem,
    PlayMedia,
    Unresolvable,
)
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant

from .api import Catalog, QuranApiError
from .const import (
    DOMAIN,
    ID_AYAH,
    ID_CHAPTER,
    ID_RECITER,
    MIME_TYPE_MP3,
    get_display_language,
    get_favorite_reciter_ids,
)
from .coordinator import QuranCoordinator


async def async_get_media_source(hass: HomeAssistant) -> AlquranCloudMediaSource:
    """Set up the Quran.com media source."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        raise BrowseError("Al Quran Cloud is not configured")
    return AlquranCloudMediaSource(hass, entries[0])


class AlquranCloudMediaSource(MediaSource):
    """Provide ayah recitations as a media source."""

    name = "Al Quran Cloud"

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the media source."""
        super().__init__(DOMAIN)
        self.hass = hass
        self.entry = entry

    @property
    def coordinator(self) -> QuranCoordinator:
        """Return the catalog coordinator."""
        return self.entry.runtime_data.coordinator

    @property
    def catalog(self) -> Catalog:
        """Return the cached catalog."""
        if self.entry.state is not ConfigEntryState.LOADED or self.coordinator.data is None:
            raise BrowseError("Al Quran Cloud catalog is not ready")
        return self.coordinator.data

    def _display_language(self) -> str:
        return get_display_language(self.entry.options)

    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        """Resolve an ayah identifier to a streaming MP3."""
        if self.entry.state is not ConfigEntryState.LOADED:
            raise Unresolvable("Al Quran Cloud is not ready")
        parsed = _parse_identifier(item.identifier)
        if parsed is None or parsed[1] is None or parsed[2] is None:
            raise Unresolvable(f"Invalid media identifier: {item.identifier}")
        reciter_id, chapter, ayah = parsed
        catalog = self.catalog
        if catalog.get_reciter(reciter_id) is None:
            raise Unresolvable(f"Unknown reciter: {reciter_id}")
        info = catalog.get_chapter(chapter)
        if info is None or ayah < 1 or ayah > info.verses_count:
            raise Unresolvable(f"Unknown ayah: {chapter}:{ayah}")
        try:
            url = await self.coordinator.api.ayah_audio_url(catalog, reciter_id, chapter, ayah)
        except QuranApiError as err:
            raise Unresolvable(str(err)) from err
        return PlayMedia(url, MIME_TYPE_MP3)

    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        """Return browsable reciters, surahs, and ayahs."""
        if self.entry.state is not ConfigEntryState.LOADED:
            raise BrowseError("Al Quran Cloud is not ready")
        catalog = self.catalog
        identifier = item.identifier or ""
        language = self._display_language()
        if not identifier:
            return self._browse_root(catalog, language)
        parsed = _parse_identifier(identifier)
        if parsed is None:
            raise BrowseError(f"Unknown media identifier: {identifier}")
        reciter_id, chapter, ayah = parsed
        if ayah is not None:
            raise BrowseError("Ayahs cannot be expanded")
        reciter = catalog.get_reciter(reciter_id)
        if reciter is None:
            raise BrowseError(f"Unknown reciter: {reciter_id}")
        if chapter is None:
            return self._browse_chapters(catalog, reciter, language)
        info = catalog.get_chapter(chapter)
        if info is None:
            raise BrowseError(f"Unknown surah: {chapter}")
        return self._browse_ayahs(reciter, info, language)

    def _browse_root(self, catalog: Catalog, language: str) -> BrowseMediaSource:
        favorites = set(get_favorite_reciter_ids(self.entry.options))
        reciters = sorted(
            catalog.sorted_reciters(language),
            key=lambda reciter: reciter.id not in favorites,
        )
        children = []
        for reciter in reciters:
            title = reciter.browse_title(language)
            if reciter.id in favorites:
                title = f"★ {title}"
            children.append(
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=f"{ID_RECITER}/{reciter.id}",
                    media_class=MediaClass.DIRECTORY,
                    media_content_type=MediaType.MUSIC,
                    title=title,
                    can_play=False,
                    can_expand=True,
                    children_media_class=MediaClass.DIRECTORY,
                )
            )
        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=None,
            media_class=MediaClass.CHANNEL,
            media_content_type=MediaType.MUSIC,
            title=self.entry.title or "Al Quran Cloud",
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.DIRECTORY,
            children=children,
        )

    def _browse_chapters(self, catalog: Catalog, reciter: Any, language: str) -> BrowseMediaSource:
        children = []
        for number in sorted(catalog.chapters):
            chapter = catalog.chapters[number]
            children.append(
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=f"{ID_RECITER}/{reciter.id}/{ID_CHAPTER}/{number}",
                    media_class=MediaClass.DIRECTORY,
                    media_content_type=MediaType.MUSIC,
                    title=chapter.display_title(language),
                    can_play=False,
                    can_expand=True,
                    children_media_class=MediaClass.TRACK,
                )
            )
        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=f"{ID_RECITER}/{reciter.id}",
            media_class=MediaClass.DIRECTORY,
            media_content_type=MediaType.MUSIC,
            title=reciter.browse_title(language),
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.DIRECTORY,
            children=children,
        )

    def _browse_ayahs(self, reciter: Any, chapter: Any, language: str) -> BrowseMediaSource:
        children = [
            BrowseMediaSource(
                domain=DOMAIN,
                identifier=(
                    f"{ID_RECITER}/{reciter.id}/{ID_CHAPTER}/{chapter.number}/{ID_AYAH}/{ayah}"
                ),
                media_class=MediaClass.TRACK,
                media_content_type=MIME_TYPE_MP3,
                title=f"{chapter.number:03d}:{ayah:03d}",
                can_play=True,
                can_expand=False,
            )
            for ayah in range(1, chapter.verses_count + 1)
        ]
        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=f"{ID_RECITER}/{reciter.id}/{ID_CHAPTER}/{chapter.number}",
            media_class=MediaClass.DIRECTORY,
            media_content_type=MediaType.MUSIC,
            title=f"{reciter.browse_title(language)} · {chapter.display_title(language)}",
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.TRACK,
            children=children,
        )


def _parse_identifier(identifier: str | None) -> tuple[str, int | None, int | None] | None:
    """Parse reciter/{edition}/chapter/{n}/ayah/{a}."""
    if not identifier:
        return None
    parts = [part for part in identifier.split("/") if part]
    if len(parts) < 2 or parts[0] != ID_RECITER or not parts[1]:
        return None
    reciter_id = parts[1]
    chapter: int | None = None
    ayah: int | None = None
    index = 2
    while index < len(parts):
        key = parts[index]
        if index + 1 >= len(parts):
            return None
        try:
            value = int(parts[index + 1])
        except ValueError:
            return None
        if key == ID_CHAPTER:
            chapter = value
        elif key == ID_AYAH:
            ayah = value
        else:
            return None
        index += 2
    return reciter_id, chapter, ayah
