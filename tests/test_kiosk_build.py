"""The TV page must keep serving a Chrome 53 build of the current scripts."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

_JS = Path(__file__).resolve().parents[1] / "custom_components" / "alquran_cloud" / "www" / "kiosk" / "js"
_INDEX = _JS.parent / "index.html"
_SOURCES = ("kiosk-lib.js", "app.js")


def _esbuild():
    local = Path(__file__).resolve().parents[1] / "node_modules" / ".bin" / "esbuild"
    if local.is_file():
        return str(local)
    return shutil.which("esbuild")


def test_kiosk_page_loads_the_chrome53_build():
    page = _INDEX.read_text(encoding="utf-8")
    assert 'src="js/legacy.js"' in page
    assert 'src="js/kiosk-lib.compat.js"' in page
    assert 'src="js/app.compat.js"' in page
    assert 'src="js/app.js"' not in page
    assert 'src="js/kiosk-lib.js"' not in page


def test_chrome53_build_matches_the_source():
    esbuild = _esbuild()
    if esbuild is None:
        pytest.skip("esbuild is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for name in _SOURCES:
            built = folder / name.replace(".js", ".compat.js")
            completed = subprocess.run(
                [esbuild, str(_JS / name), "--target=chrome53", f"--outfile={built}"],
                check=False,
                capture_output=True,
                text=True,
            )
            assert completed.returncode == 0, completed.stderr
            committed = (_JS / built.name).read_bytes()
            assert built.read_bytes() == committed, f"{built.name} is not the Chrome 53 build of {name}"
            text = built.read_text(encoding="utf-8")
            assert "??" not in text
            assert "?." not in text
            assert "await " not in text
            node = shutil.which("node")
            if node:
                checked = subprocess.run([node, "--check", str(built)], check=False, capture_output=True, text=True)
                assert checked.returncode == 0, checked.stderr
