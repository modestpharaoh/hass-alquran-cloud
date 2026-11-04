"""Config flow for Quran.com."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import (
    CONF_CACHE_DAYS,
    CONF_DISPLAY_LANGUAGE,
    CONF_FAVORITE_RECITERS,
    CONF_PLAYBACK_SPEED,
    CONF_SHOW_PICTURE,
    DEFAULT_CACHE_DAYS,
    DEFAULT_DISPLAY_LANGUAGE,
    DEFAULT_PLAYBACK_SPEED,
    DEFAULT_SHOW_PICTURE,
    DISPLAY_LANGUAGES,
    DOMAIN,
    MAX_CACHE_DAYS,
    MIN_CACHE_DAYS,
    PLAYBACK_SPEEDS,
    coerce_speed,
    get_cache_days,
    get_display_language,
    get_favorite_reciter_ids,
)


def _reciter_select_options(hass: HomeAssistant | None, language: str) -> list[dict[str, str]]:
    if hass is None:
        return []
    try:
        entries = hass.config_entries.async_entries(DOMAIN)
    except Exception:  # noqa: BLE001
        return []
    for entry in entries:
        runtime = getattr(entry, "runtime_data", None)
        catalog = getattr(getattr(runtime, "coordinator", None), "data", None)
        if catalog is None:
            continue
        return [
            {"value": str(reciter.id), "label": reciter.browse_title(language)}
            for reciter in catalog.sorted_reciters(language)
        ]
    return []


def _speed_default(options: dict[str, Any]) -> str:
    try:
        return f"{coerce_speed(options.get(CONF_PLAYBACK_SPEED, DEFAULT_PLAYBACK_SPEED)):g}"
    except ValueError:
        return "1"


def _options_schema(defaults: dict[str, Any], reciter_options: list[dict[str, str]]) -> vol.Schema:
    schema: dict[Any, Any] = {
        vol.Required(
            CONF_DISPLAY_LANGUAGE, default=get_display_language(defaults)
        ): SelectSelector(
            SelectSelectorConfig(
                options=DISPLAY_LANGUAGES,
                mode=SelectSelectorMode.DROPDOWN,
                translation_key=CONF_DISPLAY_LANGUAGE,
            )
        ),
        vol.Required(
            CONF_CACHE_DAYS, default=get_cache_days(defaults)
        ): NumberSelector(
            NumberSelectorConfig(
                min=MIN_CACHE_DAYS,
                max=MAX_CACHE_DAYS,
                mode=NumberSelectorMode.BOX,
                step=1,
            )
        ),
        vol.Required(CONF_PLAYBACK_SPEED, default=_speed_default(defaults)): SelectSelector(
            SelectSelectorConfig(
                options=[{"value": f"{speed:g}", "label": f"{speed:g}×"} for speed in PLAYBACK_SPEEDS],
                mode=SelectSelectorMode.DROPDOWN,
            )
        ),
        vol.Required(
            CONF_SHOW_PICTURE, default=bool(defaults.get(CONF_SHOW_PICTURE, DEFAULT_SHOW_PICTURE))
        ): BooleanSelector(),
    }
    if reciter_options:
        current = [str(item) for item in get_favorite_reciter_ids(defaults)]
        schema[vol.Optional(CONF_FAVORITE_RECITERS, default=current)] = SelectSelector(
            SelectSelectorConfig(
                options=reciter_options,
                multiple=True,
                mode=SelectSelectorMode.DROPDOWN,
            )
        )
    return vol.Schema(schema)


def _stored_options(user_input: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    if CONF_FAVORITE_RECITERS in user_input:
        favorites = get_favorite_reciter_ids(
            {CONF_FAVORITE_RECITERS: user_input.get(CONF_FAVORITE_RECITERS)}
        )
    else:
        favorites = get_favorite_reciter_ids(previous)
    return {
        CONF_DISPLAY_LANGUAGE: user_input.get(
            CONF_DISPLAY_LANGUAGE, get_display_language(previous)
        ),
        CONF_CACHE_DAYS: get_cache_days(
            {CONF_CACHE_DAYS: user_input.get(CONF_CACHE_DAYS, previous.get(CONF_CACHE_DAYS, DEFAULT_CACHE_DAYS))}
        ),
        CONF_PLAYBACK_SPEED: coerce_speed(
            user_input.get(CONF_PLAYBACK_SPEED, previous.get(CONF_PLAYBACK_SPEED, DEFAULT_PLAYBACK_SPEED))
        ),
        CONF_SHOW_PICTURE: bool(
            user_input.get(CONF_SHOW_PICTURE, previous.get(CONF_SHOW_PICTURE, DEFAULT_SHOW_PICTURE))
        ),
        CONF_FAVORITE_RECITERS: favorites,
    }


class AlquranCloudConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Quran.com."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Handle the initial step."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        language = get_display_language(user_input or {})
        reciter_options = _reciter_select_options(getattr(self, "hass", None), language)
        if user_input is not None:
            return self.async_create_entry(
                title="Al Quran Cloud",
                data={},
                options=_stored_options(user_input, {}),
            )
        return self.async_show_form(
            step_id="user",
            data_schema=_options_schema(
                {
                    CONF_DISPLAY_LANGUAGE: DEFAULT_DISPLAY_LANGUAGE,
                    CONF_CACHE_DAYS: DEFAULT_CACHE_DAYS,
                    CONF_PLAYBACK_SPEED: DEFAULT_PLAYBACK_SPEED,
                    CONF_SHOW_PICTURE: DEFAULT_SHOW_PICTURE,
                    CONF_FAVORITE_RECITERS: [],
                },
                reciter_options,
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow handler."""
        return AlquranCloudOptionsFlowHandler()


class AlquranCloudOptionsFlowHandler(OptionsFlow):
    """Handle Quran.com options."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manage options."""
        current = dict(self.config_entry.options)
        if user_input is not None:
            return self.async_create_entry(title="", data=_stored_options(user_input, current))
        return self.async_show_form(
            step_id="init",
            data_schema=_options_schema(
                current,
                _reciter_select_options(self.hass, get_display_language(current)),
            ),
        )
