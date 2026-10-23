# Beans Extractor

<p align="center">
  <strong>A modern, lightweight Windows desktop media-downloading application built with Python, Flask, pywebview, yt-dlp, and gallery-dl.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#requirements">Requirements</a> &bull;
  <a href="#installation-running-from-source">Installation</a> &bull;
  <a href="#basic-usage">Usage</a> &bull;
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

> **⚠️ Legal Notice:** Only download content you own, have permission to download, or are otherwise legally allowed to save. Respect each website's terms of service and creators' intellectual property rights.

---

## 🌟 Features

- **Modern Desktop UI:** Clean interface built with HTML, CSS, and JavaScript, powered natively via `pywebview`.
- **URL Inspection:** Preview and analyze supported media links before starting any download.
- **Resolution Control:** Choose from available video resolutions or select the best-quality option.
- **Audio Extraction:** Download high-quality audio tracks (e.g., MP3) with automated metadata and cover-art tagging where supported.
- **Image Gallery Support:** Detect and download supported multi-image galleries effortlessly using `gallery-dl`.
- **Subtitle Integration:** Optional subtitle downloading and embedding with preferred language selection.
- **Progress & Cancellation:** Real-time progress feedback and cancellation support for running tasks.
- **Persistent Settings:** Remembers user configurations, theme preferences, download destinations, and recent URL history between sessions.
- **Cookie Support:** Optional `cookies.txt` integration for accessing private or authenticated content securely.
- **FFmpeg Integration:** Seamless media merging, container conversion, and subtitle embedding.

*Supported sites and formats depend on underlying tools (`yt-dlp` and `gallery-dl`), website updates, and account access. Not every URL is guaranteed to work.*

---

## 📁 Project Structure

The repository maintains the following standard file layout:

```text
media-extractor-app/
├── app.py                 # Flask backend and pywebview bridge
├── requirements.txt       # Python package dependencies
├── .gitignore             # Excluded files (caches, downloads, credentials)
├── templates/
│   └── index.html         # Main user interface template
└── static/
    ├── main.js            # Core frontend logic
    ├── sidebar.js         # Navigation and layout controllers
    ├── style.css          # Primary styling rules
    └── sidebar.css        # Sidebar layout styling
```

---

## 🛠️ Requirements

- **Operating System:** Windows 10 or Windows 11
- **Python:** Python 3.10 or newer recommended
- **Core Python Packages:** `Flask`, `pywebview`, `yt-dlp`, `gallery-dl`
- **External Binary:** FFmpeg (required for video/audio merging, format conversion, and subtitle embedding)

---

## 🚀 Installation (Running from Source)

1. **Install Python:** Download and install Python from [python.org](https://www.python.org/downloads/). Ensure you check the box to **Add Python to PATH**.
2. **Install FFmpeg:** Install FFmpeg and make sure `ffmpeg` and `ffprobe` are accessible from your command line terminal.
3. **Clone or Open Repository:** Open Command Prompt or PowerShell inside the project directory.
4. **Install Python Dependencies:**
   ```powershell
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   ```
   *(Alternatively, install packages individually: `python -m pip install Flask pywebview yt-dlp gallery-dl`)*
5. **Launch the Application:**
   ```powershell
   python app.py
   ```

---

## 💡 Basic Usage

1. Launch Beans Extractor.
2. Paste your target media URL into the input field.
3. Click **Analyze Media** to inspect available formats.
4. Choose your preferred format:
   - For video: Select your desired resolution or best quality.
   - For audio: Select the audio/MP3 option.
   - For galleries: Pick the desired images from the extracted list.
5. Hit **Download** and track live progress in the app window.
6. Open **Settings** to customize your download directory or configure subtitles.

---

## ⚙️ Settings & Stored Data

Persistent configuration files and history logs are securely stored in your Windows roaming profile directory:

```text
%APPDATA%\Beans Extractor\
```

- `settings.json` — User preferences and application settings.
- `url_history.json` — History of recently inspected URLs.
- `download_history.json` — Record of past download tasks.
- `cookies.txt` — Optional authentication cookies file (kept strictly private).

---

## 🔧 Troubleshooting

### The application fails to start
- Run `python app.py` directly in PowerShell to check error outputs.
- Verify your Python installation using `python --version`.
- Re-run the dependency installation commands.

### Extraction or download fails
- Verify that the target URL is accessible in your web browser.
- Update your downloader components to the latest versions:
  ```powershell
  python -m pip install --upgrade yt-dlp gallery-dl
  ```
- If authentication is required, verify that your `cookies.txt` file is correctly configured.

### Video merging or conversion errors
- Ensure FFmpeg is installed and test it by running `ffmpeg -version` in a fresh terminal window.

---

## 🛡️ Disclaimer

Beans Extractor is provided as-is, without warranty of any kind. Web scrapers, extractors, and target websites change frequently. Users are entirely responsible for ensuring compliance with local laws, website terms of service, and content copyright restrictions.