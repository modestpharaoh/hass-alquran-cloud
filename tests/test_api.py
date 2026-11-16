"""Tests for the Al Quran Cloud API client."""

from __future__ import annotations

import pytest

from custom_components.alquran_cloud.api import (
    Catalog,
    Chapter,
    QuranApi,
    QuranApiError,
    ayah_after,
    ayah_before,
    bitrate_from_audio_url,
)
from custom_components.alquran_cloud.const import arabic_ayah_word, ayah_audio_url, ayah_image_url


class _Response:
    def __init__(self, payload):
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def raise_for_status(self):
        return None

    async def json(self, content_type=None):
        return self.payload


class _Session:
    def __init__(self, routes):
        self.routes = routes

    def get(self, url, params=None, timeout=None):
        params = params or {}
        key = (url, params.get("format"), params.get("type"), params.get("language"))
        if key not in self.routes:
            raise AssertionError(f"unexpected {key}")
        return _Response(self.routes[key])


def _chapters():
    return {
        1: Chapter(1, "Al-Faatiha", "سُورَةُ ٱلْفَاتِحَةِ", 7, "Meccan"),
        2: Chapter(2, "Al-Baqara", "سُورَةُ البَقَرَةِ", 286, "Medinan"),
    }


def test_audio_and_image_urls():
    assert ayah_audio_url("ar.alafasy", 262, 128) == (
        "https://cdn.islamic.network/quran/audio/128/ar.alafasy/262.mp3"
    )
    assert ayah_image_url(2, 255) == "https://cdn.islamic.network/quran/images/2_255.png"
    assert ayah_image_url(2, 255, "high") == (
        "https://cdn.islamic.network/quran/images/high-resolution/2_255.png"
    )
    assert bitrate_from_audio_url("https://cdn.islamic.network/quran/audio/64/ar.aymanswoaid/1.mp3") == 64
    catalog = Catalog(chapters=_chapters())
    assert catalog.global_ayah_number(1, 1) == 1
    assert catalog.global_ayah_number(2, 1) == 8
    assert catalog.global_ayah_number(2, 255) == 262


def test_ayah_navigation():
    assert ayah_after(1, 1, 7, auto_advance=True, continue_surah=False, loop=False) == (1, 2)
    assert ayah_after(1, 1, 7, auto_advance=False, continue_surah=False, loop=False) is None
    assert ayah_after(1, 7, 7, auto_advance=True, continue_surah=False, loop=True) == (1, 1)
    assert ayah_after(1, 7, 7, auto_advance=True, continue_surah=True, loop=False) == (2, 1)
    assert ayah_after(114, 6, 6, auto_advance=True, continue_surah=True, loop=True) == (1, 1)
    assert ayah_before(1, 2, continue_surah=False, previous_verse_count=None) == (1, 1)
    assert ayah_before(2, 1, continue_surah=True, previous_verse_count=7) == (1, 7)
    assert ayah_before(2, 1, continue_surah=False, previous_verse_count=7) is None


@pytest.mark.asyncio
async def test_fetch_catalog_and_ayah_audio():
    base = "https://api.alquran.cloud/v1"
    routes = {
        (f"{base}/edition", "audio", None, "ar"): {
            "code": 200,
            "status": "OK",
            "data": [
                {"identifier": "ar.alafasy", "englishName": "Alafasy", "name": "مشاري العفاسي", "format": "audio", "type": "versebyverse"},
                {"identifier": "ar.husarymujawwad", "englishName": "Husary", "name": "محمود خليل الحصري", "format": "audio", "type": "versebyverse"},
                {"identifier": "ar.minshawi", "englishName": "Minshawi", "name": "محمد صديق المنشاوي", "format": "audio", "type": "translation"},
                {"identifier": "ar.abdulbasitmurattal", "englishName": "Abdul Basit", "name": "عبد الباسط", "format": "audio", "type": "translation"},
                {"identifier": "ar.fullsurah", "englishName": "Full", "name": "سورة", "format": "audio", "type": "surahbysurah"},
                {"identifier": "en.walk", "englishName": "Walk", "name": "نص", "format": "text", "type": "versebyverse"},
            ],
        },
        (f"{base}/surah", None, None, None): {
            "code": 200,
            "status": "OK",
            "data": [
                {"number": number, "englishName": f"Surah {number}", "name": f"سورة {number}", "numberOfAyahs": 7 if number == 1 else 3, "revelationType": "Meccan"}
                for number in range(1, 115)
            ],
        },
        (f"{base}/ayah/1:1/ar.alafasy", None, None, None): {
            "code": 200,
            "status": "OK",
            "data": {"audio": "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3"},
        },
    }
    api = QuranApi(_Session(routes))
    catalog = await api.fetch_catalog()
    assert catalog.get_reciter("ar.alafasy").name_ar == "مشاري العفاسي"
    assert "ar.husarymujawwad" in catalog.get_reciter("ar.husarymujawwad").browse_title()
    assert catalog.get_reciter("ar.minshawi").name_en == "Minshawi"
    assert catalog.get_reciter("ar.abdulbasitmurattal").name_ar == "عبد الباسط"
    assert catalog.get_reciter("ar.fullsurah") is None
    assert catalog.get_reciter("en.walk") is None
    assert catalog.get_chapter(1).verses_count == 7
    assert await api.ayah_audio_url(catalog, "ar.alafasy", 2, 1) == (
        "https://cdn.islamic.network/quran/audio/128/ar.alafasy/8.mp3"
    )
    assert await api.bitrate_for("ar.alafasy") == 128


@pytest.mark.asyncio
async def test_fetch_catalog_rejects_a_surah_without_a_number():
    base = "https://api.alquran.cloud/v1"
    routes = {
        (f"{base}/edition", "audio", None, "ar"): {
            "code": 200,
            "status": "OK",
            "data": [
                {"identifier": "ar.alafasy", "englishName": "Alafasy", "name": "مشاري", "format": "audio", "type": "versebyverse"},
            ],
        },
        (f"{base}/surah", None, None, None): {
            "code": 200,
            "status": "OK",
            "data": [{"englishName": "Missing", "name": "سورة", "numberOfAyahs": 7}],
        },
    }
    api = QuranApi(_Session(routes))
    with pytest.raises(QuranApiError):
        await api.fetch_catalog()


def test_arabic_ayah_count_word():
    assert arabic_ayah_word(1) == "آية"
    assert arabic_ayah_word(2) == "آيتان"
    assert arabic_ayah_word(7) == "آيات"
    assert arabic_ayah_word(83) == "آية"
    assert arabic_ayah_word(200) == "آية"
    assert arabic_ayah_word(206) == "آيات"
    assert arabic_ayah_word(0) == "آية"
    assert arabic_ayah_word(11) == "آية"
    assert arabic_ayah_word(12) == "آية"
    assert arabic_ayah_word(99) == "آية"
    assert arabic_ayah_word(101) == "آية"
    assert arabic_ayah_word(102) == "آيتان"
    assert arabic_ayah_word(109) == "آيات"
    assert arabic_ayah_word(110) == "آيات"
    assert arabic_ayah_word(286) == "آية"
    fatiha = Chapter(1, "Al-Faatiha", "سُورَةُ ٱلْفَاتِحَةِ", 7, "Meccan")
    baqara = Chapter(2, "Al-Baqara", "سُورَةُ البَقَرَةِ", 286, "Medinan")
    assert fatiha.display_title("arabic") == "001 · سُورَةُ ٱلْفَاتِحَةِ · 7 آيات · مكية"
    assert baqara.display_title("arabic") == "002 · سُورَةُ البَقَرَةِ · 286 آية · مدنية"
    assert fatiha.display_title() == "001 · Al-Faatiha · 7 ayahs · Meccan"
    assert fatiha.playing_title(2) == "001 · Al-Faatiha · 7 ayahs · Meccan · Ayah 2"
    assert fatiha.playing_title(2, "arabic") == "001 · سُورَةُ ٱلْفَاتِحَةِ · 7 آيات · مكية · آية 2"
