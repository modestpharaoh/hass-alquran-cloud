var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
const CACHE_KEY_RECITERS = "quran_audio_reciters_cache_v4";
const SETTINGS_KEY = "quran_kiosk_settings_v1";
const MEDIA_CACHE = "quran-kiosk-media-v1";
const KIOSK_DB = "quran-kiosk";
const KIOSK_STORE = "meta";
const BISMILLAH_IMAGE_URL = "assets/bismillah.png";
const AVAILABLE_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let cacheExpiryDays = 7;
let language = "en";
let favoriteReciters = [];
let playbackNote = "";
function readCacheSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    cacheExpiryDays = clampCacheDays(parsed.cacheExpiryDays, cacheExpiryDays);
    language = parsed.language === "ar" ? "ar" : "en";
    favoriteReciters = Array.isArray(parsed.favorites) ? parsed.favorites.filter((id) => safeEditionId(id, "")).slice(0, 100) : [];
  } catch (err) {
    console.warn("Settings read error:", err);
  }
}
function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    cacheExpiryDays,
    language,
    favorites: favoriteReciters
  }));
}
function openKioskDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KIOSK_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KIOSK_STORE)) db.createObjectStore(KIOSK_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function withKioskDb(fn) {
  return openKioskDb().then((db) => __async(null, null, function* () {
    try {
      return yield fn(db);
    } finally {
      db.close();
    }
  }));
}
function idbPut(key, value) {
  return withKioskDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(KIOSK_STORE, "readwrite");
    tx.objectStore(KIOSK_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function syncCacheSettings() {
  return __async(this, null, function* () {
    cacheExpiryDays = clampCacheDays(cacheExpiryDays);
    persistSettings();
    try {
      yield idbPut("settings", { cacheExpiryDays });
    } catch (err) {
      console.warn("Unable to share cache settings with the media worker", err);
    }
  });
}
function clearStoredMedia() {
  return __async(this, null, function* () {
    Object.keys(bismillahAudioCache).forEach((key) => delete bismillahAudioCache[key]);
    localStorage.removeItem(CACHE_KEY_RECITERS);
    if ("caches" in window) {
      const names = yield caches.keys();
      yield Promise.all(names.filter((name) => name.startsWith("quran-kiosk-media")).map((name) => caches.delete(name)));
    }
    try {
      yield withKioskDb((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(KIOSK_STORE, "readwrite");
        const store = tx.objectStore(KIOSK_STORE);
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (String(cursor.key).startsWith("media:")) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
    } catch (err) {
      console.warn("Unable to clear media index", err);
    }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_MEDIA" });
    }
  });
}
function cacheStatusText() {
  return __async(this, null, function* () {
    let count = 0;
    try {
      if ("caches" in window) {
        const cache = yield caches.open(MEDIA_CACHE);
        count = (yield cache.keys()).length;
      }
    } catch (err) {
      console.warn("Cache status error:", err);
    }
    let mode = t("cacheOn");
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
      mode = t("cacheNeedsServer");
    } else if (!navigator.serviceWorker.controller) {
      mode = t("cacheWaiting");
    }
    return t("cacheStatus", { count, mode, days: cacheExpiryDays });
  });
}
function oldTvBrowser() {
  const ua = navigator.userAgent || "";
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const chromeMajor = chrome ? parseInt(chrome[1], 10) : 0;
  if (/Web0S|webOS/i.test(ua)) return chromeMajor > 0 && chromeMajor < 80;
  if (!/Smart-?TV|Tizen/i.test(ua)) return false;
  const tizen = /Tizen\s+(\d+)(?:\.(\d+))?/i.exec(ua);
  if (tizen) {
    const major = parseInt(tizen[1], 10);
    const minor = parseInt(tizen[2] || "0", 10);
    return major < 6 || major === 6 && minor < 5;
  }
  return chromeMajor === 0 || chromeMajor < 80;
}
function registerMediaWorker() {
  return __async(this, null, function* () {
    if (!("serviceWorker" in navigator) || location.protocol === "file:" || oldTvBrowser()) return false;
    const workerUrl = resolveAssetUrl(location.href, "sw.js?v=3");
    try {
      const regs = yield navigator.serviceWorker.getRegistrations();
      const stale = regs.filter((reg) => {
        const script = (reg.active || reg.waiting || reg.installing || {}).scriptURL || "";
        return script.split("#")[0] !== workerUrl;
      });
      if (stale.length) {
        yield Promise.all(stale.map((reg) => reg.unregister()));
        const controller = navigator.serviceWorker.controller;
        if (controller && controller.scriptURL.split("#")[0] !== workerUrl && sessionStorage.getItem("kiosk-sw-reset") !== workerUrl) {
          sessionStorage.setItem("kiosk-sw-reset", workerUrl);
          location.reload();
          return false;
        }
      }
      const registered = yield Promise.race([
        navigator.serviceWorker.register(workerUrl, { updateViaCache: "none" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker timeout")), 2e3))
      ]);
      yield Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(resolve, 1e3))
      ]);
      return Boolean(navigator.serviceWorker.controller || registered);
    } catch (err) {
      console.warn("Media cache worker failed:", err);
      return false;
    }
  });
}
readCacheSettings();
const DEFAULT_RECITERS = [
  { id: "ar.alafasy", name: "\u0645\u0634\u0627\u0631\u064A \u0631\u0627\u0634\u062F \u0627\u0644\u0639\u0641\u0627\u0633\u064A", english: "Mishary Alafasy", type: "versebyverse", language: "ar" },
  { id: "ar.abdulbasitmurattal", name: "\u0639\u0628\u062F \u0627\u0644\u0628\u0627\u0633\u0637 \u0639\u0628\u062F \u0627\u0644\u0635\u0645\u062F (\u0645\u0631\u062A\u0644)", english: "AbdulBaset (Murattal)", type: "translation", language: "ar" },
  { id: "ar.minshawi", name: "\u0645\u062D\u0645\u062F \u0635\u062F\u064A\u0642 \u0627\u0644\u0645\u0646\u0634\u0627\u0648\u064A", english: "Al-Minshawi", type: "translation", language: "ar" },
  { id: "ar.husary", name: "\u0645\u062D\u0645\u0648\u062F \u062E\u0644\u064A\u0644 \u0627\u0644\u062D\u0635\u0631\u064A", english: "Al-Husary", type: "versebyverse", language: "ar" },
  { id: "ar.mahermuaiqly", name: "\u0645\u0627\u0647\u0631 \u0627\u0644\u0645\u0639\u064A\u0642\u0644\u064A", english: "Maher Al-Muaiqly", type: "versebyverse", language: "ar" },
  { id: "ar.abdullahbasfar", name: "\u0639\u0628\u062F \u0627\u0644\u0644\u0647 \u0628\u0635\u0641\u0631", english: "Abdullah Basfar", type: "versebyverse", language: "ar" },
  { id: "ar.saoodshuraym", name: "\u0633\u0639\u0648\u062F \u0627\u0644\u0634\u0631\u064A\u0645", english: "Saood Ash-Shuraym", type: "versebyverse", language: "ar" }
];
const params = new URLSearchParams(window.location.search);
function queryInt(name, fallback, min, max) {
  return boundedQueryInt(params, name, fallback, min, max);
}
let currentSurah = queryInt("surah", 1, 1, 114);
let startAyah = queryInt("ayah", 1, 1, 286);
let endAyah = params.has("to_ayah") ? queryInt("to_ayah", null, 1, 286) : null;
const endSurah = params.has("to_surah") ? queryInt("to_surah", null, 1, 114) : null;
let reciter = safeEditionId(params.get("reciter"), "ar.alafasy");
let autoNextSurah = params.get("auto_surah") === "true";
let loopEnabled = params.get("loop") === "true";
const requestedSpeed = parseFloat(params.get("speed") || "1");
const legacyTv = oldTvBrowser();
let currentSpeed = !legacyTv && AVAILABLE_SPEEDS.includes(requestedSpeed) ? requestedSpeed : 1;
let maxRepeatCount = queryInt("repeat", 1, 1, 20);
let currentRepeatCycle = 1;
let bgVideoEnabled = params.get("background_video") === "true";
const originSurah = currentSurah;
const originStartAyah = startAyah;
const originEndAyah = endAyah;
function languageFromQuery() {
  return languageFromSearch(params);
}
function writeLanguageQuery(next) {
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  if (next) url.searchParams.set("language", next);
  else url.searchParams.delete("language");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
const requestedLanguage = languageFromQuery();
if (requestedLanguage) {
  language = requestedLanguage;
  persistSettings();
}
let surahData = null;
let allSurahs = [];
let recitersList = [];
let currentAyahIndex = 0;
let isBismillah = false;
let surahAudioMode = false;
const bismillahAudioCache = {};
const audio = document.getElementById("audio");
const ayahImg = document.getElementById("ayah-img");
const infoBar = document.getElementById("info-bar");
const bgVideo = document.getElementById("bg");
audio.preload = "auto";
const btnPlayPause = document.getElementById("btn-play-pause");
const btnToggleBg = document.getElementById("btn-toggle-bg");
const btnAutoSurah = document.getElementById("btn-auto-surah");
const btnLoop = document.getElementById("btn-loop");
const btnSpeedToggle = document.getElementById("btn-speed-toggle");
const speedLabel = document.getElementById("speed-label");
const rangeLabel = document.getElementById("range-label");
const repeatLabel = document.getElementById("repeat-label");
const reciterLabel = document.getElementById("reciter-label");
const STRINGS = {
  en: {
    title: "Quran Kiosk Player",
    surahsBtn: "Surahs",
    ayahsLabel: "Ayahs",
    settingsBtn: "Settings",
    prevSurah: "Previous surah",
    prevAyah: "Previous ayah",
    nextAyah: "Next ayah",
    nextSurah: "Next surah",
    play: "Play",
    pause: "Pause",
    surahsTitle: "Surahs",
    surahSearch: "Search by number or name...",
    recitersTitle: "Reciters",
    reciterSearch: "Search by name or alquran.cloud id...",
    reciterHint: "Click the id or Copy to copy it. A star pins a favorite to the top. Full surah is one file; ayah by ayah is a clip per verse.",
    rangeTitle: "Ayah range for this surah",
    rangeFrom: "From ayah:",
    rangeTo: "To ayah (leave empty for the end of the surah):",
    rangeToPlaceholder: "End of surah",
    rangeReset: "Clear range (full surah)",
    apply: "Apply",
    settingsTitle: "Settings",
    cacheDaysLabel: "Cache period (days)",
    cacheHint: "The same period is used for the reciter list, audio, ayah images, and the background video. 0 turns caching off. Older files are removed when the period ends or browser storage fills up.",
    cacheCounting: "Counting...",
    clearCache: "Clear cache",
    save: "Save",
    resetSettings: "Reset settings",
    resetHint: "Restores English, removes every favorite reciter, and sets the cache period back to 7 days. Downloaded audio is kept.",
    settingsReset: "Settings restored.",
    repeatTitle: "Repeat the surah or selected range",
    repeatCountLabel: "Repeat count (1 to 20):",
    repeatHint: "If an ayah range is set, that range repeats this many times before moving on or stopping.",
    loading: "Loading...",
    loadingSurah: "Loading surah {surah}...",
    loadFailed: "Could not load surah ({surah})",
    audioFailed: "Could not play this reciter",
    reciter: "Reciter",
    all: "All",
    end: "end",
    repeat: "Repeat: {current}/{max}",
    ayahs: "ayahs",
    ayahByAyah: "Ayah by ayah",
    fullSurah: "Full surah",
    copy: "Copy",
    copied: "Copied",
    copyId: "Copy {id}",
    favorite: "Favorite",
    bismillah: "Bismillah",
    meccan: "Meccan",
    medinan: "Medinan",
    ayahLine: "{head} \u2014 ayah {ayah}",
    fullSurahLine: "{head} \u2014 ayah {ayah} \xB7 full surah",
    surahsDone: "requested surahs finished",
    done: "recitation complete",
    bgOn: "Background: on",
    bgOff: "Background: off",
    autoOn: "Auto next: on",
    autoOff: "Auto next: off",
    loopOn: "Loop: on",
    loopOff: "Loop: off",
    cacheOn: "on",
    cacheNeedsServer: "needs a local server",
    cacheWaiting: "waiting to start",
    cacheStatus: "Saved files: {count}. Cache: {mode}. Period: {days} days.",
    cacheSaved: "Saved.",
    cacheCleared: "Cleared."
  },
  ar: {
    title: "\u0642\u0627\u0631\u0626 \u0627\u0644\u0642\u0631\u0622\u0646",
    surahsBtn: "\u0627\u0644\u0633\u0648\u0631",
    ayahsLabel: "\u0627\u0644\u0622\u064A\u0627\u062A",
    settingsBtn: "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",
    prevSurah: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629",
    prevAyah: "\u0627\u0644\u0622\u064A\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629",
    nextAyah: "\u0627\u0644\u0622\u064A\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629",
    nextSurah: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629",
    play: "\u062A\u0634\u063A\u064A\u0644",
    pause: "\u0625\u064A\u0642\u0627\u0641",
    surahsTitle: "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0633\u0648\u0631",
    surahSearch: "\u0627\u0628\u062D\u062B \u0628\u0631\u0642\u0645 \u0623\u0648 \u0627\u0633\u0645 \u0627\u0644\u0633\u0648\u0631\u0629...",
    recitersTitle: "\u0627\u062E\u062A\u0631 \u0627\u0644\u0642\u0627\u0631\u0626",
    reciterSearch: "\u0627\u0628\u062D\u062B \u0628\u0627\u0644\u0627\u0633\u0645 \u0623\u0648 \u0628\u0645\u0639\u0631\u0641 alquran.cloud...",
    reciterHint: "\u0627\u0636\u063A\u0637 \u0627\u0644\u0645\u0639\u0631\u0641 \u0623\u0648 \xAB\u0646\u0633\u062E\xBB \u0644\u0646\u0633\u062E\u0647. \u0627\u0644\u0646\u062C\u0645\u0629 \u062A\u062B\u0628\u062A \u0627\u0644\u0642\u0627\u0631\u0626 \u0627\u0644\u0645\u0641\u0636\u0644 \u0641\u064A \u0627\u0644\u0623\u0639\u0644\u0649. \xAB\u0633\u0648\u0631\u0629 \u0643\u0627\u0645\u0644\u0629\xBB \u0645\u0644\u0641 \u0648\u0627\u062D\u062F\u060C \u0648\xAB\u0622\u064A\u0629 \u0628\u0622\u064A\u0629\xBB \u0645\u0642\u0637\u0639 \u0644\u0643\u0644 \u0622\u064A\u0629.",
    rangeTitle: "\u062A\u062D\u062F\u064A\u062F \u0646\u0637\u0627\u0642 \u0627\u0644\u0622\u064A\u0627\u062A \u0644\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629",
    rangeFrom: "\u0645\u0646 \u0627\u0644\u0622\u064A\u0629:",
    rangeTo: "\u0625\u0644\u0649 \u0627\u0644\u0622\u064A\u0629 (\u0627\u062A\u0631\u0643\u0647 \u0641\u0627\u0631\u063A\u0627\u064B \u0644\u0622\u062E\u0631 \u0627\u0644\u0633\u0648\u0631\u0629):",
    rangeToPlaceholder: "\u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0633\u0648\u0631\u0629",
    rangeReset: "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0646\u0637\u0627\u0642 (\u0643\u0627\u0645\u0644 \u0627\u0644\u0633\u0648\u0631\u0629)",
    apply: "\u062A\u0637\u0628\u064A\u0642",
    settingsTitle: "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",
    cacheDaysLabel: "\u0645\u062F\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0624\u0642\u062A (\u0628\u0627\u0644\u0623\u064A\u0627\u0645)",
    cacheHint: "\u0646\u0641\u0633 \u0627\u0644\u0645\u062F\u0629 \u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0642\u0631\u0627\u0621 \u0648\u0627\u0644\u0635\u0648\u062A \u0648\u0635\u0648\u0631 \u0627\u0644\u0622\u064A\u0627\u062A \u0648\u0641\u064A\u062F\u064A\u0648 \u0627\u0644\u062E\u0644\u0641\u064A\u0629. 0 \u064A\u0648\u0642\u0641 \u0627\u0644\u062A\u062E\u0632\u064A\u0646. \u0639\u0646\u062F \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0645\u062F\u0629\u060C \u0623\u0648 \u0625\u0630\u0627 \u0627\u0645\u062A\u0644\u0623\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0645\u062A\u0635\u0641\u062D\u060C \u064A\u064F\u062D\u0630\u0641 \u0627\u0644\u0623\u0642\u062F\u0645.",
    cacheCounting: "\u062C\u0627\u0631\u064A \u0627\u0644\u062D\u0633\u0627\u0628...",
    clearCache: "\u0645\u0633\u062D \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0624\u0642\u062A",
    save: "\u062D\u0641\u0638",
    resetSettings: "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0636\u0628\u0637",
    resetHint: "\u064A\u0639\u064A\u062F \u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629\u060C \u0648\u064A\u0632\u064A\u0644 \u0643\u0644 \u0627\u0644\u0642\u0631\u0627\u0621 \u0627\u0644\u0645\u0641\u0636\u0644\u064A\u0646\u060C \u0648\u064A\u0639\u064A\u062F \u0645\u062F\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0625\u0644\u0649 7 \u0623\u064A\u0627\u0645. \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629 \u062A\u0628\u0642\u0649.",
    settingsReset: "\u062A\u0645\u062A \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A.",
    repeatTitle: "\u062A\u0643\u0631\u0627\u0631 \u0627\u0644\u0633\u0648\u0631\u0629 \u0623\u0648 \u0627\u0644\u0646\u0637\u0627\u0642 \u0627\u0644\u0645\u062D\u062F\u062F",
    repeatCountLabel: "\u0639\u062F\u062F \u0645\u0631\u0627\u062A \u0627\u0644\u062A\u0643\u0631\u0627\u0631 (1 \u0625\u0644\u0649 20):",
    repeatHint: "\u0625\u0630\u0627 \u0643\u0627\u0646 \u0647\u0646\u0627\u0643 \u0646\u0637\u0627\u0642 \u0622\u064A\u0627\u062A \u0645\u062D\u062F\u062F\u060C \u0633\u064A\u062A\u0643\u0631\u0631 \u0627\u0644\u0646\u0637\u0627\u0642 \u0643\u0627\u0645\u0644\u0627\u064B \u0647\u0630\u0627 \u0627\u0644\u0639\u062F\u062F \u0645\u0646 \u0627\u0644\u0645\u0631\u0627\u062A \u0642\u0628\u0644 \u0627\u0644\u0627\u0646\u062A\u0642\u0627\u0644 \u0623\u0648 \u0627\u0644\u062A\u0648\u0642\u0641.",
    loading: "\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644...",
    loadingSurah: "\u062C\u0627\u0631\u064A \u062A\u062D\u0645\u064A\u0644 \u0633\u0648\u0631\u0629 {surah}...",
    loadFailed: "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0633\u0648\u0631\u0629 ({surah})",
    audioFailed: "\u062A\u0639\u0630\u0631 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0635\u0648\u062A \u0644\u0647\u0630\u0627 \u0627\u0644\u0642\u0627\u0631\u0626",
    reciter: "\u0627\u0644\u0642\u0627\u0631\u0626",
    all: "\u0627\u0644\u0643\u0644",
    end: "\u0646\u0647\u0627\u064A\u0629",
    repeat: "\u062A\u0643\u0631\u0627\u0631: {current}/{max}",
    ayahs: "\u0622\u064A\u0627\u062A",
    ayahByAyah: "\u0622\u064A\u0629 \u0628\u0622\u064A\u0629",
    fullSurah: "\u0633\u0648\u0631\u0629 \u0643\u0627\u0645\u0644\u0629",
    copy: "\u0646\u0633\u062E",
    copied: "\u062A\u0645 \u0627\u0644\u0646\u0633\u062E",
    copyId: "\u0646\u0633\u062E {id}",
    favorite: "\u0645\u0641\u0636\u0644\u0629",
    bismillah: "\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0651\u064E\u0647\u0650 \u0627\u0644\u0631\u0651\u064E\u062D\u0652\u0645\u064E\u0670\u0646\u0650 \u0627\u0644\u0631\u0651\u064E\u062D\u0650\u064A\u0645\u0650",
    meccan: "\u0645\u0643\u064A\u0629",
    medinan: "\u0645\u062F\u0646\u064A\u0629",
    ayahLine: "{head} - \u0622\u064A\u0629 {ayah}",
    fullSurahLine: "{head} - \u0622\u064A\u0629 {ayah} \xB7 \u062A\u0644\u0627\u0648\u0629 \u0627\u0644\u0633\u0648\u0631\u0629 \u0643\u0627\u0645\u0644\u0629",
    surahsDone: "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u0633\u0648\u0631 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629",
    done: "\u0627\u0643\u062A\u0645\u0644 \u0627\u0644\u062A\u0644\u0627\u0648\u0629",
    bgOn: "\u062E\u0644\u0641\u064A\u0629: \u062A\u0634\u063A\u064A\u0644",
    bgOff: "\u062E\u0644\u0641\u064A\u0629: \u0625\u062E\u0641\u0627\u0621",
    autoOn: "\u0627\u0644\u062A\u0627\u0644\u064A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B: \u062A\u0641\u0639\u064A\u0644",
    autoOff: "\u0627\u0644\u062A\u0627\u0644\u064A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B: \u062A\u0639\u0637\u064A\u0644",
    loopOn: "\u0627\u0644\u0625\u0639\u0627\u062F\u0629: \u062A\u0641\u0639\u064A\u0644",
    loopOff: "\u0627\u0644\u0625\u0639\u0627\u062F\u0629: \u062A\u0639\u0637\u064A\u0644",
    cacheOn: "\u064A\u0639\u0645\u0644",
    cacheNeedsServer: "\u064A\u062D\u062A\u0627\u062C \u0641\u062A\u062D \u0627\u0644\u0635\u0641\u062D\u0629 \u0645\u0646 \u062E\u0627\u062F\u0645",
    cacheWaiting: "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062A\u0641\u0639\u064A\u0644",
    cacheStatus: "\u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629: {count}. \u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646: {mode}. \u0627\u0644\u0645\u062F\u0629: {days} \u064A\u0648\u0645.",
    cacheSaved: "\u062A\u0645 \u0627\u0644\u062D\u0641\u0638.",
    cacheCleared: "\u062A\u0645 \u0627\u0644\u0645\u0633\u062D."
  }
};
function t(key, vars) {
  const template = STRINGS[language] && STRINGS[language][key] || STRINGS.en[key] || key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    var _a;
    return (_a = vars[name]) != null ? _a : "";
  });
}
let continuingPlayback = false;
let currentClipUrl = "";
let needsGesture = false;
let clipToken = 0;
let loadToken = 0;
let imageToken = 0;
let imageTimer = 0;
function setIconShown(icon, shown) {
  if (!icon) return;
  if (shown) icon.removeAttribute("hidden");
  else icon.setAttribute("hidden", "");
}
function updatePlayButton() {
  const label = document.getElementById("play-label");
  if (label) label.textContent = continuingPlayback ? t("pause") : t("play");
  setIconShown(btnPlayPause.querySelector(".ico-play"), !continuingPlayback);
  setIconShown(btnPlayPause.querySelector(".ico-pause"), continuingPlayback);
  btnPlayPause.classList.toggle("active", continuingPlayback);
}
function applyPlaybackRate() {
  if (legacyTv) return;
  try {
    audio.playbackRate = currentSpeed;
  } catch (err) {
  }
}
function startClip(url) {
  if (!isAllowedMediaUrl(url)) {
    continuingPlayback = false;
    needsGesture = false;
    updatePlayButton();
    infoBar.textContent = t("audioFailed");
    return;
  }
  const token = ++clipToken;
  currentClipUrl = url;
  needsGesture = false;
  continuingPlayback = true;
  updatePlayButton();
  audio.volume = 1;
  audio.src = url;
  applyPlaybackRate();
  const pending = audio.play();
  if (pending && typeof pending.catch === "function") {
    pending.catch(() => {
      if (token !== clipToken) return;
      needsGesture = true;
      continuingPlayback = false;
      updatePlayButton();
    });
  }
}
function retryBlockedPlayback(event) {
  if (!needsGesture || !currentClipUrl) return;
  const tag = event && event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const token = clipToken;
  needsGesture = false;
  continuingPlayback = true;
  updatePlayButton();
  audio.volume = 1;
  if (audio.src !== currentClipUrl) audio.src = currentClipUrl;
  try {
    audio.load();
  } catch (err) {
  }
  applyPlaybackRate();
  const pending = audio.play();
  if (pending && typeof pending.catch === "function") {
    pending.catch(() => {
      if (token !== clipToken) return;
      needsGesture = true;
      continuingPlayback = false;
      updatePlayButton();
    });
  }
}
function stopPlaybackButton() {
  continuingPlayback = false;
  updatePlayButton();
}
function updateBgButton() {
  const label = document.getElementById("bg-label");
  if (label) label.textContent = bgVideoEnabled ? t("bgOn") : t("bgOff");
}
let bgHold = false;
let bgRestartAt = 0;
const BG_VIDEO = "assets/landscape-tree-clouds.mp4";
function bgStills() {
  return document.getElementById("bg-stills");
}
function playBackgroundVideo() {
  if (legacyTv || !bgVideo || !bgVideoEnabled) return;
  bgHold = false;
  const stills = bgStills();
  if (stills) stills.classList.add("hidden");
  if (!bgVideo.getAttribute("src")) bgVideo.src = BG_VIDEO;
  bgVideo.classList.remove("hidden");
  const pending = bgVideo.play();
  if (pending && typeof pending.catch === "function") pending.catch(() => {
  });
}
function restartBackgroundVideo() {
  if (legacyTv || !bgVideo || !bgVideoEnabled) return;
  if (audio && !audio.paused) return;
  const now = Date.now();
  if (now - bgRestartAt < 400) return;
  bgRestartAt = now;
  try {
    bgVideo.currentTime = 0;
  } catch (err) {
  }
  playBackgroundVideo();
}
function applyBackground() {
  if (btnToggleBg) btnToggleBg.classList.toggle("active", bgVideoEnabled);
  const stills = bgStills();
  if (legacyTv) {
    if (bgVideo) {
      bgHold = true;
      bgVideo.classList.add("hidden");
      try {
        bgVideo.pause();
      } catch (err) {
      }
    }
    if (stills) stills.classList.toggle("hidden", !bgVideoEnabled);
    updateBgButton();
    return;
  }
  if (!bgVideo) return;
  if (!bgVideoEnabled) {
    bgHold = true;
    bgVideo.classList.add("hidden");
    try {
      bgVideo.pause();
    } catch (err) {
    }
    if (stills) stills.classList.add("hidden");
    updateBgButton();
    return;
  }
  playBackgroundVideo();
  updateBgButton();
}
if (bgVideo && !legacyTv) {
  bgVideo.addEventListener("ended", () => {
    if (!bgVideoEnabled) return;
    restartBackgroundVideo();
  });
  bgVideo.addEventListener("pause", () => {
    if (bgHold || !bgVideoEnabled) return;
    if (audio && !audio.paused) return;
    restartBackgroundVideo();
  });
}
function updateAutoButton() {
  if (!btnAutoSurah) return;
  btnAutoSurah.textContent = autoNextSurah ? t("autoOn") : t("autoOff");
  btnAutoSurah.classList.toggle("active", autoNextSurah);
}
function updateLoopButton() {
  if (!btnLoop) return;
  btnLoop.textContent = loopEnabled ? t("loopOn") : t("loopOff");
  btnLoop.classList.toggle("active", loopEnabled);
}
function updateLanguageButton() {
  const button = document.getElementById("btn-language");
  button.textContent = language === "en" ? "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" : "English";
}
function surahDisplayName() {
  if (!surahData) return "";
  return language === "ar" ? surahData.name : surahData.englishName;
}
function surahNumberLabel() {
  const number = Number(surahData && surahData.number);
  if (!number) return "";
  const text = String(number);
  return text.length >= 3 ? text : ("000" + text).slice(-3);
}
function surahPlace() {
  const kind = String(surahData && surahData.revelationType || "").toLowerCase();
  if (kind === "meccan") return t("meccan");
  if (kind === "medinan") return t("medinan");
  return "";
}
function surahHeading() {
  const parts = [];
  const number = surahNumberLabel();
  const name = surahDisplayName();
  const place = surahPlace();
  if (number) parts.push(number);
  if (name) parts.push(name);
  if (place) parts.push(place);
  return parts.join(" \xB7 ");
}
function surahCountPhrase() {
  const count = Number(surahData && surahData.numberOfAyahs);
  if (!count) return "";
  return "".concat(count, " ").concat(t("ayahs"));
}
function ayahCountWord(count) {
  const last = Math.abs(Number(count) || 0) % 100;
  if (last === 2) return "\u0622\u064A\u062A\u0627\u0646";
  if (last >= 3 && last <= 10) return "\u0622\u064A\u0627\u062A";
  return "\u0622\u064A\u0629";
}
function ayahCountNode(count) {
  const wrap = document.createElement("span");
  wrap.className = "ayah-count";
  wrap.dir = "rtl";
  const number = document.createElement("span");
  number.dir = "ltr";
  number.textContent = String(count);
  wrap.append(number, " ".concat(ayahCountWord(count)));
  return wrap;
}
function refreshPlaybackInfo() {
  if (!surahData) return;
  if (language === "ar") {
    const parts = [surahHeading(), " \xB7 ", ayahCountNode(surahData.numberOfAyahs)];
    if (isBismillah) {
      parts.push(" \u2014 ".concat(t("bismillah")));
    } else if (surahData.ayahs && surahData.ayahs[currentAyahIndex]) {
      const ayah = surahData.ayahs[currentAyahIndex].numberInSurah;
      parts.push(" - \u0622\u064A\u0629 ".concat(ayah));
      if (surahAudioMode) parts.push(" \xB7 \u062A\u0644\u0627\u0648\u0629 \u0627\u0644\u0633\u0648\u0631\u0629 \u0643\u0627\u0645\u0644\u0629");
    } else {
      return;
    }
    if (playbackNote) parts.push(" (".concat(t(playbackNote), ")"));
    infoBar.replaceChildren(...parts);
    return;
  }
  let text;
  const count = surahCountPhrase();
  const head = count ? "".concat(surahHeading(), " \xB7 ").concat(count) : surahHeading();
  if (isBismillah) {
    text = "".concat(head, " \u2014 ").concat(t("bismillah"));
  } else if (surahData.ayahs && surahData.ayahs[currentAyahIndex]) {
    const ayah = surahData.ayahs[currentAyahIndex];
    const vars = { head, ayah: ayah.numberInSurah };
    text = surahAudioMode ? t("fullSurahLine", vars) : t("ayahLine", vars);
  } else {
    return;
  }
  if (playbackNote) text += " (".concat(t(playbackNote), ")");
  infoBar.textContent = text;
}
function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  updateLanguageButton();
  updatePlayButton();
  applyBackground();
  updateAutoButton();
  updateLoopButton();
  updateRangeUI();
  updateRepeatUI();
  updateReciterLabel();
  refreshPlaybackInfo();
  const surahModal = document.getElementById("modal-surah");
  if (surahModal && surahModal.classList.contains("show")) {
    document.getElementById("search-surah").dispatchEvent(new Event("input"));
  }
  const reciterModal = document.getElementById("modal-reciter");
  if (reciterModal && reciterModal.classList.contains("show")) {
    document.getElementById("search-reciter").dispatchEvent(new Event("input"));
  }
}
audio.onplay = () => {
  continuingPlayback = true;
  needsGesture = false;
  applyPlaybackRate();
  updatePlayButton();
};
audio.onpause = () => {
  if (continuingPlayback) return;
  updatePlayButton();
  if (bgVideoEnabled) playBackgroundVideo();
};
audio.onerror = () => {
  const src = audio.currentSrc || "";
  if (!src) return;
  if (audio.error && audio.error.code === MediaError.MEDIA_ERR_ABORTED) return;
  continuingPlayback = false;
  infoBar.textContent = t("audioFailed");
  updatePlayButton();
};
function updateSpeedUI() {
  speedLabel.innerText = "".concat(currentSpeed, "x");
  if (legacyTv && btnSpeedToggle) btnSpeedToggle.setAttribute("hidden", "");
  if (audio && !legacyTv) applyPlaybackRate();
}
function updateRepeatUI() {
  repeatLabel.textContent = t("repeat", { current: currentRepeatCycle, max: maxRepeatCount });
}
function updateRangeUI() {
  if (startAyah > 1 || endAyah) {
    rangeLabel.textContent = "".concat(startAyah, " - ").concat(endAyah || t("end"));
  } else {
    rangeLabel.textContent = t("all");
  }
}
btnSpeedToggle.onclick = () => {
  if (legacyTv) return;
  let idx = AVAILABLE_SPEEDS.indexOf(currentSpeed);
  idx = (idx + 1) % AVAILABLE_SPEEDS.length;
  currentSpeed = AVAILABLE_SPEEDS[idx];
  updateSpeedUI();
};
function loadRecitersWithCache() {
  return __async(this, null, function* () {
    try {
      const cached = localStorage.getItem(CACHE_KEY_RECITERS);
      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        const ageDays = (Date.now() - timestamp) / (1e3 * 60 * 60 * 24);
        const clean = Array.isArray(data) ? data.map(sanitizeReciter).filter(Boolean) : [];
        if (cacheExpiryDays > 0 && ageDays < cacheExpiryDays && clean.length > 0) {
          recitersList = clean;
          updateReciterLabel();
          return;
        }
      }
    } catch (err) {
      console.warn("Cache read error:", err);
    }
    try {
      const res = yield fetch("https://api.alquran.cloud/v1/edition?format=audio");
      const json = yield res.json();
      if (json.code === 200 && Array.isArray(json.data)) {
        recitersList = json.data.map(sanitizeReciter).filter(Boolean);
        if (cacheExpiryDays > 0) {
          try {
            localStorage.setItem(CACHE_KEY_RECITERS, JSON.stringify({
              timestamp: Date.now(),
              data: recitersList
            }));
          } catch (e) {
            console.warn("Failed to cache reciters:", e);
          }
        }
      } else {
        recitersList = DEFAULT_RECITERS;
      }
    } catch (err) {
      console.error("Network error fetching reciters, using fallback:", err);
      recitersList = DEFAULT_RECITERS;
    }
    updateReciterLabel();
  });
}
function updateReciterLabel() {
  const found = recitersList.find((r) => r.id === reciter);
  if (!found) {
    reciterLabel.textContent = t("reciter");
    return;
  }
  reciterLabel.textContent = language === "ar" ? found.name || found.english : found.english || found.name;
}
function isFavorite(id) {
  return favoriteReciters.includes(id);
}
function reciterPrimaryName(item) {
  if (language === "ar") return item.name || item.english || "";
  return item.english || item.name || "";
}
function reciterSecondaryName(item) {
  if (language === "ar") return item.english || "";
  return item.name || "";
}
function compareReciters(a, b) {
  return compareReciterItems(a, b, favoriteReciters, language);
}
function toggleFavorite(id) {
  const safeId = safeEditionId(id, "");
  if (!safeId) return;
  if (isFavorite(safeId)) favoriteReciters = favoriteReciters.filter((item) => item !== safeId);
  else if (favoriteReciters.length < 100) favoriteReciters.push(safeId);
  persistSettings();
  document.getElementById("search-reciter").dispatchEvent(new Event("input"));
}
function editionKindLabel(item) {
  const kind = item.type === "surahbysurah" ? t("fullSurah") : t("ayahByAyah");
  if (item.language && item.language !== "ar") return "".concat(kind, " \xB7 ").concat(item.language.toUpperCase());
  return kind;
}
function copyReciterId(id, btn) {
  const markCopied = () => {
    if (!btn) return;
    const previous = btn.textContent;
    btn.textContent = t("copied");
    btn.classList.add("copied");
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.textContent = previous;
      btn.classList.remove("copied");
    }, 1200);
  };
  const fallbackCopy = () => {
    const field = document.createElement("textarea");
    field.value = id;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    if (ok) markCopied();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(markCopied).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
}
function renderReciterGrid(list) {
  const grid = document.getElementById("reciter-grid");
  grid.innerHTML = "";
  list.slice().sort(compareReciters).forEach((r) => {
    const card = document.createElement("div");
    const favorite = isFavorite(r.id);
    card.className = "item-card ".concat(r.id === reciter ? "active" : "", " ").concat(favorite ? "favorite" : "");
    const fullSurah = r.type === "surahbysurah";
    card.innerHTML = '\n          <div class="item-title-row">\n            <button type="button" class="fav-btn '.concat(favorite ? "active" : "", '" title="').concat(escapeHtml(t("favorite")), '">').concat(favorite ? '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>' : '<svg class="star star-outline" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>', '</button>\n            <span class="item-title">').concat(escapeHtml(reciterPrimaryName(r)), '</span>\n          </div>\n          <span class="item-sub">').concat(escapeHtml(reciterSecondaryName(r)), '</span>\n          <span class="item-kind ').concat(fullSurah ? "full" : "", '">').concat(escapeHtml(editionKindLabel(r)), '</span>\n          <div class="item-id-row">\n            <code class="item-id" title="').concat(escapeHtml(t("copyId", { id: r.id })), '">').concat(escapeHtml(r.id), '</code>\n            <button type="button" class="copy-id">').concat(escapeHtml(t("copy")), "</button>\n          </div>\n        ");
    const copyBtn = card.querySelector(".copy-id");
    const copy = (event) => {
      event.stopPropagation();
      copyReciterId(r.id, copyBtn);
    };
    copyBtn.onclick = copy;
    card.querySelector(".item-id").onclick = copy;
    card.querySelector(".fav-btn").onclick = (event) => {
      event.stopPropagation();
      toggleFavorite(r.id);
    };
    card.onclick = () => {
      const id = safeEditionId(r.id, "");
      if (!id) return;
      reciter = id;
      updateReciterLabel();
      closeModals();
      const currentAyahNum = !surahData || isBismillah ? startAyah : surahData.ayahs[currentAyahIndex].numberInSurah;
      loadSurah(currentSurah, currentAyahNum);
    };
    grid.appendChild(card);
  });
}
function initSurahList() {
  return __async(this, null, function* () {
    try {
      const res = yield fetch("https://api.alquran.cloud/v1/surah");
      const data = yield res.json();
      if (!Array.isArray(data.data)) throw new Error("Invalid surah index");
      allSurahs = data.data;
      renderSurahGrid(allSurahs);
    } catch (e) {
      console.error("Could not fetch Surah index", e);
    }
  });
}
function renderSurahGrid(list) {
  const grid = document.getElementById("surah-grid");
  grid.innerHTML = "";
  list.forEach((s) => {
    const surahNumber = Number(s.number);
    const ayahCount = Number(s.numberOfAyahs);
    if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahCount)) return;
    const card = document.createElement("div");
    card.className = "item-card ".concat(surahNumber === currentSurah ? "active" : "");
    const primary = language === "ar" ? s.name : s.englishName;
    const secondary = language === "ar" ? s.englishName : s.name;
    card.innerHTML = '\n          <span class="item-num">#'.concat(surahNumber, '</span>\n          <span class="item-title">').concat(escapeHtml(primary), '</span>\n          <span class="item-sub">').concat(escapeHtml(secondary), "</span>\n        ");
    if (language === "ar") {
      const line = document.createElement("div");
      line.className = "item-title-row";
      const title = card.querySelector(".item-title");
      title.replaceWith(line);
      line.append(title, ayahCountNode(ayahCount));
    } else {
      card.querySelector(".item-sub").textContent = "".concat(secondary, " (").concat(ayahCount, " ").concat(t("ayahs"), ")");
    }
    card.onclick = () => {
      closeModals();
      currentSurah = surahNumber;
      startAyah = 1;
      endAyah = null;
      currentRepeatCycle = 1;
      updateRangeUI();
      updateRepeatUI();
      loadSurah(currentSurah, 1);
    };
    grid.appendChild(card);
  });
}
function playBismillah() {
  return __async(this, arguments, function* (token = ++loadToken) {
    isBismillah = true;
    refreshPlaybackInfo();
    ayahImg.style.opacity = "0";
    clearTimeout(imageTimer);
    imageTimer = setTimeout(() => {
      ayahImg.onload = () => {
        ayahImg.style.opacity = "1";
      };
      ayahImg.src = BISMILLAH_IMAGE_URL;
    }, 200);
    const edition = safeEditionId(reciter, "ar.alafasy");
    if (!bismillahAudioCache[edition]) {
      try {
        const res = yield fetch("https://api.alquran.cloud/v1/ayah/1:1/".concat(encodeURIComponent(edition)));
        const data = yield res.json();
        if (data.code === 200 && data.data && isAllowedMediaUrl(data.data.audio)) {
          bismillahAudioCache[edition] = data.data.audio;
        }
      } catch (err) {
        console.warn("Fallback to standard 128kbps Bismillah audio:", err);
      }
    }
    if (token !== loadToken) return;
    startClip(bismillahAudioCache[edition] || "https://cdn.islamic.network/quran/audio/128/".concat(edition, "/1.mp3"));
  });
}
function loadSurah(surahNum, targetAyah = 1) {
  return __async(this, null, function* () {
    const token = ++loadToken;
    const edition = safeEditionId(reciter, "ar.alafasy");
    playbackNote = "";
    infoBar.textContent = t("loadingSurah", { surah: surahNum });
    try {
      const res = yield fetch("https://api.alquran.cloud/v1/surah/".concat(encodeURIComponent(surahNum), "/").concat(encodeURIComponent(edition)));
      const data = yield res.json();
      if (token !== loadToken) return;
      if (data.code !== 200) throw new Error("Invalid Surah Response");
      surahData = data.data;
      surahAudioMode = Boolean(
        surahData.audio && surahData.ayahs && surahData.ayahs.length && !surahData.ayahs[0].audio
      );
      document.getElementById("range-from-input").max = surahData.numberOfAyahs;
      document.getElementById("range-to-input").max = surahData.numberOfAyahs;
      let foundIdx = surahData.ayahs.findIndex((a) => a.numberInSurah === targetAyah);
      if (foundIdx === -1) {
        foundIdx = targetAyah >= surahData.ayahs.length ? surahData.ayahs.length - 1 : 0;
      }
      currentAyahIndex = foundIdx;
      if (surahAudioMode) {
        playSurahAudio();
      } else if (targetAyah === 1 && currentSurah !== 1 && currentSurah !== 9) {
        yield playBismillah(token);
      } else {
        isBismillah = false;
        playAyah(currentAyahIndex);
      }
    } catch (err) {
      if (token !== loadToken) return;
      infoBar.textContent = t("loadFailed", { surah: surahNum });
      stopPlaybackButton();
      console.error(err);
    }
  });
}
function showAyahImage(index) {
  if (!surahData || !surahData.ayahs[index]) return;
  const surahNumber = Number(surahData.number);
  const ayahNumber = Number(surahData.ayahs[index].numberInSurah);
  if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber)) return;
  const token = ++imageToken;
  clearTimeout(imageTimer);
  ayahImg.onload = null;
  ayahImg.style.opacity = "0";
  imageTimer = setTimeout(() => {
    if (token !== imageToken) return;
    ayahImg.onload = () => {
      if (token !== imageToken) return;
      ayahImg.style.opacity = "1";
    };
    ayahImg.src = "https://cdn.islamic.network/quran/images/high-resolution/".concat(surahNumber, "_").concat(ayahNumber, ".png");
  }, 200);
}
function updateSurahAudioInfo() {
  refreshPlaybackInfo();
}
function playSurahAudio() {
  if (!surahData || !surahData.audio) return;
  isBismillah = false;
  updateSurahAudioInfo();
  showAyahImage(currentAyahIndex);
  startClip(surahData.audio);
}
function playAyah(index) {
  if (!surahData || !surahData.ayahs[index]) return;
  isBismillah = false;
  const ayah = surahData.ayahs[index];
  showAyahImage(index);
  refreshPlaybackInfo();
  startClip(ayah.audio);
}
function finishCurrentPass() {
  if (currentRepeatCycle < maxRepeatCount) {
    currentRepeatCycle++;
    updateRepeatUI();
    loadSurah(currentSurah, startAyah);
    return;
  }
  currentRepeatCycle = 1;
  updateRepeatUI();
  if (endSurah && currentSurah >= endSurah) {
    if (loopEnabled) {
      replayFromStart();
      return;
    }
    playbackNote = "surahsDone";
    refreshPlaybackInfo();
    stopPlaybackButton();
    return;
  }
  if (autoNextSurah && currentSurah < 114) {
    currentSurah++;
    startAyah = 1;
    endAyah = null;
    updateRangeUI();
    loadSurah(currentSurah, 1);
    return;
  }
  if (loopEnabled) {
    replayFromStart();
    return;
  }
  playbackNote = "done";
  refreshPlaybackInfo();
  stopPlaybackButton();
}
function replayFromStart() {
  if (autoNextSurah) {
    currentSurah = 1;
    startAyah = 1;
    endAyah = null;
  } else {
    currentSurah = originSurah;
    startAyah = originStartAyah;
    endAyah = originEndAyah;
  }
  currentRepeatCycle = 1;
  updateRangeUI();
  updateRepeatUI();
  loadSurah(currentSurah, startAyah);
}
audio.onended = () => {
  if (isBismillah) {
    isBismillah = false;
    const startIdx = surahData.ayahs.findIndex((a) => a.numberInSurah === startAyah);
    currentAyahIndex = startIdx !== -1 ? startIdx : 0;
    playAyah(currentAyahIndex);
    return;
  }
  if (surahAudioMode) {
    finishCurrentPass();
    return;
  }
  const currentAyahNum = surahData.ayahs[currentAyahIndex].numberInSurah;
  const isRangeLimitReached = endAyah && currentAyahNum >= endAyah;
  const isSurahLimitReached = currentAyahIndex + 1 >= surahData.ayahs.length;
  if (isRangeLimitReached || isSurahLimitReached) {
    finishCurrentPass();
    return;
  }
  currentAyahIndex++;
  playAyah(currentAyahIndex);
};
document.getElementById("btn-open-range").onclick = () => {
  document.getElementById("range-from-input").value = startAyah;
  document.getElementById("range-to-input").value = endAyah || "";
  document.getElementById("modal-range").classList.add("show");
  document.body.classList.add("modal-open");
};
document.getElementById("btn-open-repeat").onclick = () => {
  document.getElementById("repeat-input").value = maxRepeatCount;
  document.getElementById("modal-repeat").classList.add("show");
  document.body.classList.add("modal-open");
};
function applyAyahRange() {
  const fromVal = parseInt(document.getElementById("range-from-input").value, 10) || 1;
  const toVal = parseInt(document.getElementById("range-to-input").value, 10) || null;
  startAyah = Math.max(1, fromVal);
  endAyah = toVal && toVal >= startAyah ? toVal : null;
  currentRepeatCycle = 1;
  updateRangeUI();
  updateRepeatUI();
  closeModals();
  loadSurah(currentSurah, startAyah);
}
function resetAyahRange() {
  startAyah = 1;
  endAyah = null;
  currentRepeatCycle = 1;
  updateRangeUI();
  updateRepeatUI();
  closeModals();
  loadSurah(currentSurah, 1);
}
function applyRepeatCount() {
  const val = parseInt(document.getElementById("repeat-input").value, 10) || 1;
  maxRepeatCount = Math.min(20, Math.max(1, val));
  currentRepeatCycle = 1;
  updateRepeatUI();
  closeModals();
}
btnPlayPause.onclick = () => {
  if (continuingPlayback) {
    continuingPlayback = false;
    needsGesture = false;
    audio.pause();
    updatePlayButton();
    return;
  }
  if (needsGesture || !audio.src) {
    retryBlockedPlayback();
    return;
  }
  continuingPlayback = true;
  updatePlayButton();
  audio.volume = 1;
  const pending = audio.play();
  if (pending && typeof pending.catch === "function") {
    pending.catch(() => {
      needsGesture = true;
      continuingPlayback = false;
      updatePlayButton();
    });
  }
};
document.getElementById("btn-next-ayah").onclick = () => {
  if (surahAudioMode) {
    if (surahData && currentAyahIndex + 1 < surahData.ayahs.length) {
      currentAyahIndex++;
      showAyahImage(currentAyahIndex);
      updateSurahAudioInfo();
    }
    return;
  }
  if (isBismillah) {
    isBismillah = false;
    playAyah(0);
  } else if (surahData && currentAyahIndex + 1 < surahData.ayahs.length) {
    currentAyahIndex++;
    playAyah(currentAyahIndex);
  }
};
document.getElementById("btn-prev-ayah").onclick = () => {
  if (surahAudioMode) {
    if (surahData && currentAyahIndex > 0) {
      currentAyahIndex--;
      showAyahImage(currentAyahIndex);
      updateSurahAudioInfo();
    }
    return;
  }
  if (isBismillah) {
    if (currentSurah > 1) {
      currentSurah--;
      loadSurah(currentSurah, 9999);
    }
  } else if (currentAyahIndex === 0 && currentSurah !== 1 && currentSurah !== 9) {
    playBismillah();
  } else if (surahData && currentAyahIndex > 0) {
    currentAyahIndex--;
    playAyah(currentAyahIndex);
  }
};
document.getElementById("btn-next-surah").onclick = () => {
  if (currentSurah < 114) {
    currentSurah++;
    startAyah = 1;
    endAyah = null;
    currentRepeatCycle = 1;
    updateRangeUI();
    updateRepeatUI();
    loadSurah(currentSurah, 1);
  }
};
document.getElementById("btn-prev-surah").onclick = () => {
  if (currentSurah > 1) {
    currentSurah--;
    startAyah = 1;
    endAyah = null;
    currentRepeatCycle = 1;
    updateRangeUI();
    updateRepeatUI();
    loadSurah(currentSurah, 1);
  }
};
btnToggleBg.onclick = () => {
  bgVideoEnabled = !bgVideoEnabled;
  applyBackground();
};
btnAutoSurah.onclick = () => {
  autoNextSurah = !autoNextSurah;
  updateAutoButton();
};
btnLoop.onclick = () => {
  loopEnabled = !loopEnabled;
  updateLoopButton();
};
document.getElementById("btn-language").onclick = () => {
  language = language === "en" ? "ar" : "en";
  writeLanguageQuery(language);
  persistSettings();
  applyLanguage();
};
document.getElementById("btn-open-surahs").onclick = () => {
  const search = document.getElementById("search-surah");
  if (allSurahs.length) search.dispatchEvent(new Event("input"));
  document.getElementById("modal-surah").classList.add("show");
  document.body.classList.add("modal-open");
};
document.getElementById("btn-open-settings").onclick = () => __async(null, null, function* () {
  document.getElementById("cache-days-input").value = cacheExpiryDays;
  document.getElementById("cache-status").textContent = t("cacheCounting");
  document.getElementById("modal-settings").classList.add("show");
  document.body.classList.add("modal-open");
  document.getElementById("cache-status").textContent = yield cacheStatusText();
});
document.getElementById("btn-apply-cache").onclick = () => __async(null, null, function* () {
  cacheExpiryDays = clampCacheDays(document.getElementById("cache-days-input").value, cacheExpiryDays);
  document.getElementById("cache-days-input").value = cacheExpiryDays;
  yield syncCacheSettings();
  document.getElementById("cache-status").textContent = "".concat(t("cacheSaved"), " ").concat(yield cacheStatusText());
});
document.getElementById("btn-clear-cache").onclick = () => __async(null, null, function* () {
  const button = document.getElementById("btn-clear-cache");
  button.disabled = true;
  yield clearStoredMedia();
  button.disabled = false;
  document.getElementById("cache-status").textContent = "".concat(t("cacheCleared"), " ").concat(yield cacheStatusText());
});
document.getElementById("btn-reset-settings").onclick = () => __async(null, null, function* () {
  language = "en";
  favoriteReciters = [];
  cacheExpiryDays = 7;
  writeLanguageQuery(null);
  document.getElementById("cache-days-input").value = cacheExpiryDays;
  yield syncCacheSettings();
  applyLanguage();
  document.getElementById("cache-status").textContent = "".concat(t("settingsReset"), " ").concat(yield cacheStatusText());
});
document.getElementById("btn-open-reciters").onclick = () => {
  const search = document.getElementById("search-reciter");
  search.value = "";
  renderReciterGrid(recitersList);
  document.getElementById("modal-reciter").classList.add("show");
  document.body.classList.add("modal-open");
};
function closeModals() {
  document.querySelectorAll(".modal").forEach((m) => m.classList.remove("show"));
  document.body.classList.remove("modal-open");
}
document.getElementById("search-surah").oninput = (e) => {
  const q = e.target.value.toLowerCase().trim();
  const filtered = allSurahs.filter(
    (s) => String(s.number).includes(q) || String(s.name || "").includes(q) || String(s.englishName || "").toLowerCase().includes(q)
  );
  renderSurahGrid(filtered);
};
document.getElementById("search-reciter").oninput = (e) => {
  const q = e.target.value.toLowerCase().trim();
  const filtered = recitersList.filter(
    (r) => String(r.name || "").toLowerCase().includes(q) || String(r.english || "").toLowerCase().includes(q) || String(r.id || "").toLowerCase().includes(q)
  );
  renderReciterGrid(filtered);
};
let idleTimer;
function resetIdle() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  if (!document.body.classList.contains("modal-open")) {
    idleTimer = setTimeout(() => document.body.classList.add("idle"), 4e3);
  }
}
window.onmousemove = resetIdle;
window.onclick = resetIdle;
window.addEventListener("click", retryBlockedPlayback);
window.addEventListener("keydown", retryBlockedPlayback);
(function init() {
  return __async(this, null, function* () {
    applyLanguage();
    updateSpeedUI();
    updateRepeatUI();
    updateRangeUI();
    yield registerMediaWorker();
    yield syncCacheSettings();
    const bismillahPreload = new Image();
    bismillahPreload.src = BISMILLAH_IMAGE_URL;
    yield loadRecitersWithCache();
    initSurahList();
    loadSurah(currentSurah, startAyah);
  });
})();
