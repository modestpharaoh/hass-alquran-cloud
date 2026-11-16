# Gemini

Follow [AGENTS.md](AGENTS.md). Integration: [docs/integration.md](docs/integration.md). TV page: [docs/kiosk.md](docs/kiosk.md). Card: [docs/card.md](docs/card.md).

Tests run from this repo: `.venv/bin/python -m pytest tests/ -q` after `requirements-dev.txt` and `npm install`. Rebuild `app.compat.js` and `kiosk-lib.compat.js` with esbuild `--target=chrome53` after editing the kiosk sources. `index.html` loads those compat files.

Do not break: local-only kiosk access through `request.remote`; Chrome 53 compat output; stills and 1× on old webOS and pre-Tizen 6.5 Samsung sets; no arrow-key ayah or surah control; the Arabic count rule (2 آيتان, 3–10 آيات, otherwise آية); web-app card track commands versus audio `next_surah`; saved playback settings and overlay Back; Minshawi and Abdul Basit in the ayah catalog; media-source browse of the entry that is loaded now; card catalog retry; live audio Continue, Loop, and Repeat, with speed on the next repeat or next surah; sensor attributes without the media URL or spans; `ffprobe` without `-nostdin`. Do not open the video, stills, font, or screenshots unless the user asks. Commit only when asked.
