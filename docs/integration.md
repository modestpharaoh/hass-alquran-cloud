# Integration architecture

This integration follows the shape of [hass-mp3quran](https://github.com/modestpharaoh/hass-mp3quran), with Al Quran Cloud editions and an ayah range inside one surah. Domain: `alquran_cloud`.

There are two playback paths. They do not share a media file.

| Mode | What Home Assistant does | Who plays it |
| --- | --- | --- |
| Audio (`webapp` off) | Downloads ayah MP3s, joins them with ffmpeg, serves one MP3 | Any media player |
| Web app (`webapp` on) | Opens a URL in a TV browser | The TV browser runs the bundled player |

An earlier design downloaded audio, stacked ayah images, and encoded an MP4 on Home Assistant. That was dropped. The TV browser is a better screen, and Home Assistant does not need to track the live ayah after the TV takes over. The option was named `show_picture` while that encoder existed. It is now `webapp`. Saved options that still say `show_picture` are read as `webapp`.

## Layout

```
custom_components/alquran_cloud/
  __init__.py        setup, card resource, HTTP views
  api.py             Al Quran Cloud catalog
  coordinator.py     periodic catalog refresh
  config_flow.py     options: language, cache days, speed, web app, favorites, kiosk access
  services.py        play, stop, next, previous, cache clears
  session.py         one playback session per media player
  video.py           joined MP3 build and cache
  kiosk.py           TV URL and the unauthenticated player files
  media_source.py    browse one ayah at a time
  sensor.py          active sessions
  button.py          stop button per used player
  www/               Lovelace card, brand icon, and the TV player
```

`async_setup` registers the card, the static `/alquran_cloud` files, the joined-audio view, and the kiosk view. `async_setup_entry` builds the coordinator, the session manager, and the cache, then deletes leftover video files from the old MP4 path.

## Audio

`prepare_playback` in `video.py` refuses `webapp`. The web app is not a file.

For audio it:

1. Resolves the ayah range. An empty end ayah means the last ayah of the surah.
2. Looks up the reciter bitrate from the API, defaulting the URL pattern to 128 kbit/s.
3. Downloads each ayah from `cdn.islamic.network` into `.cache/alquran_cloud/src/`.
4. Joins them with ffmpeg as PCM, then encodes one MP3. Speeds other than 1 are applied in that encode, so the file itself is slower or faster. The player does not have to support playback rate.
5. Writes a JSON sidecar of ayah time spans. The session uses those spans while the joined file is playing.
6. Publishes the file on `/api/alquran_cloud/media/{token}/{filename}`.

That media view does not require a Home Assistant login. Many speakers cannot send the HA token. The token in the path is unguessable and only maps to a file this process has published.

Joined audio is served only over HTTPS. `https_base` asks Home Assistant for an SSL URL, internal first, then external. Without one, playback fails with a message to set a URL under Settings → System → Network. HTTP is not used for the MP3 because several players refuse it.

Cache files live under `.cache/alquran_cloud/audio/{edition}/{surah}-{start}-{end}-s{speed}.mp3`. **Joined audio cache (days)** is how long an unused file is kept. The default is 7, the range is 1–90. Playing a fresh file updates its age. The first build of a long surah can take several minutes. A persistent notification stays up while ffmpeg runs.

Repeat plays that same file the requested number of times (1–20). Continue to the next surah applies only when the range is the whole surah. Loop, off by default, replays the original surah or range. An ayah range does not continue into the next surah. Playback speed includes `0.5`.

The media browser lists reciters, then surahs, then ayahs. The first card inside a surah names the surah, its ayah count, and Meccan or Medinan. Playing it calls `prepare_playback` for ayah 1 through the last ayah, at the saved playback speed, so it reuses the joined MP3 cache. A missing file is built first. Each ayah card still resolves one public CDN MP3. Favorites from the options flow are listed first.

## Web app

`session.py` never calls `prepare_playback` when `webapp` is set. It builds a kiosk URL and launches the TV browser. The session stores the title, the range, and the reciter that were opened, then replaces them with the reciter, surah, ayah, playing state, auto-next, loop, background, repeat, and speed the page reports. The card shows that report and sends a `settings` transport command when one of those controls changes. There is no `media_position` and no ayah advance from the TV’s media player. The state listener returns immediately for these sessions, so the TV going idle does not end the session or start the next surah.

`background_video` is sent as `background_video=true` or `background_video=false`. The default is false, so the landscape clip stays hidden until it is turned on. Joined audio ignores it.

The URL is `{internal-or-external}/api/alquran_cloud/kiosk/?…`. The internal URL is preferred (`prefer_external=False`, `allow_internal=True`) so a TV on the LAN can open it. The external URL is the fallback. `http://` is allowed for the page. The query is described in [Quran player](kiosk.md). The path has a trailing slash before `?` so the page can resolve `assets/` and `js/` underneath `/kiosk/`.

The page stays unauthenticated, and the view returns 403 unless the client is loopback or on an enabled Home Assistant adapter subnet. **Also allow private addresses** extends that to other private LANs. **Extra trusted subnets** adds an explicit CIDR list. A Docker bridge install whose only adapter is `172.17.0.0/16` needs one of those before a `192.168` TV can open the page. `network` is an `after_dependency` so the adapter list exists before the view is used.

In web app mode the card’s previous surah, previous ayah, play, pause, next ayah, and next surah buttons call `alquran_cloud.transport` on every TV. The page reports the current reciter, surah, and ayah back. The `next_surah` and `previous_surah` actions still open the neighboring full surah in the browser.

### Which TVs

`VIDEO_BROWSER_PLATFORMS` in `kiosk.py`:

| Platform | How the page opens | Stop |
| --- | --- | --- |
| `webostv` | `webostv.command` / `system.launcher/open` with `target` set to the URL | `webostv.button` HOME |
| `samsungtv_smart`, `samsungtv_tizen` | `media_player.play_media`, content type `browser` | Clears the HA session only. The page stays on the TV. |
| `samsungtv` | `browser`, then `url` if that call raises | Same as the other Samsung platforms |
| `androidtv` | `androidtv.adb_command`: `am start -a android.intent.action.VIEW -d "<url>"` | `adb_command` HOME |

Not included:

- `androidtv_remote`. It cannot open an arbitrary browser URL the way ADB can.
- `cast` / Chromecast. `cast.show_lovelace_view` opens a Lovelace path over HTTPS. It does not open this player. `play_media` of an HTML URL uses the Cast media receiver, which plays audio and video files, not a web app. DashCast was not added. A Chromecast with Google TV can still be used when that device is set up as `androidtv` and ADB can start the URL.

Chromecast remains a normal audio target. The joined MP3 is a file the Cast receiver can play.

## Cache cleanup

The old video mode left MP4s under `.cache/alquran_cloud/surah/` and ayah PNGs under `src/`. `MediaStore.clear_video()` deletes those and leaves downloaded ayah MP3s. It runs on setup and from `clear_video_cache`. The picture-size option was removed with the MP4 encoder. `ayah_image_url` remains for the audio cover image, at the low-resolution CDN path.

| Service | Deletes |
| --- | --- |
| `clear_audio_cache` | Joined MP3s |
| `clear_video_cache` | Leftover surah videos and downloaded ayah pictures |
| `clear_source_cache` | Downloaded ayah MP3s and work files |
| `clear_cache` | All of the above |

## Session and entities

One `PlaybackSession` per media player. `sensor.al_quran_cloud_active_sessions` exposes the reciter, surah, and requested range, keyed by media-player entity id. The same attributes include `display_language`, `english` or `arabic`. They do not include the media address or the ayah cue list. An unchanged report from a TV page does not write the sensor again. The card and the TV page both follow `display_language`. A stop button is created for each player that has been used.

Audio stop calls `media_stop`. Web app stop is the table above: Home on LG and Android TV, and only a session clear on Samsung.

`sensor` and `button` platforms are set up from the config entry. The catalog refresh interval is 24 hours.

## Decisions

- Joined MP3 for speakers, TV browser for the mushaf view. Do not encode MP4s on Home Assistant.
- After the TV opens, Home Assistant does not follow the ayah.
- Web app targets are browsers we can launch: LG webOS, Samsung, and Android TV via ADB. Chromecast is audio only.
- Joined audio requires HTTPS. The TV page prefers the internal URL and may be HTTP.
- Cache days apply to joined audio. Old video files are deleted, not regenerated.
- The media browser plays one CDN file per ayah. The first card in a surah uses the joined MP3 cache.
