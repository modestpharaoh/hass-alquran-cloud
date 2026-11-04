"""Stop buttons for Quran.com sessions."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create a stop button the first time each player starts a session."""
    sessions = entry.runtime_data.sessions
    known: dict[str, QuranStopButton] = {}

    async def _ensure_button(media_player_entity_id: str) -> None:
        if media_player_entity_id in known:
            return
        button = QuranStopButton(entry, sessions, media_player_entity_id)
        known[media_player_entity_id] = button
        async_add_entities([button])
        _LOGGER.debug("Created stop button for %s", media_player_entity_id)

    sessions.set_button_factory(_ensure_button)


class QuranStopButton(ButtonEntity):
    """Stop the Quran.com session on one media player."""

    _attr_has_entity_name = True
    _attr_translation_key = "stop_session"
    _attr_icon = "mdi:stop-circle-outline"

    def __init__(self, entry: ConfigEntry, sessions: Any, media_player_entity_id: str) -> None:
        """Initialize the stop button."""
        self._entry = entry
        self._sessions = sessions
        self._media_player_entity_id = media_player_entity_id
        suffix = media_player_entity_id.removeprefix("media_player.")
        self._attr_unique_id = f"{entry.entry_id}_stop_{suffix}"
        self._attr_name = f"Stop Al Quran Cloud ({suffix.replace('_', ' ').title()})"

    @property
    def available(self) -> bool:
        """Stay available after the session ends."""
        return True

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the linked player and session."""
        session = self._sessions.get_session(self._media_player_entity_id)
        return {
            "media_player": self._media_player_entity_id,
            "session_active": session is not None,
            "session": session.as_attr_dict() if session else None,
        }

    @property
    def device_info(self) -> DeviceInfo:
        """Group under the Quran.com service device."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name="Al Quran Cloud",
            manufacturer="alquran.cloud",
            model="Ayah playback",
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_press(self) -> None:
        """Stop the session and the current media."""
        await self._sessions.async_stop(self._media_player_entity_id, stop_media=True)
        self.async_write_ha_state()
