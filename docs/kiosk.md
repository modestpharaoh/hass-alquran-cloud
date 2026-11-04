# Quran player

The TV page is the [alquran-cloud-local-UI](https://github.com/modestpharaoh/alquran-cloud-local-UI) player, copied into this integration. The original repository is not modified from here. Home Assistant serves the copy and opens it on the TV. After that, the TV owns playback.

Files live in `custom_components/alquran_cloud/www/kiosk/`. `QuranKioskView` in `kiosk.py` serves them with `requires_auth = False` at:

```
/api/alquran_cloud/kiosk/
/api/alquran_cloud/kiosk/{path}
```

No Home Assistant login. A TV browser launched by `system.launcher/open` or ADB does not have an HA session cookie. Paths that escape the kiosk directory (`..`) are rejected. HTML, JS, and CSS responses send `Cache-Control: no-cache` so a TV picks up a new script without a manual cache clear. The background video is large and is not marked that way.

The page address always has a trailing slash before the query string:

```
http://ha.lan:8123/api/alquran_cloud/kiosk/?surah=2&ayah=1&reciter=ar.alafasy&speed=1&repeat=1&auto_surah=true&language=en
```

Relative URLs such as `assets/bismillah.png` and `js/app.compat.js` then resolve under `/api/alquran_cloud/kiosk/`. Without the slash they would resolve under `/api/alquran_cloud/` and 404. The background video is a `<video>` tag with that relative path, which is why it played even when the script did not.

## Address parameters

Built by `build_kiosk_url`:

| Parameter | Meaning |
| --- | --- |
| `surah` | 1–114 |
| `ayah` | First ayah |
| `to_ayah` | Last ayah. Omitted when the range already runs to the end of the surah |
| `reciter` | Al Quran Cloud edition id, such as `ar.alafasy` |
| `speed` | `0.75` through `2`. `1.0` is written as `1` |
| `repeat` | 1–20 |
| `auto_surah` | `true` when continue-to-next is on. That option is only for a full surah |
| `language` | `en` or `ar`, from the integration display language |
| `background_video` | `true` or `false`. Missing means the landscape clip plays. `false` pauses it and hides it |

Loop is not sent. It is audio-only in Home Assistant and forced off for the web app.

The player reads those values once at load. It does not report the current ayah back to Home Assistant.

## What the page loads

Surah text, ayah lists, and reciters come from `https://api.alquran.cloud`. Ayah audio and ayah images come from `https://cdn.islamic.network`. Those hosts are HTTPS. The Home Assistant page itself may be HTTP on the LAN. The CDN does not send CORS headers. An `<audio>` or `<img>` element can still load those URLs. A `fetch()` from a service worker cannot read them, and a `no-cors` response is opaque.

Bismillah (the opening image and a short clip) plays for ayah 1 of every surah except surah 1 and surah 9. The image file is `assets/bismillah.png` and is also the initial `src` of the ayah image, same as the video tag, so it appears even if the script is slow.

## Service worker

`sw.js` was written for a site served at the origin root (`http://127.0.0.1:8080/`). Under Home Assistant the page is not at `/`.

The first install tried to precache `new URL('/assets/bismillah.png', self.location.href)`. A leading slash ignores the kiosk directory, so the request was `https://<ha>/assets/bismillah.png`, not `/api/alquran_cloud/kiosk/assets/bismillah.png`. `cache.add` never finished, `skipWaiting()` never ran, and `navigator.serviceWorker.ready` has no timeout in the original player. Startup waited forever, so the surah and reciter lists stayed empty. The next-surah button still worked because it was bound before that wait. A later reload could get past the wait, but the worker still intercepted any same-origin path ending in `/assets/bismillah.png` and answered with a bad or opaque response, so the image stayed broken. The background video kept working because the `<video>` tag had already started, and the video handler built a real response from the actual request URL.

The worker now:

- Calls `skipWaiting()` immediately and does not precache a root-absolute path.
- Does not answer `audio`, `image`, or `video` requests, and does not answer URLs that end in those media extensions. The media element loads the network response itself.
- Drops old `quran-kiosk-static-*` caches on activate.
- Registration in `app.js` gives up after about two seconds, and replaces a worker whose script URL is not `sw.js?v=3` once, then reloads.

Opaque worker responses are why webOS could show the lists and still play no audio. Desktop Chrome often plays them. webOS does not. Letting `<audio>` fetch `cdn.islamic.network` directly is the reliable path. Offline caching of those MP3s from the worker is not used for playback.

## webOS 4

webOS TV 4 (firmware 04.64.00) is Chromium 53. That engine parses ES2016 and does not parse `async`/`await` or `??`. `Element.append` and `replaceChildren` are also missing, and so are flex `gap`, CSS grid, and `min()`.

The video tag did not need any of that, so the background played. The script never ran, so the surah request never started and the ayah image kept an empty `src`, which this browser shows as a broken image.

The page loads three scripts, in order:

1. `js/legacy.js` — small polyfills for `append`, `replaceChildren`, and `NodeList.forEach`, written without modern syntax.
2. `js/kiosk-lib.compat.js` — `js/kiosk-lib.js` downleveled to Chrome 53.
3. `js/app.compat.js` — `js/app.js` downleveled to Chrome 53.

`index.html` does not load `app.js` or `kiosk-lib.js` directly. Edit those, then rebuild:

```bash
npx esbuild custom_components/alquran_cloud/www/kiosk/js/kiosk-lib.js \
  --target=chrome53 \
  --outfile=custom_components/alquran_cloud/www/kiosk/js/kiosk-lib.compat.js
npx esbuild custom_components/alquran_cloud/www/kiosk/js/app.js \
  --target=chrome53 \
  --outfile=custom_components/alquran_cloud/www/kiosk/js/app.compat.js
```

`oldTvBrowser()` skips service-worker registration when the user agent contains `Web0S` / `webOS` / `SmartTV` and Chrome is older than 80. That covers webOS 4 (Chrome 53), webOS 5 (Chrome 68), and webOS 6 (Chrome 79). Newer webOS can register the worker. The worker still does not sit in front of audio or images.

`system.launcher/open` is not a user gesture, so the first `audio.play()` is often rejected. The page remembers that and retries on the next click or remote key, calling `load()` and `play()` in that handler. `playbackRate` is applied inside a try, because some TV browsers throw if it is set before metadata loads.

CSS that Chromium 53 ignores is given a fallback under `@supports not (gap: 1px)`: button margins, and surah cards as inline blocks instead of a grid.

## Decisions

- Serve the existing player from Home Assistant. Do not generate an MP4.
- The TV does not report ayah progress back.
- The page must work in a subdirectory, so asset URLs are relative to `/api/alquran_cloud/kiosk/` and the address keeps its trailing slash.
- Do not block first paint on the service worker, and do not let the worker answer media elements.
- webOS 4 gets a Chrome 53 build plus a few DOM polyfills, and does not get a service worker.
- The bismillah image is in the HTML, like the background video, so it does not depend on the script.
