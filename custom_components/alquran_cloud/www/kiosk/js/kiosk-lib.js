// Shared checks for the page and the service worker. No DOM.

function safeEditionId(value, fallback = '') {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : fallback;
}

function isAllowedMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.islamic.network';
  } catch (err) {
    return false;
  }
}

function sanitizeReciter(item) {
  if (!item || typeof item !== 'object') return null;
  const id = safeEditionId(item.id || item.identifier, '');
  if (!id) return null;
  const text = (value) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 180);
  const languageCode = String(item.language || '').toLowerCase();
  return {
    id,
    name: text(item.name),
    english: text(item.english || item.englishName),
    type: ['versebyverse', 'surahbysurah', 'translation'].includes(item.type) ? item.type : '',
    language: /^[a-z]{2,8}$/.test(languageCode) ? languageCode : ''
  };
}

function clampCacheDays(value, fallback = 7) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) return fallback;
  return Math.min(365, Math.max(0, days));
}

function boundedQueryInt(params, name, fallback, min, max) {
  if (!params.has(name) || params.get(name) === '') return fallback;
  const value = parseInt(params.get(name), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function languageFromSearch(params) {
  const raw = (params.get('language') || params.get('lang') || '').trim().toLowerCase();
  if (raw === 'en' || raw === 'ar') return raw;
  return null;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function clampStoredInt(value, fallback, min, max) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function matchedSpeed(value) {
  const number = Number(value);
  for (let i = 0; i < PLAYBACK_SPEEDS.length; i++) {
    if (Math.abs(PLAYBACK_SPEEDS[i] - number) < 1e-6) return PLAYBACK_SPEEDS[i];
  }
  return null;
}

function playbackFromStored(stored) {
  const source = stored && typeof stored === 'object' ? stored : {};
  const toRaw = source.toAyah;
  const toAyah = toRaw == null || toRaw === '' ? null : clampStoredInt(toRaw, null, 1, 286);
  return {
    surah: clampStoredInt(source.surah, 1, 1, 114),
    ayah: clampStoredInt(source.ayah, 1, 1, 286),
    toAyah,
    reciter: safeEditionId(source.reciter, 'ar.alafasy'),
    speed: matchedSpeed(source.speed) || 1,
    repeat: clampStoredInt(source.repeat, 1, 1, 20),
    autoSurah: source.autoSurah === true,
    loop: source.loop === true,
    background: source.background === true
  };
}

function queryFlag(params, name, fallback) {
  if (!params || !params.has(name)) return fallback;
  return params.get(name) === 'true';
}

function resolvePlayback(params, stored, legacyTv) {
  const saved = playbackFromStored(stored);
  const surah = boundedQueryInt(params, 'surah', saved.surah, 1, 114);
  const ayah = boundedQueryInt(params, 'ayah', saved.ayah, 1, 286);
  let toAyah = saved.toAyah;
  if (params.has('to_ayah')) toAyah = boundedQueryInt(params, 'to_ayah', null, 1, 286);
  else if (params.has('surah') || params.has('ayah')) toAyah = null;
  if (toAyah != null && toAyah < ayah) toAyah = null;
  const requested = params.has('speed') ? matchedSpeed(params.get('speed')) : null;
  const rememberedSpeed = requested || saved.speed;
  return {
    surah,
    ayah,
    toAyah,
    reciter: params.has('reciter') ? safeEditionId(params.get('reciter'), saved.reciter) : saved.reciter,
    speed: legacyTv ? 1 : rememberedSpeed,
    rememberedSpeed,
    repeat: boundedQueryInt(params, 'repeat', saved.repeat, 1, 20),
    autoSurah: queryFlag(params, 'auto_surah', saved.autoSurah),
    loop: queryFlag(params, 'loop', saved.loop),
    background: queryFlag(params, 'background_video', saved.background)
  };
}

function mediaKeyAction(event) {
  if (!event || event.repeat) return '';
  const target = event.target;
  const tag = target && target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
  const key = event.key || '';
  const code = Number(event.keyCode || event.which || 0);
  const space = key === ' ' || key === 'Spacebar' || code === 32;
  if (typing && space) return '';
  if (space || key === 'MediaPlayPause' || key === 'MediaPlay' || code === 179 || code === 415 || code === 10252) {
    return 'toggle';
  }
  if (key === 'MediaPause' || key === 'MediaStop' || code === 19 || code === 127 || code === 413) return 'pause';
  if (code === 126) return 'play';
  if (key === 'MediaTrackNext' || code === 176 || code === 10233) return 'next';
  if (key === 'MediaTrackPrevious' || code === 177 || code === 10232) return 'prev';
  return '';
}

function compareReciterItems(a, b, favorites, language) {
  const favorite = (id) => Array.isArray(favorites) && favorites.includes(id);
  const arabicAyah = (item) => item.language === 'ar' && item.type !== 'surahbysurah';
  const primary = (item) => (
    language === 'ar' ? (item.name || item.english || '') : (item.english || item.name || '')
  );
  const favoriteOrder = Number(favorite(b.id)) - Number(favorite(a.id));
  if (favoriteOrder) return favoriteOrder;
  const ayahOrder = Number(arabicAyah(b)) - Number(arabicAyah(a));
  if (ayahOrder) return ayahOrder;
  const locale = language === 'ar' ? 'ar' : 'en';
  return primary(a).localeCompare(primary(b), locale, { sensitivity: 'base' });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function isCachedMedia(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    return false;
  }
  return url.hostname === 'cdn.islamic.network' &&
    (url.pathname.includes('/quran/audio') || url.pathname.includes('/quran/images'));
}

function isSameOriginAsset(raw, origin, suffix) {
  try {
    const url = new URL(raw);
    return url.origin === origin && url.pathname.endsWith(suffix);
  } catch (err) {
    return false;
  }
}

function resolveAssetUrl(baseHref, relative) {
  let base;
  try {
    base = new URL(baseHref, 'http://kiosk.local/');
  } catch (err) {
    base = new URL('http://kiosk.local/');
  }
  const last = base.pathname.split('/').pop();
  if (!base.pathname.endsWith('/') && last && !last.includes('.')) {
    base.pathname += '/';
  }
  return new URL(String(relative ?? '').replace(/^\/+/, ''), base).href;
}

function videoResponse(buffer, range) {
  const size = buffer.byteLength;
  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes'
  };
  if (!range) {
    headers['Content-Length'] = String(size);
    return new Response(buffer.slice(0), { status: 200, headers });
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  if (!match) {
    headers['Content-Length'] = String(size);
    return new Response(buffer.slice(0), { status: 200, headers });
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (!Number.isFinite(start) || start < 0 || start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    });
  }
  const slice = buffer.slice(start, end + 1);
  headers['Content-Length'] = String(slice.byteLength);
  headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(slice, { status: 206, statusText: 'Partial Content', headers });
}

const kioskLib = {
  safeEditionId,
  isAllowedMediaUrl,
  sanitizeReciter,
  clampCacheDays,
  boundedQueryInt,
  languageFromSearch,
  resolvePlayback,
  mediaKeyAction,
  compareReciterItems,
  escapeHtml,
  isCachedMedia,
  isSameOriginAsset,
  resolveAssetUrl,
  videoResponse
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = kioskLib;
}
