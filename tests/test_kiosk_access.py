"""Who may open the unauthenticated Quran player."""

from __future__ import annotations

from ipaddress import ip_network
from types import SimpleNamespace

import pytest

from custom_components.alquran_cloud import kiosk as kiosk_module
from custom_components.alquran_cloud.kiosk import (
    InvalidTrustedNetwork,
    QuranKioskView,
    client_on_kiosk_network,
    lookahead_audio_url,
    networks_from_adapters,
    parse_trusted_networks,
)


def test_loopback_is_allowed_with_no_adapters():
    assert client_on_kiosk_network("127.0.0.1", []) is True
    assert client_on_kiosk_network("::1", []) is True


def test_adapter_subnet_allows_its_own_addresses_only():
    adapters = networks_from_adapters(
        [
            {
                "enabled": True,
                "ipv4": [{"address": "192.168.1.20", "network_prefix": 24}],
            },
            SimpleNamespace(enabled=False, ipv4=[SimpleNamespace(address="10.0.0.2", network_prefix=24)]),
        ]
    )
    assert client_on_kiosk_network("192.168.1.50", adapters) is True
    assert client_on_kiosk_network("10.1.2.3", adapters) is False
    assert client_on_kiosk_network("10.1.2.3", adapters, allow_private=True) is True


def test_trusted_subnet_and_public_address():
    trusted = [ip_network(item) for item in parse_trusted_networks("10.8.0.0/24")]
    assert client_on_kiosk_network("10.8.0.5", [], trusted=trusted) is True
    assert client_on_kiosk_network("10.9.0.1", [], trusted=trusted) is False
    assert client_on_kiosk_network("8.8.8.8", [], trusted=trusted) is False
    public = [ip_network("203.0.113.5/32")]
    assert client_on_kiosk_network("203.0.113.5", [], trusted=public) is True


def test_parser_rejects_the_whole_internet_and_accepts_a_host():
    with pytest.raises(InvalidTrustedNetwork):
        parse_trusted_networks("0.0.0.0/0")
    with pytest.raises(InvalidTrustedNetwork):
        parse_trusted_networks("::/0")
    with pytest.raises(InvalidTrustedNetwork):
        parse_trusted_networks("not-a-network")
    assert parse_trusted_networks("192.168.1.9") == ["192.168.1.9/32"]


def test_bad_remote_is_refused_and_mapped_ipv4_follows_the_subnet():
    adapters = [ip_network("192.168.1.0/24")]
    assert client_on_kiosk_network("not-an-ip", adapters) is False
    assert client_on_kiosk_network(None, adapters) is False
    assert client_on_kiosk_network("::ffff:192.168.1.5", adapters) is True
    assert client_on_kiosk_network("::ffff:8.8.8.8", adapters) is False


@pytest.mark.asyncio
async def test_kiosk_view_reads_options_from_the_http_app():
    """Home Assistant stores hass on the app, not on the view."""

    class Entries:
        def async_entries(self, domain):
            assert domain == "alquran_cloud"
            return [SimpleNamespace(options={"kiosk_allow_private": True, "kiosk_trusted_networks": "203.0.113.0/24"})]

    class Request:
        def __init__(self, remote: str):
            self.remote = remote
            self.path = "/api/alquran_cloud/kiosk/"
            self.app = {"hass": SimpleNamespace(config_entries=Entries())}

    view = QuranKioskView()
    allowed = await view.get(Request("192.168.50.8"), "")
    assert allowed.status == 200
    listed = await view.get(Request("203.0.113.9"), "")
    assert listed.status == 200
    public = await view.get(Request("8.8.4.4"), "")
    assert public.status == 403


@pytest.mark.asyncio
async def test_kiosk_view_refuses_public_and_serves_loopback():
    view = QuranKioskView()

    class Request:
        def __init__(self, remote: str):
            self.remote = remote
            self.path = "/api/alquran_cloud/kiosk/"

    denied = await view.get(Request("8.8.8.8"), "")
    assert denied.status == 403
    allowed = await view.get(Request("127.0.0.1"), "")
    assert allowed.status == 200


def test_lookahead_audio_url_accepts_one_ayah():
    assert lookahead_audio_url("audio/128/ar.alafasy/1.mp3") == (
        "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3"
    )
    assert lookahead_audio_url("/audio/64/ar.husary/6236.mp3") == (
        "https://cdn.islamic.network/quran/audio/64/ar.husary/6236.mp3"
    )
    assert lookahead_audio_url("audio/96/ar.alafasy/1.mp3") is None
    assert lookahead_audio_url("audio/128/../1.mp3") is None
    assert lookahead_audio_url("audio/128/ar.alafasy/0.mp3") is None
    assert lookahead_audio_url("audio/128/ar.alafasy/6237.mp3") is None
    assert lookahead_audio_url("index.html") is None


@pytest.mark.asyncio
async def test_lookahead_route_stays_on_the_local_network(monkeypatch):
    seen = {}

    async def fake_stream(request, url, hass):
        seen["url"] = url
        from aiohttp import web

        return web.Response(status=200, body=b"mp3")

    monkeypatch.setattr(kiosk_module, "stream_lookahead_audio", fake_stream)
    view = QuranKioskView()

    class Request:
        def __init__(self, remote: str):
            self.remote = remote
            self.path = "/api/alquran_cloud/kiosk/audio/128/ar.alafasy/1.mp3"

    denied = await view.get(Request("8.8.8.8"), "audio/128/ar.alafasy/1.mp3")
    assert denied.status == 403
    assert "url" not in seen
    allowed = await view.get(Request("127.0.0.1"), "audio/128/ar.alafasy/1.mp3")
    assert allowed.status == 200
    assert seen["url"] == "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3"


@pytest.mark.asyncio
async def test_control_route_stays_local_and_returns_one_command():
    import json

    class Session:
        def __init__(self):
            self.entity_id = "media_player.lg"
            self.control_ticket = "abcdefghijklmnop"
            self.commands = ["next"]
            self.report = None

    session = Session()

    class Sessions:
        def session_for_ticket(self, ticket):
            return session if ticket == session.control_ticket else None

        def apply_report(self, found, **kwargs):
            session.report = kwargs

        async def wait_transport(self, found, timeout=20):
            if found.commands:
                return found.commands.pop(0)
            return ""

        def get_session(self, entity_id):
            return session if entity_id == session.entity_id else None

    class Entries:
        def async_entries(self, domain):
            return [SimpleNamespace(runtime_data=SimpleNamespace(sessions=Sessions()), options={})]

    class Request:
        def __init__(self, remote, query):
            self.remote = remote
            self.path = "/api/alquran_cloud/kiosk/control"
            self.query = query
            self.app = {"hass": SimpleNamespace(config_entries=Entries())}

    view = QuranKioskView()
    denied = await view.get(Request("8.8.8.8", {"ticket": session.control_ticket}), "control")
    assert denied.status == 403
    assert session.report is None
    missing = await view.get(Request("127.0.0.1", {"ticket": "missing-ticket-value"}), "control")
    assert missing.status == 404
    answer = await view.get(
        Request(
            "127.0.0.1",
            {
                "ticket": session.control_ticket,
                "reciter": "ar.alafasy",
                "surah": "2",
                "ayah": "3",
                "playing": "1",
            },
        ),
        "control",
    )
    assert answer.status == 200
    assert json.loads(answer.body) == {"command": "next"}
    assert session.report["surah"] == 2
    assert session.report["ayah"] == 3
    assert session.report["playing"] is True
    assert session.commands == []
