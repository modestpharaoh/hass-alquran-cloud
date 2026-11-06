const ROOT_ID = "media-source://alquran_cloud";
const BRAND_ICON = "/alquran_cloud_brand/icon.svg";
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
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
    webapp: "Web app",
    webappHelp: "Opens the Quran web app in the TV browser. The six buttons reach the page on every TV. A remote’s play, pause, and track keys work on Android TV and often do not arrive on LG webOS or Samsung.",
    webappFollow: "These lines are the last report from the TV. Sync asks the page again.",
    pageSilent: "The page did not answer.",
    sync: "Sync",
    previousAyah: "Previous ayah",
    nextAyah: "Next ayah",
    openingNext: "Opening the next surah…",
    openingPrevious: "Opening the previous surah…",
    background: "Background video",
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
    ayah: "ayah",
    ayahs: "ayahs",
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
    webapp: "تطبيق الويب",
    webappHelp: "يفتح تطبيق القرآن في متصفح التلفاز. الأزرار الستة تصل إلى الصفحة على كل تلفاز. مفاتيح التشغيل والإيقاف والمسار في جهاز التحكم تعمل على Android TV وغالباً لا تصل على LG webOS أو Samsung.",
    webappFollow: "هذه السطور آخر ما أبلغ به التلفاز. التحديث يسأل الصفحة من جديد.",
    pageSilent: "الصفحة لم ترد.",
    sync: "تحديث",
    previousAyah: "الآية السابقة",
    nextAyah: "الآية التالية",
    openingNext: "جارٍ فتح السورة التالية…",
    openingPrevious: "جارٍ فتح السورة السابقة…",
    background: "فيديو الخلفية",
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
    ayah: "آية",
    ayahs: "آيات",
  },
};

function language(hass) {
  const code = (hass && hass.locale && hass.locale.language) || (hass && hass.language) || "en";
  return String(code).toLowerCase().startsWith("ar") ? "ar" : "en";
}

function integrationLanguage(hass) {
  if (!hass || !hass.states) return language(hass);
  const known = [
    "sensor.alquran_cloud_active_sessions",
    "sensor.al_quran_cloud_active_sessions",
  ];
  const states = known
    .map((id) => hass.states[id])
    .filter(Boolean)
    .concat(Object.values(hass.states));
  for (const state of states) {
    if (!state || !state.entity_id || !state.entity_id.startsWith("sensor.")) continue;
    const value = state.attributes && state.attributes.display_language;
    if (value === "arabic" || value === "english") return value === "arabic" ? "ar" : "en";
  }
  return language(hass);
}

function strings(hass) {
  return STRINGS[integrationLanguage(hass)];
}

function inLanguage(value, lang) {
  if (!value) return "";
  return String(value)
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => {
      const hasArabic = /[\u0600-\u06FF]/.test(part);
      const hasEnglish = /[A-Za-z]/.test(part);
      if (lang === "ar") return !hasEnglish || hasArabic;
      return !hasArabic || hasEnglish;
    })
    .join(" · ");
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
  const known = [
    "sensor.alquran_cloud_active_sessions",
    "sensor.al_quran_cloud_active_sessions",
  ];
  const states = known
    .map((id) => hass.states[id])
    .filter(Boolean)
    .concat(Object.values(hass.states));
  for (const state of states) {
    if (!state || !state.entity_id || !state.entity_id.startsWith("sensor.")) continue;
    const session = state.attributes && state.attributes[entityId];
    if (session && typeof session === "object" && ("surah" in session || session.verse_key)) {
      return session;
    }
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

function playbackClock(state) {
  if (!state || !state.attributes) return null;
  if (state.state !== "playing" && state.state !== "paused" && state.state !== "buffering") return null;
  const attrs = state.attributes;
  if (attrs.media_position == null) return null;
  let position = Number(attrs.media_position);
  if (!Number.isFinite(position)) return null;
  const duration = attrs.media_duration == null ? null : Number(attrs.media_duration);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  if (state.state === "playing" && attrs.media_position_updated_at) {
    const updated = Date.parse(attrs.media_position_updated_at);
    if (Number.isFinite(updated)) position += Math.max(0, (Date.now() - updated) / 1000);
  }
  position = Math.max(0, position);
  if (hasDuration) position = Math.min(duration, position);
  return { position, duration: hasDuration ? duration : null };
}

function pad3(value) {
  return String(value).padStart(3, "0");
}

function arabicIndic(number) {
  return String(number).replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[digit]);
}

function arabicAyahWord(count) {
  const last = Math.abs(Number(count) || 0) % 100;
  if (last === 2) return "آيتان";
  if (last >= 3 && last <= 10) return "آيات";
  return "آية";
}

function playbackLine(session, text, lang) {
  const title = inLanguage(session.title || "", lang);
  const start = Number(session.start_ayah);
  const end = Number(session.end_ayah);
  const names = title.replace(/^\d{1,3}\s*·\s*/, "");
  if (session.full_surah && Number.isFinite(end)) {
    const unit = lang === "ar" ? arabicAyahWord(end) : (end === 1 ? text.ayah : text.ayahs);
    const count = lang === "ar" ? arabicIndic(end) : String(end);
    const surah = title || session.verse_key || "";
    return `${surah} · ${count} ${unit}`;
  }
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const range = `${pad3(start)}:${pad3(end)}`;
    return names ? `${range} · ${names}` : range;
  }
  return title || session.verse_key || "";
}

const STYLE = `
  :host { display: block; }
  [hidden] { display: none !important; }
  ha-card { overflow: hidden; }
  .header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
  .header img, .header ha-icon { width: 32px; height: 32px; border-radius: 50%; flex: 0 0 auto; }
  .header .name { font-size: 1.12rem; font-weight: 650; color: var(--primary-text-color); }
  .stage {
    position: relative;
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
  .stage.webapp { padding-top: 52px; }
  .art {
    width: 76px; height: 76px; border-radius: 50%; margin: 0 auto 10px; display: block;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.28);
    object-fit: cover;
  }
  .surah-line { font-size: 1.12rem; font-weight: 650; line-height: 1.35; }
  .reciter-line, .mushaf-line { margin-top: 4px; font-size: 0.92rem; line-height: 1.35; opacity: 0.9; }
  .state-pill {
    display: inline-block; margin-top: 8px; padding: 3px 12px; border-radius: 999px;
    font-size: 0.75rem; font-weight: 650; letter-spacing: 0.04em;
    background: rgba(255, 255, 255, 0.16);
  }
  .state-pill.live { background: #026634; color: #ffffff; }
  .state-pill.silent { background: #b00020; color: #ffffff; }
  .stage > button.sync {
    position: absolute; top: 10px; inset-inline-end: 10px; z-index: 1;
    width: 40px; height: 40px; padding: 0; border: none; border-radius: 50%;
    background: rgba(255, 255, 255, 0.16); color: #f6fff8; cursor: pointer;
  }
  .stage > button.sync:hover {
    background: rgba(255, 255, 255, 0.4);
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.28);
  }
  .stage > button.sync:active,
  .stage > button.sync.pressed {
    background: #ffffff; color: #0c1c14;
  }
  .follow-note {
    margin: 10px auto 0; max-width: 36em; font-size: 0.84rem; line-height: 1.4; opacity: 0.92;
  }
  .follow-note[hidden] { display: none; }
  .progress { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .progress[hidden] { display: none; }
  .progress .time { min-width: 2.4em; font-size: 0.75rem; font-variant-numeric: tabular-nums; opacity: 0.9; }
  .progress .track { flex: 1; height: 4px; border-radius: 999px; background: rgba(255, 255, 255, 0.22); overflow: hidden; }
  .progress .fill { height: 100%; width: 0%; border-radius: 999px; background: #7dcea0; }
  .transport { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 14px; }
  .transport button {
    flex: 0 0 40px; width: 40px; height: 40px; padding: 0; border: none; border-radius: 50%;
    background: rgba(255, 255, 255, 0.16); color: #f6fff8; cursor: pointer;
    transition: background 80ms ease, color 80ms ease, box-shadow 80ms ease, transform 80ms ease;
  }
  .transport button.pause { flex-basis: 48px; width: 48px; height: 48px; background: #f6fff8; color: #0c1c14; }
  .transport button:hover {
    background: rgba(255, 255, 255, 0.4);
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.28);
    transform: scale(1.08);
  }
  .transport button.pause:hover {
    background: #ffffff;
    box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.38);
    transform: scale(1.08);
  }
  .transport button:active,
  .transport button.pressed {
    background: #ffffff; color: #0c1c14;
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.45);
    transform: scale(0.9);
  }
  .transport button.pause:active,
  .transport button.pause.pressed {
    background: #026634; color: #ffffff;
    box-shadow: 0 0 0 5px rgba(2, 102, 52, 0.45);
    transform: scale(0.9);
  }
  .transport button:focus-visible { outline: 2px solid #ffffff; outline-offset: 3px; }
  ha-icon { --mdc-icon-size: 22px; color: inherit; pointer-events: none; }
  .body { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color); }
  select, input[type="number"] {
    width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 10px;
    border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.4));
    background: var(--card-background-color, transparent); color: var(--primary-text-color); font: inherit;
  }
  .volume { display: flex; align-items: center; gap: 8px; }
  .volume input[type="range"] { flex: 1; accent-color: #026634; }
  .volume .value {
    min-width: 3em; text-align: end; font-variant-numeric: tabular-nums;
    font-size: 0.9rem; color: var(--primary-text-color);
  }
  .switch { flex-direction: row; align-items: center; justify-content: space-between; font-size: 14px; color: var(--primary-text-color); }
  .actions { display: flex; gap: 8px; }
  button.action {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 12px; border: none; border-radius: 999px; font: inherit; cursor: pointer;
    transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }
  button.play { background: #026634; color: #fff; }
  button.play:hover { background: #038a46; box-shadow: 0 0 0 3px rgba(2, 102, 52, 0.28); }
  button.play:active,
  button.play.pressed { background: #ffffff; color: #026634; box-shadow: inset 0 0 0 2px #026634; transform: scale(0.97); }
  button.stop { background: var(--secondary-background-color, rgba(127, 127, 127, 0.2)); color: var(--primary-text-color); }
  button.stop:hover { box-shadow: inset 0 0 0 2px var(--primary-text-color); }
  button.stop:active,
  button.stop.pressed {
    background: var(--primary-text-color, #1c1c1c); color: var(--card-background-color, #fff);
    transform: scale(0.97);
  }
  button.action:focus-visible { outline: 2px solid #026634; outline-offset: 3px; }
  button.icon {
    flex: 0 0 36px; width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%;
    background: var(--secondary-background-color, rgba(127, 127, 127, 0.18));
    color: var(--primary-text-color); cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 120ms ease;
  }
  button.icon:hover { background: var(--divider-color, rgba(127, 127, 127, 0.4)); transform: scale(1.06); }
  button.icon:active,
  button.icon.pressed {
    background: var(--primary-text-color); color: var(--card-background-color, #fff); transform: scale(0.9);
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

function showPress(button) {
  button.addEventListener("pointerdown", () => {
    button.classList.add("pressed");
    window.setTimeout(() => button.classList.remove("pressed"), 320);
  });
}

function webappSelected(card, session) {
  return Boolean((session && session.webapp) || (card._webapp && card._webapp.checked));
}

function iconButton(className, iconName) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  const icon = document.createElement("ha-icon");
  icon.icon = iconName;
  icon.setAttribute("icon", iconName);
  button.append(icon);
  showPress(button);
  return button;
}

function setIcon(button, iconName) {
  const icon = button && button.querySelector("ha-icon");
  if (!icon) return;
  icon.icon = iconName;
  icon.setAttribute("icon", iconName);
}

class AlquranCloudCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._built = false;
    this._progressTimer = null;
    this.attachShadow({ mode: "open" });
  }

  static getStubConfig() {
    return {
      speed: 1,
      start_ayah: 1,
      repeat: 1,
      continue_surah: false,
      loop: false,
      webapp: false,
      background_video: false,
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

  disconnectedCallback() {
    this._stopProgressClock();
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
    this._followNote = document.createElement("div");
    this._followNote.className = "follow-note";
    this._followNote.hidden = true;
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
    this._previousButton = iconButton("jump", "mdi:skip-previous");
    this._previousAyahButton = iconButton("jump", "mdi:menu-left");
    this._pauseButton = iconButton("pause", "mdi:pause");
    this._nextAyahButton = iconButton("jump", "mdi:menu-right");
    this._nextButton = iconButton("jump", "mdi:skip-next");
    this._playTransport = iconButton("pause", "mdi:play");
    this._playTransport.hidden = true;
    this._previousAyahButton.hidden = true;
    this._nextAyahButton.hidden = true;
    this._playTransport.addEventListener("click", () => this._transportAction("play"));
    this._previousButton.addEventListener("click", () => this._step("previous"));
    this._previousAyahButton.addEventListener("click", () => this._transportAction("previous_ayah"));
    this._pauseButton.addEventListener("click", () => this._transportAction("pause"));
    this._nextAyahButton.addEventListener("click", () => this._transportAction("next_ayah"));
    this._nextButton.addEventListener("click", () => this._step("next"));
    this._syncButton = iconButton("sync", "mdi:sync");
    this._syncButton.hidden = true;
    this._syncButton.addEventListener("click", () => this._sync());
    this._transport.append(
      this._previousButton,
      this._previousAyahButton,
      this._playTransport,
      this._pauseButton,
      this._nextAyahButton,
      this._nextButton
    );
    this._art = brandImage("art");
    stage.append(
      this._art,
      this._surahLine,
      this._reciterLine,
      this._mushafLine,
      this._statePill,
      this._followNote,
      progress,
      this._transport,
      this._syncButton
    );

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
    this._webapp = this._check("webapp");
    this._webapp.addEventListener("change", () => this._onWebappChange());
    this._background = this._check("background");
    this._help = document.createElement("div");
    this._help.className = "help";
    const volume = document.createElement("div");
    volume.className = "volume";
    volume.hidden = true;
    this._volumeDown = iconButton("icon", "mdi:volume-minus");
    this._volumeSlider = document.createElement("input");
    this._volumeSlider.type = "range";
    this._volumeSlider.min = "0";
    this._volumeSlider.max = "100";
    this._volumeSlider.value = "50";
    this._volumeValue = document.createElement("span");
    this._volumeValue.className = "value";
    this._volumeUp = iconButton("icon", "mdi:volume-plus");
    this._volumeDown.addEventListener("click", () => this._volumeStep(-0.05));
    this._volumeUp.addEventListener("click", () => this._volumeStep(0.05));
    this._volumeSlider.addEventListener("input", () => {
      const value = Math.round(Number(this._volumeSlider.value));
      this._volumeValue.textContent = `${value}%`;
    });
    this._volumeSlider.addEventListener("change", () => {
      const level = Number(this._volumeSlider.value) / 100;
      this._volumeTarget = level;
      this._showVolumePercent(level * 100);
      this._hass.callService("media_player", "volume_set", {
        entity_id: this._player.value,
        volume_level: level,
      });
    });
    this._showVolumePercent(50);
    volume.append(this._volumeDown, this._volumeSlider, this._volumeValue, this._volumeUp);
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
    showPress(play);
    showPress(stop);
    actions.append(play, stop);
    body.append(
      this._status,
      this._player.parentElement,
      volume,
      this._reciter.parentElement,
      this._surah.parentElement,
      this._start.parentElement,
      this._end.parentElement,
      this._repeat.parentElement,
      this._speed.parentElement,
      this._continue.parentElement,
      this._loop.parentElement,
      this._webapp.parentElement,
      this._background.parentElement,
      this._help,
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
    this._webapp.checked = Boolean(config.webapp);
    this._background.checked = config.background_video === true;
    if (config.entity) this._preferredPlayer = config.entity;
    if (config.reciter_id) this._preferredReciter = String(config.reciter_id);
    if (config.surah) this._preferredSurah = String(config.surah);
    if (config.start_ayah) this._preferredStart = String(config.start_ayah);
    if (config.end_ayah) this._preferredEnd = String(config.end_ayah);
  }

  _onWebappChange() {
    const before = this._player.value;
    this._loadPlayers();
    if (this._webapp.checked && before && !this._player.value) {
      this._status.textContent = strings(this._hass).tvRequired;
    }
    this._syncRange();
    this._update();
  }

  _loadPlayers() {
    const video = Boolean(this._webapp && this._webapp.checked);
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
    const video = Boolean(this._webapp && this._webapp.checked);
    this._background.parentElement.hidden = !video;
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
    this._background.parentElement.hidden = !this._webapp.checked;
    this._webapp.parentElement.querySelector("span").textContent = text.webapp;
    this._background.parentElement.querySelector("span").textContent = text.background;
    this._help.textContent = this._webapp.checked
      ? this._player.value
        ? text.webappHelp
        : text.tvRequired
      : "";
    const state = this._playerState();
    const session = sessionFor(this._hass, this._player.value);
    const webapp = Boolean((session && session.webapp) || this._webapp.checked);
    this._followNote.hidden = !webapp;
    this._followNote.textContent = webapp ? text.webappFollow : "";
    this._art.hidden = webapp;
    this._surahLine.hidden = false;
    this._reciterLine.hidden = false;
    this._mushafLine.hidden = webapp;
    this._statePill.hidden = false;
    if (session && webapp && Number(session.report_seq) > (this._syncSeq || 0)) {
      this._syncSeq = Number(session.report_seq);
      if (this._syncTimer) {
        window.clearTimeout(this._syncTimer);
        this._syncTimer = null;
      }
      if (this._status.textContent === text.pageSilent) this._status.textContent = "";
    }
    this._paintSessionPill(text, session, webapp);
    if (session) {
      const lang = integrationLanguage(this._hass);
      this._reciterLine.textContent = inLanguage(session.artist || "", lang);
      this._mushafLine.textContent = inLanguage(session.album || (session.webapp ? text.mushaf : ""), lang);
      this._statePill.textContent = session.webapp
        ? session.live
          ? session.playing
            ? text.playing
            : text.paused
          : text.onTv
        : state && state.state === "paused"
          ? text.paused
          : text.playing;
    } else {
      const surah = this._surah && this._surah.selectedOptions[0];
      const reciter = this._reciter && this._reciter.selectedOptions[0];
      this._surahLine.textContent = (surah && surah.textContent) || text.idle;
      this._reciterLine.textContent = (reciter && reciter.textContent) || "";
      this._mushafLine.textContent = this._webapp.checked ? text.mushaf : "";
      this._statePill.textContent = text.idle;
    }
    this._renderTransport(text, state, webapp);
    this._paintPlayback();
    this._renderVolume(state);
  }

  _paintPlayback() {
    const state = this._playerState();
    const session = sessionFor(this._hass, this._player && this._player.value);
    if (session && !session.webapp) {
      const lang = integrationLanguage(this._hass);
      this._surahLine.textContent = playbackLine(session, strings(this._hass), lang);
    } else if (session) {
      this._surahLine.textContent = session.title || session.verse_key;
    }
    this._renderProgress(state, session);
    if (state && state.state === "playing" && session && !session.webapp) this._startProgressClock();
    else this._stopProgressClock();
  }

  _startProgressClock() {
    if (this._progressTimer) return;
    this._progressTimer = window.setInterval(() => this._paintPlayback(), 1000);
  }

  _stopProgressClock() {
    if (!this._progressTimer) return;
    window.clearInterval(this._progressTimer);
    this._progressTimer = null;
  }

  _paintSessionPill(text, session, webapp) {
    if (!this._statePill) return;
    this._statePill.className = "state-pill";
    if (!webapp || !session || !session.webapp) return;
    const silent = (this._status && this._status.textContent === text.pageSilent) || !session.live;
    this._statePill.className = silent ? "state-pill silent" : "state-pill live";
  }

  _renderTransport(text, state, webapp) {
    const features = (state && state.attributes && state.attributes.supported_features) || 0;
    const paused = state && state.state === "paused";
    const canPause = features & PAUSE || features & PLAY;
    const rtl = text.dir === "rtl";
    this._previousButton.hidden = false;
    this._nextButton.hidden = false;
    this._previousButton.title = text.previous;
    this._nextButton.title = text.next;
    setIcon(this._previousButton, rtl ? "mdi:skip-next" : "mdi:skip-previous");
    setIcon(this._nextButton, rtl ? "mdi:skip-previous" : "mdi:skip-next");
    if (this._previousAyahButton) {
      this._previousAyahButton.hidden = !webapp;
      this._previousAyahButton.title = text.previousAyah;
      setIcon(this._previousAyahButton, rtl ? "mdi:menu-right" : "mdi:menu-left");
    }
    if (this._nextAyahButton) {
      this._nextAyahButton.hidden = !webapp;
      this._nextAyahButton.title = text.nextAyah;
      setIcon(this._nextAyahButton, rtl ? "mdi:menu-left" : "mdi:menu-right");
    }
    this._playTransport.hidden = !webapp;
    this._playTransport.title = text.play;
    if (this._syncButton) {
      this._syncButton.hidden = !webapp;
      this._syncButton.title = text.sync;
      const stage = this._syncButton.parentElement;
      if (stage && stage.classList) stage.classList.toggle("webapp", Boolean(webapp));
    }
    this._pauseButton.hidden = webapp ? false : !canPause;
    this._pauseButton.title = webapp ? text.pause : (paused ? text.resume : text.pause);
    setIcon(this._pauseButton, webapp || !paused ? "mdi:pause" : "mdi:play");
    this._transport.hidden = false;
  }

  _renderProgress(state, session) {
    if (session && session.webapp) {
      this._progress.hidden = true;
      return;
    }
    const clock = playbackClock(state);
    if (!clock || clock.duration == null) {
      this._progress.hidden = true;
      return;
    }
    this._progress.hidden = false;
    this._elapsed.textContent = formatTime(clock.position);
    this._remaining.textContent = formatTime(Math.max(0, clock.duration - clock.position));
    this._fill.style.width = `${Math.min(100, (clock.position / clock.duration) * 100)}%`;
  }

  _renderVolume(state) {
    const attrs = (state && state.attributes) || {};
    const features = attrs.supported_features || 0;
    const reported = typeof attrs.volume_level === "number";
    if (!(features & VOLUME_SET) && !(features & VOLUME_STEP) && !reported) {
      this._volume.hidden = true;
      return;
    }
    this._volume.hidden = false;
    if (!reported || this.shadowRoot.activeElement === this._volumeSlider) return;
    if (this._volumeTarget != null) {
      if (Math.abs(attrs.volume_level - this._volumeTarget) > 0.02) return;
      this._volumeTarget = null;
    }
    this._showVolumePercent(Math.min(1, Math.max(0, attrs.volume_level)) * 100);
  }

  _showVolumePercent(percent) {
    const value = Math.round(Math.min(100, Math.max(0, percent)));
    this._volumeSlider.value = String(value);
    if (this._volumeValue) this._volumeValue.textContent = `${value}%`;
  }

  _volumeStep(delta) {
    const entity = this._player.value;
    if (!entity) return;
    const state = this._playerState();
    const attrs = (state && state.attributes) || {};
    const features = attrs.supported_features || 0;
    const canSet = features & VOLUME_SET || typeof attrs.volume_level === "number";
    if (canSet) {
      const current = typeof attrs.volume_level === "number"
        ? attrs.volume_level
        : Number(this._volumeSlider.value) / 100;
      const next = Math.min(1, Math.max(0, current + delta));
      this._volumeTarget = next;
      this._showVolumePercent(next * 100);
      this._hass.callService("media_player", "volume_set", {
        entity_id: entity,
        volume_level: next,
      });
      return;
    }
    this._hass.callService("media_player", delta > 0 ? "volume_up" : "volume_down", { entity_id: entity });
  }

  async _sync() {
    const text = strings(this._hass);
    const session = sessionFor(this._hass, this._player && this._player.value);
    this._syncSeq = session && Number(session.report_seq) || 0;
    if (this._syncTimer) window.clearTimeout(this._syncTimer);
    this._syncTimer = window.setTimeout(() => {
      this._syncTimer = null;
      const current = sessionFor(this._hass, this._player && this._player.value);
      const seq = current && Number(current.report_seq) || 0;
      if (seq <= this._syncSeq) {
        this._status.textContent = text.pageSilent;
        this._paintSessionPill(text, current, webappSelected(this, current));
      }
    }, 5000);
    await this._transportAction("report");
  }

  _step(direction) {
    const session = sessionFor(this._hass, this._player && this._player.value);
    const webapp = webappSelected(this, session);
    this._transportAction(webapp ? `${direction}_surah` : direction);
  }

  async _transportAction(action) {
    const text = strings(this._hass);
    const entity = this._player.value;
    if (!entity) return;
    const session = sessionFor(this._hass, entity);
    const webapp = webappSelected(this, session);
    const pageStep = action === "play" || action === "pause" || action === "report"
      || action === "next_ayah" || action === "previous_ayah"
      || action === "next_surah" || action === "previous_surah";
    try {
      if (webapp && pageStep) {
        await this._hass.callService(
          "alquran_cloud",
          "transport",
          { entity_id: entity, command: action },
          { entity_id: entity }
        );
        return;
      }
      if (action === "play" || action === "pause") {
        let service = action === "play" ? "media_play" : "media_pause";
        if (!webapp && action === "pause") {
          const state = this._playerState();
          service = state && state.state === "paused" ? "media_play" : "media_pause";
        }
        await this._hass.callService("media_player", service, { entity_id: entity });
        return;
      }
      if (session) {
        this._status.textContent = action === "next" ? text.openingNext : text.openingPrevious;
        await this._hass.callService(
          "alquran_cloud",
          action === "next" ? "next_surah" : "previous_surah",
          {},
          { entity_id: entity }
        );
        if (this._status.textContent === text.openingNext || this._status.textContent === text.openingPrevious) {
          this._status.textContent = "";
        }
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
      loop: this._loop.checked,
      webapp: this._webapp.checked,
      background_video: this._background.checked,
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
      this._webapp = this._switch("webapp");
      this._background = this._switch("background");
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
        this._webapp.label,
        this._background.label,
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
    this._webapp.text.textContent = text.webapp;
    this._background.text.textContent = text.background;
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
    const video = Boolean(config.webapp);
    this._loop.control.checked = Boolean(config.loop);
    this._webapp.control.checked = video;
    this._background.label.classList.toggle("hidden", !video);
    this._background.control.checked = config.background_video === true;
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
    this._webapp.control.addEventListener("change", () => {
      const show = this._webapp.control.checked;
      const players = mediaPlayers(this._hass, show);
      const patch = { webapp: show };
      if (show && this._config.entity && !players.some((item) => item.id === this._config.entity)) {
        patch.entity = undefined;
      }
      this._commit(patch);
    });
    this._background.control.addEventListener("change", () => {
      this._commit({ background_video: this._background.control.checked });
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
