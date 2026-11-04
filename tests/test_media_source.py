"""Tests for the Quran.com media source."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from custom_components.alquran_cloud.api import Catalog, Chapter, Reciter
from custom_components.alquran_cloud.const import MIME_TYPE_MP3
from custom_components.alquran_cloud.media_source import AlquranCloudMediaSource, _parse_identifier
from homeassistant.components.media_source import MediaSourceItem
from homeassistant.config_entries import ConfigEntry, ConfigEntryState


class _Api:
    async def ayah_audio_url(self, catalog, reciter_id, chapter, ayah):
        return f"https://cdn.islamic.network/quran/audio/128/{reciter_id}/{chapter}_{ayah}.mp3"


def _source():
    catalog = Catalog(
        reciters={
            "ar.alafasy": Reciter("ar.alafasy", "Alafasy", "مشاري", ""),
            "ar.husarymujawwad": Reciter("ar.husarymujawwad", "Husary", "الحصري", "Mujawwad"),
        },
        chapters={1: Chapter(1, "Al-Fatihah", "الفاتحة", 2, "makkah")},
    )
    entry = ConfigEntry(options={"display_language": "english", "favorite_reciters": ["ar.husarymujawwad"]})
    entry.state = ConfigEntryState.LOADED
    entry.runtime_data = SimpleNamespace(coordinator=SimpleNamespace(data=catalog, api=_Api()))
    return AlquranCloudMediaSource(None, entry)


def test_parse_identifier():
    assert _parse_identifier("reciter/ar.alafasy/chapter/1/ayah/3") == ("ar.alafasy", 1, 3)
    assert _parse_identifier("reciter/ar.husarymujawwad-2") == ("ar.husarymujawwad-2", None, None)
    assert _parse_identifier("nope") is None


@pytest.mark.asyncio
async def test_browse_favorites_and_resolve():
    source = _source()
    root = await source.async_browse_media(MediaSourceItem())
    assert root.children[0].title.startswith("★")
    assert "Husary" in root.children[0].title
    chapters = await source.async_browse_media(MediaSourceItem("reciter/ar.alafasy"))
    assert "Al-Fatihah" in chapters.children[0].title
    ayahs = await source.async_browse_media(MediaSourceItem("reciter/ar.alafasy/chapter/1"))
    assert len(ayahs.children) == 2
    media = await source.async_resolve_media(MediaSourceItem("reciter/ar.alafasy/chapter/1/ayah/2"))
    assert media.mime_type == MIME_TYPE_MP3
    assert media.url.endswith("/ar.alafasy/1_2.mp3")
