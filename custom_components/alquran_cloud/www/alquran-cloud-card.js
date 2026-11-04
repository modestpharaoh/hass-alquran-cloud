const ROOT_ID = "media-source://alquran_cloud";
const BRAND_ICON = "/alquran_cloud_brand/icon.svg";
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const VIDEO_PLATFORMS = ["webostv", "samsungtv", "samsungtv_smart", "samsungtv_tizen", "androidtv"];
const PAUSE = 1;
const VOLUME_SET = 4;
const VOLUME_STEP = 1024;
const PLAY = 16384;

const STRINGS = {
  en: {
    dir: "ltr",
    title: "Al Quran Cloud",
    player: "Media player",
    reciter: "Reciter",
    surah: "Surah",
    startAyah: "Start ayah",
    endAyah: "End ayah",
    throughLast: "Through the last ayah",
    repeat: "Repeat",
    speed: "Playback speed",
    continueSurah: "Continue to the next surah",
    loop: "Loop",
    picture: "Surah video",
    pictureHelp: "Opens the Quran player in the TV browser. Home Assistant does not follow the ayah after that.",
    onTv: "On the TV",
    tvRequired: "Choose an LG, Samsung, or Android TV.",
    play: "Play",
    pause: "Pause",
    resume: "Resume",
    previous: "Previous surah",
    next: "Next surah",
    stop: "Stop",
    idle: "Ready",
    error: "Could not load the catalog",
    missing: "Choose a media player, reciter, and surah",
    playing: "Playing",
    paused: "Paused",
    mushaf: "Madinah Mushaf",
  },
  ar: {
    dir: "rtl",
    title: "Al Quran Cloud",
    player: "مشغل الوسائط",
    reciter: "القارئ",
    surah: "السورة",
    startAyah: "من الآية",
    endAyah: "إلى الآية",
    throughLast: "حتى آخر الآية",
    repeat: "التكرار",
    speed: "سرعة التشغيل",
    continueSurah: "متابعة السورة التالية",
    loop: "إعادة التشغيل",
    picture: "فيديو السورة",
    pictureHelp: "يفتح مشغّل القرآن في متصفح التلفاز. هوم أسيستنت لا يتابع الآية بعد ذلك.",
    onTv: "على التلفاز",
    tvRequired: "اختر تلفاز LG أو Samsung أو Android.",
    play: "تشغيل",
    pause: "إيقاف مؤقت",
    resume: "استئناف",
    previous: "السورة السابقة",
    next: "السورة التالية",
    stop: "إيقاف",
    idle: "جاهز",
    error: "تعذر تحميل القائمة",
    missing: "اختر المشغل والقارئ والسورة",
    playing: "يعمل",
    paused: "متوقف مؤقتاً",
    mushaf: "مصحف المدينة",
  },
};

function language(hass) {
  const code = (hass && hass.locale && hass.locale.language) || (hass && hass.language) || "en";
  return String(code).toLowerCase().startsWith("ar") ? "ar" : "en";
}

function strings(hass) {
  return STRINGS[language(hass)];
}

function valueFromContent(contentId, key) {
  if (!contentId) return null;
  const marker = `/${key}/`;
  const index = contentId.lastIndexOf(marker);
  if (index === -1) return null;
  const value = contentId.slice(index + marker.length).split("/")[0];
  return value || null;
}

function idFromContent(contentId, key) {
  const value = parseInt(valueFromContent(contentId, key), 10);
  return Number.isFinite(value) ? value : null;
}

function asOption(child, key) {
  const raw = valueFromContent(child.media_content_id, key);
  if (!raw) return null;
  const numeric = idFromContent(child.media_content_id, key);
  return { id: numeric == null ? raw : numeric, label: child.title || raw };
}

function playerPlatform(hass, entityId) {
  const entry = hass && hass.entities && hass.entities[entityId];
  return (entry && entry.platform) || "";
}

function mediaPlayers(hass, videoOnly) {
  if (!hass || !hass.states) return [];
  return Object.values(hass.states)
    .filter((state) => state.entity_id && state.entity_id.startsWith("media_player."))
    .filter((state) => !videoOnly || VIDEO_PLATFORMS.includes(playerPlatform(hass, state.entity_id)))
    .map((state) => ({
      id: state.entity_id,
      label: (state.attributes && state.attributes.friendly_name) || state.entity_id,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function fillSelect(select, options, selected, placeholder) {
  const value = selected == null || selected === "" ? "" : String(selected);
  const key = `${placeholder || ""}\n${options.map((item) => `${item.id}\t${item.label}`).join("\n")}`;
  if (select.dataset.options !== key) {
    select.dataset.options = key;
    select.replaceChildren();
    if (placeholder) {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = placeholder;
      select.appendChild(blank);
    }
    options.forEach((item) => {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = item.label;
      select.appendChild(option);
    });
  }
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (exists || value === "") select.value = value;
  else if (!exists) select.value = "";
}

function clampRepeat(value) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return 1;
  return Math.min(20, Math.max(1, number));
}

function errorText(err, fallback) {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return err.message || fallback;
}

function sessionFor(hass, entityId) {
  if (!hass || !entityId || !hass.states) return null;
  const states = Object.values(hass.states);
  for (const state of states) {
    if (!state || !state.entity_id || !state.entity_id.includes("alquran_cloud")) continue;
    const details = state.attributes && state.attributes[entityId];
    if (details && details.verse_key) return details;
  }
  return null;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
  .header img, .header ha-icon { width: 32px; height: 32px; border-radius: 50%; flex: 0 0 auto; }
  .header .name { font-size: 1.12rem; font-weight: 650; color: var(--primary-text-color); }
  .stage {
    margin: 0 16px 4px;
    padding: 18px 16px 16px;
    border-radius: 18px;
    text-align: center;
    color: #f6fff8;
    background:
      radial-gradient(90% 70% at 50% 0%, rgba(2, 102, 52, 0.55), transparent 62%),
      linear-gradient(180deg, #143024 0%, #0c1c14 100%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
  }
  .art {
    width: 76px; height: 76px; border-radius: 50%; margin: 0 auto 10px; display: block;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.28);
    object-fit: cover;
  }
  .surah-line { font-size: 1.12rem; font-weight: 650; line-height: 1.35; }
  .reciter-line, .mushaf-line { margin-top: 4px; font-size: 0.92rem; line-height: 1.35; opacity: 0.9; }
  .state-pill {
    display: inline-block; margin-top: 8px; padding: 2px 10px; border-radius: 999px;
    font-size: 0.75rem; letter-spacing: 0.04em; background: rgba(255, 255, 255, 0.16);
  }
  .progress { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .progress[hidden] { display: none; }
  .progress .time { min-width: 2.4em; font-size: 0.75rem; font-variant-numeric: tabular-nums; opacity: 0.9; }
  .progress .track { flex: 1; height: 4px; border-radius: 999px; background: rgba(255, 255, 255, 0.22); overflow: hidden; }
  .progress .fill { height: 100%; width: 0%; border-radius: 999px; background: #7dcea0; }
  .transport { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 14px; }
  .transport button {
    flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: none; border-radius: 50%;
    background: rgba(255, 255, 255, 0.16); color: #f6fff8; cursor: pointer;
  }
  .transport button.pause { flex-basis: 52px; width: 52px; height: 52px; background: #f6fff8; color: #0c1c14; }
  ha-icon { --mdc-icon-size: 22px; }
  .body { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color); }
  select, input[type="number"] {
    width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 10px;
    border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.4));
    background: var(--card-background-color, transparent); color: var(--primary-text-color); font: inherit;
  }
  .volume { display: flex; align-items: center; gap: 8px; }
  .volume input[type="range"] { flex: 1; accent-color: #026634; }
  .switch { flex-direction: row; align-items: center; justify-content: space-between; font-size: 14px; color: var(--primary-text-color); }
  .actions { display: flex; gap: 8px; }
  button.action {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 12px; border: none; border-radius: 999px; font: inherit; cursor: pointer;
  }
  button.play { background: #026634; color: #fff; }
  button.stop { background: var(--secondary-background-color, rgba(127, 127, 127, 0.2)); color: var(--primary-text-color); }
  button.icon {
    flex: 0 0 36px; width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%;
    background: var(--secondary-background-color, rgba(127, 127, 127, 0.18));
    color: var(--primary-text-color); cursor: pointer;
  }
  .status { min-height: 1.2em; color: var(--error-color, #db4437); font-size: 0.9em; }
  .help { font-size: 12px; color: var(--secondary-text-color); }
`;

function brandImage(className) {
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.src = BRAND_ICON;
  image.addEventListener("error", () => {
    const icon = document.createElement("ha-icon");
    icon.icon = "mdi:star-crescent";
    icon.setAttribute("icon", "mdi:star-crescent");
    image.replaceWith(icon);
  });
  return image;
}

function iconButton(className, iconName) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  const icon = document.createElement("ha-icon");
  icon.icon = iconName;
  icon.setAttribute("icon", iconName);
  button.append(icon);
  return button;
}

class AlquranCloudCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._built = false;
    this.attachShadow({ mode: "open" });
  }

  static getStubConfig() {
    return {
      speed: 1,
      start_ayah: 1,
      repeat: 1,
      continue_surah: false,
      loop: false,
      show_picture: false,
    };
  }

  setConfig(config) {
    this._config = { ...AlquranCloudCard.getStubConfig(), ...config };
    if (this._built) this._applyConfig();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  getCardSize() {
    return 8;
  }

  connectedCallback() {
    if (this._hass && !this._catalog) this._loadReciters();
  }

  _build() {
    const text = strings(this._hass);
    const style = document.createElement("style");
    style.textContent = STYLE;
    const card = document.createElement("ha-card");
    const header = document.createElement("div");
    header.className = "header";
    this._title = document.createElement("div");
    this._title.className = "name";
    header.append(brandImage("logo"), this._title);

    const stage = document.createElement("div");
    stage.className = "stage";
    this._surahLine = document.createElement("div");
    this._surahLine.className = "surah-line";
    this._reciterLine = document.createElement("div");
    this._reciterLine.className = "reciter-line";
    this._mushafLine = document.createElement("div");
    this._mushafLine.className = "mushaf-line";
    this._statePill = document.createElement("div");
    this._statePill.className = "state-pill";
    const progress = document.createElement("div");
    progress.className = "progress";
    progress.hidden = true;
    this._elapsed = document.createElement("span");
    this._elapsed.className = "time";
    const track = document.createElement("div");
    track.className = "track";
    this._fill = document.createElement("div");
    this._fill.className = "fill";
    track.append(this._fill);
    this._remaining = document.createElement("span");
    this._remaining.className = "time";
    progress.append(this._elapsed, track, this._remaining);
    this._progress = progress;
    this._transport = document.createElement("div");
    this._transport.className = "transport";
    stage.append(brandImage("art"), this._surahLine, this._reciterLine, this._mushafLine, this._statePill, progress, this._transport);

    const body = document.createElement("div");
    body.className = "body";
    this._status = document.createElement("div");
    this._status.className = "status";
    this._player = this._field(text.player, "select", "player");
    this._reciter = this._field(text.reciter, "select", "reciter");
    this._surah = this._field(text.surah, "select", "surah");
    this._start = this._field(text.startAyah, "select", "start");
    this._end = this._field(text.endAyah, "select", "end");
    this._repeat = this._field(text.repeat, "input", "repeat");
    this._repeat.type = "number";
    this._repeat.min = "1";
    this._repeat.max = "20";
    this._speed = this._field(text.speed, "select", "speed");
    this._speed.innerHTML = SPEEDS.map((speed) => `<option value="${speed}">${speed}×</option>`).join("");
    this._continue = this._check("continue");
    this._loop = this._check("loop");
    this._picture = this._check("picture");
    this._picture.addEventListener("change", () => this._onPictureChange());
    this._help = document.createElement("div");
    this._help.className = "help";
    const volume = document.createElement("div");
    volume.className = "volume";
    volume.hidden = true;
    this._volume = volume;
    const actions = document.createElement("div");
    actions.className = "actions";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "action play";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "action stop";
    this._playButton = play;
    this._stopButton = stop;
    actions.append(play, stop);
    body.append(
      this._status,
      this._player.parentElement,
      this._reciter.parentElement,
      this._surah.parentElement,
      this._start.parentElement,
      this._end.parentElement,
      this._repeat.parentElement,
      this._speed.parentElement,
      this._continue.parentElement,
      this._loop.parentElement,
      this._picture.parentElement,
      this._help,
      volume,
      actions,
    );
    card.append(header, stage, body);
    this.shadowRoot.replaceChildren(style, card);
    this._player.addEventListener("change", () => this._update());
    this._reciter.addEventListener("change", () => this._loadChapters());
    this._surah.addEventListener("change", () => this._loadAyahs());
    this._start.addEventListener("change", () => this._syncRange());
    this._end.addEventListener("change", () => this._syncRange());
    play.addEventListener("click", () => this._play());
    stop.addEventListener("click", () => this._stop());
    this._built = true;
    this._applyConfig();
    this._loadPlayers();
    this._loadReciters();
  }

  _field(labelText, tag, className) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const control = document.createElement(tag);
    control.className = className;
    label.append(control);
    return control;
  }

  _check(className) {
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = className;
    const span = document.createElement("span");
    label.append(span, input);
    return input;
  }

  _applyConfig() {
    const config = this._config || {};
    this._speed.value = String(SPEEDS.includes(Number(config.speed)) ? Number(config.speed) : 1);
    this._repeat.value = String(clampRepeat(config.repeat == null ? 1 : config.repeat));
    this._continue.checked = Boolean(config.continue_surah);
    this._loop.checked = Boolean(config.loop);
    this._picture.checked = Boolean(config.show_picture);
    if (config.entity) this._preferredPlayer = config.entity;
    if (config.reciter_id) this._preferredReciter = String(config.reciter_id);
    if (config.surah) this._preferredSurah = String(config.surah);
    if (config.start_ayah) this._preferredStart = String(config.start_ayah);
    if (config.end_ayah) this._preferredEnd = String(config.end_ayah);
  }

  _onPictureChange() {
    if (this._picture.checked) this._loop.checked = false;
    const before = this._player.value;
    this._loadPlayers();
    if (this._picture.checked && before && !this._player.value) {
      this._status.textContent = strings(this._hass).tvRequired;
    }
    this._syncRange();
    this._update();
  }

  _loadPlayers() {
    const video = Boolean(this._picture && this._picture.checked);
    const players = mediaPlayers(this._hass, video);
    const current = this._player.value || this._preferredPlayer || "";
    const valid = players.some((item) => item.id === current);
    const text = strings(this._hass);
    fillSelect(this._player, players, valid ? current : "", video && !valid ? text.tvRequired : "");
  }

  async _browse(contentId) {
    return this._hass.callWS({
      type: "media_source/browse_media",
      media_content_id: contentId,
    });
  }

  async _loadReciters() {
    const text = strings(this._hass);
    this._status.textContent = "";
    try {
      const root = await this._browse(ROOT_ID);
      this._catalog = true;
      const children = root.children || [];
      this._reciter.innerHTML = children
        .map((child) => `<option value="${valueFromContent(child.media_content_id, "reciter")}">${child.title}</option>`)
        .join("");
      if (this._preferredReciter) this._reciter.value = this._preferredReciter;
      await this._loadChapters();
    } catch (err) {
      this._status.textContent = errorText(err, text.error);
    }
  }

  async _loadChapters() {
    if (!this._reciter.value) return;
    const text = strings(this._hass);
    try {
      const result = await this._browse(`${ROOT_ID}/reciter/${this._reciter.value}`);
      this._surah.innerHTML = (result.children || [])
        .map((child) => `<option value="${idFromContent(child.media_content_id, "chapter")}">${child.title}</option>`)
        .join("");
      if (this._preferredSurah) this._surah.value = this._preferredSurah;
      await this._loadAyahs();
    } catch (err) {
      this._status.textContent = errorText(err, text.error);
    }
  }

  async _loadAyahs() {
    if (!this._reciter.value || !this._surah.value) return;
    const text = strings(this._hass);
    try {
      const result = await this._browse(
        `${ROOT_ID}/reciter/${this._reciter.value}/chapter/${this._surah.value}`
      );
      const ayahs = (result.children || []).map((child) => asOption(child, "ayah")).filter(Boolean);
      this._ayahCount = ayahs.length ? Number(ayahs[ayahs.length - 1].id) : 0;
      fillSelect(this._start, ayahs, this._preferredStart || this._start.value || "1", "");
      fillSelect(this._end, ayahs, this._preferredEnd || this._end.value, text.throughLast);
      this._syncRange();
    } catch (err) {
      this._status.textContent = errorText(err, text.error);
    }
  }

  _isFullSurah() {
    const start = Number(this._start.value) || 1;
    const end = this._end.value ? Number(this._end.value) : this._ayahCount;
    return start <= 1 && end >= this._ayahCount && this._ayahCount > 0;
  }

  _syncRange() {
    const full = this._isFullSurah();
    this._continue.parentElement.hidden = !full;
    if (!full) this._continue.checked = false;
    const video = Boolean(this._picture && this._picture.checked);
    this._loop.parentElement.hidden = video;
    if (video) this._loop.checked = false;
  }

  _playerState() {
    const entity = this._player && this._player.value;
    if (!this._hass || !entity) return null;
    return this._hass.states[entity] || null;
  }

  _update() {
    if (!this._built || !this._hass) return;
    const text = strings(this._hass);
    this._loadPlayers();
    this.dir = text.dir;
    this._title.textContent = text.title;
    this._playButton.textContent = text.play;
    this._stopButton.textContent = text.stop;
    this._continue.parentElement.querySelector("span").textContent = text.continueSurah;
    this._loop.parentElement.querySelector("span").textContent = text.loop;
    this._loop.parentElement.hidden = this._picture.checked;
    this._picture.parentElement.querySelector("span").textContent = text.picture;
    this._help.textContent = this._picture.checked
      ? this._player.value
        ? text.pictureHelp
        : text.tvRequired
      : "";
    const state = this._playerState();
    const session = sessionFor(this._hass, this._player.value);
    if (session) {
      this._surahLine.textContent = session.title || session.verse_key;
      this._reciterLine.textContent = session.artist || "";
      this._mushafLine.textContent = session.album || (session.show_picture ? text.mushaf : "");
      this._statePill.textContent = session.show_picture
        ? text.onTv
        : state && state.state === "paused"
          ? text.paused
          : text.playing;
    } else {
      const surah = this._surah && this._surah.selectedOptions[0];
      const reciter = this._reciter && this._reciter.selectedOptions[0];
      this._surahLine.textContent = (surah && surah.textContent) || text.idle;
      this._reciterLine.textContent = (reciter && reciter.textContent) || "";
      this._mushafLine.textContent = this._picture.checked ? text.mushaf : "";
      this._statePill.textContent = text.idle;
    }
    this._renderTransport(text, state);
    this._renderProgress(state);
    this._renderVolume(state);
  }

  _renderTransport(text, state) {
    const session = sessionFor(this._hass, this._player && this._player.value);
    const features = (state && state.attributes && state.attributes.supported_features) || 0;
    const paused = state && state.state === "paused";
    const canPause = !(session && session.show_picture) && (features & PAUSE || features & PLAY);
    this._transport.replaceChildren();
    const previous = iconButton("jump", "mdi:skip-previous");
    previous.title = text.previous;
    previous.addEventListener("click", () => this._transportAction("previous"));
    const pause = iconButton("pause", paused ? "mdi:play" : "mdi:pause");
    pause.title = paused ? text.resume : text.pause;
    pause.hidden = !canPause;
    pause.addEventListener("click", () => this._transportAction("pause"));
    const next = iconButton("jump", "mdi:skip-next");
    next.title = text.next;
    next.addEventListener("click", () => this._transportAction("next"));
    this._transport.append(previous, pause, next);
  }

  _renderProgress(state) {
    const session = sessionFor(this._hass, this._player && this._player.value);
    if (session && session.show_picture) {
      this._progress.hidden = true;
      return;
    }
    const attrs = (state && state.attributes) || {};
    const duration = Number(attrs.media_duration);
    const position = Number(attrs.media_position);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) {
      this._progress.hidden = true;
      return;
    }
    this._progress.hidden = false;
    this._elapsed.textContent = formatTime(position);
    this._remaining.textContent = formatTime(Math.max(0, duration - position));
    this._fill.style.width = `${Math.min(100, (position / duration) * 100)}%`;
  }

  _renderVolume(state) {
    const features = (state && state.attributes && state.attributes.supported_features) || 0;
    if (!(features & VOLUME_SET) && !(features & VOLUME_STEP)) {
      this._volume.hidden = true;
      return;
    }
    this._volume.hidden = false;
    if (this._volume.childElementCount) return;
    const level = state && state.attributes ? state.attributes.volume_level : 0.5;
    const down = iconButton("icon", "mdi:volume-minus");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round((level || 0) * 100));
    const up = iconButton("icon", "mdi:volume-plus");
    down.addEventListener("click", () => this._volumeStep(-0.05, features));
    up.addEventListener("click", () => this._volumeStep(0.05, features));
    slider.addEventListener("change", (event) => {
      this._hass.callService("media_player", "volume_set", {
        entity_id: this._player.value,
        volume_level: Number(event.target.value) / 100,
      });
    });
    this._volume.append(down, slider, up);
  }

  _volumeStep(delta, features) {
    const entity = this._player.value;
    if (features & VOLUME_SET) {
      const state = this._playerState();
      const current = (state && state.attributes && state.attributes.volume_level) || 0;
      this._hass.callService("media_player", "volume_set", {
        entity_id: entity,
        volume_level: Math.min(1, Math.max(0, current + delta)),
      });
      return;
    }
    this._hass.callService("media_player", delta > 0 ? "volume_up" : "volume_down", { entity_id: entity });
  }

  async _transportAction(action) {
    const text = strings(this._hass);
    const entity = this._player.value;
    if (!entity) return;
    const session = sessionFor(this._hass, entity);
    try {
      if (action === "pause") {
        const state = this._playerState();
        const service = state && state.state === "paused" ? "media_play" : "media_pause";
        await this._hass.callService("media_player", service, { entity_id: entity });
        return;
      }
      if (session) {
        await this._hass.callService(
          "alquran_cloud",
          action === "next" ? "next_surah" : "previous_surah",
          {},
          { entity_id: entity }
        );
        return;
      }
      const options = [...this._surah.options].map((option) => parseInt(option.value, 10));
      const index = options.indexOf(parseInt(this._surah.value, 10));
      const nextIndex = action === "next" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
      this._surah.value = String(options[nextIndex] || options[0] || 1);
      await this._loadAyahs();
      this._start.value = "1";
      this._end.value = "";
      this._syncRange();
      await this._play();
    } catch (err) {
      this._status.textContent = errorText(err, text.error);
    }
  }

  async _play() {
    const text = strings(this._hass);
    this._status.textContent = "";
    if (!this._player.value || !this._reciter.value || !this._surah.value || !this._start.value) {
      this._status.textContent = text.missing;
      return;
    }
    const data = {
      reciter_id: this._reciter.value,
      surah: Number(this._surah.value),
      start_ayah: Number(this._start.value),
      repeat: clampRepeat(this._repeat.value),
      speed: Number(this._speed.value),
      continue_surah: this._isFullSurah() && this._continue.checked,
      loop: this._picture.checked ? false : this._loop.checked,
      show_picture: this._picture.checked,
    };
    if (this._end.value) data.end_ayah = Number(this._end.value);
    try {
      await this._hass.callService(
        "alquran_cloud",
        "play",
        data,
        { entity_id: this._player.value }
      );
    } catch (err) {
      this._status.textContent = errorText(err, text.error);
    }
  }

  async _stop() {
    if (!this._player.value) return;
    try {
      await this._hass.callService("alquran_cloud", "stop", {}, { entity_id: this._player.value });
    } catch (err) {
      this._status.textContent = errorText(err, strings(this._hass).error);
    }
  }
}

class AlquranCloudCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._reciters = [];
    this._surahs = [];
    this._ayahs = [];
    this._loading = false;
  }

  setConfig(config) {
    this._config = { ...AlquranCloudCard.getStubConfig(), ...config };
    if (this._hass) this._ensure();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._ensure();
  }

  _ensure() {
    if (!this._ui) {
      const style = document.createElement("style");
      style.textContent = `${STYLE} .hidden { display: none; }`;
      const form = document.createElement("div");
      form.className = "body";
      this._player = this._labeled("player");
      this._reciter = this._labeled("reciter");
      this._surah = this._labeled("surah");
      this._start = this._labeled("start");
      this._end = this._labeled("end");
      this._repeat = this._labeled("repeat", "input");
      this._repeat.control.type = "number";
      this._repeat.control.min = "1";
      this._repeat.control.max = "20";
      this._speed = this._labeled("speed");
      this._speed.control.innerHTML = SPEEDS.map((speed) => `<option value="${speed}">${speed}×</option>`).join("");
      this._continue = this._switch("continue");
      this._loop = this._switch("loop");
      this._picture = this._switch("picture");
      form.append(
        this._player.label,
        this._reciter.label,
        this._surah.label,
        this._start.label,
        this._end.label,
        this._repeat.label,
        this._speed.label,
        this._continue.label,
        this._loop.label,
        this._picture.label,
      );
      this.shadowRoot.replaceChildren(style, form);
      this._bind();
      this._ui = true;
    }
    this._paint();
    if (this._hass.callWS && !this._reciters.length && !this._loading) {
      this._loading = true;
      this._load();
    }
  }

  _labeled(className, tag = "select") {
    const label = document.createElement("label");
    const text = document.createElement("span");
    const control = document.createElement(tag);
    control.className = className;
    label.append(text, control);
    return { label, text, control };
  }

  _switch(className) {
    const label = document.createElement("label");
    label.className = "switch";
    const text = document.createElement("span");
    const control = document.createElement("input");
    control.type = "checkbox";
    control.className = className;
    label.append(text, control);
    return { label, text, control };
  }

  _paint() {
    const text = strings(this._hass);
    const config = this._config;
    this._player.text.textContent = text.player;
    this._reciter.text.textContent = text.reciter;
    this._surah.text.textContent = text.surah;
    this._start.text.textContent = text.startAyah;
    this._end.text.textContent = text.endAyah;
    this._repeat.text.textContent = text.repeat;
    this._speed.text.textContent = text.speed;
    this._continue.text.textContent = text.continueSurah;
    this._loop.text.textContent = text.loop;
    this._picture.text.textContent = text.picture;
    fillSelect(this._reciter.control, this._reciters, config.reciter_id || "", "");
    fillSelect(this._surah.control, this._surahs, config.surah || "", "");
    fillSelect(this._start.control, this._ayahs, config.start_ayah || 1, "");
    fillSelect(this._end.control, this._ayahs, config.end_ayah || "", text.throughLast);
    if (this.shadowRoot.activeElement !== this._repeat.control) {
      this._repeat.control.value = String(clampRepeat(config.repeat == null ? 1 : config.repeat));
    }
    this._speed.control.value = String(SPEEDS.includes(Number(config.speed)) ? Number(config.speed) : 1);
    const full = this._editorFull();
    this._continue.label.classList.toggle("hidden", !full);
    this._continue.control.checked = full && Boolean(config.continue_surah);
    const video = Boolean(config.show_picture);
    this._loop.label.classList.toggle("hidden", video);
    this._loop.control.checked = !video && Boolean(config.loop);
    this._picture.control.checked = video;
    const players = mediaPlayers(this._hass, video);
    const entity = config.entity && players.some((item) => item.id === config.entity) ? config.entity : "";
    fillSelect(this._player.control, players, entity, "");
  }

  _editorFull() {
    const start = Number(this._config.start_ayah || 1);
    const last = this._ayahs.length ? Number(this._ayahs[this._ayahs.length - 1].id) : 0;
    const end = this._config.end_ayah ? Number(this._config.end_ayah) : last;
    return last > 0 && start <= 1 && end >= last;
  }

  _bind() {
    this._player.control.addEventListener("change", () => {
      this._commit({ entity: this._player.control.value || undefined });
    });
    this._reciter.control.addEventListener("change", () => {
      const reciterId = this._reciter.control.value || undefined;
      this._commit({ reciter_id: reciterId, surah: undefined, start_ayah: 1, end_ayah: undefined });
      this._loadSurahs(reciterId);
    });
    this._surah.control.addEventListener("change", () => {
      const surah = Number(this._surah.control.value) || undefined;
      this._commit({ surah, start_ayah: 1, end_ayah: undefined });
      this._loadAyahs(this._config.reciter_id, surah);
    });
    this._start.control.addEventListener("change", () => {
      this._commit({ start_ayah: Number(this._start.control.value) || 1 });
    });
    this._end.control.addEventListener("change", () => {
      const value = this._end.control.value;
      this._commit({ end_ayah: value ? Number(value) : undefined });
    });
    this._repeat.control.addEventListener("change", () => {
      this._commit({ repeat: clampRepeat(this._repeat.control.value) });
    });
    this._speed.control.addEventListener("change", () => {
      this._commit({ speed: Number(this._speed.control.value) });
    });
    this._continue.control.addEventListener("change", () => {
      this._commit({ continue_surah: this._continue.control.checked });
    });
    this._loop.control.addEventListener("change", () => {
      this._commit({ loop: this._loop.control.checked });
    });
    this._picture.control.addEventListener("change", () => {
      const show = this._picture.control.checked;
      const players = mediaPlayers(this._hass, show);
      const patch = { show_picture: show };
      if (show) patch.loop = false;
      if (show && this._config.entity && !players.some((item) => item.id === this._config.entity)) {
        patch.entity = undefined;
      }
      this._commit(patch);
    });
  }

  _commit(patch) {
    const config = { ...this._config, ...patch };
    const last = this._ayahs.length ? Number(this._ayahs[this._ayahs.length - 1].id) : 0;
    const start = Number(config.start_ayah || 1);
    const end = config.end_ayah ? Number(config.end_ayah) : last;
    if (!(last > 0 && start <= 1 && end >= last)) config.continue_surah = false;
    Object.keys(config).forEach((key) => {
      if (config[key] === undefined || config[key] === "") delete config[key];
    });
    this._config = config;
    this._paint();
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
    );
  }

  async _load() {
    try {
      const page = await this._hass.callWS({ type: "media_source/browse_media", media_content_id: ROOT_ID });
      this._reciters = (page.children || []).map((child) => asOption(child, "reciter")).filter(Boolean);
      this._paint();
      if (this._config.reciter_id) await this._loadSurahs(this._config.reciter_id);
    } catch (_err) {
      /* The card shows catalog errors. */
    } finally {
      this._loading = false;
    }
  }

  async _loadSurahs(reciterId) {
    if (!reciterId || !this._hass || !this._hass.callWS) return;
    try {
      const page = await this._hass.callWS({
        type: "media_source/browse_media",
        media_content_id: `${ROOT_ID}/reciter/${reciterId}`,
      });
      this._surahs = (page.children || []).map((child) => asOption(child, "chapter")).filter(Boolean);
      this._paint();
      if (this._config.surah) await this._loadAyahs(reciterId, this._config.surah);
    } catch (_err) {
      /* Ignore browse failures in the editor. */
    }
  }

  async _loadAyahs(reciterId, surah) {
    if (!reciterId || !surah || !this._hass || !this._hass.callWS) return;
    try {
      const page = await this._hass.callWS({
        type: "media_source/browse_media",
        media_content_id: `${ROOT_ID}/reciter/${reciterId}/chapter/${surah}`,
      });
      this._ayahs = (page.children || []).map((child) => asOption(child, "ayah")).filter(Boolean);
      this._paint();
    } catch (_err) {
      /* Ignore browse failures in the editor. */
    }
  }
}

customElements.define("alquran-cloud-card", AlquranCloudCard);
customElements.define("alquran-cloud-card-editor", AlquranCloudCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "alquran-cloud-card",
  name: "Al Quran Cloud",
  description: "Play a joined surah or ayah range, or open it in a TV browser.",
  preview: true,
});

AlquranCloudCard.getConfigElement = () => document.createElement("alquran-cloud-card-editor");
