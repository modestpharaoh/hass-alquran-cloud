"""Tests for the Quran.com media source."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from custom_components.alquran_cloud.api import Catalog, Chapter, Reciter
from custom_components.alquran_cloud.const import MIME_TYPE_MP3
from custom_components.alquran_cloud.media_source import AlquranCloudMediaSource, _parse_identifier
from custom_components.alquran_cloud.video import LocalMediaError
from homeassistant.components.media_source import MediaSourceItem, Unresolvable
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
    assert _parse_identifier("reciter/ar.alafasy/chapter/1/ayah/3") == ("ar.alafasy", 1, 3, False)
    assert _parse_identifier("reciter/ar.alafasy/chapter/1/full") == ("ar.alafasy", 1, None, True)
    assert _parse_identifier("reciter/ar.husarymujawwad-2") == ("ar.husarymujawwad-2", None, None, False)
    assert _parse_identifier("nope") is None


@pytest.mark.asyncio
async def test_browse_favorites_and_resolve():
    source = _source()
    root = await source.async_browse_media(MediaSourceItem())
    assert root.children[0].title.startswith("★")
    assert "Husary" in root.children[0].title
    chapters = await source.async_browse_media(MediaSourceItem("reciter/ar.alafasy"))
    assert chapters.children[0].title == "001 · Al-Fatihah · 2 ayahs · Meccan"
    ayahs = await source.async_browse_media(MediaSourceItem("reciter/ar.alafasy/chapter/1"))
    assert ayahs.children[0].title == "001 · Al-Fatihah · 2 ayahs · Meccan"
    assert ayahs.children[0].can_play is True
    assert ayahs.children[0].can_expand is False
    assert ayahs.children[0].identifier == "reciter/ar.alafasy/chapter/1/full"
    assert [child.title for child in ayahs.children[1:]] == ["001:001", "001:002"]
    source.entry.options["display_language"] = "arabic"
    arabic = await source.async_browse_media(MediaSourceItem("reciter/ar.alafasy/chapter/1"))
    assert arabic.children[0].title == "001 · الفاتحة · 2 آيتان · مكية"
    media = await source.async_resolve_media(MediaSourceItem("reciter/ar.alafasy/chapter/1/ayah/2"))
    assert media.mime_type == MIME_TYPE_MP3
    assert media.url.endswith("/ar.alafasy/1_2.mp3")


@pytest.mark.asyncio
async def test_full_surah_uses_the_joined_cache(monkeypatch):
    source = _source()
    source.hass = object()
    source.entry.options["playback_speed"] = 0.75
    source.entry.runtime_data.store = object()
    seen = {}

    async def fake_prepare(hass, store, **kwargs):
        seen["hass"] = hass
        seen["store"] = store
        seen.update(kwargs)
        return SimpleNamespace(url="https://ha.example/api/alquran_cloud/media/token/001.mp3")

    monkeypatch.setattr(
        "custom_components.alquran_cloud.media_source.prepare_playback",
        fake_prepare,
    )
    media = await source.async_resolve_media(MediaSourceItem("reciter/ar.alafasy/chapter/1/full"))
    assert media.mime_type == MIME_TYPE_MP3
    assert media.url.endswith("/001.mp3")
    assert seen["hass"] is source.hass
    assert seen["store"] is source.entry.runtime_data.store
    assert seen["start_ayah"] == 1
    assert seen["end_ayah"] == 2
    assert seen["speed"] == 0.75
    assert seen["cache_days"] == 7
    assert seen["reciter"].id == "ar.alafasy"
    assert seen["chapter"].number == 1

    async def fail_prepare(*_args, **_kwargs):
        raise LocalMediaError("Al Quran Cloud is not ready to build this surah")

    monkeypatch.setattr(
        "custom_components.alquran_cloud.media_source.prepare_playback",
        fail_prepare,
    )
    with pytest.raises(Unresolvable):
        await source.async_resolve_media(MediaSourceItem("reciter/ar.alafasy/chapter/1/full"))
