# Media Extractor

A lightweight, authenticated web pipeline built with Flask and `yt-dlp` to inspect, extract, and convert media streams from YouTube and other supported platforms.

---

## Features

* **Dynamic Auth Gate:** Session-protected interface with daily revolving access PINs.
* **Stream Quality Selector:** Auto-detects available video resolutions (up to 4K) with client-side selection.
* **Audio Extraction with Artwork:** One-click MP3 conversion at 192kbps with automatic ID3 tagging and embedded cover artwork.
* **Datacenter Anti-Block Protection:** Integrated Cloudflare WARP SOCKS5 proxy (`wireproxy`) to bypass datacenter IP restrictions on cloud hosts.
* **Dual Theme Engine:** Dark and light mode support with URL query override (`?theme=light|dark`) and `window.postMessage` parent frame integration.
* **Automated Housekeeping:** Background cleanup thread pruning downloaded artifacts older than 15 minutes.

---

## Project Structure

```text
media-extractor/
├── static/
│   ├── favicon.svg
│   ├── main.js
│   └── style.css
├── templates/
│   └── index.html
├── app.py
├── Dockerfile
├── requirements.txt
├── start.sh
├── wireproxy.conf     # (Local/Render Secret - do not commit)
├── cookies.txt        # (Local/Render Secret - do not commit)
└── README.md