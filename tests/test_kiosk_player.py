"""Browser-side rules for the TV page, checked through the shared script."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

_LIB = Path(__file__).resolve().parents[1] / "custom_components" / "alquran_cloud" / "www" / "kiosk" / "js" / "kiosk-lib.js"

_SCRIPT = r"""
const lib = require(process.argv[1]);
const q = (value) => new URLSearchParams(value);
const saved = {
  surah: 36, ayah: 5, toAyah: 12, reciter: "ar.husary",
  speed: 1.5, repeat: 3, autoSurah: true, loop: true, background: true
};
function check(name, condition) {
  if (!condition) throw new Error(name);
}
let play = lib.resolvePlayback(q(""), saved, false);
check("restore stored playback", play.surah === 36 && play.ayah === 5 && play.toAyah === 12 && play.reciter === "ar.husary" && play.speed === 1.5 && play.repeat === 3 && play.autoSurah && play.loop && play.background);
play = lib.resolvePlayback(q("surah=2&ayah=1&reciter=ar.alafasy&speed=1.75&repeat=2&auto_surah=false&loop=false&background_video=false"), saved, false);
check("query replaces stored playback", play.surah === 2 && play.ayah === 1 && play.toAyah === null && play.reciter === "ar.alafasy" && play.speed === 1.75 && play.repeat === 2 && !play.autoSurah && !play.loop && !play.background);
play = lib.resolvePlayback(q("surah=2&ayah=1&to_ayah=40"), saved, false);
check("partial query keeps the reciter", play.toAyah === 40 && play.reciter === "ar.husary");
play = lib.resolvePlayback(q("ayah=20&to_ayah=4"), saved, false);
check("end before start is dropped", play.toAyah === null);
play = lib.resolvePlayback(q("speed=1.5"), saved, true);
check("old TV keeps the saved speed", play.speed === 1 && play.rememberedSpeed === 1.5);
play = lib.resolvePlayback(q("reciter=not valid"), saved, false);
check("bad reciter falls back", play.reciter === "ar.husary");
play = lib.resolvePlayback(q(""), {}, false);
check("empty storage uses defaults", play.surah === 1 && play.ayah === 1 && play.toAyah === null && play.reciter === "ar.alafasy" && play.speed === 1 && play.repeat === 1 && !play.autoSurah && !play.loop && !play.background);
const key = (event) => lib.mediaKeyAction(event);
check("space toggles", key({ key: " ", keyCode: 32 }) === "toggle");
check("space in a field types", key({ key: " ", keyCode: 32, target: { tagName: "INPUT" } }) === "");
check("play pause key", key({ key: "MediaPlayPause", keyCode: 179 }) === "toggle");
check("webOS play", key({ key: "", keyCode: 415 }) === "toggle");
check("webOS pause", key({ key: "", keyCode: 19 }) === "pause");
check("samsung play pause", key({ key: "", keyCode: 10252 }) === "toggle");
check("stop pauses", key({ key: "MediaStop", keyCode: 413 }) === "pause");
check("android play", key({ key: "", keyCode: 126 }) === "play");
check("next track", key({ key: "MediaTrackNext", keyCode: 176 }) === "next");
check("previous track", key({ key: "MediaTrackPrevious", keyCode: 177 }) === "prev");
check("samsung next", key({ key: "", keyCode: 10233 }) === "next");
check("samsung previous", key({ key: "", keyCode: 10232 }) === "prev");
check("fast forward stays free", key({ key: "MediaFastForward", keyCode: 417 }) === "");
check("arrows stay free", key({ key: "ArrowRight", keyCode: 39 }) === "");
check("repeat is ignored", key({ key: " ", keyCode: 32, repeat: true }) === "");
const back = (event) => lib.overlayBackKey(event);
check("escape", back({ key: "Escape", keyCode: 27 }));
check("legacy escape", back({ key: "Esc", keyCode: 27 }));
check("webOS back", back({ key: "", keyCode: 461 }));
check("samsung back", back({ key: "", keyCode: 10009 }));
check("android back", back({ key: "GoBack", keyCode: 4 }));
check("xf86 back", back({ key: "XF86Back", keyCode: 0 }));
check("backspace still deletes", !back({ key: "Backspace", keyCode: 8 }));
check("held escape is ignored", !back({ key: "Escape", keyCode: 27, repeat: true }));
check("arrow is not back", !back({ key: "ArrowLeft", keyCode: 37 }));
"""


def test_kiosk_player_rules():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    completed = subprocess.run(
        [node, "-e", _SCRIPT, str(_LIB)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
