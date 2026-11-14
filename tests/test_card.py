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
    playbackLine, integrationLanguage, mediaPlayers, sessionFor, playbackSelectors, canSeek, seekFraction,
    playbackClock, formatTime, strings, AlquranCloudCard
  };
`, context);

const card = context.__card;
if (!card) throw new Error("card script did not load");
function check(name, condition) {
  if (!condition) throw new Error(name);
}
const text = card.strings({ states: { "sensor.al_quran_cloud_active_sessions": {
  entity_id: "sensor.al_quran_cloud_active_sessions",
  attributes: { display_language: "english" }
}}});
check("full english surah line", card.playbackLine({
  title: "002 · Al-Baqara · 286 ayahs · Medinan", full_surah: true, start_ayah: 1, end_ayah: 286
}, "en") === "002 · Al-Baqara · 286 ayahs · Medinan");
check("full arabic surah line", card.playbackLine({
  title: "001 · سُورَةُ الفَاتِحَةِ · 7 آيات · مكية", full_surah: true, end_ayah: 7
}, "ar") === "001 · سُورَةُ الفَاتِحَةِ · 7 آيات · مكية");
check("partial range", card.playbackLine({
  title: "001 · Al-Fatiha · 7 ayahs · Meccan", full_surah: false, start_ayah: 1, end_ayah: 5
}, "en") === "001 · Al-Fatiha · 7 ayahs · Meccan · 001:005");
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
    "media_player.living_room": { entity_id: "media_player.living_room", attributes: { friendly_name: "Living room", supported_features: 512 } },
    "media_player.speaker": { entity_id: "media_player.speaker", attributes: { friendly_name: "Speaker", supported_features: 512 } }
  }
};
check("web app lists only a TV", card.mediaPlayers(hass, true).map((item) => item.id).join(",") === "media_player.living_room");
check("audio lists only the speaker", card.mediaPlayers(hass, false).map((item) => item.id).join(",") === "media_player.speaker");
check("selectors follow the playing reciter and surah", card.playbackSelectors({
  reciter_id: "ar.husary", surah: 36
}, { reciter_id: "ar.alafasy", surah: 1 }).reciter === "ar.husary" && card.playbackSelectors({
  reciter_id: "ar.husary", surah: 36
}, { reciter_id: "ar.alafasy", surah: 1 }).surah === "36");
check("selectors return to the card defaults", card.playbackSelectors(null, {
  reciter_id: "ar.alafasy", surah: 1
}).reciter === "ar.alafasy" && card.playbackSelectors(null, {
  reciter_id: "ar.alafasy", surah: 1
}).surah === "1");
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
  _previousAyahButton: button(),
  _nextAyahButton: button(),
  _nextButton: button(),
  _playTransport: button(),
  _pauseButton: button(),
  _syncButton: button(),
  _transport: { hidden: null }
};
card.AlquranCloudCard.prototype._renderTransport.call(view, text, {
  state: "playing",
  attributes: { supported_features: 1 }
}, true);
check("web app shows play and pause", view._playTransport.hidden === false && view._pauseButton.hidden === false);
check("web app shows the ayah steps", view._previousAyahButton.hidden === false && view._nextAyahButton.title === "Next ayah");
check("web app shows sync", view._syncButton.hidden === false && view._syncButton.title === "Sync");
check("web app labels name the surah", view._nextButton.title === "Next surah" && view._previousButton.title === "Previous surah");
card.AlquranCloudCard.prototype._renderTransport.call(view, text, {
  state: "playing",
  attributes: { supported_features: 1 }
}, false);
check("audio hides the extra play button", view._playTransport.hidden === true && view._nextButton.title === "Next surah");
check("audio hides the ayah steps and sync", view._previousAyahButton.hidden === true && view._nextAyahButton.hidden === true && view._syncButton.hidden === true);
const pill = { className: "" };
card.AlquranCloudCard.prototype._paintSessionPill.call({
  _statePill: pill,
  _status: { textContent: "" }
}, text, { webapp: true, live: true }, true);
check("a reporting page is green", pill.className === "state-pill live");
card.AlquranCloudCard.prototype._paintSessionPill.call({
  _statePill: pill,
  _status: { textContent: "" }
}, text, { webapp: true, live: true, playing: false }, true);
check("a paused page is amber", pill.className === "state-pill paused");
check("seek feature is the second bit", card.canSeek(2) === true && card.canSeek(1) === false);
check("seek follows the reading direction", card.seekFraction(25, 100, false) === 0.25 && card.seekFraction(25, 100, true) === 0.75);
const seekCalls = [];
card.AlquranCloudCard.prototype._seekTo.call({
  _player: { value: "media_player.vlc" },
  _progressDuration: 80,
  _hass: { callService() { seekCalls.push([].slice.call(arguments)); } },
  _playerState() { return { attributes: { media_position_updated_at: "t0" } }; }
}, 12.5);
check("seek asks the player", seekCalls.length === 1 && seekCalls[0][0] === "media_player" && seekCalls[0][1] === "media_seek" && seekCalls[0][2].entity_id === "media_player.vlc" && seekCalls[0][2].seek_position === 12.5);
card.AlquranCloudCard.prototype._paintSessionPill.call({
  _statePill: pill,
  _status: { textContent: "The page did not answer." }
}, text, { webapp: true, live: true }, true);
check("a silent page is red", pill.className === "state-pill silent");

const calls = [];
function host(webapp, state, platform) {
  return {
    _hass: {
      entities: platform ? { "media_player.living_room": { platform: platform } } : {},
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
  const tv = host(true, "playing", "webostv");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "previous_surah");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "previous_ayah");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "play");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "pause");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "next_ayah");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "next_surah");
  await card.AlquranCloudCard.prototype._transportAction.call(tv, "report");
  check("web app previous surah asks the page", calls[0].domain === "alquran_cloud" && calls[0].service === "transport" && calls[0].data.command === "previous_surah");
  check("web app previous ayah asks the page", calls[1].data.command === "previous_ayah");
  check("web app play and pause stay separate", calls[2].data.command === "play" && calls[3].data.command === "pause");
  check("web app next ayah asks the page", calls[4].data.command === "next_ayah");
  check("web app next surah asks the page", calls[5].data.command === "next_surah");
  check("sync asks the page to report", calls[6].data.command === "report");
  calls.length = 0;
  const android = host(true, "playing", "androidtv");
  await card.AlquranCloudCard.prototype._transportAction.call(android, "next_ayah");
  await card.AlquranCloudCard.prototype._transportAction.call(android, "play");
  await card.AlquranCloudCard.prototype._transportAction.call(android, "report");
  check("android ayah step asks the page", calls[0].domain === "alquran_cloud" && calls[0].service === "transport" && calls[0].data.command === "next_ayah");
  check("android play asks the page", calls[1].service === "transport" && calls[1].data.command === "play");
  check("android sync still asks the page", calls[2].data.command === "report");
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
