"""Serve the Quran kiosk and build the URL a TV browser should open."""

from __future__ import annotations

import logging
import re
from ipaddress import ip_address, ip_network
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from aiohttp import ClientError, ClientSession, ClientTimeout, web

from .const import CONF_KIOSK_ALLOW_PRIVATE, CONF_KIOSK_TRUSTED_NETWORKS, DOMAIN, LANG_ARABIC
from .video import LocalMediaError

_LOGGER = logging.getLogger(__name__)
_REFUSED_REMOTES: set[str] = set()
_EMPTY_ADAPTERS_LOGGED = False

KIOSK_ROOT = Path(__file__).parent / "www" / "kiosk"
KIOSK_PREFIX = "/api/alquran_cloud/kiosk/"
_AUDIO_BITRATES = {32, 40, 48, 64, 128, 192}
_AYAH_AUDIO_COUNT = 6236
_EDITION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_LOOKAHEAD_AUDIO = re.compile(r"^audio/(\d+)/([^/]+)/(\d+)\.mp3$")

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
    loop: bool = False,
    background_video: bool = False,
) -> str:
    """Return the kiosk URL for one reciter and ayah range."""
    params: dict[str, str] = {
        "surah": str(int(surah)),
        "ayah": str(int(ayah)),
        "reciter": reciter,
        "speed": f"{float(speed):g}",
        "repeat": str(int(repeat)),
        "auto_surah": "true" if auto_surah else "false",
        "loop": "true" if loop else "false",
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


def lookahead_audio_url(path: str) -> str | None:
    """Return the CDN MP3 for one lookahead path, or None when the path is not one ayah."""
    match = _LOOKAHEAD_AUDIO.fullmatch((path or "").split("?", 1)[0].lstrip("/"))
    if match is None:
        return None
    bitrate = int(match.group(1))
    edition = match.group(2)
    number = int(match.group(3))
    if bitrate not in _AUDIO_BITRATES or _EDITION_ID.fullmatch(edition) is None:
        return None
    if number < 1 or number > _AYAH_AUDIO_COUNT:
        return None
    return f"https://cdn.islamic.network/quran/audio/{bitrate}/{edition}/{number}.mp3"


async def stream_lookahead_audio(request: web.Request, url: str, hass: Any) -> web.StreamResponse:
    """Pass one CDN ayah through to the TV. The bytes are not stored."""
    session: ClientSession | None = None
    owns_session = False
    if hass is not None:
        try:
            from homeassistant.helpers.aiohttp_client import async_get_clientsession

            session = async_get_clientsession(hass)
        except (ImportError, RuntimeError, AttributeError):
            session = None
    if session is None:
        session = ClientSession(timeout=ClientTimeout(total=60))
        owns_session = True
    try:
        async with session.get(url) as upstream:
            if upstream.status != 200:
                return web.Response(status=502, text="Audio was not available")
            headers = {"Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400"}
            length = upstream.headers.get("Content-Length")
            if length and length.isdigit():
                headers["Content-Length"] = length
            response = web.StreamResponse(status=200, headers=headers)
            await response.prepare(request)
            async for chunk in upstream.content.iter_chunked(64 * 1024):
                await response.write(chunk)
            await response.write_eof()
            return response
    except (ClientError, TimeoutError, OSError):
        return web.Response(status=502, text="Audio was not available")
    finally:
        if owns_session:
            await session.close()


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


class InvalidTrustedNetwork(ValueError):
    """A trusted-subnet option could not be parsed, or it was the whole internet."""


def parse_trusted_networks(raw: object) -> list[str]:
    """Return canonical CIDRs. A bare address is a single host. ``/0`` is refused."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        text = "\n".join(str(item) for item in raw)
    else:
        text = str(raw)
    tokens = [part for part in text.replace(",", " ").replace(";", " ").split() if part]
    networks: list[str] = []
    for token in tokens:
        try:
            if "/" not in token:
                address = ip_address(token)
                token = f"{address}/{address.max_prefixlen}"
            network = ip_network(token, strict=False)
        except ValueError as err:
            raise InvalidTrustedNetwork(token) from err
        if network.prefixlen == 0:
            raise InvalidTrustedNetwork(token)
        rendered = str(network)
        if rendered not in networks:
            networks.append(rendered)
    return networks


def _client_ip(remote: str | None):
    if not remote:
        return None
    try:
        ip = ip_address(remote)
    except ValueError:
        return None
    mapped = getattr(ip, "ipv4_mapped", None)
    return mapped or ip


def client_on_kiosk_network(
    remote: str | None,
    adapter_networks,
    *,
    allow_private: bool = False,
    trusted=(),
) -> bool:
    """Allow loopback, an enabled adapter subnet, or an explicit option."""
    ip = _client_ip(remote)
    if ip is None:
        return False
    if ip.is_loopback:
        return True
    if allow_private and ip.is_private:
        return True
    for network in (*adapter_networks, *trusted):
        if ip in network:
            return True
    return False


def networks_from_adapters(adapters) -> list:
    """Build subnets from enabled Home Assistant adapters (objects or dicts)."""
    networks = []
    for adapter in adapters or []:
        enabled = adapter.get("enabled") if isinstance(adapter, dict) else getattr(adapter, "enabled", True)
        if enabled is False:
            continue
        addresses = []
        for key in ("ipv4", "ipv6"):
            group = adapter.get(key) if isinstance(adapter, dict) else getattr(adapter, key, None)
            if group:
                addresses.extend(group)
        for item in addresses:
            if isinstance(item, dict):
                raw, prefix = item.get("address"), item.get("network_prefix")
            else:
                raw = getattr(item, "address", None)
                prefix = getattr(item, "network_prefix", None)
            if raw is None or prefix is None:
                continue
            try:
                networks.append(ip_network(f"{raw}/{int(prefix)}", strict=False))
            except (TypeError, ValueError):
                continue
    return networks


def kiosk_access_from_options(options: dict | None) -> tuple[bool, list]:
    """Read the private-address switch and any saved trusted subnets."""
    options = options or {}
    allow_private = bool(options.get(CONF_KIOSK_ALLOW_PRIVATE, False))
    try:
        trusted = [ip_network(item, strict=False) for item in parse_trusted_networks(options.get(CONF_KIOSK_TRUSTED_NETWORKS, ""))]
    except InvalidTrustedNetwork:
        trusted = []
    return allow_private, trusted


def _request_hass(view: object, request: web.Request):
    """Return the Home Assistant instance for this request.

    Home Assistant does not set ``hass`` on the view. It stores it on the
    aiohttp application, including the ``"hass"`` key kept for older callers.
    """
    hass = getattr(view, "hass", None)
    if hass is not None:
        return hass
    app = getattr(request, "app", None)
    if app is None:
        return None
    try:
        return app["hass"]
    except (KeyError, TypeError, LookupError):
        return None


def _entry_options(hass) -> dict:
    entries = getattr(getattr(hass, "config_entries", None), "async_entries", None)
    if entries is None:
        return {}
    found = entries(DOMAIN)
    if not found:
        return {}
    return dict(getattr(found[0], "options", None) or {})


async def adapter_networks(hass) -> list:
    """Enabled adapter subnets. An empty list is logged once and not invented."""
    global _EMPTY_ADAPTERS_LOGGED
    adapters = None
    try:
        from homeassistant.components.network import async_get_adapters
    except ImportError:
        async_get_adapters = None
    if hass is not None and async_get_adapters is not None:
        try:
            adapters = await async_get_adapters(hass)
        except Exception:  # noqa: BLE001 - a missing network component must not break the page
            adapters = None
    networks = networks_from_adapters(adapters)
    if networks or _EMPTY_ADAPTERS_LOGGED:
        return networks
    _EMPTY_ADAPTERS_LOGGED = True
    _LOGGER.warning(
        "No Home Assistant network adapters found. The Quran player stays limited to loopback until an adapter or a trusted subnet is configured"
    )
    return networks


def _refuse(
    remote: str | None,
    *,
    allow_private: bool,
    adapter_count: int,
    trusted_count: int,
) -> web.Response:
    key = remote or ""
    detail = (
        "private addresses allowed" if allow_private else "private addresses not allowed",
        f"{adapter_count} adapter subnets",
        f"{trusted_count} trusted subnets",
    )
    if key in _REFUSED_REMOTES:
        _LOGGER.debug("Refused Quran player request from %s (%s)", remote, ", ".join(detail))
    else:
        _REFUSED_REMOTES.add(key)
        _LOGGER.warning("Refused Quran player request from %s (%s)", remote, ", ".join(detail))
    return web.Response(status=403, text="This page is only available on the Home Assistant machine's local network.")


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
        """Return one kiosk file, or 403 when the client is not on a trusted network."""
        hass = _request_hass(self, request)
        remote = getattr(request, "remote", None)
        allow_private, trusted = kiosk_access_from_options(_entry_options(hass) if hass is not None else {})
        networks = await adapter_networks(hass)
        if not client_on_kiosk_network(
            remote,
            networks,
            allow_private=allow_private,
            trusted=trusted,
        ):
            return _refuse(
                remote,
                allow_private=allow_private,
                adapter_count=len(networks),
                trusted_count=len(trusted),
            )
        cdn_audio = lookahead_audio_url(path)
        if cdn_audio:
            return await stream_lookahead_audio(request, cdn_audio, hass)
        target = resolve_kiosk_file(KIOSK_ROOT, path or request.path.removeprefix("/api/alquran_cloud/kiosk"))
        if target is None:
            return web.Response(status=404, text="Not found")
        headers = None
        if target.suffix.lower() in {".html", ".js", ".css"}:
            headers = {"Cache-Control": "no-cache"}
        return web.FileResponse(target, headers=headers)
