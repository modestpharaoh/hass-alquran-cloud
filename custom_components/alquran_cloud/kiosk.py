"""Serve the Quran kiosk and build the URL a TV browser should open."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlencode
from typing import Any

from aiohttp import web

from .const import LANG_ARABIC
from .video import LocalMediaError

KIOSK_ROOT = Path(__file__).parent / "www" / "kiosk"
KIOSK_PREFIX = "/api/alquran_cloud/kiosk/"

VIDEO_BROWSER_PLATFORMS = frozenset(
    {
        "webostv",
        "samsungtv",
        "samsungtv_smart",
        "samsungtv_tizen",
        "androidtv",
    }
)


def kiosk_language(display_language: str) -> str:
    """Return the kiosk language code for an integration display language."""
    return "ar" if display_language == LANG_ARABIC else "en"


def build_kiosk_url(
    base: str,
    *,
    surah: int,
    ayah: int,
    end_ayah: int,
    verses_count: int,
    reciter: str,
    speed: float,
    repeat: int,
    auto_surah: bool,
    language: str,
    background_video: bool = True,
) -> str:
    """Return the kiosk URL for one reciter and ayah range."""
    params: dict[str, str] = {
        "surah": str(int(surah)),
        "ayah": str(int(ayah)),
        "reciter": reciter,
        "speed": f"{float(speed):g}",
        "repeat": str(int(repeat)),
        "auto_surah": "true" if auto_surah else "false",
        "language": language if language in {"en", "ar"} else "en",
        "background_video": "true" if background_video else "false",
    }
    if int(end_ayah) < int(verses_count):
        params["to_ayah"] = str(int(end_ayah))
    root = str(base).rstrip("/")
    return f"{root}{KIOSK_PREFIX}?{urlencode(params)}"


def hass_base_url(hass: Any) -> str:
    """Return the Home Assistant URL a TV on the LAN should open."""
    from homeassistant.helpers.network import NoURLAvailableError, get_url

    try:
        return str(get_url(hass, prefer_external=False, allow_internal=True)).rstrip("/")
    except NoURLAvailableError:
        try:
            return str(get_url(hass, prefer_external=True, allow_internal=True)).rstrip("/")
        except NoURLAvailableError as err:
            raise LocalMediaError(
                "Home Assistant has no URL the TV can open. Set one under Settings > System > Network."
            ) from err


def resolve_kiosk_file(root: Path, raw: str) -> Path | None:
    """Return a file inside the kiosk directory, or None."""
    relative = (raw or "").replace("\\", "/").lstrip("/")
    if not relative or relative.endswith("/"):
        relative = f"{relative}index.html"
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    return None


class QuranKioskView:
    """Serve the kiosk without a Home Assistant login.

    Assigned onto a HomeAssistantView subclass in __init__ so tests can import
    this module without the HTTP component.
    """

    url = "/api/alquran_cloud/kiosk/{path:.*}"
    name = "api:alquran_cloud:kiosk"
    requires_auth = False
    extra_urls = ["/api/alquran_cloud/kiosk", "/api/alquran_cloud/kiosk/"]

    async def get(self, request: web.Request, path: str = "") -> web.StreamResponse:
        """Return one kiosk file."""
        target = resolve_kiosk_file(KIOSK_ROOT, path or request.path.removeprefix("/api/alquran_cloud/kiosk"))
        if target is None:
            return web.Response(status=404, text="Not found")
        headers = None
        if target.suffix.lower() in {".html", ".js", ".css"}:
            headers = {"Cache-Control": "no-cache"}
        return web.FileResponse(target, headers=headers)
