"""The Al Quran Cloud integration."""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import CARD_URL, DOMAIN
from .coordinator import QuranCoordinator
from .kiosk import QuranKioskView
from .services import async_register_services, async_unregister_services
from .session import PlaybackSessionManager
from .video import MediaStore, QuranMediaView, prepare_playback

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)
PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.BUTTON]


class QuranMediaHttpView(HomeAssistantView):
    """Unauthenticated file view for joined ayah audio."""

    url = QuranMediaView.url
    name = QuranMediaView.name
    requires_auth = False

    async def get(self, request, token: str, filename: str):
        """Return the cached file for this token."""
        return await QuranMediaView.get(self, request, token, filename)


class QuranKioskHttpView(HomeAssistantView):
    """Unauthenticated kiosk for TV browsers."""

    url = QuranKioskView.url
    extra_urls = QuranKioskView.extra_urls
    name = QuranKioskView.name
    requires_auth = False

    def register(self, hass, app, router) -> None:
        """Remember hass. The base view does not keep it on the instance."""
        self.hass = hass
        super().register(hass, app, router)

    async def get(self, request, path: str = ""):
        """Return one kiosk file."""
        return await QuranKioskView.get(self, request, path)


@dataclass(slots=True)
class QuranRuntimeData:
    """Runtime data attached to the config entry."""

    coordinator: QuranCoordinator
    sessions: PlaybackSessionManager
    store: MediaStore


type QuranConfigEntry = ConfigEntry[QuranRuntimeData]

_STATIC_READY = "static_ready"
_CARD_RESOURCE_READY = "card_resource_ready"
_VIEW_READY = "view_ready"


def _card_url() -> str:
    root = Path(__file__).parent
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    return f"{CARD_URL}?v={manifest['version']}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the card, static files, and media view."""
    hass.data.setdefault(DOMAIN, {})
    await _async_register_static(hass)
    _async_register_view(hass)
    _schedule_card_resource(hass)
    return True


def _ha_has_started(hass: HomeAssistant) -> bool:
    return getattr(hass, "state", None) is CoreState.running


def _schedule_card_resource(hass: HomeAssistant) -> None:
    if _ha_has_started(hass):
        hass.async_create_task(_async_register_card(hass))
        return

    async def _on_started(_event) -> None:
        await _async_register_card(hass)

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started)


def _async_register_view(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(_VIEW_READY):
        return
    hass.http.register_view(QuranMediaHttpView())
    hass.http.register_view(QuranKioskHttpView())
    domain_data[_VIEW_READY] = True


async def _async_register_static(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(_STATIC_READY):
        return
    root = Path(__file__).parent
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig("/alquran_cloud", str(root / "www"), False),
            StaticPathConfig("/alquran_cloud_brand", str(root / "brand"), False),
        ]
    )
    domain_data[_STATIC_READY] = True


async def _async_register_card(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(_CARD_RESOURCE_READY):
        return
    card_url = _card_url()
    lovelace = hass.data.get("lovelace")
    resources = getattr(lovelace, "resources", None)
    if getattr(lovelace, "resource_mode", None) != "storage" or resources is None:
        _LOGGER.warning(
            "Al Quran Cloud card was not added to dashboard resources because "
            "Lovelace storage resources are not available yet"
        )
        add_extra_js_url(hass, card_url)
        domain_data[_CARD_RESOURCE_READY] = True
        return
    try:
        if not getattr(resources, "loaded", True):
            await resources.async_get_info()
        for item in resources.async_items():
            url = str(item.get("url", ""))
            if url.split("?", 1)[0] != CARD_URL:
                continue
            if url != card_url:
                await resources.async_update_item(
                    item["id"], {"res_type": "module", "url": card_url}
                )
            domain_data[_CARD_RESOURCE_READY] = True
            return
        await resources.async_create_item({"res_type": "module", "url": card_url})
        domain_data[_CARD_RESOURCE_READY] = True
    except Exception:
        _LOGGER.exception("Could not register the Al Quran Cloud card as a dashboard resource")
        add_extra_js_url(hass, card_url)


async def async_setup_entry(hass: HomeAssistant, entry: QuranConfigEntry) -> bool:
    """Set up Al Quran Cloud from a config entry."""
    store = MediaStore(hass)
    await hass.async_add_executor_job(store.clear_video)
    hass.data.setdefault(DOMAIN, {})["store"] = store
    coordinator = QuranCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    sessions = PlaybackSessionManager(hass, coordinator)

    async def _prepare(**kwargs):
        return await prepare_playback(hass, store, api=coordinator.api, **kwargs)

    sessions.set_preparer(_prepare)
    entry.runtime_data = QuranRuntimeData(
        coordinator=coordinator,
        sessions=sessions,
        store=store,
    )
    async_register_services(hass, coordinator, sessions)
    if _ha_has_started(hass):
        await _async_register_card(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    _LOGGER.info(
        "Al Quran Cloud ready (%s ayah reciters)",
        len(coordinator.data.reciters) if coordinator.data else 0,
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: QuranConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    entry.runtime_data.sessions.async_unload()
    other_entries = [
        item
        for item in hass.config_entries.async_entries(DOMAIN)
        if item.entry_id != entry.entry_id
    ]
    if not other_entries:
        async_unregister_services(hass)
        hass.data.get(DOMAIN, {}).pop("store", None)
    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: QuranConfigEntry) -> None:
    """Reload when options change."""
    await hass.config_entries.async_reload(entry.entry_id)
