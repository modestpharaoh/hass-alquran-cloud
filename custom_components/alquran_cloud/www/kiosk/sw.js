importScripts('js/kiosk-lib.js');

const MEDIA_CACHE = 'quran-kiosk-media-v1';
const STATIC_CACHE = 'quran-kiosk-static-v1';
const BISMILLAH_IMAGE = '/assets/bismillah.png';
const DB_NAME = 'quran-kiosk';
const DB_VERSION = 1;
const META_STORE = 'meta';
const SETTINGS_KEY = 'settings';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const inflight = new Map();
const localBodies = new Map();
const BACKGROUND_VIDEO = '/assets/landscape-tree-clouds.mp4';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.add(new URL(BISMILLAH_IMAGE, self.location.href).href))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url.split('#')[0];
  if (isSameOriginAsset(url, self.location.origin, BISMILLAH_IMAGE)) {
    event.respondWith(handleStatic(event.request, url));
    return;
  }
  if (isSameOriginAsset(url, self.location.origin, BACKGROUND_VIDEO)) {
    event.respondWith(handleLocalVideo(event.request, url));
    return;
  }
  if (!isCachedMedia(url)) return;
  event.respondWith(handleMedia(url));
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'CLEAR_MEDIA') return;
  event.waitUntil(clearMediaCache());
});

async function handleStatic(request, url) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) await cache.put(url, fresh.clone());
  return fresh;
}

async function loadLocalVideo(url) {
  if (localBodies.has(url)) return localBodies.get(url);
  const hit = await readFresh(url);
  if (hit) {
    const body = await hit.arrayBuffer();
    localBodies.set(url, body);
    return body;
  }
  const fresh = await fetch(url, { cache: 'reload' });
  if (!fresh.ok) throw new Error('Background video failed');
  const body = await fresh.arrayBuffer();
  localBodies.set(url, body);
  await storeResponse(url, new Response(body.slice(0), {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(body.byteLength)
    }
  }));
  return body;
}

async function handleLocalVideo(request, url) {
  try {
    if (await expiryMs() <= 0) return fetch(request);
    let task = inflight.get(url);
    if (!task) {
      task = loadLocalVideo(url).finally(() => inflight.delete(url));
      inflight.set(url, task);
    }
    const body = await task;
    return videoResponse(body, request.headers.get('range'));
  } catch (err) {
    console.warn('Background video cache failed', err);
    return fetch(request);
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const request = tx.objectStore(META_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function idbSet(key, value) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDelete(key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbMediaEntries() {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const entries = [];
    const request = tx.objectStore(META_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      if (String(cursor.key).startsWith('media:')) {
        entries.push({ key: cursor.key, value: cursor.value });
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }));
}

async function expiryMs() {
  try {
    const settings = await idbGet(SETTINGS_KEY);
    const days = settings && Number(settings.cacheExpiryDays);
    if (!Number.isFinite(days)) return DEFAULT_DAYS * DAY_MS;
    if (days <= 0) return 0;
    return Math.min(365, days) * DAY_MS;
  } catch (err) {
    return DEFAULT_DAYS * DAY_MS;
  }
}

async function withinBudget() {
  if (!navigator.storage || !navigator.storage.estimate) return true;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  if (!quota) return true;
  const budget = Math.min(quota * 0.2, 2 * 1024 * 1024 * 1024);
  return usage + (8 * 1024 * 1024) < budget;
}

async function evictOldest() {
  const entries = await idbMediaEntries();
  entries.sort((a, b) => (a.value?.savedAt || 0) - (b.value?.savedAt || 0));
  const oldest = entries[0];
  if (!oldest) return false;
  const url = oldest.key.slice('media:'.length);
  const cache = await caches.open(MEDIA_CACHE);
  await cache.delete(url);
  await idbDelete(oldest.key);
  return true;
}

async function makeRoom() {
  for (let i = 0; i < 40; i++) {
    if (await withinBudget()) return;
    const removed = await evictOldest();
    if (!removed) return;
  }
}

async function readFresh(url) {
  const ttl = await expiryMs();
  if (ttl <= 0) return null;
  const meta = await idbGet('media:' + url);
  const cache = await caches.open(MEDIA_CACHE);
  if (!meta || !meta.savedAt || Date.now() - meta.savedAt >= ttl) {
    if (meta) {
      await cache.delete(url);
      await idbDelete('media:' + url);
    }
    return null;
  }
  return cache.match(url);
}

async function storeResponse(url, response) {
  const ttl = await expiryMs();
  if (ttl <= 0) return;
  if (!(response.type === 'opaque' || response.ok)) return;
  const copy = response.clone();
  try {
    await makeRoom();
    const cache = await caches.open(MEDIA_CACHE);
    await cache.put(url, copy);
    await idbSet('media:' + url, { savedAt: Date.now() });
  } catch (err) {
    console.warn('Unable to store media', url, err);
  }
}

async function fillAndServe(url) {
  const fresh = await fetch(url, { mode: 'no-cors', cache: 'reload' });
  await storeResponse(url, fresh);
  return fresh;
}

async function handleMedia(url) {
  try {
    const hit = await readFresh(url);
    if (hit) return hit;

    let task = inflight.get(url);
    if (!task) {
      task = fillAndServe(url).finally(() => inflight.delete(url));
      inflight.set(url, task);
      return await task;
    }

    await task;
    const after = await readFresh(url);
    if (after) return after;
    return fetch(url);
  } catch (err) {
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const fallback = await cache.match(url);
      if (fallback) return fallback;
    } catch (inner) {
      console.warn('Media cache read failed', inner);
    }
    return fetch(url);
  }
}

async function clearMediaCache() {
  localBodies.clear();
  await caches.delete(MEDIA_CACHE);
  const entries = await idbMediaEntries();
  await Promise.all(entries.map((entry) => idbDelete(entry.key)));
}
