<p align="center">
  <img src="assets/logo.png" alt="Beans Extractor logo" width="128" height="128">
</p>

<h1 align="center">Beans Extractor</h1>

<p align="center">
  <strong>Paste a link. Get the file.</strong><br>
  A free, open-source media downloader for Windows: video, audio and images from almost anywhere.
</p>

<p align="center">
  <a href="https://github.com/CoffeeUnderFlow/Beans-Extractor/releases/latest">Download</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#using-it">Using it</a> &bull;
  <a href="#run-from-source">Run from source</a> &bull;
  <a href="#build-the-installer">Build</a> &bull;
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

> **Legal notice:** Only download content you own, have permission to download, or are otherwise legally allowed to save. Respect each website's terms of service and creators' rights.

---

## Download

Get **BeansExtractor_Setup.exe** from the [latest release](https://github.com/CoffeeUnderFlow/Beans-Extractor/releases/latest) and run it. It installs for the current user only (no administrator rights needed) and includes everything the app needs, including FFmpeg.

Requires Windows 10 or 11 (64-bit).

## Features

- **Preview before you download.** Paste a link and see the title, thumbnail and available formats first.
- **Video, audio and images.** Pick a resolution, extract MP3 audio with tags and cover art, or choose images from a gallery.
- **Subtitles.** Optionally download and embed subtitles in your preferred language.
- **Queue and progress.** Live progress, cancel, retry failed downloads, and a history that never deletes your files.
- **Stays up to date.** Checks for new app versions and can update its downloader engine (yt-dlp) from inside the app, because sites change often.
- **Private by design.** Everything runs on your PC. The app only contacts the sites you paste, plus GitHub and PyPI for update checks.
- **Cookies.** Optional `cookies.txt` (Netscape format) for content that needs you to be signed in.
- **Dark and light themes.**

Supported sites depend on [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [gallery-dl](https://github.com/mikf/gallery-dl) and on the sites themselves. Not every link is guaranteed to work.

## Using it

1. Open Beans Extractor.
2. Paste a media link and press **Extract**.
3. Choose a format: a video resolution, audio only (MP3), or the images you want.
4. Press **Download**. Progress shows in the Downloads panel.
5. Use **Settings** to change the download folder, subtitles, theme or cookies.

Right-click the link field for a quick **Paste**.

## Your data

Settings and history are stored separately from the program, in:

```text
%APPDATA%\Beans Extractor\
```

| File | Purpose |
|---|---|
| `settings.json` | Preferences |
| `url_history.json` | Recently extracted links |
| `download_history.json` | Past downloads |
| `cookies.txt` | Optional sign-in cookies (keep private) |

Reinstalling or updating the app keeps this folder. Delete it if you want a clean start.

## Run from source

Requirements: Windows 10/11, Python 3.10 or newer, and FFmpeg (`ffmpeg` and `ffprobe`) available on your PATH, or placed next to `app.py`.

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python app.py
```

`requirements.txt` installs the Python dependencies, including `yt-dlp[curl-cffi]` (needed for sites such as TikTok that check for a real browser).

## Build the installer

You need [PyInstaller](https://pyinstaller.org/) and [Inno Setup](https://jrsoftware.org/isinfo.php).

```powershell
python -m PyInstaller BeansExtractor.spec --noconfirm --clean
```

This creates `dist\BeansExtractor\`. Then open `installer.iss` in Inno Setup and compile it to get `BeansExtractor_Setup.exe`. Place `ffmpeg.exe` (and `ffprobe.exe` if you have it) in the project folder before building so they are bundled.

## Project layout

```text
Beans-Extractor/
├── app.py                    # Flask backend and pywebview window
├── requirements.txt
├── BeansExtractor.spec       # PyInstaller build
├── installer.iss             # Inno Setup installer
├── icon.ico                  # App icon
├── LICENSE                   # GPL-2.0-only
├── THIRD_PARTY_NOTICES.md    # Licences of bundled components
├── licenses/
│   └── GPL-3.0.txt           # Licence of the bundled FFmpeg build
├── assets/                   # Logo and images for this README
├── templates/
│   ├── index.html            # Main screen
│   └── sidebar.html          # Sidebar, downloads panel, settings
└── static/
    ├── main.js               # Core front-end logic
    ├── sidebar.js            # Navigation, drawer, settings
    ├── style.css             # Home and format panel styles
    └── sidebar.css           # Design tokens, sidebar, drawer, settings
```


## Licence

Beans Extractor is licensed under **GPL-2.0-only**. See [LICENSE](LICENSE).
It uses and ships other software under their own licences, including FFmpeg (GPL-3.0-or-later), gallery-dl (GPL-2.0), and yt-dlp (Unlicense). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Disclaimer

Provided as is, without warranty. Extractors and websites change often. You are responsible for following the law, each site's terms, and content copyright.

---

<p align="center">
  Made by <a href="https://coffeeunderflow.in/">CoffeeUnderFlow</a>
</p>
