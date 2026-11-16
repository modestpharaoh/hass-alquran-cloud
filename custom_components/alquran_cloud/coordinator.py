"""Data update coordinator for Al Quran Cloud."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import Catalog, QuranApi, QuranApiError
from .const import DEFAULT_UPDATE_INTERVAL_HOURS, DOMAIN, get_cache_days

_LOGGER = logging.getLogger(__name__)


class QuranCoordinator(DataUpdateCoordinator[Catalog]):
    """Fetch and cache the Al Quran Cloud catalog."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=timedelta(hours=DEFAULT_UPDATE_INTERVAL_HOURS),
        )
        self.entry = entry
        self.api = QuranApi(async_get_clientsession(hass))

    async def _async_update_data(self) -> Catalog:
        """Fetch the latest catalog from the API."""
        try:
            catalog = await self.api.fetch_catalog()
        except QuranApiError as err:
            raise UpdateFailed(str(err)) from err
        store = self.hass.data.get(DOMAIN, {}).get("store")
        if store is not None:
            await self.hass.async_add_executor_job(store.purge_expired, get_cache_days(self.entry.options))
            await self.hass.async_add_executor_job(store.forget_missing_tokens)
            store.prune_idle_locks()
        return catalog
