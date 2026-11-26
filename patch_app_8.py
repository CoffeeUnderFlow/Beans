#!/usr/bin/env python3
"""Show a short, readable message when a link cannot be read (instead of the raw yt-dlp error).

Usage:  python patch_app_8.py path/to/app.py
Needs patch_app_2.py applied (it provides classify_error). Writes app.py.bak first.
The full technical error is still printed in the terminal / log as "[Inspect] yt-dlp error: ...".
"""
import shutil
import sys

OLD = '''            message = (
                'Could not find supported video or images at this URL. '
                'The link may be unsupported, private, or require authentication.'
            )

            if ytdlp_error:
                message += f'\\nyt-dlp: {strip_ansi(ytdlp_error)}'
'''

NEW = '''            print(f'[Inspect] yt-dlp error: {strip_ansi(ytdlp_error or "")}')
            message = "Couldn't read this link. It may be unsupported, private, or need sign-in."
'''


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    text = open(path, 'r', encoding='utf-8').read()
    problems = []
    if text.count(OLD) != 1:
        problems.append(f'  expected 1 match of the error message block, found {text.count(OLD)} (already patched?)')
    if 'def classify_error' not in text:
        problems.append('  patch_app_2.py must be applied first (classify_error missing).')
    if problems:
        sys.exit('Nothing changed:\n' + '\n'.join(problems))
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(text.replace(OLD, NEW, 1))
    print(f'Patched {path} (backup: {path}.bak)')


if __name__ == '__main__':
    main()
