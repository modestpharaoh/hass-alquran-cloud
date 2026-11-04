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
    TextSelector,
    TextSelectorConfig,
)

from .const import (
    CONF_CACHE_DAYS,
    CONF_DISPLAY_LANGUAGE,
    CONF_FAVORITE_RECITERS,
    CONF_KIOSK_ALLOW_PRIVATE,
    CONF_KIOSK_TRUSTED_NETWORKS,
    CONF_PLAYBACK_SPEED,
    CONF_WEBAPP,
    DEFAULT_CACHE_DAYS,
    DEFAULT_DISPLAY_LANGUAGE,
    DEFAULT_PLAYBACK_SPEED,
    DEFAULT_WEBAPP,
    DISPLAY_LANGUAGES,
    DOMAIN,
    MAX_CACHE_DAYS,
    MIN_CACHE_DAYS,
    PLAYBACK_SPEEDS,
    coerce_speed,
    get_cache_days,
    get_display_language,
    get_favorite_reciter_ids,
    webapp_enabled,
)
from .kiosk import InvalidTrustedNetwork, parse_trusted_networks


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
            CONF_WEBAPP, default=webapp_enabled(defaults)
        ): BooleanSelector(),
        vol.Required(
            CONF_KIOSK_ALLOW_PRIVATE,
            default=bool(defaults.get(CONF_KIOSK_ALLOW_PRIVATE, False)),
        ): BooleanSelector(),
        vol.Optional(
            CONF_KIOSK_TRUSTED_NETWORKS,
            default=str(defaults.get(CONF_KIOSK_TRUSTED_NETWORKS) or ""),
        ): TextSelector(TextSelectorConfig(multiline=True)),
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
        CONF_WEBAPP: bool(user_input.get(CONF_WEBAPP, webapp_enabled(previous))),
        CONF_FAVORITE_RECITERS: favorites,
        CONF_KIOSK_ALLOW_PRIVATE: bool(
            user_input.get(CONF_KIOSK_ALLOW_PRIVATE, previous.get(CONF_KIOSK_ALLOW_PRIVATE, False))
        ),
        CONF_KIOSK_TRUSTED_NETWORKS: "\n".join(
            parse_trusted_networks(
                user_input.get(
                    CONF_KIOSK_TRUSTED_NETWORKS,
                    previous.get(CONF_KIOSK_TRUSTED_NETWORKS, ""),
                )
            )
        ),
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
            try:
                stored = _stored_options(user_input, {})
            except InvalidTrustedNetwork:
                return self.async_show_form(
                    step_id="user",
                    data_schema=_options_schema(user_input, reciter_options),
                    errors={CONF_KIOSK_TRUSTED_NETWORKS: "invalid_subnet"},
                )
            return self.async_create_entry(
                title="Al Quran Cloud",
                data={},
                options=stored,
            )
        return self.async_show_form(
            step_id="user",
            data_schema=_options_schema(
                {
                    CONF_DISPLAY_LANGUAGE: DEFAULT_DISPLAY_LANGUAGE,
                    CONF_CACHE_DAYS: DEFAULT_CACHE_DAYS,
                    CONF_PLAYBACK_SPEED: DEFAULT_PLAYBACK_SPEED,
                    CONF_WEBAPP: DEFAULT_WEBAPP,
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
            try:
                stored = _stored_options(user_input, current)
            except InvalidTrustedNetwork:
                merged = {**current, **user_input}
                return self.async_show_form(
                    step_id="init",
                    data_schema=_options_schema(
                        merged,
                        _reciter_select_options(getattr(self, "hass", None), get_display_language(merged)),
                    ),
                    errors={CONF_KIOSK_TRUSTED_NETWORKS: "invalid_subnet"},
                )
            return self.async_create_entry(title="", data=stored)
        return self.async_show_form(
            step_id="init",
            data_schema=_options_schema(
                current,
                _reciter_select_options(self.hass, get_display_language(current)),
            ),
        )
