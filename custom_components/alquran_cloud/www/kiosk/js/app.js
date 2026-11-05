// --- 1. Configuration & Caching ---
    const CACHE_KEY_RECITERS = 'quran_audio_reciters_cache_v4';
    const SETTINGS_KEY = 'quran_kiosk_settings_v1';
    const MEDIA_CACHE = 'quran-kiosk-media-v1';
    const KIOSK_DB = 'quran-kiosk';
    const KIOSK_STORE = 'meta';
    const BISMILLAH_IMAGE_URL = 'assets/bismillah.png';
    const AVAILABLE_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    let cacheExpiryDays = 7;
    let language = 'en';
    let favoriteReciters = [];
    let remoteSkip = 'ayah';
    let playbackNote = '';
    let storedSettings = {};
    let playbackReady = false;

    function readCacheSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        storedSettings = parsed;
        cacheExpiryDays = clampCacheDays(parsed.cacheExpiryDays, cacheExpiryDays);
        language = parsed.language === 'ar' ? 'ar' : 'en';
        favoriteReciters = Array.isArray(parsed.favorites)
          ? parsed.favorites.filter((id) => safeEditionId(id, '')).slice(0, 100)
          : [];
        remoteSkip = parsed.remoteSkip === 'surah' ? 'surah' : 'ayah';
      } catch (err) {
        console.warn('Settings read error:', err);
      }
    }

    function persistSettings() {
      try {
        const payload = {
          cacheExpiryDays,
          language,
          favorites: favoriteReciters,
          remoteSkip: remoteSkip === 'surah' ? 'surah' : 'ayah'
        };
        if (playbackReady) {
          payload.surah = currentSurah;
          payload.ayah = startAyah;
          payload.toAyah = endAyah || null;
          payload.reciter = reciter;
          payload.speed = rememberedSpeed;
          payload.repeat = maxRepeatCount;
          payload.autoSurah = autoNextSurah;
          payload.loop = loopEnabled;
          payload.background = bgVideoEnabled;
        } else {
          ['surah', 'ayah', 'toAyah', 'reciter', 'speed', 'repeat', 'autoSurah', 'loop', 'background'].forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storedSettings, key)) payload[key] = storedSettings[key];
          });
        }
        storedSettings = payload;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
        if (playbackReady) writePlaybackQuery();
      } catch (err) {
        console.warn('Settings write error:', err);
      }
    }

    function writePlaybackQuery() {
      const url = new URL(window.location.href);
      const set = (name, value) => url.searchParams.set(name, String(value));
      set('surah', currentSurah);
      set('ayah', startAyah);
      if (endAyah) set('to_ayah', endAyah);
      else url.searchParams.delete('to_ayah');
      set('reciter', reciter);
      set('speed', rememberedSpeed);
      set('repeat', maxRepeatCount);
      set('auto_surah', autoNextSurah ? 'true' : 'false');
      set('loop', loopEnabled ? 'true' : 'false');
      set('background_video', bgVideoEnabled ? 'true' : 'false');
      url.searchParams.delete('lang');
      set('language', language);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
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
      return openKioskDb().then(async (db) => {
        try {
          return await fn(db);
        } finally {
          db.close();
        }
      });
    }

    function idbPut(key, value) {
      return withKioskDb((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(KIOSK_STORE, 'readwrite');
        tx.objectStore(KIOSK_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
    }

    async function syncCacheSettings() {
      cacheExpiryDays = clampCacheDays(cacheExpiryDays);
      persistSettings();
      try {
        await idbPut('settings', { cacheExpiryDays });
      } catch (err) {
        console.warn('Unable to share cache settings with the media worker', err);
      }
    }

    async function clearStoredMedia() {
      Object.keys(bismillahAudioCache).forEach((key) => delete bismillahAudioCache[key]);
      localStorage.removeItem(CACHE_KEY_RECITERS);
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith('quran-kiosk-media')).map((name) => caches.delete(name)));
      }
      try {
        await withKioskDb((db) => new Promise((resolve, reject) => {
          const tx = db.transaction(KIOSK_STORE, 'readwrite');
          const store = tx.objectStore(KIOSK_STORE);
          const request = store.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (String(cursor.key).startsWith('media:')) cursor.delete();
            cursor.continue();
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }));
      } catch (err) {
        console.warn('Unable to clear media index', err);
      }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_MEDIA' });
      }
    }

    async function cacheStatusText() {
      let count = 0;
      try {
        if ('caches' in window) {
          const cache = await caches.open(MEDIA_CACHE);
          count = (await cache.keys()).length;
        }
      } catch (err) {
        console.warn('Cache status error:', err);
      }
      let mode = t('cacheOn');
      if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
        mode = t('cacheNeedsServer');
      } else if (!navigator.serviceWorker.controller) {
        mode = t('cacheWaiting');
      }
      return t('cacheStatus', { count, mode, days: cacheExpiryDays });
    }

    async function registerMediaWorker() {
      if (!('serviceWorker' in navigator) || location.protocol === 'file:' || oldTvBrowser()) return false;
      const workerUrl = resolveAssetUrl(location.href, 'sw.js?v=3');
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const stale = regs.filter((reg) => {
          const script = (reg.active || reg.waiting || reg.installing || {}).scriptURL || '';
          return script.split('#')[0] !== workerUrl;
        });
        if (stale.length) {
          await Promise.all(stale.map((reg) => reg.unregister()));
          const controller = navigator.serviceWorker.controller;
          if (controller && controller.scriptURL.split('#')[0] !== workerUrl && sessionStorage.getItem('kiosk-sw-reset') !== workerUrl) {
            sessionStorage.setItem('kiosk-sw-reset', workerUrl);
            location.reload();
            return false;
          }
        }
        const registered = await Promise.race([
          navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('service worker timeout')), 2000))
        ]);
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(resolve, 1000))
        ]);
        return Boolean(navigator.serviceWorker.controller || registered);
      } catch (err) {
        console.warn('Media cache worker failed:', err);
        return false;
      }
    }

    readCacheSettings();

    const DEFAULT_RECITERS = [
      { id: 'ar.alafasy', name: 'مشاري راشد العفاسي', english: 'Mishary Alafasy', type: 'versebyverse', language: 'ar' },
      { id: 'ar.abdulbasitmurattal', name: 'عبد الباسط عبد الصمد (مرتل)', english: 'AbdulBaset (Murattal)', type: 'translation', language: 'ar' },
      { id: 'ar.minshawi', name: 'محمد صديق المنشاوي', english: 'Al-Minshawi', type: 'translation', language: 'ar' },
      { id: 'ar.husary', name: 'محمود خليل الحصري', english: 'Al-Husary', type: 'versebyverse', language: 'ar' },
      { id: 'ar.mahermuaiqly', name: 'ماهر المعيقلي', english: 'Maher Al-Muaiqly', type: 'versebyverse', language: 'ar' },
      { id: 'ar.abdullahbasfar', name: 'عبد الله بصفر', english: 'Abdullah Basfar', type: 'versebyverse', language: 'ar' },
      { id: 'ar.saoodshuraym', name: 'سعود الشريم', english: 'Saood Ash-Shuraym', type: 'versebyverse', language: 'ar' }
    ];

    // --- 2. Query Params & State ---
    const params = new URLSearchParams(window.location.search);

    function queryInt(name, fallback, min, max) {
      return boundedQueryInt(params, name, fallback, min, max);
    }

    const legacyTv = oldTvBrowser();
    const playback = resolvePlayback(params, storedSettings, legacyTv);
    let currentSurah = playback.surah;
    let startAyah = playback.ayah;
    let endAyah = playback.toAyah;
    const endSurah = params.has('to_surah') ? queryInt('to_surah', null, 1, 114) : null;
    let reciter = playback.reciter;
    let autoNextSurah = playback.autoSurah;
    let loopEnabled = playback.loop;
    let currentSpeed = playback.speed;
    let rememberedSpeed = playback.rememberedSpeed;
    let maxRepeatCount = playback.repeat;
    let currentRepeatCycle = 1;
    let bgVideoEnabled = playback.background;
    let originSurah = currentSurah;
    let originStartAyah = startAyah;
    let originEndAyah = endAyah;

    function languageFromQuery() {
      return languageFromSearch(params);
    }

    const requestedLanguage = languageFromQuery();
    if (requestedLanguage) language = requestedLanguage;
    playbackReady = true;
    persistSettings();

    let surahData = null;
    let allSurahs = [];
    let recitersList = [];
    let currentAyahIndex = 0;
    let isBismillah = false;
    let surahAudioMode = false;
    const bismillahAudioCache = {};

    // DOM Elements
    const audio = document.getElementById('audio');
    const ayahImg = document.getElementById('ayah-img');
    const infoBar = document.getElementById('info-bar');
    const bgVideo = document.getElementById('bg');
    audio.preload = 'auto';
    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnToggleBg = document.getElementById('btn-toggle-bg');
    const btnAutoSurah = document.getElementById('btn-auto-surah');
    const btnLoop = document.getElementById('btn-loop');
    const btnSpeedToggle = document.getElementById('btn-speed-toggle');
    const speedLabel = document.getElementById('speed-label');
    const rangeLabel = document.getElementById('range-label');
    const repeatLabel = document.getElementById('repeat-label');
    const reciterLabel = document.getElementById('reciter-label');

    const STRINGS = {
      en: {
        title: 'Quran Kiosk Player',
        surahsBtn: 'Surahs',
        ayahsLabel: 'Ayahs',
        settingsBtn: 'Settings',
        prevSurah: 'Previous surah',
        prevAyah: 'Previous ayah',
        nextAyah: 'Next ayah',
        nextSurah: 'Next surah',
        play: 'Play',
        pause: 'Pause',
        surahsTitle: 'Surahs',
        surahSearch: 'Search by number or name...',
        recitersTitle: 'Reciters',
        reciterSearch: 'Search by name or alquran.cloud id...',
        reciterHint: 'Click the id or Copy to copy it. A star pins a favorite to the top. Full surah is one file; ayah by ayah is a clip per verse.',
        rangeTitle: 'Ayah range for this surah',
        rangeFrom: 'From ayah:',
        rangeTo: 'To ayah (leave empty for the end of the surah):',
        rangeToPlaceholder: 'End of surah',
        rangeReset: 'Clear range (full surah)',
        apply: 'Apply',
        settingsTitle: 'Settings',
        cacheDaysLabel: 'Cache period (days)',
        cacheHint: 'The same period is used for the reciter list, audio, ayah images, and the background video. 0 turns caching off. Older files are removed when the period ends or browser storage fills up.',
        cacheCounting: 'Counting...',
        clearCache: 'Clear cache',
        save: 'Save',
        resetSettings: 'Reset settings',
        resetHint: 'Restores English, surah 1, Alafasy, speed 1, and repeat 1. Turns off auto-next, loop, and the background. Remote next and previous return to the ayah. Removes every favorite reciter and sets the cache period back to 7 days. Downloaded audio is kept.',
        remoteSkipLabel: 'Remote next and previous',
        remoteSkipAyah: 'Ayah',
        remoteSkipSurah: 'Surah',
        remoteSkipHint: 'Next and previous on the remote move one ayah. Choose Surah to move a whole surah instead.',
        settingsReset: 'Settings restored.',
        repeatTitle: 'Repeat the surah or selected range',
        repeatCountLabel: 'Repeat count (1 to 20):',
        repeatHint: 'If an ayah range is set, that range repeats this many times before moving on or stopping.',
        loading: 'Loading...',
        loadingSurah: 'Loading surah {surah}...',
        loadFailed: 'Could not load surah ({surah})',
        audioFailed: 'Could not play this reciter',
        reciter: 'Reciter',
        all: 'All',
        end: 'end',
        repeat: 'Repeat: {current}/{max}',
        ayahs: 'ayahs',
        ayahByAyah: 'Ayah by ayah',
        fullSurah: 'Full surah',
        copy: 'Copy',
        copied: 'Copied',
        copyId: 'Copy {id}',
        favorite: 'Favorite',
        bismillah: 'Bismillah',
        meccan: 'Meccan',
        medinan: 'Medinan',
        ayahLine: '{head} — ayah {ayah}',
        fullSurahLine: '{head} — ayah {ayah} · full surah',
        surahsDone: 'requested surahs finished',
        done: 'recitation complete',
        bgOn: 'Background: on',
        bgOff: 'Background: off',
        autoOn: 'Auto next: on',
        autoOff: 'Auto next: off',
        loopOn: 'Loop: on',
        loopOff: 'Loop: off',
        cacheOn: 'on',
        cacheNeedsServer: 'needs a local server',
        cacheWaiting: 'waiting to start',
        cacheStatus: 'Saved files: {count}. Cache: {mode}. Period: {days} days.',
        cacheSaved: 'Saved.',
        cacheCleared: 'Cleared.'
      },
      ar: {
        title: 'قارئ القرآن',
        surahsBtn: 'السور',
        ayahsLabel: 'الآيات',
        settingsBtn: 'الإعدادات',
        prevSurah: 'السورة السابقة',
        prevAyah: 'الآية السابقة',
        nextAyah: 'الآية التالية',
        nextSurah: 'السورة التالية',
        play: 'تشغيل',
        pause: 'إيقاف',
        surahsTitle: 'قائمة السور',
        surahSearch: 'ابحث برقم أو اسم السورة...',
        recitersTitle: 'اختر القارئ',
        reciterSearch: 'ابحث بالاسم أو بمعرف alquran.cloud...',
        reciterHint: 'اضغط المعرف أو «نسخ» لنسخه. النجمة تثبت القارئ المفضل في الأعلى. «سورة كاملة» ملف واحد، و«آية بآية» مقطع لكل آية.',
        rangeTitle: 'تحديد نطاق الآيات للسورة الحالية',
        rangeFrom: 'من الآية:',
        rangeTo: 'إلى الآية (اتركه فارغاً لآخر السورة):',
        rangeToPlaceholder: 'نهاية السورة',
        rangeReset: 'إلغاء النطاق (كامل السورة)',
        apply: 'تطبيق',
        settingsTitle: 'الإعدادات',
        cacheDaysLabel: 'مدة التخزين المؤقت (بالأيام)',
        cacheHint: 'نفس المدة لقائمة القراء والصوت وصور الآيات وفيديو الخلفية. 0 يوقف التخزين. عند انتهاء المدة، أو إذا امتلأت مساحة المتصفح، يُحذف الأقدم.',
        cacheCounting: 'جاري الحساب...',
        clearCache: 'مسح التخزين المؤقت',
        save: 'حفظ',
        resetSettings: 'إعادة الضبط',
        resetHint: 'يعيد الإنجليزية، والسورة 1، والقارئ العفاسي، والسرعة 1، والتكرار 1، ويوقف التالي التلقائي والإعادة والخلفية. زر التالي والسابق في جهاز التحكم يعود للآية. يزيل كل القراء المفضلين ويعيد مدة التخزين إلى 7 أيام. الملفات المحفوظة تبقى.',
        remoteSkipLabel: 'التالي والسابق في جهاز التحكم',
        remoteSkipAyah: 'آية',
        remoteSkipSurah: 'سورة',
        remoteSkipHint: 'التالي والسابق في جهاز التحكم ينقلان آية واحدة. اختر سورة للانتقال سورة كاملة.',
        settingsReset: 'تمت استعادة الإعدادات.',
        repeatTitle: 'تكرار السورة أو النطاق المحدد',
        repeatCountLabel: 'عدد مرات التكرار (1 إلى 20):',
        repeatHint: 'إذا كان هناك نطاق آيات محدد، سيتكرر النطاق كاملاً هذا العدد من المرات قبل الانتقال أو التوقف.',
        loading: 'جاري التحميل...',
        loadingSurah: 'جاري تحميل سورة {surah}...',
        loadFailed: 'تعذر تحميل السورة ({surah})',
        audioFailed: 'تعذر تشغيل الصوت لهذا القارئ',
        reciter: 'القارئ',
        all: 'الكل',
        end: 'نهاية',
        repeat: 'تكرار: {current}/{max}',
        ayahs: 'آيات',
        ayahByAyah: 'آية بآية',
        fullSurah: 'سورة كاملة',
        copy: 'نسخ',
        copied: 'تم النسخ',
        copyId: 'نسخ {id}',
        favorite: 'مفضلة',
        bismillah: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
        meccan: 'مكية',
        medinan: 'مدنية',
        ayahLine: '{head} - آية {ayah}',
        fullSurahLine: '{head} - آية {ayah} · تلاوة السورة كاملة',
        surahsDone: 'انتهت السور المطلوبة',
        done: 'اكتمل التلاوة',
        bgOn: 'خلفية: تشغيل',
        bgOff: 'خلفية: إخفاء',
        autoOn: 'التالي تلقائياً: تفعيل',
        autoOff: 'التالي تلقائياً: تعطيل',
        loopOn: 'الإعادة: تفعيل',
        loopOff: 'الإعادة: تعطيل',
        cacheOn: 'يعمل',
        cacheNeedsServer: 'يحتاج فتح الصفحة من خادم',
        cacheWaiting: 'بانتظار التفعيل',
        cacheStatus: 'الملفات المحفوظة: {count}. حالة التخزين: {mode}. المدة: {days} يوم.',
        cacheSaved: 'تم الحفظ.',
        cacheCleared: 'تم المسح.'
      }
    };

    function t(key, vars) {
      const template = (STRINGS[language] && STRINGS[language][key]) || STRINGS.en[key] || key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
    }

    let continuingPlayback = false;
    let currentClipUrl = '';
    let needsGesture = false;
    let clipToken = 0;
    let loadToken = 0;
    let imageToken = 0;
    let imageTimer = 0;

    function setIconShown(icon, shown) {
      if (!icon) return;
      if (shown) icon.removeAttribute('hidden');
      else icon.setAttribute('hidden', '');
    }

    function updatePlayButton() {
      const label = document.getElementById('play-label');
      if (label) label.textContent = continuingPlayback ? t('pause') : t('play');
      setIconShown(btnPlayPause.querySelector('.ico-play'), !continuingPlayback);
      setIconShown(btnPlayPause.querySelector('.ico-pause'), continuingPlayback);
      btnPlayPause.classList.toggle('active', continuingPlayback);
      if (navigator.mediaSession) {
        try {
          navigator.mediaSession.playbackState = continuingPlayback ? 'playing' : 'paused';
        } catch (err) { /* playbackState is missing on older TVs */ }
      }
    }

    function applyPlaybackRate() {
      if (legacyTv) return;
      try {
        audio.playbackRate = currentSpeed;
      } catch (err) {
        // Some TV browsers reject playbackRate until the clip has metadata.
      }
    }

    function startClip(url) {
      if (!isAllowedMediaUrl(url)) {
        continuingPlayback = false;
        needsGesture = false;
        updatePlayButton();
        infoBar.textContent = t('audioFailed');
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
      if (pending && typeof pending.catch === 'function') {
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
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const token = clipToken;
      needsGesture = false;
      continuingPlayback = true;
      updatePlayButton();
      audio.volume = 1;
      if (audio.src !== currentClipUrl) audio.src = currentClipUrl;
      try {
        audio.load();
      } catch (err) {
        // Older TV browsers can throw if load() is called twice.
      }
      applyPlaybackRate();
      const pending = audio.play();
      if (pending && typeof pending.catch === 'function') {
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
      const label = document.getElementById('bg-label');
      if (label) label.textContent = bgVideoEnabled ? t('bgOn') : t('bgOff');
    }

    let bgHold = false;
    let bgRestartAt = 0;
    const BG_VIDEO = 'assets/landscape-tree-clouds.mp4';

    function bgStills() {
      return document.getElementById('bg-stills');
    }

    function playBackgroundVideo() {
      if (legacyTv || !bgVideo || !bgVideoEnabled) return;
      bgHold = false;
      const stills = bgStills();
      if (stills) stills.classList.add('hidden');
      if (!bgVideo.getAttribute('src')) bgVideo.src = BG_VIDEO;
      bgVideo.classList.remove('hidden');
      const pending = bgVideo.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    }

    function restartBackgroundVideo() {
      if (legacyTv || !bgVideo || !bgVideoEnabled) return;
      if (audio && !audio.paused) return;
      const now = Date.now();
      if (now - bgRestartAt < 400) return;
      bgRestartAt = now;
      try { bgVideo.currentTime = 0; } catch (err) { /* not seekable yet */ }
      playBackgroundVideo();
    }

    function applyBackground() {
      if (btnToggleBg) btnToggleBg.classList.toggle('active', bgVideoEnabled);
      const stills = bgStills();
      if (legacyTv) {
        if (bgVideo) {
          bgHold = true;
          bgVideo.classList.add('hidden');
          try { bgVideo.pause(); } catch (err) { /* already stopped */ }
        }
        if (stills) stills.classList.toggle('hidden', !bgVideoEnabled);
        updateBgButton();
        return;
      }
      if (!bgVideo) return;
      if (!bgVideoEnabled) {
        bgHold = true;
        bgVideo.classList.add('hidden');
        try { bgVideo.pause(); } catch (err) { /* already stopped */ }
        if (stills) stills.classList.add('hidden');
        updateBgButton();
        return;
      }
      playBackgroundVideo();
      updateBgButton();
    }

    if (bgVideo && !legacyTv) {
      bgVideo.addEventListener('ended', () => {
        if (!bgVideoEnabled) return;
        restartBackgroundVideo();
      });
      bgVideo.addEventListener('pause', () => {
        if (bgHold || !bgVideoEnabled) return;
        if (audio && !audio.paused) return;
        restartBackgroundVideo();
      });
    }

    function updateAutoButton() {
      if (!btnAutoSurah) return;
      btnAutoSurah.textContent = autoNextSurah ? t('autoOn') : t('autoOff');
      btnAutoSurah.classList.toggle('active', autoNextSurah);
    }

    function updateLoopButton() {
      if (!btnLoop) return;
      btnLoop.textContent = loopEnabled ? t('loopOn') : t('loopOff');
      btnLoop.classList.toggle('active', loopEnabled);
    }

    function updateLanguageButton() {
      const button = document.getElementById('btn-language');
      button.textContent = language === 'en' ? 'العربية' : 'English';
    }

    function surahDisplayName() {
      if (!surahData) return '';
      return language === 'ar' ? surahData.name : surahData.englishName;
    }

    function surahNumberLabel() {
      const number = Number(surahData && surahData.number);
      if (!number) return '';
      const text = String(number);
      return text.length >= 3 ? text : ('000' + text).slice(-3);
    }

    function surahPlace() {
      const kind = String((surahData && surahData.revelationType) || '').toLowerCase();
      if (kind === 'meccan') return t('meccan');
      if (kind === 'medinan') return t('medinan');
      return '';
    }

    function surahHeading() {
      const parts = [];
      const number = surahNumberLabel();
      const name = surahDisplayName();
      const place = surahPlace();
      if (number) parts.push(number);
      if (name) parts.push(name);
      if (place) parts.push(place);
      return parts.join(' · ');
    }

    function surahCountPhrase() {
      const count = Number(surahData && surahData.numberOfAyahs);
      if (!count) return '';
      return `${count} ${t('ayahs')}`;
    }

    function ayahCountNode(count) {
      const wrap = document.createElement('span');
      wrap.className = 'ayah-count';
      wrap.dir = 'rtl';
      const number = document.createElement('span');
      number.dir = 'ltr';
      number.textContent = String(count);
      wrap.append(number, ` ${ayahCountWord(count)}`);
      return wrap;
    }

    function refreshPlaybackInfo() {
      if (!surahData) return;
      if (language === 'ar') {
        const parts = [surahHeading(), ' · ', ayahCountNode(surahData.numberOfAyahs)];
        if (isBismillah) {
          parts.push(` — ${t('bismillah')}`);
        } else if (surahData.ayahs && surahData.ayahs[currentAyahIndex]) {
          const ayah = surahData.ayahs[currentAyahIndex].numberInSurah;
          parts.push(` - آية ${ayah}`);
          if (surahAudioMode) parts.push(' · تلاوة السورة كاملة');
        } else {
          return;
        }
        if (playbackNote) parts.push(` (${t(playbackNote)})`);
        infoBar.replaceChildren(...parts);
        return;
      }

      let text;
      const count = surahCountPhrase();
      const head = count ? `${surahHeading()} · ${count}` : surahHeading();
      if (isBismillah) {
        text = `${head} — ${t('bismillah')}`;
      } else if (surahData.ayahs && surahData.ayahs[currentAyahIndex]) {
        const ayah = surahData.ayahs[currentAyahIndex];
        const vars = { head: head, ayah: ayah.numberInSurah };
        text = surahAudioMode ? t('fullSurahLine', vars) : t('ayahLine', vars);
      } else {
        return;
      }
      if (playbackNote) text += ` (${t(playbackNote)})`;
      infoBar.textContent = text;
    }

    function applyLanguage() {
      document.documentElement.lang = language;
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      document.title = t('title');
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
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
      const surahModal = document.getElementById('modal-surah');
      if (surahModal && surahModal.classList.contains('show')) {
        document.getElementById('search-surah').dispatchEvent(new Event('input'));
      }
      const reciterModal = document.getElementById('modal-reciter');
      if (reciterModal && reciterModal.classList.contains('show')) {
        document.getElementById('search-reciter').dispatchEvent(new Event('input'));
      }
    }

    // --- 3. Audio Lifecycle Handlers ---
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
      const src = audio.currentSrc || '';
      if (!src) return;
      if (audio.error && audio.error.code === MediaError.MEDIA_ERR_ABORTED) return;
      continuingPlayback = false;
      infoBar.textContent = t('audioFailed');
      updatePlayButton();
    };

    // --- 4. Speed & Repeat UI Updates ---
    function updateSpeedUI() {
      speedLabel.innerText = `${currentSpeed}x`;
      if (legacyTv && btnSpeedToggle) btnSpeedToggle.setAttribute('hidden', '');
      if (audio && !legacyTv) applyPlaybackRate();
    }

    function updateRepeatUI() {
      repeatLabel.textContent = t('repeat', { current: currentRepeatCycle, max: maxRepeatCount });
    }

    function updateRangeUI() {
      if (startAyah > 1 || endAyah) {
        rangeLabel.textContent = `${startAyah} - ${endAyah || t('end')}`;
      } else {
        rangeLabel.textContent = t('all');
      }
    }

    btnSpeedToggle.onclick = () => {
      if (legacyTv) return;
      let idx = AVAILABLE_SPEEDS.indexOf(currentSpeed);
      idx = (idx + 1) % AVAILABLE_SPEEDS.length;
      currentSpeed = AVAILABLE_SPEEDS[idx];
      rememberedSpeed = currentSpeed;
      updateSpeedUI();
      persistSettings();
    };

    // --- 5. Dynamic Reciters Loader with LocalStorage TTL ---
    async function loadRecitersWithCache() {
      try {
        const cached = localStorage.getItem(CACHE_KEY_RECITERS);
        if (cached) {
          const { timestamp, data } = JSON.parse(cached);
          const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
          const clean = Array.isArray(data) ? data.map(sanitizeReciter).filter(Boolean) : [];
          if (cacheExpiryDays > 0 && ageDays < cacheExpiryDays && clean.length > 0) {
            recitersList = clean;
            updateReciterLabel();
            return;
          }
        }
      } catch (err) {
        console.warn('Cache read error:', err);
      }

      try {
        const res = await fetch('https://api.alquran.cloud/v1/edition?format=audio');
        const json = await res.json();
        if (json.code === 200 && Array.isArray(json.data)) {
          recitersList = json.data.map(sanitizeReciter).filter(Boolean);

          if (cacheExpiryDays > 0) {
            try {
              localStorage.setItem(CACHE_KEY_RECITERS, JSON.stringify({
                timestamp: Date.now(),
                data: recitersList
              }));
            } catch (e) {
              console.warn('Failed to cache reciters:', e);
            }
          }
        } else {
          recitersList = DEFAULT_RECITERS;
        }
      } catch (err) {
        console.error('Network error fetching reciters, using fallback:', err);
        recitersList = DEFAULT_RECITERS;
      }

      updateReciterLabel();
    }

    function updateReciterLabel() {
      const found = recitersList.find(r => r.id === reciter);
      if (!found) {
        reciterLabel.textContent = t('reciter');
        return;
      }
      reciterLabel.textContent = language === 'ar'
        ? (found.name || found.english)
        : (found.english || found.name);
    }

    function isFavorite(id) {
      return favoriteReciters.includes(id);
    }

    function reciterPrimaryName(item) {
      if (language === 'ar') return item.name || item.english || '';
      return item.english || item.name || '';
    }

    function reciterSecondaryName(item) {
      if (language === 'ar') return item.english || '';
      return item.name || '';
    }

    function compareReciters(a, b) {
      return compareReciterItems(a, b, favoriteReciters, language);
    }

    function toggleFavorite(id) {
      const safeId = safeEditionId(id, '');
      if (!safeId) return;
      if (isFavorite(safeId)) favoriteReciters = favoriteReciters.filter((item) => item !== safeId);
      else if (favoriteReciters.length < 100) favoriteReciters.push(safeId);
      persistSettings();
      document.getElementById('search-reciter').dispatchEvent(new Event('input'));
    }

    function editionKindLabel(item) {
      const kind = item.type === 'surahbysurah' ? t('fullSurah') : t('ayahByAyah');
      if (item.language && item.language !== 'ar') return `${kind} · ${item.language.toUpperCase()}`;
      return kind;
    }

    function copyReciterId(id, btn) {
      const markCopied = () => {
        if (!btn) return;
        const previous = btn.textContent;
        btn.textContent = t('copied');
        btn.classList.add('copied');
        setTimeout(() => {
          if (!btn.isConnected) return;
          btn.textContent = previous;
          btn.classList.remove('copied');
        }, 1200);
      };

      const fallbackCopy = () => {
        const field = document.createElement('textarea');
        field.value = id;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.left = '-9999px';
        document.body.appendChild(field);
        field.select();
        const ok = document.execCommand('copy');
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
      const grid = document.getElementById('reciter-grid');
      grid.innerHTML = '';
      list.slice().sort(compareReciters).forEach(r => {
        const card = document.createElement('div');
        const favorite = isFavorite(r.id);
        card.className = `item-card ${r.id === reciter ? 'active' : ''} ${favorite ? 'favorite' : ''}`;
        const fullSurah = r.type === 'surahbysurah';
        card.innerHTML = `
          <div class="item-title-row">
            <button type="button" class="fav-btn ${favorite ? 'active' : ''}" title="${escapeHtml(t('favorite'))}">${favorite ? '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>' : '<svg class="star star-outline" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'}</button>
            <span class="item-title">${escapeHtml(reciterPrimaryName(r))}</span>
          </div>
          <span class="item-sub">${escapeHtml(reciterSecondaryName(r))}</span>
          <span class="item-kind ${fullSurah ? 'full' : ''}">${escapeHtml(editionKindLabel(r))}</span>
          <div class="item-id-row">
            <code class="item-id" title="${escapeHtml(t('copyId', { id: r.id }))}">${escapeHtml(r.id)}</code>
            <button type="button" class="copy-id">${escapeHtml(t('copy'))}</button>
          </div>
        `;
        const copyBtn = card.querySelector('.copy-id');
        const copy = (event) => {
          event.stopPropagation();
          copyReciterId(r.id, copyBtn);
        };
        copyBtn.onclick = copy;
        card.querySelector('.item-id').onclick = copy;
        card.querySelector('.fav-btn').onclick = (event) => {
          event.stopPropagation();
          toggleFavorite(r.id);
        };
        card.onclick = () => {
          const id = safeEditionId(r.id, '');
          if (!id) return;
          reciter = id;
          updateReciterLabel();
          closeModals();
          const currentAyahNum = (!surahData || isBismillah)
            ? startAyah
            : surahData.ayahs[currentAyahIndex].numberInSurah;
          loadSurah(currentSurah, currentAyahNum);
        };
        grid.appendChild(card);
      });
    }

    // --- 6. Surah Data Loader ---
    async function initSurahList() {
      try {
        const res = await fetch('https://api.alquran.cloud/v1/surah');
        const data = await res.json();
        if (!Array.isArray(data.data)) throw new Error('Invalid surah index');
        allSurahs = data.data;
        renderSurahGrid(allSurahs);
      } catch (e) {
        console.error("Could not fetch Surah index", e);
      }
    }

    function renderSurahGrid(list) {
      const grid = document.getElementById('surah-grid');
      grid.innerHTML = '';
      list.forEach(s => {
        const surahNumber = Number(s.number);
        const ayahCount = Number(s.numberOfAyahs);
        if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahCount)) return;
        const card = document.createElement('div');
        card.className = `item-card ${surahNumber === currentSurah ? 'active' : ''}`;
        const primary = language === 'ar' ? s.name : s.englishName;
        const secondary = language === 'ar' ? s.englishName : s.name;
        card.innerHTML = `
          <span class="item-num">#${surahNumber}</span>
          <span class="item-title">${escapeHtml(primary)}</span>
          <span class="item-sub">${escapeHtml(secondary)}</span>
        `;
        if (language === 'ar') {
          const line = document.createElement('div');
          line.className = 'item-title-row';
          const title = card.querySelector('.item-title');
          title.replaceWith(line);
          line.append(title, ayahCountNode(ayahCount));
        } else {
          card.querySelector('.item-sub').textContent = `${secondary} (${ayahCount} ${t('ayahs')})`;
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

    // --- 7. Playback Engine with OnlineQuran Bismillah ---
    async function playBismillah(token = ++loadToken) {
      isBismillah = true;
      refreshPlaybackInfo();

      ayahImg.style.opacity = '0';
      clearTimeout(imageTimer);
      imageTimer = setTimeout(() => {
        ayahImg.onload = () => { ayahImg.style.opacity = '1'; };
        ayahImg.src = BISMILLAH_IMAGE_URL;
      }, 200);

      const edition = safeEditionId(reciter, 'ar.alafasy');
      if (!bismillahAudioCache[edition]) {
        try {
          const res = await fetch(`https://api.alquran.cloud/v1/ayah/1:1/${encodeURIComponent(edition)}`);
          const data = await res.json();
          if (data.code === 200 && data.data && isAllowedMediaUrl(data.data.audio)) {
            bismillahAudioCache[edition] = data.data.audio;
          }
        } catch (err) {
          console.warn('Fallback to standard 128kbps Bismillah audio:', err);
        }
      }
      if (token !== loadToken) return;
      startClip(bismillahAudioCache[edition] || `https://cdn.islamic.network/quran/audio/128/${edition}/1.mp3`);
    }

    async function loadSurah(surahNum, targetAyah = 1) {
      persistSettings();
      const token = ++loadToken;
      const edition = safeEditionId(reciter, 'ar.alafasy');
      playbackNote = '';
      infoBar.textContent = t('loadingSurah', { surah: surahNum });
      try {
        const res = await fetch(`https://api.alquran.cloud/v1/surah/${encodeURIComponent(surahNum)}/${encodeURIComponent(edition)}`);
        const data = await res.json();
        if (token !== loadToken) return;
        if (data.code !== 200) throw new Error("Invalid Surah Response");

        surahData = data.data;
        surahAudioMode = Boolean(
          surahData.audio &&
          surahData.ayahs &&
          surahData.ayahs.length &&
          !surahData.ayahs[0].audio
        );

        // Populate range input limits
        document.getElementById('range-from-input').max = surahData.numberOfAyahs;
        document.getElementById('range-to-input').max = surahData.numberOfAyahs;
        
        let foundIdx = surahData.ayahs.findIndex(a => a.numberInSurah === targetAyah);
        if (foundIdx === -1) {
          foundIdx = targetAyah >= surahData.ayahs.length ? surahData.ayahs.length - 1 : 0;
        }
        currentAyahIndex = foundIdx;

        // Surah editions expose one MP3 for the whole surah, not an audio URL per ayah.
        if (surahAudioMode) {
          playSurahAudio();
        } else if (targetAyah === 1 && currentSurah !== 1 && currentSurah !== 9) {
          await playBismillah(token);
        } else {
          isBismillah = false;
          playAyah(currentAyahIndex);
        }
      } catch (err) {
        if (token !== loadToken) return;
        infoBar.textContent = t('loadFailed', { surah: surahNum });
        stopPlaybackButton();
        console.error(err);
      }
    }

    function showAyahImage(index) {
      if (!surahData || !surahData.ayahs[index]) return;
      const surahNumber = Number(surahData.number);
      const ayahNumber = Number(surahData.ayahs[index].numberInSurah);
      if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber)) return;
      const token = ++imageToken;
      clearTimeout(imageTimer);
      ayahImg.onload = null;
      ayahImg.style.opacity = '0';
      imageTimer = setTimeout(() => {
        if (token !== imageToken) return;
        ayahImg.onload = () => {
          if (token !== imageToken) return;
          ayahImg.style.opacity = '1';
        };
        ayahImg.src = `https://cdn.islamic.network/quran/images/high-resolution/${surahNumber}_${ayahNumber}.png`;
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

    // --- 8. Advance & Repeat Workflow ---
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
        playbackNote = 'surahsDone';
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

      playbackNote = 'done';
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
      // If Bismillah finished, proceed to designated startAyah
      if (isBismillah) {
        isBismillah = false;
        const startIdx = surahData.ayahs.findIndex(a => a.numberInSurah === startAyah);
        currentAyahIndex = startIdx !== -1 ? startIdx : 0;
        playAyah(currentAyahIndex);
        return;
      }

      // One file covers the whole surah, including translations read after the Arabic.
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

    // --- 9. Modal Management & Form Handlers ---
    document.getElementById('btn-open-range').onclick = () => {
      document.getElementById('range-from-input').value = startAyah;
      document.getElementById('range-to-input').value = endAyah || '';
      document.getElementById('modal-range').classList.add('show');
      document.body.classList.add('modal-open');
    };

    document.getElementById('btn-open-repeat').onclick = () => {
      document.getElementById('repeat-input').value = maxRepeatCount;
      document.getElementById('modal-repeat').classList.add('show');
      document.body.classList.add('modal-open');
    };

    function applyAyahRange() {
      const fromVal = parseInt(document.getElementById('range-from-input').value, 10) || 1;
      const toVal = parseInt(document.getElementById('range-to-input').value, 10) || null;

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
      const val = parseInt(document.getElementById('repeat-input').value, 10) || 1;
      maxRepeatCount = Math.min(20, Math.max(1, val));
      currentRepeatCycle = 1;
      updateRepeatUI();
      persistSettings();
      closeModals();
    }

    // --- 10. Control Listeners ---
    function pausePlayback() {
      continuingPlayback = false;
      needsGesture = false;
      try { audio.pause(); } catch (err) { /* already stopped */ }
      updatePlayButton();
    }

    function startPlayback() {
      if (needsGesture || !audio.src) {
        retryBlockedPlayback();
        return;
      }
      continuingPlayback = true;
      updatePlayButton();
      audio.volume = 1;
      const pending = audio.play();
      if (pending && typeof pending.catch === 'function') {
        pending.catch(() => {
          needsGesture = true;
          continuingPlayback = false;
          updatePlayButton();
        });
      }
    }

    function togglePlayback() {
      if (continuingPlayback) pausePlayback();
      else startPlayback();
    }

    btnPlayPause.onclick = togglePlayback;

    // Next Ayah
    document.getElementById('btn-next-ayah').onclick = () => {
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

    // Prev Ayah
    document.getElementById('btn-prev-ayah').onclick = () => {
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

    // Next Surah
    document.getElementById('btn-next-surah').onclick = () => {
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

    // Prev Surah
    document.getElementById('btn-prev-surah').onclick = () => {
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

    // Toggle Background Video
    btnToggleBg.onclick = () => {
      bgVideoEnabled = !bgVideoEnabled;
      applyBackground();
      persistSettings();
    };

    // Toggle Auto Surah Advance
    btnAutoSurah.onclick = () => {
      autoNextSurah = !autoNextSurah;
      updateAutoButton();
      persistSettings();
    };

    btnLoop.onclick = () => {
      loopEnabled = !loopEnabled;
      updateLoopButton();
      persistSettings();
    };

    function updateRemoteSkipUI() {
      const ayahBtn = document.getElementById('btn-remote-ayah');
      const surahBtn = document.getElementById('btn-remote-surah');
      if (ayahBtn) ayahBtn.classList.toggle('active', remoteSkip !== 'surah');
      if (surahBtn) surahBtn.classList.toggle('active', remoteSkip === 'surah');
    }

    function skipFromRemote(direction) {
      const surahStep = remoteSkip === 'surah';
      const id = direction === 'next'
        ? (surahStep ? 'btn-next-surah' : 'btn-next-ayah')
        : (surahStep ? 'btn-prev-surah' : 'btn-prev-ayah');
      const button = document.getElementById(id);
      if (button) button.click();
    }

    document.getElementById('btn-remote-ayah').onclick = () => {
      remoteSkip = 'ayah';
      updateRemoteSkipUI();
      persistSettings();
    };

    document.getElementById('btn-remote-surah').onclick = () => {
      remoteSkip = 'surah';
      updateRemoteSkipUI();
      persistSettings();
    };

    document.getElementById('btn-language').onclick = () => {
      language = language === 'en' ? 'ar' : 'en';
      persistSettings();
      applyLanguage();
    };

    // Modals
    document.getElementById('btn-open-surahs').onclick = () => {
      const search = document.getElementById('search-surah');
      if (allSurahs.length) search.dispatchEvent(new Event('input'));
      document.getElementById('modal-surah').classList.add('show');
      document.body.classList.add('modal-open');
    };

    document.getElementById('btn-open-settings').onclick = async () => {
      document.getElementById('cache-days-input').value = cacheExpiryDays;
      document.getElementById('cache-status').textContent = t('cacheCounting');
      document.getElementById('modal-settings').classList.add('show');
      document.body.classList.add('modal-open');
      document.getElementById('cache-status').textContent = await cacheStatusText();
    };

    document.getElementById('btn-apply-cache').onclick = async () => {
      cacheExpiryDays = clampCacheDays(document.getElementById('cache-days-input').value, cacheExpiryDays);
      document.getElementById('cache-days-input').value = cacheExpiryDays;
      await syncCacheSettings();
      document.getElementById('cache-status').textContent = `${t('cacheSaved')} ${await cacheStatusText()}`;
    };

    document.getElementById('btn-clear-cache').onclick = async () => {
      const button = document.getElementById('btn-clear-cache');
      button.disabled = true;
      await clearStoredMedia();
      button.disabled = false;
      document.getElementById('cache-status').textContent = `${t('cacheCleared')} ${await cacheStatusText()}`;
    };

    document.getElementById('btn-reset-settings').onclick = async () => {
      language = 'en';
      favoriteReciters = [];
      cacheExpiryDays = 7;
      currentSurah = 1;
      startAyah = 1;
      endAyah = null;
      reciter = 'ar.alafasy';
      currentSpeed = 1;
      rememberedSpeed = 1;
      maxRepeatCount = 1;
      currentRepeatCycle = 1;
      autoNextSurah = false;
      loopEnabled = false;
      bgVideoEnabled = false;
      remoteSkip = 'ayah';
      originSurah = 1;
      originStartAyah = 1;
      originEndAyah = null;
      document.getElementById('cache-days-input').value = cacheExpiryDays;
      updateSpeedUI();
      updateRepeatUI();
      updateRangeUI();
      updateAutoButton();
      updateLoopButton();
      updateRemoteSkipUI();
      applyBackground();
      updateReciterLabel();
      await syncCacheSettings();
      applyLanguage();
      loadSurah(currentSurah, startAyah);
      document.getElementById('cache-status').textContent = `${t('settingsReset')} ${await cacheStatusText()}`;
    };

    document.getElementById('btn-open-reciters').onclick = () => {
      const search = document.getElementById('search-reciter');
      search.value = '';
      renderReciterGrid(recitersList);
      document.getElementById('modal-reciter').classList.add('show');
      document.body.classList.add('modal-open');
    };

    function closeModals() {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
      document.body.classList.remove('modal-open');
    }

    // Modal Search Filters
    document.getElementById('search-surah').oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = allSurahs.filter(s =>
        String(s.number).includes(q) ||
        String(s.name || '').includes(q) ||
        String(s.englishName || '').toLowerCase().includes(q)
      );
      renderSurahGrid(filtered);
    };

    document.getElementById('search-reciter').oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = recitersList.filter(r =>
        String(r.name || '').toLowerCase().includes(q) ||
        String(r.english || '').toLowerCase().includes(q) ||
        String(r.id || '').toLowerCase().includes(q)
      );
      renderReciterGrid(filtered);
    };

    // Auto-hide controls when idle
    let idleTimer;
    function resetIdle() {
      document.body.classList.remove('idle');
      clearTimeout(idleTimer);
      if (!document.body.classList.contains('modal-open')) {
        idleTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
      }
    }
    window.onmousemove = resetIdle;
    window.onclick = resetIdle;
    window.addEventListener('click', retryBlockedPlayback);

    let lastTransportAt = 0;
    function acceptTransport() {
      const now = Date.now();
      if (now - lastTransportAt < 350) return false;
      lastTransportAt = now;
      return true;
    }

    function handleTransportKey(event) {
      const action = mediaKeyAction(event);
      if (!action) return false;
      event.preventDefault();
      if (!acceptTransport()) return true;
      if (action === 'pause') {
        if (continuingPlayback) pausePlayback();
      } else if (action === 'play') {
        if (!continuingPlayback) startPlayback();
      } else if (action === 'next' || action === 'prev') {
        skipFromRemote(action);
      } else {
        togglePlayback();
      }
      return true;
    }

    function registerTvMediaKeys() {
      try {
        const device = window.tizen && window.tizen.tvinputdevice;
        if (!device || !device.registerKey) return;
        ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaTrackNext', 'MediaTrackPrevious', 'Back'].forEach((name) => {
          try { device.registerKey(name); } catch (err) { /* the key is already registered */ }
        });
      } catch (err) {
        console.warn('TV media keys were not registered', err);
      }
    }

    function bindMediaSession() {
      const session = navigator.mediaSession;
      if (!session || !session.setActionHandler) return;
      const bind = (name, fn) => {
        try { session.setActionHandler(name, fn); } catch (err) { /* this action is unsupported */ }
      };
      bind('play', () => {
        if (continuingPlayback || !acceptTransport()) return;
        startPlayback();
      });
      bind('pause', () => {
        if (!continuingPlayback || !acceptTransport()) return;
        pausePlayback();
      });
      bind('nexttrack', () => {
        if (!acceptTransport()) return;
        skipFromRemote('next');
      });
      bind('previoustrack', () => {
        if (!acceptTransport()) return;
        skipFromRemote('prev');
      });
    }

    registerTvMediaKeys();
    bindMediaSession();
    window.addEventListener('keydown', (event) => {
      if (overlayBackKey(event)) {
        if (document.body.classList.contains('modal-open')) {
          event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          closeModals();
        }
        return;
      }
      if (handleTransportKey(event)) return;
      retryBlockedPlayback(event);
    });

    // --- 11. Initial Launch ---
    (async function init() {
      applyLanguage();
      updateRemoteSkipUI();
      updateSpeedUI();
      updateRepeatUI();
      updateRangeUI();
      await registerMediaWorker();
      await syncCacheSettings();
      const bismillahPreload = new Image();
      bismillahPreload.src = BISMILLAH_IMAGE_URL;
      await loadRecitersWithCache();
      initSurahList();
      loadSurah(currentSurah, startAyah);
    })();
