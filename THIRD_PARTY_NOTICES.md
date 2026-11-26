# Third-party notices — Beans Extractor

Beans Extractor itself is licensed under **GPL-2.0-only** (see `LICENSE`).
It uses and ships the following separately licensed components. Each keeps its own licence and copyright.

> DRAFT: regenerate the Python-package section from the exact build with
> `pip install pip-licenses` then `pip-licenses --format=markdown --with-urls`,
> and compare it with the `*.dist-info` folders inside `_internal`.

## FFmpeg (separate program, `ffmpeg.exe`)

- **Version / build:** FFmpeg 9.0.2, "essentials" build by gyan.dev (confirm with `ffmpeg -version` on the file inside the installer)
- **Licence:** GNU General Public License, version 3 or (at your option) any later version. The build is configured with `--enable-gpl --enable-version3`. Full text: `licenses/GPL-3.0.txt`.
- **How it is used:** Beans Extractor starts `ffmpeg.exe` as a separate program (merging streams, extracting MP3 audio, embedding subtitles). It is not linked into Beans Extractor.
- **Source code:** FFmpeg source: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz · Build details and libraries: https://www.gyan.dev/ffmpeg/builds/
  (verify both links before publishing; ideally also attach the FFmpeg source archive to the matching GitHub release)

## Python packages and tools

| Component | Licence | Notes |
|---|---|---|
| gallery-dl | GPL-2.0-only | Image/gallery downloads |
| mutagen | GPL-2.0-or-later | Audio tags |
| yt-dlp | Unlicense | May be replaced by a newer copy via Settings → About → Downloader engine |
| yt-dlp-ejs | Unlicense AND MIT AND ISC | Bundled with yt-dlp |
| curl_cffi | MIT | Browser-like requests (TikTok); includes libcurl-impersonate and BoringSSL (see its licence files) |
| cffi, pycparser | MIT, BSD-3-Clause | Dependencies of curl_cffi |
| certifi | MPL-2.0 | Unmodified. Source: https://github.com/certifi/python-certifi |
| requests, urllib3, idna, charset-normalizer | Apache-2.0 / MIT / BSD | |
| Flask, Werkzeug, Jinja2, MarkupSafe, itsdangerous, click, blinker | BSD-3-Clause | |
| pywebview, proxy_tools, bottle, pythonnet, typing_extensions | BSD-3-Clause / MIT / PSF | Desktop window |
| cryptography | Apache-2.0 OR BSD-3-Clause | Used under the BSD-3-Clause option |
| Python | PSF License | |

Microsoft Edge WebView2 Runtime, if installed or redistributed, is covered by Microsoft's own terms.

## Source code of Beans Extractor

https://github.com/CoffeeUnderFlow/Beans-Extractor (each release has a matching tag).
