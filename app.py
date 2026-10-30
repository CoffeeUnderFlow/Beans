import os
import sys
import time
import uuid
import threading
import subprocess
import shutil
import urllib.request
import json
import hashlib
from pathlib import Path
import webview
import yt_dlp
import gallery_dl
from flask import Flask, render_template, request, jsonify, send_from_directory

# 1. ==============================    PATH RESOLUTION & DIRECTORY SETUP   ==========================================

def get_base_path():
    """Determine base path whether running as script or PyInstaller bundle."""
    return sys._MEIPASS if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))

BASE_DIR = get_base_path()
USER_HOME = os.path.expanduser('~')
COOKIE_PATH = os.path.join(
    os.environ.get(
        'APPDATA',
        os.path.join(USER_HOME, 'AppData', 'Roaming')
    ),
    'Beans Extractor',
    'cookies.txt'
)


# Persistent settings are stored outside the application folder, so they survive restarts
# and also work when the app is bundled with PyInstaller.
APP_DATA_DIR = os.path.join(
    os.environ.get('APPDATA', os.path.join(USER_HOME, 'AppData', 'Roaming')),
    'Beans Extractor'
)
SETTINGS_FILE = os.path.join(APP_DATA_DIR, 'settings.json')

def normalize_download_dir(path):
    """Ensure downloads are stored inside a Beans Extractor subfolder."""
    path = os.path.abspath(
        os.path.normpath(
            os.path.expanduser(str(path).strip())
        )
    )

    if os.path.basename(path).casefold() != 'beans extractor':
        path = os.path.join(path, 'Beans Extractor')

    return path

DEFAULT_CONFIG = {
    'download_dir': os.path.join(USER_HOME, 'Downloads', 'Beans Extractor'),
    'include_subtitles': False,
    'subtitle_language': 'en',
}


def load_config():
    config = DEFAULT_CONFIG.copy()

    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as settings_file:
            saved = json.load(settings_file)

        if isinstance(saved, dict):
            config.update({
                key: saved[key]
                for key in DEFAULT_CONFIG
                if key in saved
            })

    except (OSError, ValueError, TypeError):
        pass

    if not isinstance(config.get('include_subtitles'), bool):
        config['include_subtitles'] = False

    if (
        not isinstance(config.get('subtitle_language'), str)
        or not config['subtitle_language']
    ):
        config['subtitle_language'] = 'en'

    if (
        not isinstance(config.get('download_dir'), str)
        or not config['download_dir'].strip()
    ):
        config['download_dir'] = DEFAULT_CONFIG['download_dir']

    config['download_dir'] = normalize_download_dir(
        config['download_dir']
    )

    return config

def save_config():
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    temporary_file = SETTINGS_FILE + '.tmp'
    with open(temporary_file, 'w', encoding='utf-8') as settings_file:
        json.dump(CONFIG, settings_file, ensure_ascii=False, indent=2)
    os.replace(temporary_file, SETTINGS_FILE)


CONFIG = load_config()
os.makedirs(CONFIG['download_dir'], exist_ok=True)

# 2. ==============================   FLASK APPLICATION INITIALIZATION    =============================================

app = Flask(__name__, template_folder=os.path.join(BASE_DIR, 'templates'), static_folder=os.path.join(BASE_DIR, 'static'))

# Global task registry. Up to two downloads run at once (DOWNLOAD_SLOTS); extra tasks
# wait in the queue. Two tasks with identical URL + options are refused, because they
# would share one .beans cache folder and one output filename.
TASKS = {}
CURRENT_TASK_ID = None

DOWNLOAD_SLOTS = threading.BoundedSemaphore(2)
TASKS_LOCK = threading.RLock()
CANCEL_EVENTS = {}
ACTIVE_PROCESSES = {}  # cancellable external processes, e.g. FFmpeg subtitle muxing
TERMINAL_TASK_STATUSES = {'completed', 'failed', 'error', 'cancelled', 'interrupted'}


# Persistent app history lives outside the download directory. Clearing history never deletes media.
URL_HISTORY_FILE = os.path.join(APP_DATA_DIR, 'url_history.json')
DOWNLOAD_HISTORY_FILE = os.path.join(APP_DATA_DIR, 'download_history.json')
THEME_FILE = os.path.join(APP_DATA_DIR, 'theme.json')
HISTORY_LIMIT = 100
HISTORY_LOCK = threading.RLock()


def _read_json_list(path):
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            value = json.load(handle)
        return value if isinstance(value, list) else []
    except (OSError, ValueError, TypeError):
        return []


def _write_json_atomic(path, value):
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    temporary = path + '.tmp'
    with open(temporary, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
    os.replace(temporary, path)


def _url_key(url):
    from urllib.parse import urlsplit, urlunsplit
    raw = str(url or '').strip()
    if not raw:
        return ''
    if '://' not in raw:
        raw = 'https://' + raw
    try:
        parsed = urlsplit(raw)
        # Ignore fragments; keep query parameters because they can identify the media.
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip('/') or '/', parsed.query, ''))
    except ValueError:
        return raw


def update_url_history(url, title='Unknown title', duration=0, thumbnail=''):
    key = _url_key(url)
    if not key:
        return
    now = time.time()
    with HISTORY_LOCK:
        records = _read_json_list(URL_HISTORY_FILE)
        old = next((item for item in records if _url_key(item.get('url')) == key), {})
        record = {
            'url': str(url), 'key': key,
            'title': str(title or old.get('title') or 'Unknown title'),
            'duration': duration or old.get('duration') or 0,
            'thumbnail': str(thumbnail or old.get('thumbnail') or ''),
            'timestamp': now,
        }
        records = [record] + [item for item in records if _url_key(item.get('url')) != key]
        _write_json_atomic(URL_HISTORY_FILE, records[:HISTORY_LIMIT])


# overall_progress_refinement_v1: persist a single monotonic overall progress value.
def upsert_download_history(task):
    if not isinstance(task, dict) or not task.get('task_id'):
        return
    now = time.time()
    record = {
        'task_id': str(task.get('task_id')),
        'url': str(task.get('url') or ''),
        'title': str(task.get('title') or task.get('url') or 'Media download'),
        'mode': str(task.get('mode') or 'video'),
        'height': task.get('height'),
        'status': str(task.get('status') or 'starting'),
        'percent': str(task.get('percent') or '0%'),
        'overall_percent': str(task.get('overall_percent') or task.get('percent') or '0%'),
        'subtitles_embedded': bool(task.get('subtitles_embedded')),
        'filename': task.get('filename'),
        'error': task.get('error'),
        'subtitle_notice': task.get('subtitle_notice'),
        'timestamp': task.get('timestamp') or now,
        'updated_at': now,
    }
    with HISTORY_LOCK:
        records = _read_json_list(DOWNLOAD_HISTORY_FILE)
        records = [item for item in records if item.get('task_id') != record['task_id']]
        records.insert(0, record)
        _write_json_atomic(DOWNLOAD_HISTORY_FILE, records[:HISTORY_LIMIT])


# A previous process cannot still be downloading after a restart. Keep its record, but mark it interrupted.
try:
    _startup_downloads = _read_json_list(DOWNLOAD_HISTORY_FILE)
    _startup_changed = False
    for _record in _startup_downloads:
        if str(_record.get('status', '')).lower() not in TERMINAL_TASK_STATUSES:
            _record['status'] = 'interrupted'
            _record['error'] = 'The app closed before this download finished. Start it again to resume from retained partial files.'
            _record['updated_at'] = time.time()
            _startup_changed = True
    if _startup_changed:
        _write_json_atomic(DOWNLOAD_HISTORY_FILE, _startup_downloads[:HISTORY_LIMIT])
except Exception as _history_error:
    print(f'[History] Could not reconcile previous tasks: {_history_error}')


class DownloadCancelled(Exception):
    """Raised inside a worker when the user cancels its task."""


def task_cancel_requested(task_id):
    event = CANCEL_EVENTS.get(task_id)
    task = TASKS.get(task_id, {})
    return bool((event and event.is_set()) or task.get('cancelled'))


def raise_if_cancelled(task_id):
    if task_cancel_requested(task_id):
        raise DownloadCancelled('Download cancelled by user.')


# 3. ==============================     CANCELLATION ENDPOINT      =====================================================
ALLOWED_HOSTS = {'127.0.0.1:5000', 'localhost:5000'}


@app.before_request
def reject_foreign_requests():
    if request.host not in ALLOWED_HOSTS:
        return jsonify({'success': False, 'error': 'Unexpected host.'}), 403
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        from urllib.parse import urlsplit
        origin = request.headers.get('Origin') or request.headers.get('Referer')
        if origin and urlsplit(origin).netloc not in ALLOWED_HOSTS:
            return jsonify({'success': False, 'error': 'Cross-origin requests are not allowed.'}), 403


@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response
    
@app.route('/api/cancel', methods=['POST'])
def cancel_download():
    """Request cancellation of one specific task; do not pretend it has stopped yet."""
    global CURRENT_TASK_ID
    data = request.get_json(silent=True) or {}
    requested_id = str(data.get('task_id') or CURRENT_TASK_ID or '')
    process = None

    with TASKS_LOCK:
        task = TASKS.get(requested_id)
        if not task:
            return jsonify({'success': False, 'error': 'No active download task was found.'}), 404
        if task.get('status') in TERMINAL_TASK_STATUSES:
            return jsonify({'success': True, 'task_id': requested_id,
                            'status': task.get('status'), 'already_finished': True})

        task['cancelled'] = True
        task['status'] = 'cancelling'
        task['error'] = None
        event = CANCEL_EVENTS.get(requested_id)
        if event:
            event.set()
        process = ACTIVE_PROCESSES.get(requested_id)
        print(f'[{requested_id}] Cancellation requested by user.')

    # FFmpeg can be terminated directly. yt-dlp's library worker checks the
    # same cancellation flag in progress hooks and exits at its next callback.
    if process and process.poll() is None:
        try:
            process.terminate()
        except OSError:
            pass

    return jsonify({'success': True, 'task_id': requested_id, 'status': 'cancelling'})


# 4. =================================     BACKGROUND UTILITY: CLEANUP ENGINE    ====================================

CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60


def purge_stale_cache_files():
    """Delete only files inside .beans older than 30 days; preserve recent resumable parts."""
    cache_root = os.path.join(CONFIG['download_dir'], '.beans')
    if not os.path.isdir(cache_root):
        return

    cutoff = time.time() - CACHE_MAX_AGE_SECONDS
    purged = 0

    # Walk bottom-up so empty subfolders can be removed after stale files are purged.
    for current_dir, subdirs, filenames in os.walk(cache_root, topdown=False):
        for filename in filenames:
            filepath = os.path.join(current_dir, filename)
            try:
                if os.path.isfile(filepath) and os.path.getmtime(filepath) < cutoff:
                    os.remove(filepath)
                    purged += 1
                    print(f'[Cache cleanup] Removed file older than 30 days: {filepath}')
            except OSError as exc:
                print(f'[Cache cleanup] Could not remove {filepath}: {exc}')

        for dirname in subdirs:
            dirpath = os.path.join(current_dir, dirname)
            try:
                # Remove empty cache subfolders only. Never remove a folder containing a recent part.
                if os.path.isdir(dirpath) and not os.listdir(dirpath):
                    os.rmdir(dirpath)
            except OSError:
                pass

    if purged:
        print(f'[Cache cleanup] Purged {purged} stale file(s) from .beans.')


def cleanup_engine():
    """Run the cache cleanup daily; the first purge is performed synchronously at startup."""
    while True:
        time.sleep(86400)
        purge_stale_cache_files()


# On startup, purge old partials before accepting downloads, then repeat once per day.
purge_stale_cache_files()
threading.Thread(target=cleanup_engine, daemon=True).start()


# 5.  ==============================        BASE OPTS CONFIGURATION FOR YTDLP       ===================================

def find_program(name):
    """Find ffmpeg/ffprobe in PATH or alongside the application."""
    executable_names = [name]
    if os.name == 'nt' and not name.lower().endswith('.exe'):
        executable_names.insert(0, name + '.exe')

    for candidate_name in executable_names:
        path = shutil.which(candidate_name)
        if path and os.path.isfile(path):
            return os.path.abspath(path)

    search_dirs = [BASE_DIR, os.path.dirname(sys.executable)]
    for directory in search_dirs:
        for candidate_name in executable_names:
            path = os.path.join(directory, candidate_name)
            if os.path.isfile(path):
                return os.path.abspath(path)
    return None

def get_base_opts():
    """Return clean, unauthenticated options. No browser extraction."""
    opts = {
        'noplaylist': True,
        'nocheckcertificate': True,
        # Match yt-dlp CLI's resumable .part behavior.
        'continuedl': True,
        'nopart': False,
    }
    ffmpeg_path = find_program('ffmpeg')
    if ffmpeg_path:
        opts['ffmpeg_location'] = ffmpeg_path
    # Optional manual fallback if cookies.txt exists
    if os.path.exists(COOKIE_PATH) and os.path.getsize(COOKIE_PATH) > 0:
        opts['cookiefile'] = COOKIE_PATH
    return opts
    

def extract_images(url):
    """Extract image URLs with gallery-dl, excluding obvious video streams."""
    from urllib.parse import urlsplit, parse_qs

    executable = shutil.which('gallery-dl')

    if executable:
        command = [executable, '-g', url]
    else:
        command = [sys.executable, '-m', 'gallery_dl', '-g', url]

    if os.environ.get('USE_PROXY', 'false').lower() == 'true':
        command.extend([
            '--proxy',
            os.environ.get('PROXY_URL', 'socks5://127.0.0.1:1080')
        ])

    if os.path.isfile(COOKIE_PATH) and os.path.getsize(COOKIE_PATH) > 0:
        command.extend(['--cookies', COOKIE_PATH])

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=120,
            check=False
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError('Image extraction timed out after 120 seconds.')
    except OSError as exc:
        raise RuntimeError(f'Could not start gallery-dl: {exc}')

    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(
            detail or f'gallery-dl exited with code {result.returncode}.'
        )

    video_extensions = {
        '.mp4', '.m4v', '.mov', '.webm', '.mkv',
        '.avi', '.flv', '.m3u8', '.mpd', '.ts'
    }

    images = []
    seen = set()

    for line in result.stdout.splitlines():
        media_url = line.strip()

        if not media_url.startswith(('https://', 'http://')):
            continue

        try:
            parsed = urlsplit(media_url)
            extension = os.path.splitext(parsed.path)[1].lower()
            query = parse_qs(parsed.query)

            # Some services specify the media type in the query string.
            query_format = str(
                (query.get('format') or [''])[0]
            ).lower().lstrip('.')

            if extension in video_extensions:
                continue

            if query_format in {
                'mp4', 'm4v', 'mov', 'webm', 'mkv',
                'm3u8', 'mpd', 'ts'
            }:
                continue

            if media_url not in seen:
                seen.add(media_url)
                images.append(media_url)

        except ValueError:
            continue

    return images


def make_image_gallery_data(url, images, title='Image Gallery'):
    """Build the metadata structure expected by the existing image gallery UI."""
    from urllib.parse import urlsplit
    import mimetypes

    formats = []

    for index, image_url in enumerate(images):
        path = urlsplit(image_url).path
        extension = os.path.splitext(path)[1].lower().lstrip('.')

        if extension not in {'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'}:
            extension = 'jpg'

        formats.append({
            'format_id': f'image_{index}',
            'resolution': f'Image {index + 1}',
            'ext': extension,
            'height': 0,
            'size_mb': None,
            'url': image_url
        })

    return {
        'original_url': url,
        'title': title or 'Image Gallery',
        'duration': 'N/A',
        'thumbnail': images[0] if images else '',
        'formats': formats
    }


# 6.   ==============================      METADATA INSPECTION ENDPOINT      ==========================================

SUBTITLE_LANGUAGE_NAMES = {
    'en': 'English', 'hi': 'Hindi', 'es': 'Spanish', 'fr': 'French',
    'de': 'German', 'pt': 'Portuguese', 'ar': 'Arabic', 'bn': 'Bengali',
    'zh-Hans': 'Chinese (Simplified)', 'zh-Hant': 'Chinese (Traditional)',
    'ja': 'Japanese', 'ko': 'Korean', 'ru': 'Russian', 'it': 'Italian',
    'ur': 'Urdu', 'pa': 'Punjabi', 'ta': 'Tamil', 'te': 'Telugu',
    'mr': 'Marathi', 'id': 'Indonesian', 'tr': 'Turkish', 'vi': 'Vietnamese',
    'th': 'Thai', 'nl': 'Dutch', 'pl': 'Polish', 'sv': 'Swedish',
    'uk': 'Ukrainian', 'fa': 'Persian', 'el': 'Greek', 'he': 'Hebrew',
}


def resolve_subtitle_language(available, preferred):
    """Return one matching language code without downloading/listing subtitles."""
    if not isinstance(available, dict) or not available:
        return None

    preferred_norm = str(preferred or 'en').strip().lower().replace('_', '-')
    codes = list(available.keys())
    normalized = {str(code).lower().replace('_', '-'): code for code in codes}

    # Exact match first.
    if preferred_norm in normalized:
        return normalized[preferred_norm]

    # Chinese has common alternate codes across uploaders.
    if preferred_norm == 'zh-hans':
        aliases = ('zh-cn', 'zh-sg', 'zh-hans')
        for alias in aliases:
            if alias in normalized:
                return normalized[alias]
    elif preferred_norm == 'zh-hant':
        aliases = ('zh-tw', 'zh-hk', 'zh-mo', 'zh-hant')
        for alias in aliases:
            if alias in normalized:
                return normalized[alias]

    # Match regional / YouTube variants (e.g. en-US, en-orig) for the selected base language.
    base = preferred_norm.split('-', 1)[0]
    matches = [code for code in codes
               if str(code).lower().replace('_', '-').split('-', 1)[0] == base]
    if matches:
        matches.sort(key=lambda code: (str(code).lower() != base, len(str(code)), str(code)))
        return matches[0]
    return None


def find_selected_subtitle_track(info, preferred_language):
    """Prefer creator-provided captions; use auto captions only as fallback."""
    manual = info.get('subtitles') or {}
    manual_code = resolve_subtitle_language(manual, preferred_language)
    if manual_code:
        return {'source': 'manual', 'code': manual_code}

    automatic = info.get('automatic_captions') or info.get('automatic_subtitles') or {}
    automatic_code = resolve_subtitle_language(automatic, preferred_language)
    if automatic_code:
        return {'source': 'automatic', 'code': automatic_code}
    return None


SUBTITLE_EXTENSIONS = {'.srt', '.vtt', '.ass', '.ssa', '.ttml', '.srv1', '.srv2', '.srv3'}


def find_subtitle_files(directory):
    """Return subtitle files produced in this task's private temporary directory."""
    found = []
    try:
        for filename in os.listdir(directory):
            full_path = os.path.join(directory, filename)
            if os.path.isfile(full_path) and os.path.splitext(filename)[1].lower() in SUBTITLE_EXTENSIONS:
                found.append(full_path)
    except OSError:
        pass
    return sorted(found, key=os.path.getmtime, reverse=True)


def probe_subtitle_stream(video_path):
    """Return True/False when ffprobe can verify a subtitle stream, otherwise None."""
    ffprobe = find_program('ffprobe')
    if not ffprobe:
        return None
    try:
        result = subprocess.run(
            [ffprobe, '-v', 'error', '-select_streams', 's',
             '-show_entries', 'stream=index,codec_name:stream_tags=language',
             '-of', 'json', video_path],
            capture_output=True, text=True, timeout=30, check=False
        )
        if result.returncode != 0:
            print(f'[Subtitle verification] ffprobe returned: {result.stderr.strip()}')
            return None
        payload = json.loads(result.stdout or '{}')
        return bool(payload.get('streams'))
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        print(f'[Subtitle verification] Could not verify subtitle stream: {exc}')
        return None


def ffmpeg_language_code(language_code):
    """Convert common BCP-47 codes to ISO-639-2 values commonly used in MP4."""
    base = str(language_code or '').lower().replace('_', '-').split('-', 1)[0]
    return {
        'en': 'eng', 'hi': 'hin', 'es': 'spa', 'fr': 'fra', 'de': 'deu',
        'pt': 'por', 'ar': 'ara', 'bn': 'ben', 'zh': 'zho', 'ja': 'jpn',
        'ko': 'kor', 'ru': 'rus', 'it': 'ita', 'ur': 'urd', 'pa': 'pan',
        'ta': 'tam', 'te': 'tel', 'mr': 'mar', 'id': 'ind', 'tr': 'tur',
        'vi': 'vie', 'th': 'tha', 'nl': 'nld', 'pl': 'pol', 'sv': 'swe',
        'uk': 'ukr', 'fa': 'fas', 'el': 'ell', 'he': 'heb',
    }.get(base, base[:3] if base else 'und')


def embed_subtitle_file(video_path, subtitle_path, language_code, language_name, task_id):
    """Mux exactly one selected subtitle into the downloaded video and verify it."""
    ffmpeg = find_program('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('FFmpeg was not found, so subtitles could not be embedded.')

    video_ext = os.path.splitext(video_path)[1].lower()
    if video_ext in ('.mp4', '.m4v', '.mov'):
        subtitle_codec = 'mov_text'
    elif video_ext == '.mkv':
        subtitle_codec = 'srt'
    elif video_ext == '.webm':
        subtitle_codec = 'webvtt'
    else:
        raise RuntimeError(f'Subtitle embedding is not supported for the output container {video_ext or "(unknown)"}.')

    root, ext = os.path.splitext(video_path)
    temp_path = f'{root}.subtitle-temp-{task_id}{ext}'
    language_tag = ffmpeg_language_code(language_code)
    command = [
        ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
        '-i', video_path, '-i', subtitle_path,
        '-map', '0:v:0', '-map', '0:a?', '-map', '1:0',
        '-map_metadata', '0', '-map_chapters', '0',
        '-c:v', 'copy', '-c:a', 'copy', '-c:s', subtitle_codec,
        '-metadata:s:s:0', f'language={language_tag}',
        '-metadata:s:s:0', f'title={language_name}',
        '-disposition:s:0', 'default',
    ]
    if video_ext in ('.mp4', '.m4v', '.mov'):
        command.extend(['-movflags', '+faststart'])
    command.append(temp_path)

    log_path = temp_path + '.ffmpeg.log'
    process = None
    try:
        raise_if_cancelled(task_id)
        # Send stderr to a file instead of PIPE to avoid a full-pipe deadlock.
        with open(log_path, 'w', encoding='utf-8', errors='replace') as log_file:
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=log_file)
            with TASKS_LOCK:
                ACTIVE_PROCESSES[task_id] = process
            started = time.monotonic()
            while process.poll() is None:
                if task_cancel_requested(task_id):
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
                    raise DownloadCancelled('Download cancelled by user.')
                if time.monotonic() - started > 900:
                    process.kill()
                    process.wait(timeout=3)
                    raise RuntimeError('FFmpeg subtitle embedding timed out after 15 minutes.')
                time.sleep(0.15)
            return_code = process.returncode
        with TASKS_LOCK:
            if ACTIVE_PROCESSES.get(task_id) is process:
                ACTIVE_PROCESSES.pop(task_id, None)
        details = ''
        try:
            details = Path(log_path).read_text(encoding='utf-8', errors='replace').strip()
        except OSError:
            pass
        if return_code != 0 or not os.path.isfile(temp_path) or os.path.getsize(temp_path) == 0:
            raise RuntimeError('FFmpeg could not embed the selected subtitles.' + (f' Details: {details[-1200:]}' if details else ''))

        raise_if_cancelled(task_id)
        # Verify the temporary result before replacing the original video.
        verified = probe_subtitle_stream(temp_path)
        if verified is False:
            raise RuntimeError('FFmpeg finished, but ffprobe could not find an embedded subtitle stream.')
        raise_if_cancelled(task_id)
        os.replace(temp_path, video_path)
        if verified is None:
            print(f'[{task_id}] FFmpeg completed subtitle muxing; ffprobe was unavailable for verification.')
        else:
            print(f'[{task_id}] Verified embedded subtitle stream: {language_tag} ({language_name}).')
    finally:
        with TASKS_LOCK:
            if process and ACTIVE_PROCESSES.get(task_id) is process:
                ACTIVE_PROCESSES.pop(task_id, None)
        for cleanup_path in (temp_path, log_path):
            try:
                if os.path.exists(cleanup_path):
                    os.remove(cleanup_path)
            except OSError:
                pass


class SubtitleAwareLogger:
    """Capture subtitle rate-limit errors while keeping useful subtitle logs visible."""
    def __init__(self):
        self.subtitle_rate_limited = False

    def debug(self, message):
        text = str(message)
        lowered = text.lower()
        if any(token in lowered for token in ('subtitle', 'embed', 'ffmpeg')):
            print(f'[yt-dlp debug] {text}')

    def warning(self, message):
        text = str(message)
        print(f'[yt-dlp warning] {text}')
        self._check_rate_limit(text)

    def error(self, message):
        text = str(message)
        print(f'[yt-dlp error] {text}')
        self._check_rate_limit(text)

    def _check_rate_limit(self, text):
        lowered = str(text).lower()
        if ('subtitle' in lowered or 'caption' in lowered) and ('429' in lowered or 'too many requests' in lowered):
            self.subtitle_rate_limited = True



@app.route('/api/inspect', methods=['POST'])
def api_inspect():
    """Automatically inspect video URLs and fall back to image galleries."""
    data = request.get_json(silent=True) or {}
    url = str(data.get('url') or '').strip()

    if not url:
        return jsonify({
            'success': False,
            'error': 'Please provide a URL.'
        }), 400

    info = None
    ytdlp_error = None

    # First attempt: yt-dlp.
    try:
        opts = get_base_opts()
        opts['skip_download'] = True

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

    except Exception as exc:
        ytdlp_error = str(exc)
        print(f'[Inspect] yt-dlp could not inspect URL: {ytdlp_error}')

    # A successful metadata response may still have no video formats.
    video_formats = []

    if isinstance(info, dict):
        for fmt in info.get('formats') or []:
            if fmt.get('vcodec') in (None, 'none'):
                continue

            try:
                height = int(fmt.get('height') or 0)
            except (TypeError, ValueError):
                height = 0

            if height <= 0 or fmt.get('format_note') == 'storyboard':
                continue

            video_formats.append((fmt, height))

    # Second attempt: gallery-dl, only when video extraction did not give
    # usable video formats.
    if not video_formats:
        try:
            images = extract_images(url)

            if images:
                gallery_data = make_image_gallery_data(
                    url,
                    images,
                    (info or {}).get('title') or 'Image Gallery'
                )

                update_url_history(
                    url,
                    gallery_data['title'],
                    0,
                    gallery_data['thumbnail']
                )

                return jsonify({
                    'success': True,
                    'data': gallery_data
                })

        except Exception as exc:
            print(f'[Inspect] gallery-dl could not extract images: {exc}')

        # If yt-dlp itself failed, report a useful combined error.
        if info is None:
            message = (
                'Could not find supported video or images at this URL. '
                'The link may be unsupported, private, or require authentication.'
            )

            if ytdlp_error:
                message += f'\nyt-dlp: {ytdlp_error}'

            return jsonify({
                'success': False,
                'error': message
            }), 400

        # Preserve successful metadata responses that have no video formats.
        # This can include audio-only pages; don't mislabel them as videos.
        if not video_formats:
            audio_available = any(
                fmt.get('acodec') not in (None, 'none')
                for fmt in info.get('formats') or []
            )

            if not audio_available:
                return jsonify({
                    'success': False,
                    'error': (
                        'No downloadable video or supported images were found. '
                        'This URL may contain unsupported or private content.'
                    )
                }), 400

    # Build the existing resolution selector for video.
    formats = []
    seen_heights = set()

    for fmt, height in sorted(
        video_formats,
        key=lambda item: item[1],
        reverse=True
    ):
        if height in seen_heights:
            continue

        seen_heights.add(height)
        protocol = fmt.get('protocol') or ''

        formats.append({
            'format_id': fmt.get('format_id'),
            'height': height,
            'resolution': f'{height}p',
            'ext': fmt.get('ext'),
            'fps': fmt.get('fps'),
            'vcodec': fmt.get('vcodec'),
            'protocol': protocol,
            'is_hls': 'm3u8' in protocol.lower()
        })

    title = info.get('title') or 'Unknown Title'
    thumbnail = info.get('thumbnail') or ''
    duration = info.get('duration') or 0

    update_url_history(url, title, duration, thumbnail)

    return jsonify({
        'success': True,
        'data': {
            'original_url': url,
            'title': title,
            'duration': duration,
            'thumbnail': thumbnail,
            'formats': formats
        }
    })


# 7.====================================    SETTINGS & HELP ENDPOINTS    =====================================================


@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    """Read/save persistent download and optional subtitle settings."""
    global CONFIG

    if request.method == 'POST':
        data = request.get_json(silent=True) or {}

        new_dir = data.get('download_dir')

        if isinstance(new_dir, str) and new_dir.strip():
            new_dir = normalize_download_dir(new_dir)

            try:
                os.makedirs(new_dir, exist_ok=True)
                CONFIG['download_dir'] = new_dir
            except Exception as exc:
                return jsonify({
                    'success': False,
                    'error': f'Invalid directory: {exc}'
                }), 400

        if 'include_subtitles' in data:
            value = data.get('include_subtitles')
            CONFIG['include_subtitles'] = (
                value is True
                or str(value).lower() in ('1', 'true', 'yes', 'on')
            )

        if 'subtitle_language' in data:
            language = str(
                data.get('subtitle_language') or 'en'
            ).strip()

            if language in SUBTITLE_LANGUAGE_NAMES:
                CONFIG['subtitle_language'] = language

        try:
            save_config()
        except OSError as exc:
            return jsonify({
                'success': False,
                'error': f'Could not save settings: {exc}'
            }), 500

    return jsonify({
        'success': True,
        'config': CONFIG
    })



@app.route('/api/cookies', methods=['POST', 'DELETE'])
def api_cookies():
    """Upload or remove the optional cookies.txt file."""
    if request.method == 'DELETE':
        try:
            if os.path.exists(COOKIE_PATH):
                os.remove(COOKIE_PATH)
            return jsonify({'success': True})
        except OSError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 500

    uploaded = request.files.get('file')

    if not uploaded or not uploaded.filename:
        return jsonify({
            'success': False,
            'error': 'Choose a cookies.txt file first.'
        }), 400

    try:
        os.makedirs(os.path.dirname(COOKIE_PATH), exist_ok=True)
        uploaded.save(COOKIE_PATH)

        if os.path.getsize(COOKIE_PATH) == 0:
            os.remove(COOKIE_PATH)
            return jsonify({
                'success': False,
                'error': 'The uploaded cookies file is empty.'
            }), 400

        return jsonify({'success': True})

    except OSError as exc:
        return jsonify({
            'success': False,
            'error': str(exc)
        }), 500

# 8.    ==============================       DOWNLOAD EXECUTION ENDPOINT    ==============================================

def make_download_cache_key(url, mode, height=None, format_id=None):
    """Stable .beans cache key for identical download parameters."""
    from urllib.parse import urlsplit, urlunsplit, parse_qs

    p = urlsplit(url.strip() if '://' in url else f'https://{url.strip()}')
    host, parts = (p.hostname or '').lower(), [x for x in p.path.split('/') if x]
    yt_hosts = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
                'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'}
    q, vid = parse_qs(p.query), None

    if host in yt_hosts:
        if host in {'youtu.be', 'www.youtu.be'} and parts:
            vid = parts[0]
        elif p.path.rstrip('/') == '/watch':
            vid = q.get('v', [None])[0]
        elif len(parts) > 1 and parts[0] in {'shorts', 'embed', 'live', 'v'}:
            vid = parts[1]

    try:
        height = int(height) if height not in (None, '') else None
    except (TypeError, ValueError):
        height = str(height)

    identity = {
        'url': f'https://www.youtube.com/watch?v={vid}' if vid else
               urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path, p.query, '')),
        'mode': str(mode or 'video').lower(),
        'height': height,
        'format_id': str(format_id or '')
    }
    payload = json.dumps(identity, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:24]


def download_gallery_image(url, format_id, image_url=None):
    """Download the exact image selected in the UI."""
    from urllib.parse import urlsplit

    # Prefer the exact image URL selected in the inspection window.
    # Instagram URLs may change between gallery extraction requests.
    if image_url:
        selected_url = image_url.strip()

        if not selected_url.startswith(('https://', 'http://')):
            raise RuntimeError('Invalid image URL.')
    else:
        # Backward-compatible fallback for older frontend requests.
        images = extract_images(url)

        if not images:
            raise RuntimeError(
                'No images found. Please analyze the URL again.'
            )

        try:
            index = int(str(format_id).split('_', 1)[1])
        except (IndexError, TypeError, ValueError):
            raise RuntimeError('Invalid image selection.')

        if index < 0 or index >= len(images):
            raise RuntimeError(
                'The selected image is no longer available. '
                'Please analyze the URL again.'
            )

        selected_url = images[index]

    request_obj = urllib.request.Request(
        selected_url,
        headers={
            'User-Agent': 'Mozilla/5.0 Beans Extractor',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        }
    )

    os.makedirs(CONFIG['download_dir'], exist_ok=True)

    task_id = str(uuid.uuid4())

    # Determine a safe initial extension.
    extension = os.path.splitext(urlsplit(selected_url).path)[1].lower()

    allowed_extensions = {
        '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'
    }

    if extension not in allowed_extensions:
        extension = '.jpg'

    try:
        # Open the response and verify that the server returned an image.
        with urllib.request.urlopen(request_obj, timeout=60) as response:
            content_type = response.headers.get_content_type().lower()

            if not content_type.startswith('image/'):
                raise RuntimeError(
                    f'The selected URL did not return an image '
                    f'({content_type}). The image may have expired '
                    f'or require authentication.'
                )

            # Prefer the actual response content type for the extension.
            content_extension = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/webp': '.webp',
                'image/gif': '.gif',
                'image/avif': '.avif',
                'image/bmp': '.bmp',
                'image/tiff': '.tiff',
            }.get(content_type)

            if content_extension:
                extension = content_extension

            # Keep the existing filename style.
            try:
                index = int(str(format_id).split('_', 1)[1])
                image_number = index + 1
            except (IndexError, TypeError, ValueError):
                image_number = 1

            filename = f'Image_{image_number}_{task_id[:8]}{extension}'
            filepath = os.path.join(CONFIG['download_dir'], filename)

            with open(filepath, 'wb') as output:
                shutil.copyfileobj(response, output)

        if not os.path.isfile(filepath) or os.path.getsize(filepath) == 0:
            raise RuntimeError('The downloaded image file is empty.')

        return task_id, filename

    except Exception:
        try:
            if 'filepath' in locals() and os.path.exists(filepath):
                os.remove(filepath)
        except OSError:
            pass
        raise



@app.route('/api/download', methods=['POST'])
def api_download():
    """Start a download task (two run at once; extra tasks are queued)."""
    global CURRENT_TASK_ID
    data = request.get_json(silent=True) or {}
    url = str(data.get('url') or '').strip()
    mode = data.get('mode', 'video')
    height = data.get('height')
    format_id = data.get('format_id')

    if not url:
        return jsonify({'success': False, 'error': 'No URL provided'}), 400

    
    # Image downloads use gallery-dl, not the yt-dlp video worker.
    is_image = (
        str(mode).lower() == 'image'
        or str(format_id or '').startswith('image_')
        or str(height) == '0'
    )

    if is_image:
        task_id = str(uuid.uuid4())

        task = {
            'task_id': task_id,
            'url': url,
            'title': 'Image download',
            'mode': 'image',
            'height': 0,
            'format_id': format_id,
            'status': 'starting',
            'percent': '0%',
            'overall_percent': '0%',
            'progress_floor': 0.0,
            'subtitles_embedded': False,
            'error': None,
            'filename': None,
            'timestamp': time.time(),
            'cancelled': False,
            'subtitle_notice': None,
        }

        with TASKS_LOCK:
            TASKS[task_id] = task
            upsert_download_history(task)

        try:
            filename_task_id, filename = download_gallery_image(
                url,
                format_id,
                data.get('image_url')
            )

            with TASKS_LOCK:
                TASKS[task_id].update({
                    'title': filename,
                    'status': 'completed',
                    'percent': '100%',
                    'overall_percent': '100%',
                    'progress_floor': 100.0,
                    'filename': filename,
                    'error': None,
                })
                upsert_download_history(TASKS[task_id])

            return jsonify({
                'success': True,
                'task_id': task_id,
                'status': 'completed'
            })

        except Exception as exc:
            print(f'[{task_id}] Image download failed: {exc}')

            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'failed',
                    'error': str(exc),
                    'percent': '0%',
                    'overall_percent': '0%',
                })
                upsert_download_history(TASKS[task_id])

            return jsonify({
                'success': False,
                'task_id': task_id,
                'error': f'Failed to download image: {exc}'
            }), 400
   

    # Reuse the exact same .beans folder for the same URL + selected output parameters.
    # Task IDs are deliberately NOT part of this key, so a cancelled download can resume.
    cache_key = make_download_cache_key(url, mode, height, format_id)
    with TASKS_LOCK:
        for other in TASKS.values():
            if (other.get('cache_key') == cache_key
                    and other.get('status') not in TERMINAL_TASK_STATUSES):
                return jsonify({
                    'success': False,
                    'error': 'This media is already being downloaded with the same settings.'
                }), 409
    task_id = str(uuid.uuid4())
    # Reserve one of the two download slots immediately, or accept this task into the queue.
    slot_acquired = DOWNLOAD_SLOTS.acquire(blocking=False)

    with TASKS_LOCK:
        TASKS[task_id] = {
            'task_id': task_id, 'cache_key': cache_key, 'url': url, 'title': url, 'mode': str(mode or 'video'),
            'height': height, 'format_id': format_id,
            'status': 'starting' if slot_acquired else 'queued',
            'percent': '0%', 'overall_percent': '0%', 'progress_floor': 0.0, 'subtitles_embedded': False, 'error': None,
            'filename': None, 'timestamp': time.time(), 'cancelled': False,
            'subtitle_notice': None,
        }
        upsert_download_history(TASKS[task_id])
        CANCEL_EVENTS[task_id] = threading.Event()
        CURRENT_TASK_ID = task_id

    def worker():
        global CURRENT_TASK_ID
        slot_held = slot_acquired
        nonlocal_paths = {'task_temp_dir': None, 'base_name': None, 'final_path': None, 'media_download_complete': False, 'end_status': None, 'end_error': None, 'end_filename': None, 'end_subtitle_notice': None}
        subtitle_logger = SubtitleAwareLogger()
        try:
            if not slot_held:
                while not DOWNLOAD_SLOTS.acquire(timeout=0.25):
                    if task_cancel_requested(task_id):
                        raise DownloadCancelled('Download cancelled while waiting in the queue.')
                slot_held = True

            raise_if_cancelled(task_id)
            with TASKS_LOCK:
                TASKS[task_id]['status'] = 'starting'
                upsert_download_history(TASKS[task_id])

            opts = get_base_opts()

            def hook(d):
                raise_if_cancelled(task_id)
                if d.get('status') == 'downloading':
                    total = d.get('total_bytes') or d.get('total_bytes_estimate') or 1
                    downloaded = d.get('downloaded_bytes', 0)
                    raw_pct = max(0.0, min(100.0, (downloaded / total) * 100))
                    # Weighted estimate: transfer gets 88%; remaining work is reserved for finalization.
                    candidate = min(88.0, raw_pct * 0.88)
                    with TASKS_LOCK:
                        task = TASKS[task_id]
                        candidate = max(float(task.get('progress_floor', 0.0)), candidate)
                        task['progress_floor'] = candidate
                        task.update({'percent': f'{candidate:.1f}%', 'overall_percent': f'{candidate:.1f}%', 'status': 'downloading'})
                elif d.get('status') == 'finished':
                    raise_if_cancelled(task_id)
                    with TASKS_LOCK:
                        task = TASKS[task_id]
                        candidate = max(float(task.get('progress_floor', 0.0)), 88.0)
                        task['progress_floor'] = candidate
                        task.update({'status': 'merging', 'percent': f'{candidate:.1f}%', 'overall_percent': f'{candidate:.1f}%'})
                    

            # Preserve existing direct/non-HLS-first video selection and the MP3 workflow.
            if mode == 'mp3':
                opts.update({
                    'format': 'bestaudio/best',
                    'writethumbnail': True,
                    'postprocessors': [
                        {'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'},
                        {'key': 'FFmpegMetadata', 'add_metadata': True},
                        {'key': 'EmbedThumbnail', 'already_have_thumbnail': False},
                    ],
                })
            else:
                if height:
                    opts['format'] = (
                        f'bestvideo[height<={height}][protocol!*=m3u8]'
                        f'+bestaudio[protocol!*=m3u8]'
                        f'/best[height<={height}][protocol!*=m3u8]'
                        f'/bestvideo[height<={height}]+bestaudio'
                        f'/best[height<={height}]'
                        f'/best'
                    )
                else:
                    opts['format'] = (
                        'bestvideo[protocol!*=m3u8]+bestaudio[protocol!*=m3u8]'
                        '/best[protocol!*=m3u8]/bestvideo+bestaudio/best'
                    )
                opts['merge_output_format'] = 'mp4'

            temp_cache_dir = os.path.join(CONFIG['download_dir'], '.beans')
            task_temp_dir = os.path.join(temp_cache_dir, cache_key)
            nonlocal_paths['task_temp_dir'] = task_temp_dir

            os.makedirs(task_temp_dir, exist_ok=True)

            try:
                cached_files = [
                    os.path.join(root, f)
                    for root, _, files in os.walk(task_temp_dir)
                    for f in files
                ]
                has_cached_files = bool(cached_files)
                has_resumable_parts = any(
                    f.endswith('.part') or '.part-Frag' in f
                    for f in cached_files
                )
            except OSError:
                has_cached_files = has_resumable_parts = False

            if has_resumable_parts:
                print(f'[{task_id}] Partial download found; attempting resume.')
            elif has_cached_files:
                print(f'[{task_id}] Cache files found, but no partial download detected.')
            else:
                print(f'[{task_id}] No resumable cache found; starting fresh.')

            if os.name == 'nt':
                try:
                    import ctypes
                    ctypes.windll.kernel32.SetFileAttributesW(temp_cache_dir, 2)
                except Exception:
                    pass

            opts.update({
                'outtmpl': '%(title)s.%(ext)s',
                'paths': {'home': CONFIG['download_dir'], 'temp': task_temp_dir},
                'progress_hooks': [hook],
            })

            # This is the normal metadata extraction the app already needs for title/format.
            # No subtitle lookup or subtitle options are added when Include Subtitles is OFF.
            raise_if_cancelled(task_id)
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            raise_if_cancelled(task_id)

            title = info.get('title') or 'video'
            with TASKS_LOCK:
                TASKS[task_id].update({'title': title})
                upsert_download_history(TASKS[task_id])
            safe_title = yt_dlp.utils.sanitize_filename(title, restricted=False).strip(' .') or 'video'
            preferred_extension = 'mp3' if mode == 'mp3' else ('mp4' if mode == 'video' else (info.get('ext') or 'mp4'))
            base_name = safe_title
            final_name = f'{base_name}.{preferred_extension}'
            counter = 1
            while any(os.path.exists(os.path.join(CONFIG['download_dir'], f'{base_name}.{ext}'))
                      for ext in ('mp4', 'mkv', 'webm', 'mov', 'm4v', 'flv', 'mp3')):
                base_name = f'{safe_title} ({counter})'
                final_name = f'{base_name}.{preferred_extension}'
                counter += 1

            nonlocal_paths['base_name'] = base_name
            opts['outtmpl'] = f'{base_name}.%(ext)s'
            include_subtitles = bool(CONFIG.get('include_subtitles', False)) and mode == 'video'
            subtitle_track = None
            subtitle_notice = None
            language_name = None
            preferred_language = CONFIG.get('subtitle_language', 'en')
            if include_subtitles:
                language_name = SUBTITLE_LANGUAGE_NAMES.get(preferred_language, preferred_language)
                # Resolve only the user's selected language, and only when the toggle is ON.
                subtitle_track = find_selected_subtitle_track(info, preferred_language)
                print(f"[{task_id}] Subtitles enabled: language={preferred_language}")
                if subtitle_track:
                    print(f"[{task_id}] Selected {subtitle_track['source']} subtitle track: {subtitle_track['code']}")
                else:
                    subtitle_notice = f'No {language_name} subtitles were available; the video was downloaded without subtitles.'
                    print(f"[{task_id}] No subtitle track found for {preferred_language}; continuing without subtitles.")
            else:
                print(f"[{task_id}] Subtitles disabled; skipping subtitle workflow.")

            raise_if_cancelled(task_id)
            TASKS[task_id].update({'status': 'downloading', 'percent': '0%', 'overall_percent': '0%', 'progress_floor': 0.0})

            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.process_ie_result(info, download=True)

            except Exception as e:
                err = str(e)
                if not (has_resumable_parts and '416' in err):
                    raise

                raise_if_cancelled(task_id)
                print(f'[{task_id}] Resume failed with HTTP 416; retrying once without stale partial files.')

                # Preserve the original partials in .beans, and use a separate folder for
                # the fresh attempt so yt-dlp cannot resume the same incompatible file.
                retry_dir = task_temp_dir + '_fresh'
                os.makedirs(retry_dir, exist_ok=True)

                retry_opts = dict(opts)
                retry_opts.update({
                    'paths': {'home': CONFIG['download_dir'], 'temp': retry_dir},
                    'continuedl': False,
                })

                with yt_dlp.YoutubeDL(retry_opts) as ydl:
                    ydl.process_ie_result(info, download=True)

            raise_if_cancelled(task_id)

            # Find the actual final media file (the final extension can differ if no merge is needed).
            allowed_media_exts = {'.mp4', '.mkv', '.webm', '.mov', '.m4v', '.flv'}
            if mode == 'mp3':
                allowed_media_exts = {'.mp3'}
            expected_path = os.path.join(CONFIG['download_dir'], final_name)
            media_candidates = []
            for filename in os.listdir(CONFIG['download_dir']):
                full_path = os.path.join(CONFIG['download_dir'], filename)
                stem, extension = os.path.splitext(filename)
                if (os.path.isfile(full_path)
                        and stem.startswith(base_name)
                        and extension.lower() in allowed_media_exts
                        and not filename.endswith(('.part', '.ytdl', '.temp'))):
                    media_candidates.append(full_path)
            if os.path.isfile(expected_path):
                final_path = expected_path
            elif media_candidates:
                final_path = max(media_candidates, key=os.path.getmtime)
            else:
                raise RuntimeError('yt-dlp finished but the final media file could not be found.')
            nonlocal_paths['final_path'] = final_path
            nonlocal_paths['media_download_complete'] = True
            raise_if_cancelled(task_id)

            if include_subtitles and subtitle_track:
                subtitle_work_dir = os.path.join(task_temp_dir, 'subtitles')
                os.makedirs(subtitle_work_dir, exist_ok=True)
                TASKS[task_id].update({'status': 'subtitles'})
                print(f"[{task_id}] Downloading exactly one {language_name} subtitle track...")
                try:
                    subtitle_opts = get_base_opts()
                    def subtitle_hook(_progress):
                        raise_if_cancelled(task_id)

                    subtitle_opts.update({
                        'skip_download': True,
                        'writesubtitles': subtitle_track['source'] == 'manual',
                        'writeautomaticsub': subtitle_track['source'] == 'automatic',
                        'subtitleslangs': [subtitle_track['code']],
                        'subtitlesformat': 'srt/best',
                        'outtmpl': '%(title)s.%(ext)s',
                        'paths': {'home': subtitle_work_dir, 'temp': subtitle_work_dir},
                        'logger': subtitle_logger,
                        'overwrites': True,
                        'progress_hooks': [subtitle_hook],
                    })
                    # Use yt-dlp's ordinary subtitle download path in a private task folder.
                    # No other languages are requested; the actual video is already safe on disk.
                    raise_if_cancelled(task_id)
                    with yt_dlp.YoutubeDL(subtitle_opts) as subtitle_ydl:
                        subtitle_ydl.download([url])
                    raise_if_cancelled(task_id)

                    subtitle_files = find_subtitle_files(subtitle_work_dir)
                    if not subtitle_files:
                        if subtitle_logger.subtitle_rate_limited:
                            raise RuntimeError('YouTube rate-limited the subtitle request (HTTP 429).')
                        raise RuntimeError(f'yt-dlp did not produce a subtitle file for {language_name}.')

                    subtitle_file = subtitle_files[0]
                    print(f"[{task_id}] Subtitle file downloaded: {os.path.basename(subtitle_file)}")
                    TASKS[task_id].update({'status': 'embedding', 'percent': '94%', 'overall_percent': '94%', 'progress_floor': max(float(TASKS[task_id].get('progress_floor', 0.0)), 94.0)})
                    print(f"[{task_id}] Embedding {language_name} subtitles into the video...")
                    embed_subtitle_file(final_path, subtitle_file, subtitle_track['code'], language_name, task_id)
                    raise_if_cancelled(task_id)
                    subtitle_notice = f'{language_name} subtitles embedded successfully.'
                    print(f"[{task_id}] {subtitle_notice}")
                except DownloadCancelled:
                    raise
                except Exception as subtitle_exc:
                    error_text = str(subtitle_exc)
                    if subtitle_logger.subtitle_rate_limited or '429' in error_text or 'too many requests' in error_text.lower():
                        subtitle_notice = (
                            f'The video was downloaded, but {language_name} subtitles were not embedded. Try again later.'
                        )
                    else:
                        subtitle_notice = f'The video was downloaded, but {language_name} subtitles could not be embedded: {error_text}'
                    print(f"[{task_id}] {subtitle_notice}")
                finally:
                    # On cancellation, keep any partial subtitle data too. Otherwise this
                    # one task's subtitle cache can be removed after its attempt finishes.
                    if not task_cancel_requested(task_id):
                        shutil.rmtree(subtitle_work_dir, ignore_errors=True)

            with TASKS_LOCK:
                raise_if_cancelled(task_id)
                nonlocal_paths['end_status'] = 'completed'
                nonlocal_paths['end_error'] = None
                nonlocal_paths['end_filename'] = os.path.basename(final_path)
                nonlocal_paths['end_subtitle_notice'] = subtitle_notice

        except Exception as exc:
            cancelled = isinstance(exc, DownloadCancelled) or task_cancel_requested(task_id)
            base_name = nonlocal_paths.get('base_name')
            final_path = nonlocal_paths.get('final_path')
            media_download_complete = nonlocal_paths.get('media_download_complete', False)
            nonlocal_paths['end_status'] = 'cancelled' if cancelled else 'failed'
            nonlocal_paths['end_error'] = 'Download cancelled by user.' if cancelled else str(exc)
            nonlocal_paths['end_filename'] = (
                os.path.basename(final_path) if (cancelled and media_download_complete and final_path) else None
            )
            # Do not delete output files or anything under .beans on cancellation/failure.
            # yt-dlp's .part and completed component files are intentionally resumable.
            if cancelled:
                print(f'[{task_id}] Cancellation received; resumable files are being retained in .beans.')
            else:
                print(f'[{task_id}] Download failed: {exc}')
        finally:
            task_temp_dir = nonlocal_paths.get('task_temp_dir')
            end_status = nonlocal_paths.get('end_status')
            # A successful complete download no longer needs cached fragments/parts.
            # A cancelled or failed task keeps its cache for up to 30 days.
            if task_temp_dir and end_status == 'completed':
                shutil.rmtree(task_temp_dir, ignore_errors=True)
                shutil.rmtree(task_temp_dir + '_fresh', ignore_errors=True)
            with TASKS_LOCK:
                ACTIVE_PROCESSES.pop(task_id, None)
                CANCEL_EVENTS.pop(task_id, None)
                if CURRENT_TASK_ID == task_id:
                    CURRENT_TASK_ID = next(
                        (other_id for other_id, other in TASKS.items()
                         if other_id != task_id and other.get('status') not in TERMINAL_TASK_STATUSES),
                        None,
                    )
                # Publish terminal status only after cache handling and releasing the active slot.
                if end_status:
                    TASKS[task_id].update({
                        'status': end_status,
                        'error': nonlocal_paths.get('end_error'),
                        'filename': nonlocal_paths.get('end_filename'),
                    })
                    if end_status == 'completed':
                        TASKS[task_id]['percent'] = '100%'
                        TASKS[task_id]['overall_percent'] = '100%'
                        TASKS[task_id]['progress_floor'] = 100.0
                        TASKS[task_id]['subtitles_embedded'] = bool(nonlocal_paths.get('end_subtitle_notice') and 'embedded successfully' in nonlocal_paths.get('end_subtitle_notice', '').lower())
                        TASKS[task_id]['subtitle_notice'] = nonlocal_paths.get('end_subtitle_notice')
                    if end_status == 'cancelled':
                        print(f'[{task_id}] Cancellation complete; active slot released; partial files retained in .beans/{cache_key}.')
                    upsert_download_history(TASKS[task_id])

            if slot_held:
                DOWNLOAD_SLOTS.release()
                slot_held = False


    threading.Thread(target=worker, daemon=True).start()
    return jsonify({'success': True, 'task_id': task_id, 'status': 'starting' if slot_acquired else 'queued'})


# 10.     ==============================           PROGRESS POLLING ENDPOINT       =======================================

@app.route('/api/progress/<task_id>')
def api_progress(task_id):
    """Return current status and percentage of a running task to the frontend."""
    return jsonify(TASKS.get(task_id)) if task_id in TASKS else (jsonify({'error': 'Task not found'}), 404)


# 11. ==============================         FILE SERVING           ==========================================

@app.route('/api/serve/<task_id>')
def api_serve(task_id):
    """Serve completed download file to the client as an attachment."""
    task = TASKS.get(task_id)

    if not task or task.get('status') != 'completed':
        return "File not found or expired", 404

    download_dir = CONFIG['download_dir']
    filename = task.get('filename')

    if not filename:
        return "File not found or expired", 404

    filepath = os.path.join(download_dir, filename)

    if not os.path.isfile(filepath):
        return "File not found or expired", 404

    return send_from_directory(
        download_dir,
        filename,
        as_attachment=True
    )


# 11.1. NATIVE FOLDER SELECTOR ENDPOINT

@app.route('/api/select-folder', methods=['POST'])
def api_select_folder():
    """Open the native folder picker and return the exact selected path."""
    try:
        if not webview.windows:
            return jsonify({
                'success': False,
                'error': 'The folder selector is unavailable.'
            }), 500

        directory = webview.windows[0].create_file_dialog(
            webview.FOLDER_DIALOG
        )

        if not directory:
            return jsonify({'success': False, 'cancelled': True})

        selected_path = (
            directory[0]
            if isinstance(directory, (tuple, list))
            else directory
        )

        selected_path = os.path.abspath(os.path.normpath(selected_path))

        return jsonify({
            'success': True,
            'path': normalize_download_dir(selected_path)
        })

    except Exception as e:
        print(f'Folder dialog error: {e}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500



# 12.      ==============================           FLASK & PYWEBVIEW APPLICATION ENTRY POINT      =====================================

@app.route('/api/history/urls', methods=['GET', 'DELETE'])
def api_url_history():
    if request.method == 'DELETE':
        with HISTORY_LOCK:
            _write_json_atomic(URL_HISTORY_FILE, [])
        return jsonify({'success': True})
    with HISTORY_LOCK:
        return jsonify({'success': True, 'items': _read_json_list(URL_HISTORY_FILE)})


@app.route('/api/history/downloads', methods=['GET', 'DELETE'])
def api_download_history():
    if request.method == 'DELETE':
        with HISTORY_LOCK:
            _write_json_atomic(DOWNLOAD_HISTORY_FILE, [])
        return jsonify({'success': True})
    with HISTORY_LOCK:
        items = _read_json_list(DOWNLOAD_HISTORY_FILE)
    # Refresh active task snapshots, without exposing cookie data or filesystem internals.
    with TASKS_LOCK:
        active = {task_id: dict(task) for task_id, task in TASKS.items()}
    if active:
        for item in items:
            snapshot = active.get(item.get('task_id'))
            if snapshot:
                item.update({key: snapshot.get(key) for key in ('status', 'percent', 'overall_percent', 'title', 'filename', 'error', 'subtitle_notice', 'subtitles_embedded')})
    items.sort(key=lambda item: item.get('updated_at', item.get('timestamp', 0)), reverse=True)
    return jsonify({'success': True, 'items': items[:HISTORY_LIMIT]})


@app.route('/api/theme', methods=['GET', 'POST'])
def api_theme():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        theme = str(data.get('theme') or '').lower()
        if theme not in ('dark', 'light'):
            return jsonify({'success': False, 'error': 'Theme must be dark or light.'}), 400
        try:
            _write_json_atomic(THEME_FILE, {'theme': theme})
        except OSError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 500
        return jsonify({'success': True, 'theme': theme})
    try:
        with open(THEME_FILE, 'r', encoding='utf-8') as handle:
            theme = json.load(handle).get('theme', 'dark')
    except (OSError, ValueError, TypeError):
        theme = 'dark'
    return jsonify({'success': True, 'theme': theme if theme in ('dark', 'light') else 'dark'})


@app.route('/api/reveal/<task_id>', methods=['POST'])
def api_reveal_download(task_id):
    with HISTORY_LOCK:
        records = _read_json_list(DOWNLOAD_HISTORY_FILE)
    record = next((item for item in records if item.get('task_id') == task_id), None)
    filename = (record or {}).get('filename')
    if not filename:
        return jsonify({'success': False, 'error': 'No completed filename is recorded for this task.'}), 404
    download_dir = os.path.abspath(CONFIG['download_dir'])
    filepath = os.path.abspath(os.path.join(download_dir, filename))
    try:
        inside_download_dir = os.path.commonpath([download_dir, filepath]) == download_dir
    except ValueError:
        inside_download_dir = False
    if not inside_download_dir or not os.path.isfile(filepath):
        return jsonify({'success': False, 'error': 'The completed file could not be found in the download folder.'}), 404
    try:
        if os.name == 'nt':
            subprocess.Popen(['explorer.exe', '/select,', filepath])
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', '-R', filepath])
        else:
            subprocess.Popen(['xdg-open', download_dir])
        return jsonify({'success': True})
    except OSError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


@app.route('/')
def index():
    """Render the main application UI interface."""
    try:
        with open(THEME_FILE, 'r', encoding='utf-8') as handle:
            theme = json.load(handle).get('theme', 'dark')
    except (OSError, ValueError, TypeError, AttributeError):
        theme = 'dark'
    return render_template('index.html', theme=theme if theme in ('dark', 'light') else 'dark')

if __name__ == '__main__':
    import threading

    flask_thread = threading.Thread(
        target=lambda: app.run(
            host='127.0.0.1',
            port=5000,
            debug=False,
            use_reloader=False
        ),
        daemon=True
    )
    flask_thread.start()

    import socket
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1', 5000), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)

    window = webview.create_window(
        'Beans Extractor',
        'http://127.0.0.1:5000',
        width=1024,
        height=768,
        resizable=True
    )

    webview.start(icon=os.path.join(BASE_DIR, 'icon.ico'))