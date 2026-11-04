"""Tests for the Quran.com config flow."""

from __future__ import annotations

from custom_components.alquran_cloud.config_flow import AlquranCloudConfigFlow


async def test_user_step_stores_speed_and_picture():
    flow = AlquranCloudConfigFlow()
    form = await flow.async_step_user()
    assert form["type"] == "form"
    created = await flow.async_step_user(
        {
            "display_language": "arabic",
            "cache_days": 14,
            "playback_speed": "1.75",
            "show_picture": True,
        }
    )
    assert created["title"] == "Al Quran Cloud"
    assert created["options"]["playback_speed"] == 1.75
    assert created["options"]["show_picture"] is True
    assert created["options"]["cache_days"] == 14
    assert created["options"]["display_language"] == "arabic"
    assert "image_quality" not in created["options"]


async def test_single_instance():
    flow = AlquranCloudConfigFlow()
    flow._async_current_entries = lambda: [object()]
    aborted = await flow.async_step_user()
    assert aborted["reason"] == "single_instance_allowed"
