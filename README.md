# Al Quran Cloud for Home Assistant

Play [Al Quran Cloud](https://alquran.cloud/) on a Home Assistant media player, or hand a surah to a TV browser. The domain is `alquran_cloud`. Reciter ids are edition strings such as `ar.alafasy`.

Audio mode downloads the ayah MP3s and joins them into one cached file. That file plays on any media player. The web app does not build an MP4. Home Assistant opens the bundled Quran player in an LG, Samsung, or Android TV browser and leaves playback there.

Copy `custom_components/alquran_cloud` to `config/custom_components/alquran_cloud`. If an older `quran_com` folder is already installed, remove that folder and add this integration again.

## Docs

- [Integration architecture](docs/integration.md) — audio join, TV handoff, cache, and why Chromecast is not a video target
- [Quran player](docs/kiosk.md) — the page Home Assistant serves to the TV, including webOS 4
- [Dashboard card](docs/card.md) — the Lovelace card, player list, and web app controls

## Install

1. Copy `custom_components/alquran_cloud` into your Home Assistant `config/custom_components/alquran_cloud` folder.
2. Restart Home Assistant.
3. Add the **Al Quran Cloud** integration.
4. Add a dashboard card:

```yaml
type: custom:alquran-cloud-card
entity: media_player.living_room
reciter_id: ar.alafasy
surah: 1
start_ayah: 1
repeat: 1
speed: 1
webapp: false
background_video: false
```

![Al Quran Cloud card](docs/alquran-cloud-card.png)

The card is also added to Settings → Dashboards → Resources when Lovelace uses storage mode. The resource URL includes the version from `manifest.json`, so a version bump refreshes the card.

`ffmpeg` and `ffprobe` are required for joined audio at any speed other than 1, and for probing duration. Joined audio also needs an HTTPS Home Assistant URL. The TV page can use the internal `http://` URL.

## What it plays

The public Al Quran Cloud API lists the free Arabic verse-by-verse recitations. The integration loads that list. Each reciter’s bitrate comes from the API, then every ayah MP3 is built from the global ayah number.

The media browser still opens one public ayah MP3, for example `https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3`. The play action does not. It builds one cached MP3 for the range, under `.cache/alquran_cloud/audio/`. **Joined audio cache (days)** decides how long that file is kept. The default is 7 days. Playing it again refreshes that age. The first build of a long surah can take several minutes. A notification stays up while ffmpeg works.

Speeds other than 1 are written into the cached audio file. Repeat plays that file the requested number of times. Continue to the next surah is available only for a full surah. Loop starts the original surah or range again, and it is off unless you turn it on. While a speaker is playing, the card shows the requested range, such as `001:005`, or the surah line with its ayah count when the range runs through the last ayah. Names and labels follow the integration display language, Arabic or English. The volume row sits under the media player and shows the level, such as `42%`, just before the increase button.

## Web app on a TV

![Quran player](docs/quran-player.png)

Turn on **Web app**. Home Assistant opens `/api/alquran_cloud/kiosk/` in the TV browser with the reciter, surah, ayah range, speed, repeat, continue, loop, and background video in the address. The TV then owns playback. The card shows **On the TV** and does not follow the ayah. The TV going idle does not end the session. `background_video` defaults to off. Turn it on to play the landscape clip behind the page. It does nothing for joined audio. The card shows that switch only while **Web app** is on.

The player list in that mode contains only LG webOS, Samsung, and Android TV (`androidtv`, including Fire TV), in alphabetical order. Chromecast stays on the audio list. A Chromecast with Google TV can be used when that device is also set up as Android TV.

The address uses the internal Home Assistant URL when one is set. `http://` is enough for the page. Audio and ayah pictures are loaded by the TV from `cdn.islamic.network`. Next and previous open the neighboring full surah in the browser again.

webOS 4 (firmware such as 04.64.00, Chromium 53) is supported by a downleveled copy of the player. See [Quran player](docs/kiosk.md).

## Actions

`alquran_cloud.play` takes every playback option. Leave `end_ayah` out to run through the last ayah of the surah. `continue_surah` applies only to a full surah. `loop` defaults to off. For joined audio it replays the original surah or range. For the web app it is sent as `loop` and the page shows a matching button. `speed` is one of `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, or `2`. `repeat` is 1–20. `background_video` defaults to false and is used only by the web app.

```yaml
action: alquran_cloud.play
target:
  entity_id: media_player.living_room
data:
  reciter_id: ar.alafasy
  surah: 2
  start_ayah: 1
  end_ayah: 5
  repeat: 2
  speed: 1
  continue_surah: false
  loop: false
  webapp: false
  background_video: false
```

The same action opens the TV web app when `webapp` is true. Use an LG, Samsung, or Android TV entity. `loop: true` turns on the page’s loop button. `background_video: true` plays the landscape clip.

```yaml
action: alquran_cloud.play
target:
  entity_id: media_player.living_room_tv
data:
  reciter_id: ar.alafasy
  surah: 2
  start_ayah: 1
  end_ayah: 5
  repeat: 2
  speed: 1
  continue_surah: false
  loop: false
  webapp: true
  background_video: false
```

Stop, next, and previous use the player from the current session. Next and previous open the neighboring full surah with the same repeat, speed, web app, and background setting.

```yaml
action: alquran_cloud.stop
target:
  entity_id: media_player.living_room
```

```yaml
action: alquran_cloud.next_surah
target:
  entity_id: media_player.living_room
```

```yaml
action: alquran_cloud.previous_surah
target:
  entity_id: media_player.living_room
```

The cache actions have no target and no fields.

```yaml
action: alquran_cloud.clear_cache
```

```yaml
action: alquran_cloud.clear_audio_cache
```

```yaml
action: alquran_cloud.clear_video_cache
```

```yaml
action: alquran_cloud.clear_source_cache
```

`clear_cache` deletes joined audio, leftover videos and pictures, downloads, and work files. `clear_audio_cache` deletes joined MP3s only. `clear_video_cache` deletes leftover surah videos and downloaded ayah pictures. `clear_source_cache` deletes downloaded ayah MP3s and unfinished work files.

Starting the integration also deletes leftover surah videos and ayah pictures. `sensor.al_quran_cloud_active_sessions` lists the reciter, surah, and requested range, and its `display_language` attribute is `english` or `arabic`. A stop button appears for each player that has been used.

## Manual check

- [ ] Speaker, web app off, speed 1: one cached MP3 of the surah or range plays, then stops.
- [ ] Speed 0.5 and 1.75 on a speaker that can open the Home Assistant HTTPS URL.
- [ ] Web app on the card lists only LG, Samsung, and Android TV players, sorted by name. Loop stays visible. Background video appears only in that mode and starts off.
- [ ] `background_video: true` opens the web app with the landscape clip playing. The default leaves it hidden.
- [ ] `continue_surah: true` on a full surah opens with auto-next on and moves to the next surah. `auto_surah=false` leaves that button off and stops at the end.
- [ ] `loop: true` turns the web app loop button on. Off leaves it off.
- [ ] LG, Samsung, or Android TV opens the player on the requested reciter and ayah range. The card shows On the TV and does not move the ayah.
- [ ] A second audio play of the same reciter and range starts without building the file again.
- [ ] webOS 4 shows the bismillah image, fills the surah, and plays audio after a remote key if the TV blocked autoplay.

## Tests

```bash
pytest tests/ -q
```

Requires `pytest`, `pytest-asyncio`, `aiohttp`, and `voluptuous`. No Home Assistant install is required.
