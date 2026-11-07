"""Tests for joined audio, cache cleanup, and the kiosk URL."""

from __future__ import annotations

from pathlib import Path

import pytest

from custom_components.alquran_cloud.api import Chapter, Reciter
from custom_components.alquran_cloud.const import coerce_speed
from custom_components.alquran_cloud.kiosk import build_kiosk_url, resolve_kiosk_file
from custom_components.alquran_cloud.video import (
    LocalMediaError,
    MediaStore,
    build_range_audio,
    cache_is_fresh,
    cues_from_durations,
    ffmpeg_joined_audio_command,
    resolve_https_base,
    surah_tags,
)


def test_speed_includes_175():
    assert coerce_speed("0.5") == 0.5
    assert coerce_speed("1.75") == 1.75
    assert coerce_speed(1) == 1.0
    with pytest.raises(ValueError):
        coerce_speed(1.1)


def test_joined_audio_command_includes_175():
    command = ffmpeg_joined_audio_command("ffmpeg", Path("a.wav"), Path("a.mp3"), 1.75)
    assert "atempo=1.75" in command
    assert "libmp3lame" in command
    still = ffmpeg_joined_audio_command("ffmpeg", Path("a.wav"), Path("a.mp3"), 1)
    assert "atempo" not in still


def test_https_base_prefers_internal_and_rejects_http():
    class Missing(Exception):
        pass

    def get_url(**kwargs):
        if kwargs.get("allow_external") is False:
            raise Missing("no internal")
        return "https://ha.example:8123"

    def raising(**kwargs):
        raise Missing("none")

    assert resolve_https_base(get_url, Missing) == "https://ha.example:8123"

    def internal(**kwargs):
        if kwargs.get("allow_external") is False:
            return "https://home.lan"
        return "https://public.example"

    assert resolve_https_base(internal, Missing) == "https://home.lan"

    def only_http(**kwargs):
        return "http://192.168.1.10:8123"

    with pytest.raises(LocalMediaError, match="Settings > System > Network"):
        resolve_https_base(raising, Missing)
    with pytest.raises(LocalMediaError, match="Settings > System > Network"):
        resolve_https_base(only_http, Missing)


def test_surah_tags_and_back_to_back_cues():
    tags = surah_tags(
        Reciter("ar.alafasy", "Alafasy", "مشاري العفاسي", ""),
        Chapter(1, "Al-Faatiha", "سُورَةُ ٱلْفَاتِحَةِ", 7, "Meccan"),
    )
    assert tags.title == "001 · Al-Faatiha · 7 ayahs · Meccan"
    assert "Alafasy" in tags.artist and "مشاري العفاسي" in tags.artist
    assert tags.album == "Madinah Mushaf · مصحف المدينة"
    assert tags.comment == "001 · سُورَةُ ٱلْفَاتِحَةِ · 7 آيات · مكية"
    long = surah_tags(
        Reciter("ar.alafasy", "Alafasy", "مشاري العفاسي", ""),
        Chapter(2, "Al-Baqara", "سُورَةُ البَقَرَةِ", 286, "Medinan"),
    )
    assert long.comment == "002 · سُورَةُ البَقَرَةِ · 286 آية · مدنية"
    araf = surah_tags(
        Reciter("ar.alafasy", "Alafasy", "مشاري العفاسي", ""),
        Chapter(7, "Al-A'raaf", "سُورَةُ الأَعۡرَافِ", 206, "Meccan"),
    )
    assert araf.comment == "007 · سُورَةُ الأَعۡرَافِ · 206 آيات · مكية"
    cues = cues_from_durations([(1, 2.5), (2, 4.0)])
    assert cues[1].start == cues[0].end


def test_kiosk_url_and_file():
    url = build_kiosk_url(
        "http://ha.lan:8123",
        surah=67,
        ayah=1,
        end_ayah=5,
        verses_count=30,
        reciter="ar.alafasy",
        speed=1.75,
        repeat=2,
        auto_surah=False,
        language="en",
        background_video=False,
    )
    assert url.startswith("http://ha.lan:8123/api/alquran_cloud/kiosk/?")
    assert "surah=67" in url
    assert "ayah=1" in url
    assert "to_ayah=5" in url
    assert "reciter=ar.alafasy" in url
    assert "speed=1.75" in url
    assert "repeat=2" in url
    assert "auto_surah=false" in url
    assert "background_video=false" in url
    full = build_kiosk_url(
        "http://ha.lan:8123/",
        surah=1,
        ayah=1,
        end_ayah=7,
        verses_count=7,
        reciter="ar.alafasy",
        speed=1,
        repeat=1,
        auto_surah=True,
        language="ar",
    )
    assert "to_ayah" not in full
    assert "auto_surah=true" in full
    assert "loop=false" in full
    assert "background_video=false" in full
    assert "language=ar" in full
    root = Path(__file__).resolve().parents[1] / "custom_components" / "alquran_cloud" / "www" / "kiosk"
    assert resolve_kiosk_file(root, "") == root / "index.html"
    assert resolve_kiosk_file(root, "js/app.js") == root / "js" / "app.js"
    assert resolve_kiosk_file(root, "../const.py") is None


@pytest.mark.asyncio
async def test_range_audio_is_cached(tmp_path: Path):
    store = MediaStore(type("Hass", (), {"config": None})())
    store.cache_dir = tmp_path
    commands = []

    async def download(url, dest: Path):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"src")

    async def run(command):
        commands.append(command)
        Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(command[-1]).write_bytes(b"out")

    async def probe(path: Path):
        return 2.0

    chapter = Chapter(1, "Al-Faatiha", "الفاتحة", 2, "Meccan")
    path, cues = await build_range_audio(
        store,
        edition="ar.alafasy",
        chapter=chapter,
        cache_days=7,
        audio_for=lambda ayah: f"https://cdn.example/{ayah}.mp3",
        download=download,
        run_command=run,
        probe=probe,
        speed=1.75,
    )
    assert path.name == "001-001-002-s175.mp3"
    assert [cue.ayah for cue in cues] == [1, 2]
    assert any("atempo=1.75" in " ".join(command) for command in commands)
    again, _cues = await build_range_audio(
        store,
        edition="ar.alafasy",
        chapter=chapter,
        cache_days=7,
        audio_for=lambda ayah: f"https://cdn.example/{ayah}.mp3",
        download=download,
        run_command=run,
        probe=probe,
        speed=1.75,
    )
    assert again == path
    store.purge_expired(7, now=path.stat().st_mtime + 8 * 86400)
    assert not path.exists()
    assert cache_is_fresh(path, 7) is False


def test_clear_cache_kinds(tmp_path: Path):
    store = MediaStore(type("Hass", (), {"config": None})())
    store.cache_dir = tmp_path
    audio = tmp_path / "audio" / "ar.alafasy" / "001-001-007-s100.mp3"
    video = tmp_path / "surah" / "ar.alafasy" / "001-001-007-low.mp4"
    source = tmp_path / "src" / "ar.alafasy" / "001" / "001.mp3"
    picture = tmp_path / "src" / "ar.alafasy" / "001" / "low" / "001.png"
    for path in (audio, video, source, picture):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"data")
    store.publish(audio)
    assert store.clear("audio") == 1
    assert not audio.exists()
    assert video.is_file() and source.is_file() and picture.is_file()
    assert store.clear("video") == 2
    assert not video.exists()
    assert not picture.exists()
    assert source.is_file()
    assert store.clear("sources") == 1
    leftover = tmp_path / "audio" / "again.mp3"
    leftover.parent.mkdir(parents=True, exist_ok=True)
    leftover.write_bytes(b"data")
    assert store.clear("all") == 1
    assert list(tmp_path.iterdir()) == []
