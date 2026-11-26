/* Beans Extractor — extractor page logic (inspect, format pick, start download, settings). */

let activeMedia = null;
let errorTimeout = null;
let imageGallery = [];
let currentImageIndex = 0;
let selectedImageIndexes = new Set();
let selectedFormat = { mode: 'video', height: null };

const $ = id => document.getElementById(id);
const ANSI_PATTERN = /\x1B\[[0-?]*[ -\/]*[@-~]/g;

const settingsOpen = () => $('settings-modal')?.style.display === 'flex';

/* ---------- Errors ----------
   While the settings modal is open the page banner is hidden behind its backdrop,
   so errors are shown inside the modal instead. */

const clearError = () => {
    clearTimeout(errorTimeout);
    const banner = $('error-banner');
    if (banner) banner.style.display = 'none';
    const modalError = $('settings-error');
    if (modalError) modalError.hidden = true;
};

const showError = msg => {
    clearError();
    const text = String(msg).replace(ANSI_PATTERN, '');
    if (settingsOpen() && $('settings-error')) {
        $('settings-error').textContent = text;
        $('settings-error').hidden = false;
    } else if (window.beansToast) {
        window.beansToast(text, 'error', 7000);
        return;
    } else if ($('error-banner')) {
        $('error-banner').textContent = text;
        $('error-banner').style.display = 'block';
    } else {
        return;
    }
    errorTimeout = setTimeout(clearError, 5000);
};

const getJsonResponse = async response => {
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(`Backend returned invalid JSON (HTTP ${response.status})`);
    }
    if (!response.ok) {
        const error = new Error(data?.error || `Backend request failed (HTTP ${response.status})`);
        error.code = data?.code;
        throw error;
    }
    return data;
};

const formatDuration = value => {
    const total = Number(value || 0);
    if (!total) return '0:00';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    return h
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
};

/* ---------- Connection status ----------
   The browser's online flag can say "online" on a dead wifi, so the backend is asked as well. */

let offlineTimer = null;
const setOfflineBanner = on => { if ($('beans-offline')) $('beans-offline').hidden = !on; };
const clearOffline = () => {
    setOfflineBanner(false);
    clearInterval(offlineTimer);
    offlineTimer = null;
};
const checkOnline = async () => {
    try {
        const data = await (await fetch('/api/ping', { cache: 'no-store' })).json();
        if (data.online) clearOffline();
    } catch { /* keep the banner */ }
};
const markOffline = () => {
    setOfflineBanner(true);
    if (!offlineTimer) offlineTimer = setInterval(checkOnline, 4000);
};
window.addEventListener('offline', markOffline);
window.addEventListener('online', checkOnline);
if (navigator.onLine === false) markOffline();

/* ---------- Step 1: inspect URL ---------- */

$('inspect-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    clearError();

    const input = $('url-input');
    const url = input?.value.trim();
    const btn = $('inspect-btn');

    if (!url) {
        showError('Paste a link first.');
        return;
    }

    if (navigator.onLine === false) {
        markOffline();
        showError('No internet connection. Check your network and try again.');
        return;
    }

    if (btn) {
        btn.disabled = true;
        $('btn-text').style.display = 'none';
        $('btn-loader').style.display = 'flex';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch('/api/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal: controller.signal
        });
        const data = await getJsonResponse(response);
        if (!data.success || !data.data) throw new Error(data.error || 'Failed to extract metadata.');

        activeMedia = { ...data.data, original_url: data.data.original_url || url };

        $('phase-2').style.display = 'none';
        $('phase-3').style.display = 'block';
        renderDashboard(activeMedia);
    } catch (err) {
        console.error('[Inspect] Error:', err);
        if (err.name === 'AbortError') {
            showError('This is taking too long. Check your connection and try again.');
        } else {
            if (err.code === 'offline') markOffline();
            showError(err.message || 'Failed to contact engine.');
        }
        input?.select();
    } finally {
        clearTimeout(timer);
        if (btn) {
            btn.disabled = false;
            $('btn-text').style.display = 'inline';
            $('btn-loader').style.display = 'none';
        }
    }
});

/* ---------- Step 2: render ---------- */

const renderDashboard = media => {
    const isImg = media.formats?.[0]?.format_id?.startsWith('image_');
    $('video-ui').style.display = isImg ? 'none' : 'block';
    $('image-ui').style.display = isImg ? 'block' : 'none';
    if (isImg) renderImageUI(media.formats || []);
    else renderVideoUI(media);
};

const selectPill = (el, mode, height) => {
    document.querySelectorAll('#quality-grid .pill-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    selectedFormat = { mode, height };
};

const renderVideoUI = media => {
    $('meta-thumb').src = media.thumbnail || '';
    $('meta-title').textContent = media.title || 'Unknown Title';
    $('meta-duration').textContent = `Duration: ${formatDuration(media.duration)}`;

    const grid = $('quality-grid');
    grid.innerHTML = '';

    const addPill = (text, cls, action) => {
        const pill = document.createElement('div');
        pill.className = cls;
        pill.textContent = text;
        pill.onclick = () => action(pill);
        grid.appendChild(pill);
    };

    // The backend already de-duplicates heights; just make sure the order is highest first.
    const formats = (media.formats || [])
        .map(f => ({ ...f, height: Number(f.height) || 0 }))
        .filter(f => f.height > 0)
        .sort((a, b) => b.height - a.height);

    if (formats.length) {
        formats.forEach((f, index) => {
            addPill(
                f.resolution || `${f.height}p`,
                `pill-btn ${index === 0 ? 'active' : ''}`,
                pill => selectPill(pill, 'video', f.height)
            );
        });
        selectedFormat = { mode: 'video', height: formats[0].height };
    } else {
        addPill('Best Quality', 'pill-btn active', pill => selectPill(pill, 'video', null));
        selectedFormat = { mode: 'video', height: null };
    }

    addPill('Audio·MP3', 'pill-btn audio', pill => selectPill(pill, 'mp3', null));
};

/* ---------- Image gallery ---------- */

const updateCarousel = idx => {
    if (!imageGallery[idx]) return;
    currentImageIndex = idx;
    $('carousel-main-img').src = imageGallery[idx].url;
    $('carousel-prev').disabled = idx === 0;
    $('carousel-next').disabled = idx === imageGallery.length - 1;
};

const updateMainDownloadButton = () => {
    const btn = $('dl-selected-btn');
    if (!btn) return;
    const count = selectedImageIndexes.size;
    btn.textContent = count ? `Download ${count} Image${count > 1 ? 's' : ''}` : 'Select an image to download';
    btn.disabled = !count;
};

const renderImageGrid = () => {
    const grid = $('image-grid');
    grid.innerHTML = '';

    imageGallery.forEach((_, i) => {
        const pill = document.createElement('div');
        pill.id = `img-pill-${i}`;
        pill.className = `pill-btn ${selectedImageIndexes.has(i) ? 'active' : ''}`;
        pill.textContent = `Image ${i + 1}`;
        pill.onclick = () => {
            if (selectedImageIndexes.has(i)) selectedImageIndexes.delete(i);
            else selectedImageIndexes.add(i);
            pill.classList.toggle('active');
            updateCarousel(i);
            updateMainDownloadButton();
        };
        grid.appendChild(pill);
    });

    if (imageGallery.length > 1) {
        const allPill = document.createElement('div');
        allPill.className = 'pill-btn';
        allPill.textContent = 'Select All';
        allPill.style.borderStyle = 'dashed';
        allPill.style.borderColor = 'var(--accent)';
        allPill.onclick = () => {
            const selectAll = selectedImageIndexes.size !== imageGallery.length;
            selectedImageIndexes.clear();
            imageGallery.forEach((_, i) => {
                if (selectAll) selectedImageIndexes.add(i);
                $(`img-pill-${i}`).classList.toggle('active', selectAll);
            });
            allPill.classList.toggle('active', selectAll);
            updateMainDownloadButton();
        };
        grid.appendChild(allPill);
    }
    updateMainDownloadButton();
};

const renderImageUI = formats => {
    imageGallery = formats;
    currentImageIndex = 0;
    selectedImageIndexes = new Set(formats.length ? [0] : []);

    const visibility = formats.length > 1 ? 'visible' : 'hidden';
    $('carousel-prev').style.visibility = visibility;
    $('carousel-next').style.visibility = visibility;
    $('carousel-prev').onclick = () => currentImageIndex > 0 && updateCarousel(currentImageIndex - 1);
    $('carousel-next').onclick = () => currentImageIndex < imageGallery.length - 1 && updateCarousel(currentImageIndex + 1);

    updateCarousel(0);
    renderImageGrid();
};

/* ---------- Start downloads ----------
   The server accepts the task and returns immediately. Progress, cancel and
   errors for a running task live in the Downloads drawer (sidebar.js). */

const openDownloadsDrawer = () => $('beans-downloads-button')?.click();

const triggerDownload = async () => {
    if (!activeMedia) {
        showError('Paste a link first.');
        return;
    }
    clearError();

    const btn = $('download-btn');
    if (btn) btn.disabled = true;

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: activeMedia.original_url, ...selectedFormat })
        });
        const data = await getJsonResponse(response);
        if (!data.success || !data.task_id) throw new Error(data.error || 'Failed to start download.');

        resetToPhase2();
        openDownloadsDrawer();
    } catch (err) {
        showError(err.message || 'Failed to start download.');
    } finally {
        if (btn) btn.disabled = false;
    }
};

const triggerImageDownload = async () => {
    if (!activeMedia) {
        showError('No media has been analyzed yet.');
        return;
    }
    clearError();

    const indexes = Array.from(selectedImageIndexes).sort((a, b) => a - b);
    if (!indexes.length) {
        showError('No images selected.');
        return;
    }

    // Capture everything before the UI is reset.
    const pageUrl = activeMedia.original_url;
    const images = indexes.map(i => ({
        index: i,
        format_id: imageGallery[i].format_id,
        image_url: imageGallery[i].url
    }));

    // The server saves each image straight into the download folder (no browser
    // download step), and records success or failure in the Downloads drawer.
    images.forEach(async image => {
        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: pageUrl,
                    mode: 'image',
                    format_id: image.format_id,
                    image_url: image.image_url
                })
            });
            await getJsonResponse(response);
        } catch (err) {
            console.error(`Image ${image.index + 1} download failed:`, err);
        }
    });

    resetToPhase2();
    openDownloadsDrawer();
};

const resetToPhase2 = () => {
    activeMedia = null;
    imageGallery = [];
    selectedImageIndexes = new Set();
    clearError();

    $('phase-2').style.display = 'block';
    $('phase-3').style.display = 'none';
    if ($('download-btn')) $('download-btn').disabled = false;

    const input = $('url-input');
    if (input) {
        input.value = '';
        input.focus();
    }
};

/* ---------- Paste context menu ---------- */

const ctx = document.createElement('div');
ctx.className = 'context-menu';
ctx.setAttribute('role', 'menu');
ctx.innerHTML = '<button type="button" class="context-item" role="menuitem">Paste</button>';
document.body.appendChild(ctx);

const hideCtx = () => { ctx.style.display = 'none'; };

// Like the iOS edit menu: a small capsule floating just above the pointer.
$('url-input')?.addEventListener('contextmenu', e => {
    e.preventDefault();
    ctx.style.display = 'block';
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    let x = e.clientX - w / 2;
    let y = e.clientY - h - 14;
    if (y < 8) y = e.clientY + 18;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    ctx.style.left = `${x}px`;
    ctx.style.top = `${y}px`;
});

document.addEventListener('click', e => { if (!ctx.contains(e.target)) hideCtx(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });
window.addEventListener('blur', hideCtx);

// Paste reads the clipboard through the app itself (no browser permission prompt);
// the browser clipboard API is only a fallback.
ctx.addEventListener('click', async () => {
    hideCtx();
    const input = $('url-input');
    try {
        const data = await getJsonResponse(await fetch('/api/clipboard', { cache: 'no-store' }));
        input.value = (data.text || '').trim();
        input.focus();
        return;
    } catch { /* fall back below */ }
    try {
        input.value = (await navigator.clipboard.readText()).trim();
        input.focus();
    } catch {
        showError('Could not read the clipboard. Try Ctrl+V instead.');
    }
});
/* ---------- Settings ---------- */

const updateSubtitleLanguageVisibility = () => {
    const group = $('settings-subtitle-language-group');
    if (group) group.style.display = $('settings-include-subtitles')?.checked ? 'flex' : 'none';
};

const openSettingsModal = async () => {
    let loadError = null;

    try {
        const response = await fetch('/api/settings', { cache: 'no-store' });
        const data = await getJsonResponse(response);
        const config = data.config || {};

        $('setting-download-dir').value = config.download_dir || '';
        $('settings-include-subtitles').checked = config.include_subtitles === true;
        $('settings-subtitle-language').value = config.subtitle_language || 'en';
    } catch (err) {
        console.error('Failed to load settings', err);
        loadError = err.message || 'Failed to load settings.';
    }

    updateSubtitleLanguageVisibility();
    $('settings-modal').style.display = 'flex';
    if (loadError) showError(loadError);
};

const closeSettingsModal = () => {
    clearError();
    if ($('settings-modal')) $('settings-modal').style.display = 'none';
    if ($('cookie-upload-status')) $('cookie-upload-status').textContent = '';
};

const saveSettings = async () => {
    const download_dir = $('setting-download-dir')?.value.trim() || '';
    if (!download_dir) {
        showError('Please select a download folder.');
        return;
    }

    const saveButton = $('settings-save-btn');
    if (saveButton) saveButton.disabled = true;

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                download_dir,
                include_subtitles: $('settings-include-subtitles').checked === true,
                subtitle_language: $('settings-subtitle-language').value || 'en'
            })
        });
        const data = await getJsonResponse(response);
        if (!data.success) throw new Error(data.error || 'Failed to save settings.');
        closeSettingsModal();
    } catch (err) {
        console.error('Failed to save settings', err);
        showError(err.message || 'Failed to save settings.');
    } finally {
        if (saveButton) saveButton.disabled = false;
    }
};

const uploadCookiesFile = async () => {
    const fileInput = $('setting-cookies-file');
    const status = $('cookie-upload-status');
    const setStatus = (text, color) => {
        status.textContent = text;
        status.style.color = color;
    };

    if (!fileInput.files.length) {
        setStatus('Please select a cookies.txt file first.', 'var(--error-text)');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const response = await fetch('/api/cookies', { method: 'POST', body: formData });
        const data = await getJsonResponse(response);
        if (!data.success) throw new Error(data.error || 'Upload failed.');
        setStatus('Uploaded successfully!', 'var(--success)');
    } catch (err) {
        console.error('Cookie upload error', err);
        setStatus(`Upload failed: ${err.message}`, 'var(--error-text)');
    }
};

// The backend appends/validates the "Beans Extractor" folder name, so use its answer as-is.
const selectFolder = async () => {
    try {
        const response = await fetch('/api/select-folder', { method: 'POST' });
        const data = await getJsonResponse(response);
        if (data.cancelled) return;
        if (data.success && data.path) $('setting-download-dir').value = data.path;
    } catch (err) {
        console.error('Failed to open folder dialog', err);
        showError(err.message || 'Could not open folder selector.');
    }
};

window.addEventListener('DOMContentLoaded', () => {
    $('settings-include-subtitles')?.addEventListener('change', updateSubtitleLanguageVisibility);
    updateSubtitleLanguageVisibility();
});

// Functions used by inline onclick handlers in the HTML.
window.triggerDownload = triggerDownload;
window.triggerImageDownload = triggerImageDownload;
window.resetToPhase2 = resetToPhase2;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettings = saveSettings;
window.selectFolder = selectFolder;
window.uploadCookiesFile = uploadCookiesFile;