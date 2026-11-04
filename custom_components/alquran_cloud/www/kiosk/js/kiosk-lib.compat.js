function safeEditionId(value, fallback = "") {
  const id = String(value != null ? value : "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : fallback;
}
function isAllowedMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.islamic.network";
  } catch (err) {
    return false;
  }
}
function sanitizeReciter(item) {
  if (!item || typeof item !== "object") return null;
  const id = safeEditionId(item.id || item.identifier, "");
  if (!id) return null;
  const text = (value) => String(value != null ? value : "").replace(/[\u0000-\u001f]/g, "").slice(0, 180);
  const languageCode = String(item.language || "").toLowerCase();
  return {
    id,
    name: text(item.name),
    english: text(item.english || item.englishName),
    type: ["versebyverse", "surahbysurah", "translation"].includes(item.type) ? item.type : "",
    language: /^[a-z]{2,8}$/.test(languageCode) ? languageCode : ""
  };
}
function clampCacheDays(value, fallback = 7) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) return fallback;
  return Math.min(365, Math.max(0, days));
}
function boundedQueryInt(params, name, fallback, min, max) {
  if (!params.has(name) || params.get(name) === "") return fallback;
  const value = parseInt(params.get(name), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function languageFromSearch(params) {
  const raw = (params.get("language") || params.get("lang") || "").trim().toLowerCase();
  if (raw === "en" || raw === "ar") return raw;
  return null;
}
function compareReciterItems(a, b, favorites, language) {
  const favorite = (id) => Array.isArray(favorites) && favorites.includes(id);
  const arabicAyah = (item) => item.language === "ar" && item.type !== "surahbysurah";
  const primary = (item) => language === "ar" ? item.name || item.english || "" : item.english || item.name || "";
  const favoriteOrder = Number(favorite(b.id)) - Number(favorite(a.id));
  if (favoriteOrder) return favoriteOrder;
  const ayahOrder = Number(arabicAyah(b)) - Number(arabicAyah(a));
  if (ayahOrder) return ayahOrder;
  const locale = language === "ar" ? "ar" : "en";
  return primary(a).localeCompare(primary(b), locale, { sensitivity: "base" });
}
function escapeHtml(value) {
  return String(value != null ? value : "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}
function isCachedMedia(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    return false;
  }
  return url.hostname === "cdn.islamic.network" && (url.pathname.includes("/quran/audio") || url.pathname.includes("/quran/images"));
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
    base = new URL(baseHref, "http://kiosk.local/");
  } catch (err) {
    base = new URL("http://kiosk.local/");
  }
  const last = base.pathname.split("/").pop();
  if (!base.pathname.endsWith("/") && last && !last.includes(".")) {
    base.pathname += "/";
  }
  return new URL(String(relative != null ? relative : "").replace(/^\/+/, ""), base).href;
}
function videoResponse(buffer, range) {
  const size = buffer.byteLength;
  const headers = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes"
  };
  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(buffer.slice(0), { status: 200, headers });
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  if (!match) {
    headers["Content-Length"] = String(size);
    return new Response(buffer.slice(0), { status: 200, headers });
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (!Number.isFinite(start) || start < 0 || start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": "bytes */".concat(size) }
    });
  }
  const slice = buffer.slice(start, end + 1);
  headers["Content-Length"] = String(slice.byteLength);
  headers["Content-Range"] = "bytes ".concat(start, "-").concat(end, "/").concat(size);
  return new Response(slice, { status: 206, statusText: "Partial Content", headers });
}
const kioskLib = {
  safeEditionId,
  isAllowedMediaUrl,
  sanitizeReciter,
  clampCacheDays,
  boundedQueryInt,
  languageFromSearch,
  compareReciterItems,
  escapeHtml,
  isCachedMedia,
  isSameOriginAsset,
  resolveAssetUrl,
  videoResponse
};
if (typeof module !== "undefined" && module.exports) {
  module.exports = kioskLib;
}
