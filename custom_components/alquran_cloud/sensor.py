"""Sensor for Quran.com session status."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, get_display_language


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the active-sessions sensor."""
    async_add_entities([QuranActiveSessionsSensor(entry, entry.runtime_data.sessions)])


class QuranActiveSessionsSensor(SensorEntity):
    """Report how many ayah sessions are active."""

    _attr_has_entity_name = True
    _attr_translation_key = "active_sessions"
    _attr_icon = "mdi:book-open-variant"

    def __init__(self, entry: ConfigEntry, sessions: Any) -> None:
        """Initialize the sensor."""
        self._entry = entry
        self._sessions = sessions
        self._attr_unique_id = f"{entry.entry_id}_active_sessions"
        self._unsub = None

    async def async_added_to_hass(self) -> None:
        """Subscribe to session changes."""
        self._unsub = self._sessions.async_add_listener(self._handle_update)

    async def async_will_remove_from_hass(self) -> None:
        """Unsubscribe from session changes."""
        if self._unsub:
            self._unsub()
            self._unsub = None

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        """Return the number of active sessions."""
        return len(self._sessions.sessions)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return per-player session details."""
        details = {
            entity_id: session.as_attr_dict()
            for entity_id, session in self._sessions.sessions.items()
        }
        details["display_language"] = get_display_language(self._entry.options)
        return details

    @property
    def device_info(self) -> DeviceInfo:
        """Return the integration service device."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name="Al Quran Cloud",
            manufacturer="alquran.cloud",
            model="Ayah playback",
            entry_type=DeviceEntryType.SERVICE,
        )
