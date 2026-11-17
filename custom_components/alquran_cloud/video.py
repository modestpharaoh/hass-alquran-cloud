"""Join ayah MP3s into one cached file and publish it over HTTPS."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import partial
import logging
import os
from pathlib import Path
import secrets
import shutil
import threading
import time
from typing import Any, Awaitable, Callable

from aiohttp import ClientError, ClientSession, ClientTimeout, web

from .const import (
    DEFAULT_CACHE_DAYS,
    DOMAIN,
    ayah_audio_url,
    ayah_image_url,
    coerce_speed,
)

_LOGGER = logging.getLogger(__name__)
_TIMEOUT = ClientTimeout(total=120)
_FFMPEG_TIMEOUT = 600.0
_FFPROBE_TIMEOUT = 60.0
_PART_MAX_AGE = 86400.0

Download = Callable[[str, Path], Awaitable[None]]
Runner = Callable[[list[str]], Awaitable[None]]


class LocalMediaError(Exception):
    """Raised when a local audio or video file cannot be prepared."""


@dataclass(slots=True)
class PreparedMedia:
    """One file ready to send to a media player."""

    url: str
    content_type: str
    title: str
    artist: str
    marker: str
    image_url: str
    webos: bool = False
    duration: float | None = None
    album: str = ""
    comment: str = ""
    seek: float | None = None
    spans: tuple[tuple[int, float, float], ...] = ()


class MediaStore:
    """Cache transcoded files and map unguessable tokens to them."""

    def __init__(self, hass: Any) -> None:
        """Initialize the cache directory from the HA config path."""
        config = getattr(hass, "config", None)
        path_fn = getattr(config, "path", None)
        if path_fn is not None:
            self.cache_dir = Path(path_fn(".cache", "alquran_cloud"))
        else:
            self.cache_dir = Path("/tmp/alquran_cloud")
        self._tokens: dict[str, Path] = {}
        self._token_lock = threading.Lock()
        self._locks: dict[str, asyncio.Lock] = {}

    def purge_expired(self, days: int, now: float | None = None) -> None:
        """Delete cached media older than the configured number of days."""
        if not self.cache_dir.is_dir():
            return
        moment = time.time() if now is None else now
        limit = max(1, int(days)) * 86400
        for path in self.cache_dir.rglob("*"):
            if not path.is_file():
                continue
            try:
                age = moment - path.stat().st_mtime
            except OSError:
                continue
            if ".part" in path.name:
                if age > _PART_MAX_AGE:
                    path.unlink(missing_ok=True)
                continue
            if age > limit:
                path.unlink(missing_ok=True)

    def lock_for(self, key: str) -> asyncio.Lock:
        """Return a lock so one ayah is transcoded once."""
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    def publish(self, path: Path) -> str:
        """Return a token that serves this file."""
        with self._token_lock:
            for token, existing in self._tokens.items():
                if existing == path:
                    return token
            token = secrets.token_urlsafe(24)
            self._tokens[token] = path
            return token

    def resolve(self, token: str) -> Path | None:
        """Return the file for a token."""
        with self._token_lock:
            path = self._tokens.get(token)
        if path is None or not path.is_file():
            return None
        return path

    def prune_idle_locks(self) -> None:
        """Drop build locks that nothing is waiting on."""
        self._locks = {key: lock for key, lock in self._locks.items() if lock.locked()}

    def clear(self, kind: str = "all") -> int:
        """Delete cached files and return how many files were removed."""
        if kind == "video":
            return self.clear_video()
        folders = {
            "all": None,
            "audio": ("audio",),
            "sources": ("src", "work"),
        }
        if kind not in folders:
            raise LocalMediaError(f"Unknown cache: {kind}")
        if not self.cache_dir.is_dir():
            return 0
        names = folders[kind]
        roots = [self.cache_dir] if names is None else [self.cache_dir / name for name in names]
        removed = 0
        for root in roots:
            if not root.exists():
                continue
            targets = list(root.iterdir()) if names is None else [root]
            for target in targets:
                removed += _remove_tree(target)
        self._forget_missing_tokens()
        return removed

    def clear_video(self) -> int:
        """Delete leftover surah videos and downloaded ayah pictures."""
        if not self.cache_dir.is_dir():
            return 0
        removed = 0
        surah = self.cache_dir / "surah"
        if surah.exists():
            removed += _remove_tree(surah)
        src = self.cache_dir / "src"
        if src.is_dir():
            for path in list(src.rglob("*")):
                if path.is_file() and path.suffix.lower() == ".png":
                    path.unlink(missing_ok=True)
                    removed += 1
            for path in sorted(
                (path for path in src.rglob("*") if path.is_dir() and path.name in {"low", "high"}),
                reverse=True,
            ):
                try:
                    path.rmdir()
                except OSError:
                    continue
        self._forget_missing_tokens()
        return removed

    def forget_missing_tokens(self) -> None:
        """Drop tokens whose files are gone. Safe to call from an executor."""
        self._forget_missing_tokens()

    def _forget_missing_tokens(self) -> None:
        with self._token_lock:
            snapshot = list(self._tokens.items())
        stale = [token for token, path in snapshot if not path.is_file()]
        if not stale:
            return
        with self._token_lock:
            for token in stale:
                path = self._tokens.get(token)
                if path is not None and not path.is_file():
                    self._tokens.pop(token, None)


def resolve_https_base(get_url: Callable[..., str], unavailable: type[Exception]) -> str:
    """Return Home Assistant's HTTPS base URL, internal first."""
    attempts = (
        {"prefer_external": False, "allow_external": False, "require_ssl": True},
        {"prefer_external": True, "allow_internal": True, "require_ssl": True},
    )
    last_error: Exception | None = None
    for kwargs in attempts:
        try:
            url = str(get_url(**kwargs)).rstrip("/")
        except unavailable as err:
            last_error = err
            continue
        if url.startswith("https://"):
            return url
    raise LocalMediaError(
        "Home Assistant has no HTTPS URL. Set one under Settings > System > Network."
    ) from last_error


def https_base(hass: Any) -> str:
    """Return the configured HTTPS URL for this Home Assistant."""
    from homeassistant.helpers.network import NoURLAvailableError, get_url

    return resolve_https_base(
        lambda **kwargs: get_url(hass, **kwargs),
        NoURLAvailableError,
    )


def public_media_url(hass: Any, store: MediaStore, path: Path) -> str:
    """Return an unauthenticated HTTPS URL for a cached file."""
    token = store.publish(path)
    return f"{https_base(hass)}/api/alquran_cloud/media/{token}/{path.name}"


def ffmpeg_joined_audio_command(ffmpeg: str, audio: Path, dest: Path, speed: float) -> list[str]:
    """Encode joined PCM as one MP3, applying speed only when it is not 1."""
    command = [ffmpeg, "-nostdin", "-y", "-i", str(audio)]
    speed = coerce_speed(speed)
    if speed != 1:
        command += ["-filter:a", f"atempo={speed}"]
    command += ["-vn", "-c:a", "libmp3lame", "-q:a", "2", str(dest)]
    return command


def _speed_tag(speed: float) -> str:
    return str(int(round(coerce_speed(speed) * 100)))


def partial_path(dest: Path) -> Path:
    """Return a temp path that still ends in the format ffmpeg expects."""
    return dest.with_name(f"{dest.stem}.part{dest.suffix}")


def _remove_tree(path: Path) -> int:
    """Delete a file or directory and return the number of files removed."""
    if path.is_file() or path.is_symlink():
        path.unlink(missing_ok=True)
        return 1
    if not path.is_dir():
        return 0
    children = list(path.rglob("*"))
    removed = 0
    for child in children:
        if child.is_file() or child.is_symlink():
            child.unlink(missing_ok=True)
            removed += 1
    for child in sorted((child for child in children if child.is_dir()), reverse=True):
        child.rmdir()
    path.rmdir()
    return removed


_ffmpeg_bin: str | None = None
_ffprobe_bin: str | None = None
_ffmpeg_known = False
_ffprobe_known = False


async def _binary(name: str) -> str | None:
    """Find ffmpeg or ffprobe once, off the event loop."""
    global _ffmpeg_bin, _ffprobe_bin, _ffmpeg_known, _ffprobe_known
    if name == "ffmpeg":
        if not _ffmpeg_known:
            _ffmpeg_bin = await _blocking(shutil.which, "ffmpeg")
            _ffmpeg_known = True
        return _ffmpeg_bin
    if not _ffprobe_known:
        _ffprobe_bin = await _blocking(shutil.which, "ffprobe")
        _ffprobe_known = True
    return _ffprobe_bin


async def _blocking(func: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Any:
    """Run one filesystem call off the event loop."""
    if kwargs:
        func = partial(func, *args, **kwargs)
        args = ()
    return await asyncio.get_running_loop().run_in_executor(None, func, *args)


async def _communicate(
    process: asyncio.subprocess.Process,
    timeout: float,
) -> tuple[bytes, bytes]:
    """Wait for a process, and kill it when the wait is cancelled or times out."""
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except (TimeoutError, asyncio.CancelledError):
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
        raise
    return stdout, stderr


def _nonempty_file(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def _unlink_all(paths: list[Path]) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


def _pcm_is_current(wav: Path, mp3: Path) -> bool:
    return wav.is_file() and wav.stat().st_mtime >= mp3.stat().st_mtime


async def _run_command(command: list[str]) -> None:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _stdout, stderr = await _communicate(process, _FFMPEG_TIMEOUT)
    except TimeoutError as err:
        raise LocalMediaError("ffmpeg timed out") from err
    if process.returncode != 0:
        detail = (stderr or b"").decode("utf-8", errors="replace")[-500:]
        raise LocalMediaError(f"ffmpeg failed: {detail}")


async def _download(session: ClientSession, url: str, dest: Path) -> None:
    if await _blocking(_nonempty_file, dest):
        return
    await _blocking(dest.parent.mkdir, parents=True, exist_ok=True)
    temporary = partial_path(dest)
    try:
        async with session.get(url, timeout=_TIMEOUT) as response:
            response.raise_for_status()
            payload = await response.read()
            await _blocking(temporary.write_bytes, payload)
        await _blocking(temporary.replace, dest)
    except (ClientError, TimeoutError, OSError) as err:
        temporary.unlink(missing_ok=True)
        raise LocalMediaError(f"Could not download {url}: {err}") from err


async def probe_duration(path: Path) -> float | None:
    """Return the media duration in seconds, if ffprobe can read it."""
    ffprobe = await _binary("ffprobe")
    if ffprobe is None:
        return None
    process = await asyncio.create_subprocess_exec(
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await _communicate(process, _FFPROBE_TIMEOUT)
    except TimeoutError:
        _LOGGER.warning("ffprobe timed out reading %s", path)
        return None
    if process.returncode != 0:
        detail = (stderr or b"").decode("utf-8", errors="replace").strip()
        _LOGGER.warning("ffprobe could not read %s: %s", path, detail[-300:])
        return None
    try:
        duration = float(stdout.decode().strip())
    except ValueError:
        return None
    return duration if duration > 0 else None


MUSHAF_EN = "Madinah Mushaf"
MUSHAF_AR = "مصحف المدينة"


@dataclass(slots=True)
class AyahCue:
    """One ayah's place on the surah timeline, in seconds."""

    ayah: int
    start: float
    end: float


@dataclass(slots=True)
class SurahTags:
    """English and Arabic names stored with a joined range."""

    title: str
    artist: str
    album: str
    comment: str


def surah_tags(reciter: Any, chapter: Any) -> SurahTags:
    """Build the bilingual title, reciter, mushaf, and surah info."""
    artist = " · ".join(part for part in (reciter.name_en, reciter.name_ar) if part)
    return SurahTags(
        title=chapter.display_title("english"),
        artist=artist,
        album=f"{MUSHAF_EN} · {MUSHAF_AR}",
        comment=chapter.display_title("arabic"),
    )


def cues_from_durations(durations: list[tuple[int, float]]) -> list[AyahCue]:
    """Stack ayah durations back to back with no inserted silence."""
    cues: list[AyahCue] = []
    start = 0.0
    for ayah, duration in durations:
        if duration <= 0:
            raise LocalMediaError(f"Ayah {ayah} has no audio duration")
        end = start + duration
        cues.append(AyahCue(ayah, start, end))
        start = end
    return cues


def _concat_line(path: Path) -> str:
    text = str(path).replace("'", "'\\''")
    return f"file '{text}'"


def audio_concat_script(paths: list[Path]) -> str:
    """Return an ffconcat list of PCM files."""
    if not paths:
        raise LocalMediaError("A joined range needs at least one ayah")
    return "ffconcat version 1.0\n" + "\n".join(_concat_line(path) for path in paths) + "\n"


def ffmpeg_pcm_command(ffmpeg: str, source: Path, dest: Path) -> list[str]:
    """Decode one MP3 to PCM so the join has no encoder padding."""
    return [
        ffmpeg,
        "-nostdin",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "44100",
        "-ac",
        "2",
        str(dest),
    ]


def ffmpeg_concat_copy_command(ffmpeg: str, playlist: Path, dest: Path) -> list[str]:
    """Join PCM files without re-encoding."""
    return [
        ffmpeg,
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(playlist),
        "-c",
        "copy",
        str(dest),
    ]



def cache_is_fresh(path: Path, days: int, now: float | None = None) -> bool:
    """Return True when a cached file is still inside the configured lifetime."""
    if not path.is_file() or path.stat().st_size <= 0:
        return False
    moment = time.time() if now is None else now
    return moment - path.stat().st_mtime <= max(1, int(days)) * 86400


def mark_used(path: Path) -> None:
    """Refresh a cache file's age because it was just played."""
    now = time.time()
    os.utime(path, (now, now))


def _safe_edition(edition: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "._-" else "_" for char in edition)
    return cleaned or "reciter"


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _load_cues(path: Path) -> list[AyahCue]:
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    return [
        AyahCue(int(item["ayah"]), float(item["start"]), float(item["end"]))
        for item in data.get("cues") or []
    ]


def _write_sidecar(path: Path, tags: SurahTags, cues: list[AyahCue]) -> None:
    import json

    payload = {
        "title": tags.title,
        "artist": tags.artist,
        "album": tags.album,
        "comment": tags.comment,
        "cues": [{"ayah": cue.ayah, "start": cue.start, "end": cue.end} for cue in cues],
    }
    _write_text(path, json.dumps(payload))


async def _notify(hass: Any, notification_id: str, message: str | None = None, *, dismiss: bool = False) -> None:
    services = getattr(hass, "services", None)
    caller = getattr(services, "async_call", None)
    if caller is None:
        return
    data: dict[str, Any] = {"notification_id": notification_id}
    if not dismiss:
        data["title"] = "Al Quran Cloud"
        data["message"] = message or ""
    try:
        await caller(
            "persistent_notification",
            "dismiss" if dismiss else "create",
            data,
            blocking=False,
        )
    except Exception:  # noqa: BLE001 - notification is optional
        _LOGGER.debug("Could not update notification %s", notification_id, exc_info=True)


def range_bounds(chapter: Any, start_ayah: int, end_ayah: int | None) -> tuple[int, int]:
    """Return a valid inclusive ayah range inside one surah."""
    start = max(1, int(start_ayah))
    end = chapter.verses_count if end_ayah in (None, 0) else int(end_ayah)
    if start > chapter.verses_count or end > chapter.verses_count or end < start:
        raise LocalMediaError(
            f"Ayah range {start}-{end} is outside surah {chapter.number} ({chapter.verses_count} ayahs)"
        )
    return start, end


def is_full_surah(chapter: Any, start_ayah: int, end_ayah: int) -> bool:
    """Return True when the range is the whole surah."""
    return start_ayah <= 1 and end_ayah >= chapter.verses_count


async def _cached(dest: Path, sidecar: Path, cache_days: int) -> bool:
    """Refresh and keep a joined file when both it and its cues are still fresh."""
    fresh = await _blocking(cache_is_fresh, dest, cache_days) and await _blocking(
        cache_is_fresh, sidecar, cache_days
    )
    if fresh:
        await _blocking(mark_used, dest)
        await _blocking(mark_used, sidecar)
    return fresh


def _range_stem(chapter_number: int, start_ayah: int, end_ayah: int) -> str:
    return f"{chapter_number:03d}-{start_ayah:03d}-{end_ayah:03d}"


async def build_range_audio(
    store: MediaStore,
    *,
    edition: str,
    chapter: Any,
    cache_days: int,
    audio_for: Callable[[int], str],
    download: Download,
    start_ayah: int = 1,
    end_ayah: int | None = None,
    speed: float = 1.0,
    run_command: Runner | None = None,
    probe: Callable[[Path], Awaitable[float | None]] | None = None,
) -> tuple[Path, list[AyahCue]]:
    """Join ayah MP3s for one range and cache the result."""
    start, end = range_bounds(chapter, start_ayah, end_ayah)
    speed = coerce_speed(speed)
    safe = _safe_edition(edition)
    dest = store.cache_dir / "audio" / safe / f"{_range_stem(chapter.number, start, end)}-s{_speed_tag(speed)}.mp3"
    sidecar = dest.with_suffix(".json")
    if await _cached(dest, sidecar, cache_days):
        return dest, await _blocking(_load_cues, sidecar)
    ffmpeg = await _binary("ffmpeg")
    if run_command is None and not ffmpeg:
        raise LocalMediaError("ffmpeg is required to join ayah audio.")
    if probe is None and not await _binary("ffprobe"):
        raise LocalMediaError("ffprobe is required to join ayah audio.")
    runner = run_command or _run_command
    duration_of = probe or probe_duration
    async with store.lock_for(str(dest)):
        if await _cached(dest, sidecar, cache_days):
            return dest, await _blocking(_load_cues, sidecar)
        sources = store.cache_dir / "src" / safe / f"{chapter.number:03d}"
        work = store.cache_dir / "work" / safe / f"audio-{_range_stem(chapter.number, start, end)}-s{_speed_tag(speed)}"
        await _blocking(sources.mkdir, parents=True, exist_ok=True)
        await _blocking(work.mkdir, parents=True, exist_ok=True)
        wavs: list[Path] = []
        measured: list[tuple[int, float]] = []
        audio_list = work / "audio.ffconcat"
        joined = work / "range.wav"
        temporary = partial_path(dest)
        completed = False
        try:
            for ayah in range(start, end + 1):
                mp3 = sources / f"{ayah:03d}.mp3"
                wav = work / f"{ayah:03d}.wav"
                await download(audio_for(ayah), mp3)
                if not await _blocking(_pcm_is_current, wav, mp3):
                    await runner(ffmpeg_pcm_command(ffmpeg or "ffmpeg", mp3, wav))
                duration = await duration_of(wav)
                if not duration or duration <= 0:
                    raise LocalMediaError(f"Could not read the duration of ayah {chapter.number}:{ayah}")
                wavs.append(wav)
                measured.append((ayah, duration / speed))
            cues = cues_from_durations(measured)
            await _blocking(_write_text, audio_list, audio_concat_script(wavs))
            binary = ffmpeg or "ffmpeg"
            await runner(ffmpeg_concat_copy_command(binary, audio_list, joined))
            await _blocking(dest.parent.mkdir, parents=True, exist_ok=True)
            await runner(ffmpeg_joined_audio_command(binary, joined, temporary, speed))
            await _blocking(temporary.replace, dest)
            await _blocking(_write_sidecar, sidecar, SurahTags("", "", "", ""), cues)
            completed = True
            return dest, cues
        finally:
            if not completed:
                await _blocking(_unlink_all, [*wavs, joined, temporary, audio_list])
            else:
                await _blocking(_unlink_all, [joined, *wavs, audio_list])



async def prepare_playback(
    hass: Any,
    store: MediaStore,
    *,
    catalog: Any,
    reciter: Any,
    chapter: Any,
    start_ayah: int = 1,
    end_ayah: int | None = None,
    speed: float = 1.0,
    cache_days: int | None = None,
    api: Any = None,
    webapp: bool = False,
    **_extra: Any,
) -> PreparedMedia:
    """Build or reuse one joined MP3, then return the URL to play."""
    if webapp:
        raise LocalMediaError("The web app opens in a TV browser and is not built as a file.")
    days = DEFAULT_CACHE_DAYS if cache_days is None else cache_days
    await _blocking(store.purge_expired, days)
    await _blocking(store.forget_missing_tokens)
    store.prune_idle_locks()
    start, end = range_bounds(chapter, start_ayah, end_ayah)
    safe = _safe_edition(str(reciter.id))
    cached = (
        store.cache_dir
        / "audio"
        / safe
        / f"{_range_stem(chapter.number, start, end)}-s{_speed_tag(coerce_speed(speed))}.mp3"
    )
    building = not (
        await _blocking(cache_is_fresh, cached, days)
        and await _blocking(cache_is_fresh, cached.with_suffix(".json"), days)
    )
    bitrate = 128
    notification_id = f"alquran_cloud_range_{safe}_{cached.stem}"
    if building:
        if api is None:
            raise LocalMediaError("Al Quran Cloud is not ready to build this surah")
        bitrate = await api.bitrate_for(str(reciter.id))
        await _notify(
            hass,
            notification_id,
            f"Building surah {chapter.number:03d} audio ({start}-{end}) for {reciter.name_en}.",
        )

    async def fetch_source(url: str, dest: Path) -> None:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession

        await _download(async_get_clientsession(hass), url, dest)

    def _audio(ayah: int) -> str:
        number = catalog.global_ayah_number(chapter.number, ayah)
        return ayah_audio_url(str(reciter.id), number, bitrate)

    try:
        path, cues = await build_range_audio(
            store,
            edition=str(reciter.id),
            chapter=chapter,
            cache_days=days,
            audio_for=_audio,
            download=fetch_source,
            start_ayah=start,
            end_ayah=end,
            speed=speed,
        )
        tags = surah_tags(reciter, chapter)
    finally:
        if building:
            await _notify(hass, notification_id, dismiss=True)

    await _blocking(mark_used, path)
    return PreparedMedia(
        url=public_media_url(hass, store, path),
        content_type="audio/mpeg",
        title=tags.title,
        artist=tags.artist,
        marker=path.name,
        image_url=ayah_image_url(chapter.number, start),
        duration=cues[-1].end if cues else None,
        album=tags.album,
        comment=tags.comment,
        spans=tuple((cue.ayah, cue.start, cue.end) for cue in cues),
    )


class QuranMediaView:
    """Serve one cached media file without a Home Assistant login.

    Assigned onto a HomeAssistantView subclass in __init__ so tests can import
    this module without the HTTP component.
    """

    url = "/api/alquran_cloud/media/{token}/{filename}"
    name = "api:alquran_cloud:media"
    requires_auth = False

    async def get(self, request: web.Request, token: str, filename: str) -> web.StreamResponse:
        """Return the file published for this token."""
        hass = request.app["hass"]
        store: MediaStore | None = hass.data.get(DOMAIN, {}).get("store")
        path = await _blocking(store.resolve, token) if store else None
        if path is None or path.name != filename:
            return web.Response(status=404, text="Not found")
        return web.FileResponse(path)
