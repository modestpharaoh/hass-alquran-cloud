"""Tests for ayah sessions, repeat, and TV dispatch."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from custom_components.alquran_cloud.api import Catalog, Chapter, Reciter
from custom_components.alquran_cloud.session import PlaybackSessionManager, ayah_at
from custom_components.alquran_cloud.video import PreparedMedia
from homeassistant.core import Event, HomeAssistant


class _State:
    def __init__(self, state, attributes=None):
        self.state = state
        self.attributes = attributes or {}


class _Api:
    async def ayah_audio_url(self, catalog, reciter_id, chapter, ayah):
        return f"https://cdn.islamic.network/quran/audio/128/{reciter_id}/{chapter:03d}{ayah:03d}.mp3"


def _catalog():
    return Catalog(
        reciters={"ar.alafasy": Reciter("ar.alafasy", "Alafasy", "مشاري", "")},
        chapters={
            1: Chapter(1, "Al-Fatihah", "الفاتحة", 7, "makkah"),
            2: Chapter(2, "Al-Baqarah", "البقرة", 3, "madinah"),
        },
    )


def _manager(hass: HomeAssistant):
    async def prepare(**kwargs):
        show = kwargs["webapp"]
        return PreparedMedia(
            url="https://ha.example/ayah.mp4" if show else "https://ha.example/range.mp3",
            content_type="video/mp4" if show else "audio/mpeg",
            title=kwargs.get("title", "001 · Al-Fatihah · الفاتحة"),
            artist=kwargs.get("artist", "Alafasy · مشاري"),
            marker=kwargs.get("marker", "surah"),
            image_url=kwargs.get("image_url") or "https://cdn.islamic.network/quran/images/1_1.png",
            webos=kwargs["platform"] == "webostv" and show,
            duration=8.0 if show else None,
            album="Madinah Mushaf · مصحف المدينة" if show else "",
            spans=((1, 0.0, 4.0), (2, 4.0, 8.0)) if show else (),
        )

    coordinator = SimpleNamespace(
        data=_catalog(),
        entry=SimpleNamespace(options={"display_language": "english"}),
        api=_Api(),
    )
    manager = PlaybackSessionManager(hass, coordinator)
    manager.set_preparer(prepare)
    return manager


def _play_calls(hass):
    calls = []
    for call in hass.services.async_call.await_args_list:
        domain, service, data = call.args[:3]
        if service == "play_media":
            calls.append((domain, data))
    return calls


async def _finish(manager, entity_id, *, position=30, duration=31):
    session = manager.get_session(entity_id)
    attrs = {
        "media_position": position,
        "media_duration": duration,
        "media_content_id": session.expected_url,
    }
    await manager._async_on_state_changed(
        Event({"entity_id": entity_id, "old_state": None, "new_state": _State("playing", attrs)})
    )
    await manager._async_on_state_changed(
        Event(
            {
                "entity_id": entity_id,
                "old_state": _State("playing", attrs),
                "new_state": _State("idle"),
            }
        )
    )


def test_ayah_at_uses_span_bounds():
    spans = ((1, 0.0, 4.0), (2, 4.0, 8.0), (3, 8.0, 12.0))
    assert ayah_at(spans, 0) == 1
    assert ayah_at(spans, 3.9) == 1
    assert ayah_at(spans, 4) == 2
    assert ayah_at(spans, 11.9) == 3
    assert ayah_at(spans, 12) == 3
    assert ayah_at((), 1) is None


@pytest.mark.asyncio
async def test_playing_position_updates_current_ayah(hass: HomeAssistant):
    manager = _manager(hass)
    await manager.async_start(
        "media_player.room",
        manager.catalog.get_reciter("ar.alafasy"),
        manager.catalog.get_chapter(1),
        1,
        repeat=1,
        continue_surah=False,
        loop=False,
        speed=1,
        webapp=False,
    )
    session = manager.get_session("media_player.room")
    session.spans = ((1, 0.0, 4.0), (2, 4.0, 8.0), (3, 8.0, 12.0))
    await manager._async_on_state_changed(
        Event(
            {
                "entity_id": "media_player.room",
                "old_state": None,
                "new_state": _State("playing", {"media_position": 5.2, "media_duration": 12}),
            }
        )
    )
    assert session.ayah == 2
    assert session.as_attr_dict()["spans"][1] == [2, 4.0, 8.0]


@pytest.mark.asyncio
async def test_repeat_then_next_surah(hass: HomeAssistant):
    manager = _manager(hass)
    chapter = manager.catalog.get_chapter(1)
    await manager.async_start(
        "media_player.room",
        manager.catalog.get_reciter("ar.alafasy"),
        chapter,
        1,
        repeat=2,
        continue_surah=True,
        loop=False,
        speed=1,
        webapp=False,
    )
    assert _play_calls(hass)[0][1]["media_content_type"] == "audio/mpeg"
    assert _play_calls(hass)[0][1]["extra"]["metadata"]["metadataType"] == 3
    assert _play_calls(hass)[0][1]["extra"]["metadata"]["images"][0]["url"].endswith("/1_1.png")
    await _finish(manager, "media_player.room")
    assert manager.get_session("media_player.room").chapter == 1
    await _finish(manager, "media_player.room")
    assert manager.get_session("media_player.room").chapter == 2


@pytest.mark.asyncio
async def test_loop_and_continue_and_stop(hass: HomeAssistant):
    manager = _manager(hass)
    reciter = manager.catalog.get_reciter("ar.alafasy")
    await manager.async_start(
        "media_player.room",
        reciter,
        manager.catalog.get_chapter(1),
        3,
        5,
        repeat=1,
        continue_surah=True,
        loop=True,
        speed=1,
        webapp=False,
    )
    await _finish(manager, "media_player.room")
    looped = manager.get_session("media_player.room")
    assert (looped.chapter, looped.start_ayah, looped.end_ayah) == (1, 3, 5)
    assert looped.continue_surah is False

    await manager.async_start(
        "media_player.room",
        reciter,
        manager.catalog.get_chapter(1),
        1,
        repeat=1,
        continue_surah=True,
        loop=False,
        speed=1,
        webapp=False,
    )
    await _finish(manager, "media_player.room")
    session = manager.get_session("media_player.room")
    assert (session.chapter, session.start_ayah) == (2, 1)

    await manager.async_skip_surah("media_player.room", step=-1)
    assert manager.get_session("media_player.room").chapter == 1
    await manager.async_stop("media_player.room")
    assert manager.get_session("media_player.room") is None
    assert any(call.args[1] == "media_stop" for call in hass.services.async_call.await_args_list)


@pytest.mark.asyncio
async def test_picture_opens_tv_browser(hass: HomeAssistant):
    manager = _manager(hass)
    reciter = manager.catalog.get_reciter("ar.alafasy")
    chapter = manager.catalog.get_chapter(1)
    with pytest.raises(ValueError, match="TV browser"):
        await manager.async_start(
            "media_player.cast",
            reciter,
            chapter,
            1,
            repeat=1,
            continue_surah=False,
            loop=True,
            speed=1,
            webapp=True,
            platform="cast",
        )
    assert manager.get_session("media_player.cast") is None

    await manager.async_start(
        "media_player.lg",
        reciter,
        chapter,
        1,
        3,
        repeat=2,
        continue_surah=False,
        loop=True,
        speed=1.75,
        webapp=True,
        platform="webostv",
    )
    session = manager.get_session("media_player.lg")
    assert session.loop is True
    assert session.ayah == 1
    webos = [
        call.args
        for call in hass.services.async_call.await_args_list
        if call.args[0] == "webostv"
    ]
    assert webos[-1][1] == "command"
    target = webos[-1][2]["payload"]["target"]
    assert target.startswith("http://ha.lan:8123/api/alquran_cloud/kiosk/?")
    assert "surah=1" in target and "ayah=1" in target and "to_ayah=3" in target
    assert "speed=1.75" in target and "repeat=2" in target and "auto_surah=false" in target
    assert "loop=true" in target
    assert "background_video=false" in target
    await _finish(manager, "media_player.lg")
    assert manager.get_session("media_player.lg").chapter == 1

    await manager.async_skip_surah("media_player.lg", step=1)
    opened = [
        call.args[2]["payload"]["target"]
        for call in hass.services.async_call.await_args_list
        if call.args[0] == "webostv" and call.args[1] == "command"
    ]
    assert "surah=2" in opened[-1]
    assert "to_ayah" not in opened[-1]
    await manager.async_stop("media_player.lg")
    assert manager.get_session("media_player.lg") is None
    assert any(
        call.args[0] == "webostv" and call.args[1] == "button" and call.args[2]["button"] == "HOME"
        for call in hass.services.async_call.await_args_list
    )

    await manager.async_start(
        "media_player.shield",
        reciter,
        chapter,
        1,
        repeat=1,
        continue_surah=True,
        loop=False,
        speed=1,
        webapp=True,
        platform="androidtv",
    )
    android = [
        call.args
        for call in hass.services.async_call.await_args_list
        if call.args[0] == "androidtv"
    ]
    assert android[-1][1] == "adb_command"
    assert "am start -a android.intent.action.VIEW" in android[-1][2]["command"]
    assert "auto_surah=true" in android[-1][2]["command"]

    calls = []

    async def samsung_call(*args, **kwargs):
        calls.append(args)
        if args[1] == "play_media" and args[2].get("media_content_type") == "browser":
            raise RuntimeError("browser unsupported")

    hass.services.async_call.side_effect = samsung_call
    await manager.async_start(
        "media_player.frame",
        reciter,
        chapter,
        1,
        repeat=1,
        continue_surah=False,
        loop=False,
        speed=1,
        webapp=True,
        platform="samsungtv",
    )
    browser = [args for args in calls if args[1] == "play_media" and args[2].get("media_content_type") == "browser"]
    fallback = [args for args in calls if args[1] == "play_media" and args[2].get("media_content_type") == "url"]
    assert browser and fallback
    assert "kiosk/" in fallback[-1][2]["media_content_id"]


@pytest.mark.asyncio
async def test_mid_track_stop_does_not_advance(hass: HomeAssistant):
    manager = _manager(hass)
    await manager.async_start(
        "media_player.room",
        manager.catalog.get_reciter("ar.alafasy"),
        manager.catalog.get_chapter(1),
        1,
        repeat=1,
        continue_surah=False,
        loop=False,
        speed=1,
        webapp=False,
    )
    await manager._async_on_call_service(
        Event(
            {
                "domain": "media_player",
                "service": "media_stop",
                "service_data": {"entity_id": "media_player.room"},
            }
        )
    )
    await _finish(manager, "media_player.room", position=3, duration=40)
    assert manager.get_session("media_player.room") is None


@pytest.mark.asyncio
async def test_webapp_ticket_queues_a_command_and_stores_a_report(hass: HomeAssistant):
    manager = _manager(hass)
    reciter = manager.catalog.get_reciter("ar.alafasy")
    chapter = manager.catalog.get_chapter(1)
    await manager.async_start(
        "media_player.lg",
        reciter,
        chapter,
        1,
        3,
        repeat=1,
        continue_surah=False,
        loop=False,
        speed=1,
        webapp=True,
        platform="webostv",
    )
    session = manager.get_session("media_player.lg")
    target = hass.services.async_call.await_args_list[-1].args[2]["payload"]["target"]
    assert f"control={session.control_ticket}" in target
    assert "control=" not in session.expected_url
    attrs = session.as_attr_dict()
    assert "control_ticket" not in attrs
    assert session.control_ticket not in str(attrs)
    assert attrs["live"] is False
    assert manager.session_for_ticket(session.control_ticket) is session
    assert manager.session_for_ticket("not-a-ticket") is None
    assert manager.queue_transport("media_player.lg", "pause") is True
    assert manager.queue_transport("media_player.lg", "next_ayah") is True
    assert manager.queue_transport("media_player.lg", "previous_surah") is True
    assert manager.queue_transport("media_player.lg", "sideways") is False
    assert await manager.wait_transport(session, timeout=0.05) == "pause"
    assert await manager.wait_transport(session, timeout=0.05) == "next_ayah"
    assert await manager.wait_transport(session, timeout=0.05) == "previous_surah"
    assert await manager.wait_transport(session, timeout=0.05) == ""
    manager.apply_report(session, reciter_id="ar.alafasy", surah=2, ayah=2, playing=True)
    assert session.live is True
    assert session.chapter == 2
    assert session.ayah == 2
    assert session.playing is True
    assert session.report_seq == 1
    assert session.as_attr_dict()["title"] == "002:002 · Al-Baqarah"
    assert manager.queue_transport("media_player.room", "play") is False
