# Dashboard card

`www/alquran-cloud-card.js` defines `alquran-cloud-card` and `alquran-cloud-card-editor`. Lovelace type: `custom:alquran-cloud-card`.

Home Assistant registers it as `/alquran_cloud/alquran-cloud-card.js?v=<manifest version>` when Lovelace storage resources are available. The version query is how a browser drops an old card after a bump in `manifest.json`. The brand icon is served from `/alquran_cloud_brand/`.

The card speaks English or Arabic from the Home Assistant locale (`hass.locale.language` or `hass.language`). It does not use the integration’s display-language option. That option is what the TV player receives.

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
| `entity` | Media player. In video mode this must be a supported TV. |
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

The stage shows the star, the surah line, the reciter, and the Madinah mushaf line when the session has an album or is a web app session.

Audio mode shows a progress bar from the session spans and the player’s `media_position`. Pause is available when the player supports play or pause.

Web app mode hides the progress bar and the pause button. The state pill says **On the TV** (`onTv`). Volume controls stay if the entity supports volume. The session does not move the ayah, and there is nothing to pause inside Home Assistant. The TV browser is playing. The background switch is shown only in this mode and is sent as `background_video`.

Continue-to-next stays available in web app mode for a full surah. The TV player receives it as `auto_surah`. Loop stays available in both modes and is sent as `loop`. Background video is shown only while the web app is selected.

## Decisions

- One card for both modes. `webapp` switches the player list and which controls are visible.
- Players are alphabetical in both modes.
- Web app mode never offers a speaker or a Chromecast. A saved non-TV entity is dropped rather than sent to a player that cannot open the page.
- The card does not estimate the current ayah while the web app is open. The session is the range that was opened.
- Pause and progress belong to the joined MP3, not to the TV page.
