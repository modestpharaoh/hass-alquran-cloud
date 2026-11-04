# Al Quran Cloud for Home Assistant

Play [Al Quran Cloud](https://alquran.cloud/) for a full surah, or for a start and end ayah in that surah. Audio joins the ayah MP3s into one cached file. Surah video opens the Quran player in the browser of an LG, Samsung, or Android TV. Playback speed can be 0.75, 1, 1.25, 1.5, 1.75, or 2. The media browser still opens one ayah at a time.

The Home Assistant domain is `alquran_cloud`. Copy it to `config/custom_components/alquran_cloud`. If an older `quran_com` folder is already installed, remove that folder and add this integration again. Reciter ids are edition strings such as `ar.alafasy`.

This copy is for local testing. It is not published to GitHub from here.

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
show_picture: false
```

The card is also added to Settings → Dashboards → Resources when Lovelace uses storage mode. It shows the Al Quran Cloud star, the surah, the reciter, and the Madinah mushaf.

## What it plays

The public Al Quran Cloud API lists the free **Arabic verse-by-verse recitations** (Alafasy, Husary, Minshawi, Sudais, Shuraym, and the rest of that list, including the alternate editions). The integration loads that full list. Each reciter’s bitrate comes from the API, then every ayah MP3 is built from the global ayah number.

The media browser still resolves one public ayah MP3, for example `https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3`. The play action does not. It builds one cached MP3 for the range, under `.cache/alquran_cloud/audio/`. **Joined audio cache (days)** decides how long that file is kept. The default is 7 days. Playing it again refreshes that age. The first build of a long surah can take several minutes. A notification stays up while ffmpeg works.

Speeds other than 1 apply to the cached audio file. They need `ffmpeg` and `ffprobe`, and an HTTPS Home Assistant URL. Repeat plays that file the requested number of times. Continue to the next surah is available only for a full surah. Loop is audio only.

## Surah video on a TV

Turn on **Surah video**. Home Assistant does not build a video file. It opens the bundled Quran player in the TV browser, with the reciter, surah, ayah range, speed, and repeat in the page address. The TV then owns playback. The card shows **On the TV** for the range that was opened. It does not follow the ayah, and the TV going idle does not advance the session.

The player list in that mode contains only LG webOS, Samsung, and Android TV (`androidtv`, including Fire TV) media players, in alphabetical order. Chromecast stays on the audio list. Its dashboard action opens a Lovelace view, not this player. A Chromecast with Google TV can be used when that device is also set up as Android TV.

- LG webOS: `webostv.command` / `system.launcher/open`. Stop sends the Home button.
- Samsung: `media_player.play_media` with content type `browser`. The built-in Samsung integration retries with content type `url` if `browser` is rejected. Stop clears the Home Assistant session and leaves the page on the TV.
- Android / Fire TV: `androidtv.adb_command` opens the URL. Stop sends Home.

The address uses the internal Home Assistant URL when one is set, so the TV can reach it on the LAN. `http://` is enough for the page. Audio and ayah pictures are loaded by the TV from `cdn.islamic.network`. Next and previous open the neighboring full surah in the browser again.

## Services

- `alquran_cloud.play` — `reciter_id` (edition string such as `ar.alafasy`), `surah`, `start_ayah`, `end_ayah` (empty means through the last ayah), `repeat` (1–20), `speed`, `continue_surah` (full surah only), `loop` (audio only), `show_picture`
- `alquran_cloud.stop`
- `alquran_cloud.next_surah`
- `alquran_cloud.previous_surah`
- `alquran_cloud.clear_cache` — delete joined audio, leftover videos and pictures, downloads, and work files
- `alquran_cloud.clear_audio_cache` — delete joined MP3s only
- `alquran_cloud.clear_video_cache` — delete leftover surah videos and downloaded ayah pictures
- `alquran_cloud.clear_source_cache` — delete downloaded ayah MP3s and unfinished work files

Starting the integration also deletes leftover surah videos and ayah pictures. `sensor.alquran_cloud_active_sessions` lists the reciter, surah, and requested range. A stop button appears for each player that has been used.

## Manual check

- [ ] Speaker, surah video off, speed 1: one cached MP3 of the surah or range plays, then stops.
- [ ] Speed 1.75 on a speaker that can open the Home Assistant HTTPS URL.
- [ ] Surah video on the card lists only LG, Samsung, and Android TV players, sorted by name.
- [ ] LG, Samsung, or Android TV opens the kiosk on the requested reciter and ayah range. The card shows On the TV and does not move the ayah.
- [ ] A second audio play of the same reciter and range starts without building the file again.

## Tests

```bash
pytest tests/ -q
```

Requires `pytest`, `pytest-asyncio`, `aiohttp`, and `voluptuous`. No Home Assistant install is required.
