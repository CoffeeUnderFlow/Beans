#!/usr/bin/env python3
"""Apply the Beans Extractor app.py fixes in place.

Usage:  python patch_app.py path/to/app.py

Writes app.py.bak first. Every replacement must match exactly once; if any
snippet is missing (e.g. app.py was already edited) the script stops and
changes nothing.
"""
import shutil
import sys

PATCHES = [
    # 1. 'interrupted' (and 'error') are finished states. Without this, old
    #    interrupted records are rewritten again on every launch.
    (
        "TERMINAL_TASK_STATUSES = {'completed', 'failed', 'cancelled'}",
        "TERMINAL_TASK_STATUSES = {'completed', 'failed', 'error', 'cancelled', 'interrupted'}",
    ),
    # 2. Comment/docstring said "single active task"; the code allows two at once.
    (
        "# Global task registry. A single active task is allowed so that cancelling and\n"
        "# starting a new download cannot leave two yt-dlp workers writing the same file.",
        "# Global task registry. Up to two downloads run at once (DOWNLOAD_SLOTS); extra tasks\n"
        "# wait in the queue. Two tasks with identical URL + options are refused, because they\n"
        "# would share one .beans cache folder and one output filename.",
    ),
    (
        '"""Start one task, refusing overlapping workers until the prior worker has exited."""',
        '"""Start a download task (two run at once; extra tasks are queued)."""',
    ),
    # 3. browser_choice is never read (no browser cookie extraction any more).
    ("    'browser_choice': 'chrome',\n", ""),
    # 4. Refuse a second task with the same cache key while the first is still active.
    (
        "    cache_key = make_download_cache_key(url, mode, height, format_id)\n"
        "    task_id = str(uuid.uuid4())\n",
        "    cache_key = make_download_cache_key(url, mode, height, format_id)\n"
        "    with TASKS_LOCK:\n"
        "        for other in TASKS.values():\n"
        "            if (other.get('cache_key') == cache_key\n"
        "                    and other.get('status') not in TERMINAL_TASK_STATUSES):\n"
        "                return jsonify({\n"
        "                    'success': False,\n"
        "                    'error': 'This media is already being downloaded with the same settings.'\n"
        "                }), 409\n"
        "    task_id = str(uuid.uuid4())\n",
    ),
    (
        "            'task_id': task_id, 'url': url, 'title': url, 'mode': str(mode or 'video'),",
        "            'task_id': task_id, 'cache_key': cache_key, 'url': url, 'title': url, 'mode': str(mode or 'video'),",
    ),
    # 5. The HTTP-416 retry folder was never cleaned up after success.
    (
        "shutil.rmtree(task_temp_dir, ignore_errors=True)\n            with TASKS_LOCK:\n                ACTIVE_PROCESSES.pop(task_id, None)",
        "shutil.rmtree(task_temp_dir, ignore_errors=True)\n                shutil.rmtree(task_temp_dir + '_fresh', ignore_errors=True)\n            with TASKS_LOCK:\n                ACTIVE_PROCESSES.pop(task_id, None)",
    ),
    # 6. Folder picker returns the already-normalised "…\Beans Extractor" path,
    #    so the frontend no longer hard-codes a Windows backslash.
    (
        "'path': selected_path",
        "'path': normalize_download_dir(selected_path)",
    ),
    # 7. os.path.commonpath raises ValueError for paths on different drives (Windows).
    (
        "    if os.path.commonpath([download_dir, filepath]) != download_dir or not os.path.isfile(filepath):",
        "    try:\n"
        "        inside_download_dir = os.path.commonpath([download_dir, filepath]) == download_dir\n"
        "    except ValueError:\n"
        "        inside_download_dir = False\n"
        "    if not inside_download_dir or not os.path.isfile(filepath):",
    ),
    # 8. Render the saved theme into the page (no dark flash for light-theme users).
    (
        "    return render_template('index.html')",
        "    try:\n"
        "        with open(THEME_FILE, 'r', encoding='utf-8') as handle:\n"
        "            theme = json.load(handle).get('theme', 'dark')\n"
        "    except (OSError, ValueError, TypeError, AttributeError):\n"
        "        theme = 'dark'\n"
        "    return render_template('index.html', theme=theme if theme in ('dark', 'light') else 'dark')",
    ),
    # 9. Only the app's own origin may call the local API (blocks other web pages
    #    and DNS-rebinding hosts from driving /api/* on 127.0.0.1).
    (
        "@app.after_request\ndef add_header(response):",
        "ALLOWED_HOSTS = {'127.0.0.1:5000', 'localhost:5000'}\n"
        "\n"
        "\n"
        "@app.before_request\n"
        "def reject_foreign_requests():\n"
        "    if request.host not in ALLOWED_HOSTS:\n"
        "        return jsonify({'success': False, 'error': 'Unexpected host.'}), 403\n"
        "    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):\n"
        "        from urllib.parse import urlsplit\n"
        "        origin = request.headers.get('Origin') or request.headers.get('Referer')\n"
        "        if origin and urlsplit(origin).netloc not in ALLOWED_HOSTS:\n"
        "            return jsonify({'success': False, 'error': 'Cross-origin requests are not allowed.'}), 403\n"
        "\n"
        "\n"
        "@app.after_request\ndef add_header(response):",
    ),
    # 10. Never expose the Werkzeug debugger, even on localhost.
    ("            debug=True,", "            debug=False,"),
    # 11. Wait until Flask is actually listening before opening the window.
    (
        "    flask_thread.start()",
        "    flask_thread.start()\n"
        "\n"
        "    import socket\n"
        "    for _ in range(50):\n"
        "        try:\n"
        "            with socket.create_connection(('127.0.0.1', 5000), timeout=0.2):\n"
        "                break\n"
        "        except OSError:\n"
        "            time.sleep(0.1)",
    ),
]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)

    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as handle:
        text = handle.read()

    problems = []
    for index, (old, _new) in enumerate(PATCHES, start=1):
        count = text.count(old)
        if count != 1:
            problems.append(f'  patch #{index}: expected 1 match, found {count}: {old[:70]!r}')
    if problems:
        sys.exit('Nothing changed. These snippets did not match:\n' + '\n'.join(problems))

    shutil.copyfile(path, path + '.bak')
    for old, new in PATCHES:
        text = text.replace(old, new, 1)

    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)
    print(f'Applied {len(PATCHES)} patches to {path} (backup: {path}.bak)')


if __name__ == '__main__':
    main()
