"""Shared pytest fixtures and Home Assistant stubs."""

from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _ensure_ha_stubs() -> None:
    if "homeassistant" in sys.modules and hasattr(sys.modules["homeassistant"], "core"):
        try:
            import homeassistant.core  # noqa: F401

            return
        except ImportError:
            pass

    ha = types.ModuleType("homeassistant")
    sys.modules["homeassistant"] = ha

    ha_const = types.ModuleType("homeassistant.const")
    ha_const.ATTR_ENTITY_ID = "entity_id"
    ha_const.STATE_IDLE = "idle"
    ha_const.STATE_OFF = "off"
    ha_const.STATE_UNAVAILABLE = "unavailable"
    ha_const.EVENT_CALL_SERVICE = "call_service"
    ha_const.EVENT_HOMEASSISTANT_STARTED = "homeassistant_started"
    ha_const.SERVICE_TURN_OFF = "turn_off"
    ha_const.Platform = types.SimpleNamespace(SENSOR="sensor", BUTTON="button")
    sys.modules["homeassistant.const"] = ha_const

    ha_core = types.ModuleType("homeassistant.core")

    class CoreState:
        running = "RUNNING"
        starting = "STARTING"

    class HomeAssistant:
        def __init__(self) -> None:
            self.data = {}
            self.bus = MagicMock()
            self.bus.async_listen = MagicMock(return_value=MagicMock())
            self.services = MagicMock()
            self.services.has_service = MagicMock(return_value=False)
            self.services.async_register = MagicMock()
            self.services.async_remove = MagicMock()
            self.services.async_call = AsyncMock()
            self.config_entries = MagicMock()
            self.config_entries.async_entries = MagicMock(return_value=[])
            self.http = MagicMock()
            self.http.async_register_static_paths = AsyncMock()
            self.state = CoreState.starting

        async def async_add_executor_job(self, func, *args):
            return func(*args)

    class Event:
        def __init__(self, data=None):
            self.data = data or {}

    class ServiceCall:
        def __init__(self, data=None):
            self.data = data or {}

    def callback(func):
        return func

    ha_core.CoreState = CoreState
    ha_core.HomeAssistant = HomeAssistant
    ha_core.Event = Event
    ha_core.ServiceCall = ServiceCall
    ha_core.callback = callback
    sys.modules["homeassistant.core"] = ha_core

    ha_exc = types.ModuleType("homeassistant.exceptions")

    class HomeAssistantError(Exception):
        pass

    class ConfigEntryNotReady(Exception):
        pass

    ha_exc.HomeAssistantError = HomeAssistantError
    ha_exc.ConfigEntryNotReady = ConfigEntryNotReady
    sys.modules["homeassistant.exceptions"] = ha_exc

    ha_ce = types.ModuleType("homeassistant.config_entries")

    class ConfigEntry:
        def __init__(self, **kwargs):
            self.data = kwargs.get("data", {})
            self.options = kwargs.get("options", {})
            self.title = kwargs.get("title", "Quran.com")
            self.entry_id = kwargs.get("entry_id", "test")
            self.runtime_data = None
            self.state = "loaded"

        def async_on_unload(self, fn):
            return fn

        def add_update_listener(self, fn):
            return MagicMock()

    class ConfigFlow:
        def __init_subclass__(cls, domain=None, **kwargs):
            cls.domain = domain

        def async_abort(self, reason):
            return {"type": "abort", "reason": reason}

        def async_create_entry(self, title, data, options=None):
            return {"type": "create_entry", "title": title, "data": data, "options": options or {}}

        def async_show_form(self, step_id, data_schema=None, errors=None):
            return {"type": "form", "step_id": step_id, "data_schema": data_schema, "errors": errors}

        def _async_current_entries(self):
            return []

    class OptionsFlow:
        def __init__(self, config_entry=None):
            self.config_entry = config_entry or ConfigEntry()

        def async_create_entry(self, title, data):
            return {"type": "create_entry", "title": title, "data": data}

        def async_show_form(self, step_id, data_schema=None):
            return {"type": "form", "step_id": step_id, "data_schema": data_schema}

    class ConfigFlowResult(dict):
        pass

    ConfigEntryState = types.SimpleNamespace(LOADED="loaded", NOT_LOADED="not_loaded")
    ha_ce.ConfigEntry = ConfigEntry
    ha_ce.ConfigFlow = ConfigFlow
    ha_ce.OptionsFlow = OptionsFlow
    ha_ce.ConfigFlowResult = ConfigFlowResult
    ha_ce.ConfigEntryState = ConfigEntryState
    sys.modules["homeassistant.config_entries"] = ha_ce

    sys.modules["homeassistant.helpers"] = types.ModuleType("homeassistant.helpers")
    ha_cv = types.ModuleType("homeassistant.helpers.config_validation")

    def entity_ids(value):
        return [value] if isinstance(value, str) else list(value)

    ha_cv.entity_ids = entity_ids
    ha_cv.boolean = bool
    ha_cv.empty_config_schema = lambda domain: MagicMock()
    sys.modules["homeassistant.helpers.config_validation"] = ha_cv

    ha_typing = types.ModuleType("homeassistant.helpers.typing")
    ha_typing.ConfigType = dict
    sys.modules["homeassistant.helpers.typing"] = ha_typing

    ha_aio = types.ModuleType("homeassistant.helpers.aiohttp_client")
    ha_aio.async_get_clientsession = MagicMock()
    sys.modules["homeassistant.helpers.aiohttp_client"] = ha_aio

    ha_network = types.ModuleType("homeassistant.helpers.network")

    class NoURLAvailableError(Exception):
        pass

    def get_url(_hass, **_kwargs):
        return "http://ha.lan:8123"

    ha_network.NoURLAvailableError = NoURLAvailableError
    ha_network.get_url = get_url
    sys.modules["homeassistant.helpers.network"] = ha_network

    ha_er = types.ModuleType("homeassistant.helpers.entity_registry")
    ha_er.async_get = MagicMock(side_effect=RuntimeError("no registry"))
    sys.modules["homeassistant.helpers.entity_registry"] = ha_er

    ha_service = types.ModuleType("homeassistant.helpers.service")

    async def async_extract_entity_ids(*args):
        call = args[-1]
        raw = (getattr(call, "data", None) or {}).get("entity_id")
        if not raw:
            return set()
        return {raw} if isinstance(raw, str) else set(raw)

    ha_service.async_extract_entity_ids = async_extract_entity_ids
    sys.modules["homeassistant.helpers.service"] = ha_service

    ha_uc = types.ModuleType("homeassistant.helpers.update_coordinator")

    class UpdateFailed(Exception):
        pass

    class DataUpdateCoordinator:
        def __class_getitem__(cls, item):
            return cls

        def __init__(self, hass, logger, name=None, config_entry=None, update_interval=None):
            self.hass = hass
            self.logger = logger
            self.name = name
            self.config_entry = config_entry
            self.update_interval = update_interval
            self.data = None

        async def async_config_entry_first_refresh(self):
            self.data = await self._async_update_data()

    ha_uc.DataUpdateCoordinator = DataUpdateCoordinator
    ha_uc.UpdateFailed = UpdateFailed
    sys.modules["homeassistant.helpers.update_coordinator"] = ha_uc

    ha_selector = types.ModuleType("homeassistant.helpers.selector")

    class _Selector:
        def __init__(self, config=None, **kwargs):
            self.config = config
            self.kwargs = kwargs

        def __call__(self, value):
            return value

    class NumberSelectorMode:
        BOX = "box"

    class SelectSelectorMode:
        DROPDOWN = "dropdown"

    ha_selector.NumberSelector = _Selector
    ha_selector.NumberSelectorConfig = _Selector
    ha_selector.NumberSelectorMode = NumberSelectorMode
    ha_selector.SelectSelector = _Selector
    ha_selector.SelectSelectorConfig = _Selector
    ha_selector.SelectSelectorMode = SelectSelectorMode
    ha_selector.BooleanSelector = _Selector
    sys.modules["homeassistant.helpers.selector"] = ha_selector

    ha_mp = types.ModuleType("homeassistant.components.media_player")
    ha_mp.ATTR_MEDIA_CONTENT_ID = "media_content_id"
    ha_mp.ATTR_MEDIA_CONTENT_TYPE = "media_content_type"
    ha_mp.ATTR_MEDIA_DURATION = "media_duration"
    ha_mp.ATTR_MEDIA_POSITION = "media_position"
    ha_mp.DOMAIN = "media_player"
    ha_mp.SERVICE_PLAY_MEDIA = "play_media"
    ha_mp.SERVICE_MEDIA_STOP = "media_stop"
    ha_mp.MediaClass = types.SimpleNamespace(CHANNEL="channel", DIRECTORY="directory", TRACK="track", MUSIC="music")
    ha_mp.MediaType = types.SimpleNamespace(MUSIC="music")
    ha_mp.MediaPlayerState = types.SimpleNamespace(PLAYING="playing", IDLE="idle", OFF="off", PAUSED="paused")

    class BrowseError(Exception):
        pass

    ha_mp.BrowseError = BrowseError
    sys.modules["homeassistant.components"] = types.ModuleType("homeassistant.components")
    sys.modules["homeassistant.components.media_player"] = ha_mp

    ha_dr = types.ModuleType("homeassistant.helpers.device_registry")
    ha_dr.DeviceEntryType = types.SimpleNamespace(SERVICE="service")
    ha_dr.DeviceInfo = lambda **kwargs: kwargs
    sys.modules["homeassistant.helpers.device_registry"] = ha_dr

    ha_sensor = types.ModuleType("homeassistant.components.sensor")

    class SensorEntity:
        def async_write_ha_state(self):
            pass

    ha_sensor.SensorEntity = SensorEntity
    sys.modules["homeassistant.components.sensor"] = ha_sensor

    ha_button = types.ModuleType("homeassistant.components.button")

    class ButtonEntity:
        def async_write_ha_state(self):
            pass

    ha_button.ButtonEntity = ButtonEntity
    sys.modules["homeassistant.components.button"] = ha_button

    ha_ep = types.ModuleType("homeassistant.helpers.entity_platform")
    ha_ep.AddEntitiesCallback = object
    sys.modules["homeassistant.helpers.entity_platform"] = ha_ep

    ha_ms = types.ModuleType("homeassistant.components.media_source")

    class MediaSource:
        def __init__(self, domain):
            self.domain = domain

    class MediaSourceItem:
        def __init__(self, identifier=None):
            self.identifier = identifier

    class BrowseMediaSource:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class PlayMedia:
        def __init__(self, url, mime_type):
            self.url = url
            self.mime_type = mime_type

    class Unresolvable(Exception):
        pass

    ha_ms.MediaSource = MediaSource
    ha_ms.MediaSourceItem = MediaSourceItem
    ha_ms.BrowseMediaSource = BrowseMediaSource
    ha_ms.PlayMedia = PlayMedia
    ha_ms.Unresolvable = Unresolvable
    sys.modules["homeassistant.components.media_source"] = ha_ms

    ha_frontend = types.ModuleType("homeassistant.components.frontend")

    def add_extra_js_url(_hass, url):
        add_extra_js_url.calls.append(url)

    add_extra_js_url.calls = []
    ha_frontend.add_extra_js_url = add_extra_js_url
    sys.modules["homeassistant.components.frontend"] = ha_frontend

    ha_http = types.ModuleType("homeassistant.components.http")

    class StaticPathConfig:
        def __init__(self, url_path, path, cache_headers=True):
            self.url_path = url_path
            self.path = path
            self.cache_headers = cache_headers

    class HomeAssistantView:
        pass

    ha_http.StaticPathConfig = StaticPathConfig
    ha_http.HomeAssistantView = HomeAssistantView
    sys.modules["homeassistant.components.http"] = ha_http


_ensure_ha_stubs()


@pytest.fixture
def hass():
    from homeassistant.core import HomeAssistant

    return HomeAssistant()
