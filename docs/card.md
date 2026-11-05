# Dashboard card

![Al Quran Cloud card](alquran-cloud-card.png)

`www/alquran-cloud-card.js` defines `alquran-cloud-card` and `alquran-cloud-card-editor`. Lovelace type: `custom:alquran-cloud-card`.

Home Assistant registers it as `/alquran_cloud/alquran-cloud-card.js?v=<manifest version>` when Lovelace storage resources are available. The version query is how a browser drops an old card after a bump in `manifest.json`. The brand icon is served from `/alquran_cloud_brand/`.

The card speaks the integration’s display language, read from the active-sessions sensor. Arabic shows Arabic labels and names. English shows English labels and names. The TV player receives the same language.

## Config

```yaml
type: custom:alquran-cloud-card
entity: media_player.living_room
reciter_id: ar.alafasy
surah: 1
start_ayah: 1
end_ayah: 7
repeat: 1
speed: 1
continue_surah: false
loop: false
webapp: false
background_video: false
```

| Field | Role |
| --- | --- |
| `entity` | Media player. In web app mode this must be a supported TV. |
| `reciter_id` | Al Quran Cloud edition id. |
| `surah` | 1–114. Changing reciter or surah resets the range to the full surah. |
| `start_ayah` | First ayah. Default 1. |
| `end_ayah` | Last ayah. Empty means through the last ayah. |
| `repeat` | 1–20. |
| `speed` | 0.5, 0.75, 1, 1.25, 1.5, 1.75, or 2. |
| `continue_surah` | Shown only for a full surah. Ignored for a range. |
| `loop` | Off unless set. Replays the original surah or range. Sent to the web app as `loop`. |
| `webapp` | Opens the Quran web app on a TV instead of playing a joined MP3. |
| `background_video` | Landscape clip behind the web app. Hidden unless `webapp` is on. Defaults to false. |

Play calls `alquran_cloud.play` with those fields. Pause, resume, and volume use the media player’s own services when the player supports them. Next and previous call `alquran_cloud.next_surah` and `previous_surah`. Stop calls `alquran_cloud.stop`.

Reciters and surahs are loaded from the `media-source://alquran_cloud` catalog, the same tree as the media browser. Favorites saved in the integration options come first.

## Player list

Every `media_player` entity is listed by `friendly_name`, sorted with `localeCompare`. Entity id is the fallback label.

With **Web app** on, the list keeps only these platforms, read from `hass.entities[id].platform`:

- `webostv`
- `samsungtv`
- `samsungtv_smart`
- `samsungtv_tizen`
- `androidtv`

`cast` is not in that list. Chromecast can play the joined MP3, and it can show a Lovelace dashboard, but it cannot open this player URL. See [Integration architecture](integration.md).

If the saved `entity` is not one of those TVs, the select is cleared and the card says to choose an LG, Samsung, or Android TV. Turning the web app off restores the full player list.

## While it plays

In audio mode the stage shows the brand mark, the surah line, the reciter, and the Madinah mushaf line when the session has an album.

The card speaks the integration’s display language, from `display_language` on the active-sessions sensor. It does not follow the Home Assistant locale. Arabic shows Arabic names and Eastern Arabic digits. The count word follows the last two digits: 3–10 is آيات, 2 is آيتان, and every other ending is آية, so Al-Kawthar is ٣ آيات and Al-Baqara is ٢٨٦ آية. English shows English names and ayahs. In Arabic the previous control points right and the next control points left. Audio mode shows the range that was requested, not the ayah under the playhead. A partial range is `001:005` plus the surah name. A surah played through the last ayah keeps the surah line and adds the ayah count, such as `108 · Al-Kawthar · 3 ayahs`. The card reads that session from `sensor.al_quran_cloud_active_sessions`. The progress bar still advances once a second from `media_position`. When playback moves to another surah, the sensor title changes immediately, before the next joined file is finished. Pause is available when the player supports play or pause.

The volume row is directly under the media player when that player reports a level or supports volume. The percent, such as `42%`, sits just before the increase button. Plus, minus, and the slider all update that number together.

Web app mode hides the progress bar and the surah, reciter, and status lines. The stage keeps a note that Home Assistant does not track the ayah on the TV, plus previous, play, pause, and next. Play and pause are separate buttons and call the media player’s play and pause. Next and previous call `media_next_track` and `media_previous_track`. The TV page decides whether that step is an ayah or a surah. Volume controls stay if the entity supports volume. The background switch is shown only in this mode and is sent as `background_video`.

Continue-to-next stays available in web app mode for a full surah. The TV player receives it as `auto_surah`. Loop stays available in both modes and is sent as `loop`. Background video is shown only while the web app is selected.

## Decisions

- One card for both modes. `webapp` switches the player list and which controls are visible.
- Players are alphabetical in both modes.
- Web app mode never offers a speaker or a Chromecast. A saved non-TV entity is dropped rather than sent to a player that cannot open the page.
- The card does not estimate the current ayah while the web app is open. The session is the range that was opened.
- In web app mode the stage does not show that surah or reciter. It offers play, pause, and next and previous track.
- Progress belongs to the joined MP3, not to the TV page. Audio mode keeps one button that switches between play and pause.
