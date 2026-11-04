"""Tests for Quran.com services."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from custom_components.alquran_cloud.api import Catalog, Chapter, Reciter
from custom_components.alquran_cloud.const import DOMAIN
from custom_components.alquran_cloud.services import async_register_services
from custom_components.alquran_cloud.session import PlaybackSessionManager
from custom_components.alquran_cloud.video import MediaStore, PreparedMedia
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError


class _Api:
    async def ayah_audio_url(self, catalog, reciter_id, chapter, ayah):
        return f"https://example.test/{reciter_id}/{chapter}_{ayah}.mp3"


@pytest.mark.asyncio
async def test_play_defaults_and_missing_target(hass: HomeAssistant):
    catalog = Catalog(
        reciters={"ar.alafasy": Reciter("ar.alafasy", "Alafasy", "مشاري", "")},
        chapters={1: Chapter(1, "Al-Fatihah", "الفاتحة", 7, "makkah")},
    )
    coordinator = SimpleNamespace(
        data=catalog,
        entry=SimpleNamespace(options={}),
        api=_Api(),
    )
    sessions = PlaybackSessionManager(hass, coordinator)

    async def prepare(**_kwargs):
        return PreparedMedia(
            url="https://ha.example/range.mp3",
            content_type="audio/mpeg",
            title="001",
            artist="Alafasy",
            marker="range",
            image_url="",
        )

    sessions.set_preparer(prepare)
    async_register_services(hass, coordinator, sessions)
    handlers = {call.args[1]: call.args[2] for call in hass.services.async_register.call_args_list}

    await handlers["play"](
        ServiceCall({"reciter_id": "ar.alafasy", "entity_id": "media_player.room"})
    )
    session = sessions.get_session("media_player.room")
    assert session.start_ayah == 1
    assert session.end_ayah == 7
    assert session.full_surah is True
    assert session.repeat == 1
    assert session.continue_surah is False
    assert session.speed == 1
    assert session.webapp is False
    assert session.background_video is False

    with pytest.raises(HomeAssistantError):
        await handlers["play"](ServiceCall({"reciter_id": "ar.alafasy"}))


@pytest.mark.asyncio
async def test_clear_audio_cache(hass: HomeAssistant, tmp_path):
    coordinator = SimpleNamespace(data=None, entry=SimpleNamespace(options={}), api=_Api())
    sessions = PlaybackSessionManager(hass, coordinator)
    store = MediaStore(hass)
    store.cache_dir = tmp_path
    audio = tmp_path / "audio" / "range.mp3"
    video = tmp_path / "surah" / "range.mp4"
    audio.parent.mkdir()
    video.parent.mkdir()
    audio.write_bytes(b"mp3")
    video.write_bytes(b"mp4")
    hass.data[DOMAIN] = {"store": store}
    async_register_services(hass, coordinator, sessions)
    handlers = {call.args[1]: call.args[2] for call in hass.services.async_register.call_args_list}
    await handlers["clear_audio_cache"](ServiceCall({}))
    assert not audio.exists()
    assert video.is_file()
    picture = tmp_path / "src" / "ar.alafasy" / "001" / "high" / "001.png"
    source = tmp_path / "src" / "ar.alafasy" / "001" / "001.mp3"
    picture.parent.mkdir(parents=True)
    picture.write_bytes(b"png")
    source.write_bytes(b"mp3")
    await handlers["clear_video_cache"](ServiceCall({}))
    assert not video.exists()
    assert not picture.exists()
    assert source.is_file()
