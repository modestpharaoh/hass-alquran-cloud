# AGENTS.md

Codex reads this file. Claude reads [CLAUDE.md](CLAUDE.md), Gemini reads [GEMINI.md](GEMINI.md), and Cursor reads [.cursor/rules/alquran-cloud.mdc](.cursor/rules/alquran-cloud.mdc). Those files point here.

Home Assistant custom integration. Domain `alquran_cloud`. Audio mode joins ayah MP3s into one cached file. Web app mode opens the bundled player on an LG, Samsung, or Android TV and leaves playback there.

Read [docs/integration.md](docs/integration.md), [docs/kiosk.md](docs/kiosk.md), and [docs/card.md](docs/card.md) before changing playback, the TV page, or the card.

## Commands

Run tests from this repository, with its own virtualenv and esbuild:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
npm install
.venv/bin/python -m pytest tests/ -q
```

After editing `www/kiosk/js/app.js` or `www/kiosk/js/kiosk-lib.js`, rebuild the Chrome 53 files:

```bash
npx esbuild custom_components/alquran_cloud/www/kiosk/js/kiosk-lib.js \
  --target=chrome53 \
  --outfile=custom_components/alquran_cloud/www/kiosk/js/kiosk-lib.compat.js
npx esbuild custom_components/alquran_cloud/www/kiosk/js/app.js \
  --target=chrome53 \
  --outfile=custom_components/alquran_cloud/www/kiosk/js/app.compat.js
```

`index.html` loads `legacy.js`, `kiosk-lib.compat.js`, and `app.compat.js`. It does not load the source scripts.

## Invariants

- The served kiosk scripts must stay Chrome 53 compatible: no `async`/`await`, `??`, or `?.`. The source may use them. The build test fails when the compat files drift.
- Old TVs are webOS with Chrome below 80, and Samsung sets before Tizen 6.5. They use the JPEG stills and stay at 1×. Newer browsers get the 1080p clip. Do not bind arrow keys to ayah or surah movement.
- Arabic ayah counts use the last two digits: 2 is آيتان, 3–10 is آيات, and every other ending is آية. Keep `const.py`, the kiosk, and the card on that rule.
- In web app mode the card hides the surah and reciter. Play and pause are separate and call the media player. Next and previous call `media_next_track` and `media_previous_track`. Audio mode still calls `alquran_cloud.next_surah` and `previous_surah`.
- The kiosk has no login. `QuranKioskView` allows a request only from `request.remote`: loopback, an enabled Home Assistant adapter, or an explicit trusted subnet. Home Assistant lives on `request.app["hass"]`.
- The page stores the last playback choices in `quran_kiosk_settings_v1`. A query parameter replaces that field. Reset restores the defaults, including remote next/previous back to the ayah. Escape and TV Back close an open overlay and otherwise leave the page.
- Do not add a live report-back token unless the user asks.
- Bump `manifest.json` only when a user-facing change ships.
- Commit only when the user asks. Do not commit `.venv/`, `node_modules/`, or secrets.

## Leave these files alone unless asked

The TV clip, stills, font, brand images, and doc screenshots are tracked for the integration. Do not open them to answer a code question:

- `custom_components/alquran_cloud/www/kiosk/assets/**`
- `custom_components/alquran_cloud/**/*.png`
- `docs/*.png`
- `.venv/`, `node_modules/`
