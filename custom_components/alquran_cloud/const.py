"""Constants for the Al Quran Cloud integration."""

from __future__ import annotations

DOMAIN = "alquran_cloud"

API_BASE = "https://api.alquran.cloud/v1"
AUDIO_CDN = "https://cdn.islamic.network/quran/audio"
IMAGE_CDN_LOW = "https://cdn.islamic.network/quran/images"
IMAGE_CDN_HIGH = "https://cdn.islamic.network/quran/images/high-resolution"

DEFAULT_UPDATE_INTERVAL_HOURS = 24

CONF_DISPLAY_LANGUAGE = "display_language"
CONF_CACHE_DAYS = "cache_days"
CONF_PLAYBACK_SPEED = "playback_speed"
CONF_WEBAPP = "webapp"
CONF_BACKGROUND_VIDEO = "background_video"
CONF_FAVORITE_RECITERS = "favorite_reciters"

LANG_ENGLISH = "english"
LANG_ARABIC = "arabic"
DISPLAY_LANGUAGES = [LANG_ENGLISH, LANG_ARABIC]

DEFAULT_DISPLAY_LANGUAGE = LANG_ENGLISH
DEFAULT_CACHE_DAYS = 7
DEFAULT_PLAYBACK_SPEED = 1.0
DEFAULT_WEBAPP = False
DEFAULT_BACKGROUND_VIDEO = False
DEFAULT_REPEAT = 1
DEFAULT_CONTINUE_SURAH = False
DEFAULT_LOOP = False
MIN_REPEAT = 1
MAX_REPEAT = 20

MIN_CACHE_DAYS = 1
MAX_CACHE_DAYS = 90
CHAPTER_COUNT = 114

PLAYBACK_SPEEDS = (0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)

END_OF_TRACK_SLACK_SECONDS = 5.0
END_OF_TRACK_RATIO = 0.95

ATTR_RECITER_ID = "reciter_id"
ATTR_SURAH = "surah"
ATTR_AYAH = "ayah"
ATTR_START_AYAH = "start_ayah"
ATTR_END_AYAH = "end_ayah"
ATTR_REPEAT = "repeat"
ATTR_CONTINUE_SURAH = "continue_surah"
ATTR_LOOP = "loop"
ATTR_SPEED = "speed"
ATTR_WEBAPP = "webapp"
ATTR_BACKGROUND_VIDEO = "background_video"

SERVICE_PLAY = "play"
SERVICE_STOP = "stop"
SERVICE_NEXT_SURAH = "next_surah"
SERVICE_PREVIOUS_SURAH = "previous_surah"
SERVICE_CLEAR_CACHE = "clear_cache"
SERVICE_CLEAR_AUDIO_CACHE = "clear_audio_cache"
SERVICE_CLEAR_VIDEO_CACHE = "clear_video_cache"
SERVICE_CLEAR_SOURCE_CACHE = "clear_source_cache"

MIME_TYPE_MP3 = "audio/mpeg"
CONTENT_TYPE_URL = "url"

ID_RECITER = "reciter"
ID_CHAPTER = "chapter"
ID_AYAH = "ayah"

CARD_URL = "/alquran_cloud/alquran-cloud-card.js"
MEDIA_VIEW_PATH = "/api/alquran_cloud/media/{token}/{filename}"


def get_favorite_reciter_ids(options: dict) -> list[str]:
    """Return saved favorite reciter edition identifiers."""
    raw = options.get(CONF_FAVORITE_RECITERS) or []
    if isinstance(raw, str):
        raw = [raw]
    ids: list[str] = []
    for item in raw:
        identifier = str(item).strip()
        if identifier and identifier not in ids:
            ids.append(identifier)
    return ids


def get_cache_days(options: dict) -> int:
    """Return how many days a joined MP3 stays cached."""
    try:
        days = int(options.get(CONF_CACHE_DAYS, DEFAULT_CACHE_DAYS))
    except (TypeError, ValueError):
        return DEFAULT_CACHE_DAYS
    return min(MAX_CACHE_DAYS, max(MIN_CACHE_DAYS, days))


def webapp_enabled(options: dict) -> bool:
    """Return whether playback should open the TV web app.

    `show_picture` is the previous name of this option.
    """
    if CONF_WEBAPP in options:
        return bool(options[CONF_WEBAPP])
    return bool(options.get("show_picture", DEFAULT_WEBAPP))


def get_display_language(options: dict) -> str:
    """Return the configured display language."""
    value = options.get(CONF_DISPLAY_LANGUAGE, DEFAULT_DISPLAY_LANGUAGE)
    return value if value in DISPLAY_LANGUAGES else DEFAULT_DISPLAY_LANGUAGE


def coerce_speed(value: object) -> float:
    """Return a supported playback speed."""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as err:
        raise ValueError(f"Unsupported playback speed: {value}") from err
    for speed in PLAYBACK_SPEEDS:
        if abs(number - speed) < 1e-6:
            return speed
    raise ValueError(
        "Unsupported playback speed. Use 0.5, 0.75, 1, 1.25, 1.5, 1.75, or 2."
    )


def ayah_image_url(chapter: int, ayah: int, quality: str = "low") -> str:
    """Return the Al Quran Cloud picture for one ayah."""
    base = IMAGE_CDN_HIGH if quality == "high" else IMAGE_CDN_LOW
    return f"{base}/{chapter}_{ayah}.png"


def ayah_audio_url(edition: str, global_number: int, bitrate: int) -> str:
    """Return the CDN MP3 for one global ayah number."""
    return f"{AUDIO_CDN}/{bitrate}/{edition}/{global_number}.mp3"
