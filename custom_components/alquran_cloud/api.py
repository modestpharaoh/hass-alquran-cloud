"""Async client for the Al Quran Cloud API."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
from typing import Any

from aiohttp import ClientError, ClientSession, ClientTimeout

from .const import API_BASE, ayah_audio_url

_LOGGER = logging.getLogger(__name__)
_TIMEOUT = ClientTimeout(total=30)


class QuranApiError(Exception):
    """Raised when the Al Quran Cloud API request fails."""


@dataclass(slots=True)
class Reciter:
    """An ayah-by-ayah reciter edition."""

    id: str
    name_en: str
    name_ar: str
    style: str = ""

    def localized_name(self, language: str = "english") -> str:
        """Return the reciter name in the requested language."""
        if language == "arabic":
            return self.name_ar or self.name_en
        return self.name_en or self.name_ar

    def browse_title(self, language: str = "english") -> str:
        """Return a media-browser title including the edition identifier."""
        name = self.localized_name(language)
        if self.style and self.style not in name:
            name = f"{name} ({self.style})"
        return f"{name} [{self.id}]"


@dataclass(slots=True)
class Chapter:
    """One surah."""

    number: int
    name_en: str
    name_ar: str
    verses_count: int
    revelation_place: str = ""

    def display_title(self, language: str = "english") -> str:
        """Return a short surah label."""
        name = self.name_ar if language == "arabic" else self.name_en
        unit = "آية" if language == "arabic" else "ayahs"
        return f"{self.number:03d} · {name} · {self.verses_count} {unit}"

    def ayah_title(self, ayah: int, language: str = "english") -> str:
        """Return a label for one ayah."""
        name = self.name_ar if language == "arabic" else self.name_en
        return f"{self.number:03d}:{ayah:03d} · {name}"


@dataclass(slots=True)
class Catalog:
    """Cached reciters and chapters."""

    reciters: dict[str, Reciter] = field(default_factory=dict)
    chapters: dict[int, Chapter] = field(default_factory=dict)

    def sorted_reciters(self, language: str = "english") -> list[Reciter]:
        """Return reciters sorted by the display language."""
        key = (
            (lambda item: (item.name_ar or item.name_en).casefold())
            if language == "arabic"
            else (lambda item: (item.name_en or item.name_ar).casefold())
        )
        return sorted(self.reciters.values(), key=key)

    def get_reciter(self, reciter_id: str) -> Reciter | None:
        """Return a reciter by edition identifier."""
        return self.reciters.get(str(reciter_id))

    def get_chapter(self, number: int) -> Chapter | None:
        """Return a surah by number."""
        return self.chapters.get(number)

    def global_ayah_number(self, chapter: int, ayah: int) -> int:
        """Return the Quran-wide ayah number used by the audio CDN."""
        info = self.chapters.get(chapter)
        if info is None:
            raise QuranApiError(f"Unknown surah: {chapter}")
        if ayah < 1 or ayah > info.verses_count:
            raise QuranApiError(f"Ayah {chapter}:{ayah} is outside this surah")
        offset = 0
        for number in range(1, chapter):
            previous = self.chapters.get(number)
            if previous is None:
                raise QuranApiError(f"Missing surah {number}")
            offset += previous.verses_count
        return offset + ayah


def ayah_after(
    chapter: int,
    ayah: int,
    verses_count: int,
    *,
    auto_advance: bool,
    continue_surah: bool,
    loop: bool,
    chapter_count: int = 114,
) -> tuple[int, int] | None:
    """Return the next ayah, if playback should continue."""
    if ayah < verses_count:
        return (chapter, ayah + 1) if auto_advance else None
    if continue_surah and chapter < chapter_count:
        return (chapter + 1, 1) if auto_advance else None
    if loop:
        if continue_surah:
            return (1, 1)
        return (chapter, 1)
    return None


def ayah_before(
    chapter: int,
    ayah: int,
    *,
    continue_surah: bool,
    previous_verse_count: int | None,
) -> tuple[int, int] | None:
    """Return the previous ayah, if one exists."""
    if ayah > 1:
        return chapter, ayah - 1
    if not continue_surah or chapter <= 1 or not previous_verse_count:
        return None
    return chapter - 1, previous_verse_count


def bitrate_from_audio_url(url: str) -> int:
    """Read the bitrate from a CDN path such as .../audio/128/ar.alafasy/1.mp3."""
    parts = url.rstrip("/").split("/")
    if len(parts) < 3 or not parts[-3].isdigit():
        raise QuranApiError(f"Unexpected ayah audio URL: {url}")
    return int(parts[-3])


class QuranApi:
    """Thin async wrapper around api.alquran.cloud."""

    def __init__(self, session: ClientSession) -> None:
        """Initialize with an aiohttp session."""
        self._session = session
        self._bitrates: dict[str, int] = {}

    async def _get_json(self, path: str, **params: Any) -> dict[str, Any]:
        """GET a JSON endpoint."""
        url = f"{API_BASE}/{path.lstrip('/')}"
        try:
            async with self._session.get(url, params=params or None, timeout=_TIMEOUT) as resp:
                resp.raise_for_status()
                data = await resp.json(content_type=None)
        except (ClientError, TimeoutError, ValueError) as err:
            raise QuranApiError(f"Failed to fetch {url}: {err}") from err
        if not isinstance(data, dict):
            raise QuranApiError(f"Unexpected response from {url}")
        if data.get("code") not in (200, None) and str(data.get("status", "")).upper() != "OK":
            raise QuranApiError(f"Al Quran Cloud error for {url}: {data.get('data') or data.get('status')}")
        return data

    async def fetch_catalog(self) -> Catalog:
        """Fetch Arabic ayah reciters and the 114 surahs."""
        editions, surahs = await asyncio.gather(
            self._get_json("edition", format="audio", type="versebyverse", language="ar"),
            self._get_json("surah"),
        )
        reciters: dict[str, Reciter] = {}
        for item in editions.get("data") or []:
            if item.get("format") != "audio" or item.get("type") != "versebyverse":
                continue
            identifier = str(item.get("identifier") or "").strip()
            if not identifier:
                continue
            reciters[identifier] = Reciter(
                id=identifier,
                name_en=str(item.get("englishName") or identifier).strip(),
                name_ar=str(item.get("name") or "").strip(),
            )
        chapters: dict[int, Chapter] = {}
        for item in surahs.get("data") or []:
            number = int(item["number"])
            chapters[number] = Chapter(
                number=number,
                name_en=str(item.get("englishName") or "").strip(),
                name_ar=str(item.get("name") or "").strip(),
                verses_count=int(item.get("numberOfAyahs") or 0),
                revelation_place=str(item.get("revelationType") or "").strip(),
            )
        if not reciters or len(chapters) < 114:
            raise QuranApiError("Al Quran Cloud catalog was incomplete")
        _LOGGER.debug(
            "Loaded %s ayah reciters and %s surahs from Al Quran Cloud",
            len(reciters),
            len(chapters),
        )
        return Catalog(reciters=reciters, chapters=chapters)

    async def bitrate_for(self, reciter_id: str) -> int:
        """Learn the CDN bitrate for a reciter from ayah 1:1."""
        cached = self._bitrates.get(reciter_id)
        if cached is not None:
            return cached
        data = await self._get_json(f"ayah/1:1/{reciter_id}")
        audio = str((data.get("data") or {}).get("audio") or "")
        bitrate = bitrate_from_audio_url(audio)
        self._bitrates[reciter_id] = bitrate
        return bitrate

    async def ayah_audio_url(self, catalog: Catalog, reciter_id: str, chapter: int, ayah: int) -> str:
        """Return the public MP3 URL for one ayah."""
        bitrate = await self.bitrate_for(str(reciter_id))
        number = catalog.global_ayah_number(chapter, ayah)
        return ayah_audio_url(str(reciter_id), number, bitrate)
