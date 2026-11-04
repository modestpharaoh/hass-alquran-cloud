"""Tests for Lovelace card registration."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from custom_components.alquran_cloud import async_setup
from custom_components.alquran_cloud.const import CARD_URL
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.core import CoreState, HomeAssistant

_MANIFEST = Path(__file__).resolve().parents[1] / "custom_components" / "alquran_cloud" / "manifest.json"
_VERSION = json.loads(_MANIFEST.read_text(encoding="utf-8"))["version"]
CARD_RESOURCE = f"{CARD_URL}?v={_VERSION}"


def _run_tasks(hass: HomeAssistant) -> None:
    hass.state = CoreState.running

    def _create_task(coro):
        return asyncio.get_running_loop().create_task(coro)

    hass.async_create_task = _create_task


class _Resources:
    def __init__(self):
        self.loaded = False
        self.items = []

    async def async_get_info(self):
        self.loaded = True
        return {}

    def async_items(self):
        return list(self.items)

    async def async_create_item(self, item):
        stored = {"id": "res-1", **item}
        self.items.append(stored)
        return stored


@pytest.mark.asyncio
async def test_async_setup_registers_card_and_view():
    add_extra_js_url.calls.clear()
    hass = HomeAssistant()
    _run_tasks(hass)
    assert await async_setup(hass, {}) is True
    await asyncio.sleep(0)
    assert await async_setup(hass, {}) is True
    await asyncio.sleep(0)
    assert add_extra_js_url.calls == [CARD_RESOURCE]
    paths = hass.http.async_register_static_paths.await_args.args[0]
    assert paths[0].url_path == "/alquran_cloud"
    assert (Path(paths[0].path) / "alquran-cloud-card.js").is_file()
    card = (Path(paths[0].path) / "alquran-cloud-card.js").read_text(encoding="utf-8")
    assert "1.75" in card
    assert "/alquran_cloud_brand/icon.svg" in card
    assert "Choose an LG, Samsung, or Android TV." in card
    assert any(item.url_path == "/alquran_cloud_brand" for item in paths)
    assert (Path(paths[0].path) / "kiosk" / "index.html").is_file()
    views = [call.args[0] for call in hass.http.register_view.call_args_list]
    assert len(views) == 2
    assert all(view.requires_auth is False for view in views)
    assert any(view.url.startswith("/api/alquran_cloud/media/") for view in views)
    assert any(view.url.startswith("/api/alquran_cloud/kiosk/") for view in views)
