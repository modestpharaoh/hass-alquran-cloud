"""Behavior of the Lovelace card, loaded the way the browser receives it."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

_CARD = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "alquran_cloud"
    / "www"
    / "alquran-cloud-card.js"
)

_SCRIPT = r"""
const fs = require("fs");
const vm = require("vm");
const context = { console, globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`
  function HTMLElement() {}
  const customElements = { define() {} };
  const window = {};
  const document = { createElement() { return {}; } };
` + fs.readFileSync(process.argv[1], "utf8") + `
  globalThis.__card = {
    arabicAyahWord, playbackLine, integrationLanguage, mediaPlayers, sessionFor,
    playbackClock, formatTime, strings, AlquranCloudCard
  };
`, context);

const card = context.__card;
if (!card) throw new Error("card script did not load");
function check(name, condition) {
  if (!condition) throw new Error(name);
}
check("seven", card.arabicAyahWord(7) === "آيات");
check("two", card.arabicAyahWord(2) === "آيتان");
check("two hundred six", card.arabicAyahWord(206) === "آيات");
check("two hundred eighty six", card.arabicAyahWord(286) === "آية");
const text = card.strings({ states: { "sensor.al_quran_cloud_active_sessions": {
  entity_id: "sensor.al_quran_cloud_active_sessions",
  attributes: { display_language: "english" }
}}});
check("full english surah line", card.playbackLine({
  title: "002 · Al-Baqara", full_surah: true, start_ayah: 1, end_ayah: 286
}, text, "en") === "002 · Al-Baqara · 286 ayahs");
const arabic = card.strings({ states: { "sensor.al_quran_cloud_active_sessions": {
  entity_id: "sensor.al_quran_cloud_active_sessions",
  attributes: { display_language: "arabic" }
}}});
check("full arabic surah line", card.playbackLine({
  title: "001 · سُورَةُ الفَاتِحَةِ", full_surah: true, end_ayah: 7
}, arabic, "ar") === "001 · سُورَةُ الفَاتِحَةِ · ٧ آيات");
check("partial range", card.playbackLine({
  title: "001 · Al-Fatiha", full_surah: false, start_ayah: 1, end_ayah: 5
}, text, "en") === "001:005 · Al-Fatiha");
check("integration language wins", card.integrationLanguage({
  locale: { language: "en" },
  states: { "sensor.al_quran_cloud_active_sessions": {
    entity_id: "sensor.al_quran_cloud_active_sessions",
    attributes: { display_language: "arabic" }
  }}
}) === "ar");
const hass = {
  entities: {
    "media_player.living_room": { platform: "webostv" },
    "media_player.speaker": { platform: "sonos" }
  },
  states: {
    "media_player.living_room": { entity_id: "media_player.living_room", attributes: { friendly_name: "Living room" } },
    "media_player.speaker": { entity_id: "media_player.speaker", attributes: { friendly_name: "Speaker" } }
  }
};
check("web app lists only a TV", card.mediaPlayers(hass, true).map((item) => item.id).join(",") === "media_player.living_room");
check("audio lists every player", card.mediaPlayers(hass, false).length === 2);
check("session lookup", card.sessionFor({
  states: { "sensor.al_quran_cloud_active_sessions": {
    entity_id: "sensor.al_quran_cloud_active_sessions",
    attributes: { "media_player.living_room": { surah: 2, webapp: true } }
  }}
}, "media_player.living_room").surah === 2);
check("clock stays at the reported position while paused", card.playbackClock({
  state: "paused",
  attributes: { media_position: 12, media_duration: 90 }
}).position === 12);
check("formats minutes", card.formatTime(125) === "2:05");

function button() {
  const icon = { icon: "", setAttribute(name, value) { this[name] = value; } };
  return { hidden: null, title: "", _icon: icon, querySelector() { return icon; } };
}
const view = {
  _previousButton: button(),
  _nextButton: button(),
  _playTransport: button(),
  _pauseButton: button(),
  _transport: { hidden: null }
};
card.AlquranCloudCard.prototype._renderTransport.call(view, text, {
  state: "playing",
  attributes: { supported_features: 1 }
}, true);
check("web app shows play and pause", view._playTransport.hidden === false && view._pauseButton.hidden === false);
check("web app labels are next and previous", view._nextButton.title === "Next" && view._previousButton.title === "Previous");
card.AlquranCloudCard.prototype._renderTransport.call(view, text, {
  state: "playing",
  attributes: { supported_features: 1 }
}, false);
check("audio hides the extra play button", view._playTransport.hidden === true && view._nextButton.title === "Next surah");

const calls = [];
function host(webapp, state) {
  return {
    _hass: {
      states: {
        "sensor.al_quran_cloud_active_sessions": {
          entity_id: "sensor.al_quran_cloud_active_sessions",
          attributes: {
            display_language: "english",
            "media_player.living_room": webapp ? { webapp: true, surah: 2 } : { surah: 2, start_ayah: 1, end_ayah: 286 }
          }
        },
        "media_player.living_room": { entity_id: "media_player.living_room", state, attributes: {} }
      },
      callService(domain, service, data) { calls.push({ domain, service, data }); }
    },
    _player: { value: "media_player.living_room" },
    _webapp: { checked: webapp },
    _status: { textContent: "" },
    _playerState() { return this._hass.states[this._player.value]; }
  };
}
async function exercise() {
  calls.length = 0;
  const tv = host(true, "playing");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "next");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "previous");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "play");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "pause");
  check("web app next is a track command", calls[0].domain === "media_player" && calls[0].service === "media_next_track");
  check("web app previous is a track command", calls[1].service === "media_previous_track");
  check("web app play and pause stay separate", calls[2].service === "media_play" && calls[3].service === "media_pause");
  calls.length = 0;
  const speaker = host(false, "playing");
  await card.AlquranCloudCard.prototype._transportAction.call(speaker, "next");
  await card.AlquranCloudCard.prototype._transportAction.call(speaker, "pause");
  check("audio next opens the next surah", calls[0].domain === "alquran_cloud" && calls[0].service === "next_surah");
  check("audio pause uses the player", calls[1].domain === "media_player" && calls[1].service === "media_pause");
  calls.length = 0;
  const paused = host(false, "paused");
  await card.AlquranCloudCard.prototype._transportAction.call(paused, "pause");
  check("audio pause resumes", calls[0].service === "media_play");
}
exercise().then(() => process.exit(0), (err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
"""


def test_card_behavior():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    completed = subprocess.run(
        [node, "-e", _SCRIPT, str(_CARD)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
