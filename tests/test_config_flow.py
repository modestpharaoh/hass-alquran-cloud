"""Tests for the Quran.com config flow."""

from __future__ import annotations

from custom_components.alquran_cloud.config_flow import (
    AlquranCloudConfigFlow,
    AlquranCloudOptionsFlowHandler,
)


async def test_user_step_stores_language_and_cache():
    flow = AlquranCloudConfigFlow()
    form = await flow.async_step_user()
    assert form["type"] == "form"
    created = await flow.async_step_user(
        {
            "display_language": "arabic",
            "cache_days": 14,
            "playback_speed": "1.75",
            "webapp": True,
        }
    )
    assert created["title"] == "Al Quran Cloud"
    assert "playback_speed" not in created["options"]
    assert "webapp" not in created["options"]
    assert created["options"]["cache_days"] == 14
    assert created["options"]["display_language"] == "arabic"
    assert created["options"]["kiosk_allow_private"] is False
    assert created["options"]["kiosk_trusted_networks"] == ""
    assert "image_quality" not in created["options"]


async def test_options_reject_the_whole_internet_and_store_a_subnet():
    flow = AlquranCloudOptionsFlowHandler()
    base = {
        "display_language": "english",
        "cache_days": 7,
        "kiosk_allow_private": True,
    }
    rejected = await flow.async_step_init({**base, "kiosk_trusted_networks": "0.0.0.0/0"})
    assert rejected["type"] == "form"
    assert rejected["errors"]["kiosk_trusted_networks"] == "invalid_subnet"

    saved = await flow.async_step_init({**base, "kiosk_trusted_networks": "192.168.50.0/24, 10.8.0.5"})
    assert saved["type"] == "create_entry"
    assert saved["data"]["kiosk_allow_private"] is True
    assert saved["data"]["kiosk_trusted_networks"] == "192.168.50.0/24\n10.8.0.5/32"


async def test_single_instance():
    flow = AlquranCloudConfigFlow()
    flow._async_current_entries = lambda: [object()]
    aborted = await flow.async_step_user()
    assert aborted["reason"] == "single_instance_allowed"
