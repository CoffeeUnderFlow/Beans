let activeMedia, activePoller, errorTimeout, activeTaskId = null, cancelRequestedByUI = false, imageGallery = [], currentImageIndex = 0, selectedImageIndexes = new Set(), selectedFormat = { mode: 'video', height: null };

const $ = id => document.getElementById(id);

const SUBTITLE_LANGUAGE_OPTIONS = [
    ['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'],
    ['de', 'German'], ['pt', 'Portuguese'], ['ar', 'Arabic'], ['bn', 'Bengali'],
    ['zh-Hans', 'Chinese (Simplified)'], ['zh-Hant', 'Chinese (Traditional)'],
    ['ja', 'Japanese'], ['ko', 'Korean'], ['ru', 'Russian'], ['it', 'Italian'],
    ['ur', 'Urdu'], ['pa', 'Punjabi'], ['ta', 'Tamil'], ['te', 'Telugu'],
    ['mr', 'Marathi'], ['id', 'Indonesian'], ['tr', 'Turkish'], ['vi', 'Vietnamese'],
    ['th', 'Thai'], ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'],
    ['uk', 'Ukrainian'], ['fa', 'Persian'], ['el', 'Greek'], ['he', 'Hebrew']
];

const ensureSubtitleSettingsUI = () => {
    const modal = $('settings-modal');
    if (!modal) return;

    // Style the settings controls whether they came from index.html or are added dynamically.
    if (!$('media-extractor-subtitle-setting-style')) {
        const style = document.createElement('style');
        style.id = 'media-extractor-subtitle-setting-style';
        style.textContent = `
            #subtitle-settings-block { margin:18px 0; padding:16px; border:1px solid var(--border-color,rgba(128,128,128,.3)); border-radius:12px; }
            #subtitle-settings-block .me-subtitle-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
            #subtitle-settings-block .me-subtitle-title { font-weight:600; margin-bottom:4px; }
            #subtitle-settings-block .me-subtitle-help { font-size:.88em; opacity:.75; line-height:1.4; }
            #subtitle-settings-block .me-subtitle-language { margin-top:14px; }
            #subtitle-settings-block .me-subtitle-language label { display:block; margin-bottom:7px; font-weight:500; }
            #settings-subtitle-language { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; border:1px solid var(--border-color,rgba(128,128,128,.4)); background:var(--input-bg,#2a2a3d); color:inherit; }
            .me-subtitle-switch { position:relative; display:inline-block; width:46px; height:26px; flex:0 0 46px; }
            .me-subtitle-switch input { position:absolute; opacity:0; width:1px; height:1px; }
            .me-subtitle-slider { position:absolute; inset:0; cursor:pointer; border-radius:26px; background:#858585; transition:background .2s; }
            .me-subtitle-slider:before { content:''; position:absolute; height:20px; width:20px; left:3px; top:3px; border-radius:50%; background:#fff; transition:transform .2s; }
            .me-subtitle-switch input:checked + .me-subtitle-slider { background:var(--accent,#ff9800); }
            .me-subtitle-switch input:checked + .me-subtitle-slider:before { transform:translateX(20px); }
            .me-subtitle-switch input:focus-visible + .me-subtitle-slider { outline:2px solid var(--accent,#ff9800); outline-offset:2px; }
        `;
        document.head.appendChild(style);
    }

    let block = $('subtitle-settings-block');
    if (!block) {
        block = document.createElement('section');
        block.id = 'subtitle-settings-block';
        block.innerHTML = `
            <div class="me-subtitle-row">
                <div>
                    <div class="me-subtitle-title">Include Subtitles</div>
                    <div class="me-subtitle-help">Optional. When off, no subtitle-specific lookup, downloading, or embedding is performed.</div>
                </div>
                <label class="me-subtitle-switch" aria-label="Include subtitles">
                    <input id="settings-include-subtitles" type="checkbox" aria-label="Include subtitles">
                    <span class="me-subtitle-slider"></span>
                </label>
            </div>
            <div id="settings-subtitle-language-group" class="me-subtitle-language" style="display:none">
                <label for="settings-subtitle-language">Subtitle language</label>
                <select id="settings-subtitle-language"></select>
                <div class="me-subtitle-help" style="margin-top:7px">Only this language will be used. Creator subtitles are preferred; auto-generated subtitles are the fallback.</div>
            </div>
        `;

        const root = modal.querySelector('.modal-content, .modal-body') || modal.firstElementChild || modal;
        const cookieInput = $('setting-cookies-file');
        const cookieGroup = cookieInput?.closest('.setting-group, .settings-group, .form-group, .setting-row');
        const dirInput = $('setting-download-dir');
        const dirGroup = dirInput?.closest('.setting-group, .settings-group, .form-group, .setting-row')
            || dirInput?.parentElement?.parentElement;

        if (cookieGroup && cookieGroup !== root && cookieGroup.parentElement) {
            cookieGroup.parentElement.insertBefore(block, cookieGroup);
        } else if (dirGroup && dirGroup !== root && dirGroup.parentElement) {
            dirGroup.parentElement.insertBefore(block, dirGroup.nextSibling);
        } else {
            root.appendChild(block);
        }
    }

    const languageSelect = $('settings-subtitle-language');
    if (languageSelect && languageSelect.options.length === 0) {
        SUBTITLE_LANGUAGE_OPTIONS.forEach(([code, label]) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = label;
            languageSelect.appendChild(option);
        });
    }
    if (languageSelect && !languageSelect.value) languageSelect.value = 'en';

    const toggle = $('settings-include-subtitles');
    if (toggle && toggle.dataset.subtitleVisibilityBound !== '1') {
        toggle.addEventListener('change', updateSubtitleLanguageVisibility);
        toggle.dataset.subtitleVisibilityBound = '1';
    }

    updateSubtitleLanguageVisibility();
};

const updateSubtitleLanguageVisibility = () => {
    const toggle = $('settings-include-subtitles');
    const group = $('settings-subtitle-language-group');
    if (group) group.style.display = toggle?.checked ? 'block' : 'none';
};

const clearError = () => { 
    clearTimeout(errorTimeout); 
    if ($('error-banner'))$('error-banner').style.cssText = 'opacity:0; display:none;'; 
};

const showError = msg => { 
    clearError(); 
    const b = $('error-banner'); 
    if (!b) return; 
    b.textContent = String(msg).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ''); 
    b.style.cssText = 'display:block; opacity:1;'; 
    errorTimeout = setTimeout(() => { 
        b.style.opacity = '0'; 
        setTimeout(() => b.style.display = 'none', 300); 
    }, 4000); 
};


const getJsonResponse = async response => {
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(`Backend returned invalid JSON (HTTP ${response.status})`);
    }
    if (!response.ok) {
        throw new Error(data?.error || `Backend request failed (HTTP ${response.status})`);
    }
    return data;
};

if ($('inspect-form')) {
    $('inspect-form').addEventListener('submit', async e => {
        e.preventDefault();
        clearError();

        const input = $('url-input');
        const url = input?.value.trim();
        const btn = $('inspect-btn');
        const btnText = $('btn-text');
        const btnLoader = $('btn-loader');

        if (!url) {
            showError('Please enter a media URL.');
            return;
        }

        if (btn) {
            btn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoader) btnLoader.style.display = 'flex';
        }

        try {
            const response = await fetch('/api/inspect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await getJsonResponse(response);
            if (!data.success) throw new Error(data.error || 'Failed to extract metadata.');

            // Support both backend response shapes: {success, data:{...}} and {success, ...media}.
            const media = (data.data && typeof data.data === 'object') ? data.data : data;
            activeMedia = { ...media, original_url: media.original_url || url };

            if ($('phase-2')) $('phase-2').style.display = 'none';
            if ($('phase-3')) $('phase-3').style.display = 'block';
            renderDashboard(activeMedia);
        } catch (err) {
            console.error('[Inspect] Error:', err);
            showError(err.message || 'Failed to contact engine.');
            input?.select();
        } finally {
            if (btn) {
                btn.disabled = false;
                if (btnText) btnText.style.display = 'inline';
                if (btnLoader) btnLoader.style.display = 'none';
            }
        }
    });
}

const renderDashboard = media => {
    if (!media) {
        showError('No media information was returned by the backend.');
        return;
    }
    const isImg = media.formats?.[0]?.format_id?.startsWith('image_');
    if ($('video-ui')) $('video-ui').style.display = isImg ? 'none' : 'block';
    if ($('image-ui')) $('image-ui').style.display = isImg ? 'block' : 'none';
    if (isImg) renderImageUI(media.formats || []);
    else renderVideoUI(media);
    // Hide legacy per-video subtitle controls; subtitles are controlled in Settings.
    ['subtitle-section', 'enable-subtitles', 'subtitle-lang-select', 'download-subtitles-btn'].forEach(id => {
        const element = $(id);
        if (element) element.style.display = 'none';
    });
};

const selectPill = (el, mode, height) => { 
    document.querySelectorAll('#quality-grid .pill-btn').forEach(b => b.classList.remove('active')); 
    el.classList.add('active'); 
    selectedFormat = { mode, height }; 
};

const renderVideoUI = media => {
    $('meta-thumb').src = media.thumbnail || '';
    $('meta-title').textContent = media.title || 'Unknown Title';

    // Format duration
    const seconds = Number(media.duration || 0);

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    let durationText;

    if (hours > 0) {
        durationText =
            `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
        durationText =
            `${minutes}:${String(secs).padStart(2, '0')}`;
    }

    $('meta-duration').textContent = `Duration: ${durationText}`;

    const grid = $('quality-grid');
    grid.innerHTML = '';

    /*
     * -----------------------------------------
     * CLEAN AND DEDUPLICATE VIDEO FORMATS
     * -----------------------------------------
     */

    const uniqueFormats = [];
    const seenHeights = new Set();

    if (Array.isArray(media.formats)) {

        media.formats.forEach(f => {

            const height = Number(f.height);

            if (!height) return;

            // Remove duplicate resolutions
            if (seenHeights.has(height)) return;

            seenHeights.add(height);

            uniqueFormats.push({
                ...f,
                height: height,
                resolution: f.resolution || `${height}p`
            });
        });
    }

    // Highest quality first
    uniqueFormats.sort((a, b) => b.height - a.height);

    /*
     * -----------------------------------------
     * CREATE QUALITY BUTTON
     * -----------------------------------------
     */

    const addPill = (txt, cls, act) => {

        const p = document.createElement('div');

        p.className = cls;
        p.textContent = txt;

        p.onclick = () => act(p);

        grid.appendChild(p);
    };

    /*
     * -----------------------------------------
     * VIDEO QUALITIES
     * -----------------------------------------
     */

    if (uniqueFormats.length > 0) {

        uniqueFormats.forEach((f, index) => {

            addPill(
                f.resolution,
                `pill-btn ${index === 0 ? 'active' : ''}`,
                p => selectPill(
                    p,
                    'video',
                    f.height
                )
            );

        });

        // Select highest available quality
        selectedFormat = {
            mode: 'video',
            height: uniqueFormats[0].height
        };

    } else {

        addPill(
            'Best Quality',
            'pill-btn active',
            p => selectPill(
                p,
                'video',
                null
            )
        );

        selectedFormat = {
            mode: 'video',
            height: null
        };
    }

    /*
     * -----------------------------------------
     * AUDIO BUTTON
     * -----------------------------------------
     */

    addPill(
        'Audio (MP3 + Cover)',
        'pill-btn audio',
        p => selectPill(
            p,
            'mp3',
            null
        )
    );
};

const updateCarousel = idx => { 
    currentImageIndex = idx; 
    $('carousel-main-img').src = imageGallery[idx].url; 
    $('carousel-prev').disabled = idx === 0; 
    $('carousel-next').disabled = idx === imageGallery.length - 1; 
};

const updateMainDownloadButton = () => { 
    const b = $('dl-selected-btn'); 
    if (!b) return; 
    const cnt = selectedImageIndexes.size; 
    b.textContent = cnt ? `Download ${cnt} Image${cnt > 1 ? 's' : ''}` : 'Select an image to download'; 
    b.disabled = !cnt; 
    b.style.opacity = cnt ? '1' : '0.5'; 
};

const renderImageGrid = () => {
    const grid = $('image-grid'); 
    grid.innerHTML = '';
    
    imageGallery.forEach((img, i) => { 
        const p = document.createElement('div'); p.id = `img-pill-${i}`; p.className = `pill-btn ${selectedImageIndexes.has(i) ? 'active' : ''}`; p.textContent = `Image ${i + 1}`; 
        p.onclick = () => { 
            selectedImageIndexes.has(i) ? selectedImageIndexes.delete(i) : selectedImageIndexes.add(i); 
            p.classList.toggle('active'); updateCarousel(i); updateMainDownloadButton(); 
        }; 
        grid.appendChild(p); 
    });
    
    if (imageGallery.length > 1) { 
        const allP = document.createElement('div'); allP.className = 'pill-btn'; allP.textContent = 'Select All'; allP.style.border = '1px dashed var(--accent)'; 
        allP.onclick = () => { 
            const selAll = selectedImageIndexes.size !== imageGallery.length; 
            selectedImageIndexes.clear(); 
            imageGallery.forEach((_, i) => { 
                if (selAll) selectedImageIndexes.add(i); $(`img-pill-${i}`).classList.toggle('active', selAll); 
            }); 
            allP.classList.toggle('active', selAll); updateMainDownloadButton(); 
        }; 
        grid.appendChild(allP); 
    }
    updateMainDownloadButton();
};

const renderImageUI = formats => { 
    imageGallery = formats; currentImageIndex = 0; selectedImageIndexes = new Set([0]); 
    $('carousel-prev').style.visibility =$('carousel-next').style.visibility = formats.length > 1 ? 'visible' : 'hidden'; 
    $('carousel-prev').onclick = () => currentImageIndex > 0 && updateCarousel(currentImageIndex - 1);$('carousel-next').onclick = () => currentImageIndex < imageGallery.length - 1 && updateCarousel(currentImageIndex + 1); 
    updateCarousel(0); renderImageGrid(); 
};

const triggerDownload = async () => {
    if (!activeMedia) {
        showError('No media has been analyzed yet.');
        return;
    }
    clearError();
    if (activePoller) clearInterval(activePoller);

    const btn = $('download-btn');
    const pBox = $('progress-box');
    const pFill = $('progress-fill');
    const pStatus = $('progress-status');
    const pPercent = $('progress-percent');
    if (btn) btn.style.display = 'none';
    if (pBox) pBox.style.display = 'block';
    if (pFill) pFill.style.width = '2%';
    if (pPercent) pPercent.textContent = '0%';
    if (pStatus) pStatus.textContent = 'Initializing download...';

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: activeMedia.original_url, ...selectedFormat })
        });
        const data = await getJsonResponse(response);
        if (!data.success || !data.task_id) throw new Error(data.error || 'Failed to start download.');
        activeTaskId = data.task_id;

        cancelRequestedByUI = false;

        // Accepted tasks move to Downloads immediately; later failures remain attached to that task.
        resetToPhase2();
        document.getElementById('beans-downloads-button')?.click();
        return;

        let isSettled = false;
        const stopPolling = () => {
            if (activePoller) clearInterval(activePoller);
            activePoller = null;
        };
        const checkTask = async () => {
            if (isSettled) return;
            try {
                const progressResponse = await fetch(`/api/progress/${data.task_id}`, { cache: 'no-store' });
                const state = await getJsonResponse(progressResponse);
                const status = String(state.status || '').toLowerCase();
                const rawPercent = state.percent ?? state.progress ?? '0%';
                const numericPercent = typeof rawPercent === 'string'
                    ? (parseFloat(rawPercent) || 0)
                    : (Number(rawPercent) || 0);
                const percentText = `${Math.min(100, Math.max(0, numericPercent))}%`;

                if (status === 'downloading') {
                    if (pFill) pFill.style.width = percentText;
                    if (pPercent) pPercent.textContent = percentText;
                    if (pStatus) {
                        let message = 'Downloading media...';
                        if (state.speed) message += ` ${state.speed}`;
                        if (state.eta) message += ` • ETA ${state.eta}`;
                        pStatus.textContent = message;
                    }
                } else if (['merging', 'processing'].includes(status)) {
                    if (pFill) pFill.style.width = '100%';
                    if (pPercent) pPercent.textContent = '100%';
                    if (pStatus) pStatus.textContent = selectedFormat.mode === 'mp3'
                        ? 'Converting audio and embedding cover...' : 'Processing video...';
                } else if (status === 'fallback') {
                    if (pStatus) pStatus.textContent = 'Normal download failed — trying HLS as a last resort...';
                } else if (status === 'subtitles') {
                    if (pStatus) pStatus.textContent = 'Downloading subtitle...';
                } else if (status === 'embedding') {
                    if (pStatus) pStatus.textContent = 'Embedding subtitles...';
                } else if (status === 'finalizing') {
                    if (pStatus) pStatus.textContent = 'Finalizing file...';
                } else if (status === 'cancelling') {
                    if (pStatus) pStatus.textContent = 'Stopping download and keeping resumable partial files...';
                } else if (status === 'cancelled') {
                    isSettled = true;
                    stopPolling();
                    activeTaskId = null;
                    if (!cancelRequestedByUI) showError(state.error || 'Download was cancelled.');
                    return;
                } else if (status === 'completed') {
                    isSettled = true;
                    stopPolling();
                    activeTaskId = null;
                    if (pFill) pFill.style.width = '100%';
                    if (pPercent) pPercent.textContent = '100%';
                    if (pStatus) pStatus.textContent = state.subtitle_notice || 'Download complete!';
                    setTimeout(resetToPhase2, state.subtitle_notice ? 4500 : 2200);
                } else if (['failed', 'error'].includes(status)) {
                    stopPolling();
                    activeTaskId = null;
                    // Let the catch block below update the UI and show the real error.
                    throw new Error(state.error || 'Download failed.');
                } else if (status === 'starting') {
                    if (pStatus) pStatus.textContent = 'Starting Exractor...';
                }
            } catch (err) {
                if (isSettled) return;
                isSettled = true;
                stopPolling();
                showError(err.message || 'Lost connection to the download worker.');
                if (btn) btn.style.display = 'block';
                if (pBox) pBox.style.display = 'none';
            }
        };

        // Poll immediately and continue at a modest interval.
        await checkTask();
        if (!isSettled) activePoller = setInterval(checkTask, 800);
    } catch (err) {
        if (btn) btn.style.display = 'block';
        if (pBox) pBox.style.display = 'none';
        showError(err.message || 'Failed to start download.');
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

    // Capture everything before resetting the UI.
    const pageUrl = activeMedia.original_url;
    const selectedImages = indexes.map(i => ({
        index: i,
        format_id: imageGallery[i].format_id,
        image_url: imageGallery[i].url
    }));

    const btn = $('dl-selected-btn');
    if (btn) btn.disabled = true;

    // Start each image request in the background.
    const backgroundDownloads = selectedImages.map(async image => {
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

            const data = await getJsonResponse(response);

            if (!data.success) {
                console.error(
                    `Image ${image.index + 1} failed:`,
                    data.error
                );
                return;
            }

            // Preserve the existing behavior of saving through the app.
            if (data.task_id) {
                const a = document.createElement('a');
                a.href = `/api/serve/${data.task_id}`;
                a.download = '';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (err) {
            console.error(`Image ${image.index + 1} download failed:`, err);
        }
    });

    // Reset immediately; the requests continue independently.
    resetToPhase2();
    document.getElementById('beans-downloads-button')?.click();

    if (btn) btn.disabled = false;

    // Keep track of background errors without blocking the home screen.
    Promise.allSettled(backgroundDownloads).then(results => {
        const failed = results.filter(
            result => result.status === 'rejected'
        ).length;

        if (failed) {
            console.error(`${failed} image download request(s) failed.`);
        }
    });
};


const resetToPhase2 = () => {
    if (activePoller) clearInterval(activePoller);
    activePoller = null;
    activeTaskId = null;
    cancelRequestedByUI = false;
    activeMedia = null;
    clearError();

    if ($('phase-2')) $('phase-2').style.display = 'block';
    if ($('phase-3')) $('phase-3').style.display = 'none';
    if ($('download-btn')) $('download-btn').style.display = 'block';
    if ($('dl-selected-btn')) $('dl-selected-btn').style.display = 'block';
    if ($('progress-box')) $('progress-box').style.display = 'none';
    if ($('url-input')) {
        $('url-input').value = '';
        $('url-input').focus();
    }
};

// Called by the Cancel & Extract Another button. The input screen is not
// re-enabled until the backend confirms that the worker has actually stopped.
const cancelAndExtractAnother = async () => {
    const taskId = activeTaskId;
    if (!taskId) {
        resetToPhase2();
        return;
    }

    const cancelButton = document.querySelector('.cancel-btn');
    if (cancelButton) {
        cancelButton.disabled = true;
        cancelButton.textContent = 'Cancelling...';
    }
    cancelRequestedByUI = true;
    if ($('progress-status')) $('progress-status').textContent = 'Stopping download and keeping resumable partial files...';

    try {
        const cancelResponse = await fetch('/api/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId })
        });
        const cancelData = await getJsonResponse(cancelResponse);
        if (!cancelData.success) throw new Error(cancelData.error || 'The backend could not cancel this task.');

        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            const progressResponse = await fetch(`/api/progress/${taskId}`, { cache: 'no-store' });
            const state = await getJsonResponse(progressResponse);
            const status = String(state.status || '').toLowerCase();

            if (['cancelled', 'failed', 'error', 'completed'].includes(status)) {
                activeTaskId = null;
                if (status === 'completed') {
                    showError('The download completed just before cancellation took effect. Its completed file was kept.');
                }
                resetToPhase2();
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        // Do not allow another task to start while the old worker may still be active.
        throw new Error('Cancellation was requested, but the downloader has not confirmed it stopped yet. Keep this window open and try again once cancellation finishes.');
    } catch (err) {
        showError(err.message || 'Unable to cancel the download.');
    } finally {
        cancelRequestedByUI = false;
        if (cancelButton) {
            cancelButton.disabled = false;
            cancelButton.textContent = 'Cancel & Extract Another';
        }
    }
};

window.addEventListener('message', e => { 
    if (e.data?.theme) { document.documentElement.setAttribute('data-theme', e.data.theme); localStorage.setItem('theme', e.data.theme); } 
});

const ctx = document.createElement('div');
ctx.className = 'context-menu'; ctx.textContent = '📋 Paste';
document.body.appendChild(ctx);

$('url-input')?.addEventListener('contextmenu', e => {
    e.preventDefault();
    ctx.style.cssText = `display: block; left: ${e.pageX}px; top: ${e.pageY}px;`;
});

document.addEventListener('click', e => e.target !== ctx && (ctx.style.display = 'none'));

ctx.addEventListener('click', async () => {
    try { $('url-input').value = await navigator.clipboard.readText(); } 
    catch { showError('Clipboard access denied.'); }
    ctx.style.display = 'none';
});

// Open Settings Modal and fetch current configuration from backend.
// Open Settings Modal and fetch current configuration from backend.
const openSettingsModal = async () => {
    ensureSubtitleSettingsUI();

    try {
        const response = await fetch('/api/settings', { cache: 'no-store' });
        const data = await getJsonResponse(response);

        if (data.success) {
            // Support both {config:{...}} and direct settings response shapes.
            const config = data.config || data;

            if ($('setting-download-dir')) {
                $('setting-download-dir').value = config.download_dir || '';
                updateDownloadDirPreview(); // ADDED: update destination preview
            }

            if ($('settings-include-subtitles')) {
                $('settings-include-subtitles').checked =
                    config.include_subtitles === true;
            }

            if ($('settings-subtitle-language')) {
                $('settings-subtitle-language').value =
                    config.subtitle_language || 'en';
            }

            updateSubtitleLanguageVisibility();
        }
    } catch (err) {
        console.error('Failed to load settings', err);
        showError(err.message || 'Failed to load settings.');
    }

    if ($('settings-modal')) {
        $('settings-modal').style.display = 'flex';
    }
};

// Close Settings Modal.
const closeSettingsModal = () => {
    if ($('settings-modal')) $('settings-modal').style.display = 'none';
    if ($('cookie-upload-status')) $('cookie-upload-status').innerText = '';
};

// Save download directory and subtitle preferences together.
const saveSettings = async () => {
    const download_dir = $('setting-download-dir')?.value.trim() || '';
    if (!download_dir) {
        showError('Please select a download folder.');
        return;
    }

    const saveButton = $('settings-save-btn') || $('save-settings-btn');
    if (saveButton) saveButton.disabled = true;
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                download_dir,
                include_subtitles: $('settings-include-subtitles')?.checked === true,
                subtitle_language: $('settings-subtitle-language')?.value || 'en'
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

// Upload manual cookies.txt file fallback
const uploadCookiesFile = async () => {
    const fileInput = $('setting-cookies-file');
    if (!fileInput.files.length) {
        alert('Please select a cookies.txt file first.');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const res = await fetch('/api/cookies', {
            method: 'POST',
            body: formData
        });
        const data = await getJsonResponse(res);
        if (data.success) {
            $('cookie-upload-status').innerText = 'Uploaded successfully!';
        } else {
            $('cookie-upload-status').style.color = '#f44336';
            $('cookie-upload-status').innerText = 'Upload failed: ' + data.error;
        }
    } catch (err) {
        console.error('Cookie upload error', err);
    }
};

// Trigger native folder selection dialog via backend endpoint
const selectFolder = async () => {
    try {
        const response = await fetch('/api/select-folder', { method: 'POST' });
        const data = await getJsonResponse(response);
        const folder = data.path || data.folder;

        if (data.success && folder && $('setting-download-dir')) {
            $('setting-download-dir').value = folder;
            updateDownloadDirPreview();
        }
    } catch (err) {
        console.error('Failed to open folder dialog', err);
        showError(err.message || 'Could not open folder selector.');
    }
};

const updateDownloadDirPreview = () => {
    const input = $('setting-download-dir');
    const preview = $('download-dir-preview');

    if (!input || !preview) return;

    const parentFolder = input.value.trim();

    if (!parentFolder) {
        preview.textContent = '';
        return;
    }

    const normalizedParent = parentFolder.replace(/[\\/]+$/, '');

    const destination = /[\\/]Beans Extractor$/i.test(normalizedParent)
        ? normalizedParent
        : `${normalizedParent}\\Beans Extractor`;

    preview.textContent = `Downloads will be saved to: ${destination}`;
};

window.addEventListener('DOMContentLoaded', () => {
    ensureSubtitleSettingsUI();
    ['subtitle-section', 'enable-subtitles', 'subtitle-lang-select', 'download-subtitles-btn'].forEach(id => {
        const element = $(id);
        if (element) element.style.display = 'none';
    });
});

// Expose settings functions for sidebar buttons
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettings = saveSettings;
window.selectFolder = selectFolder;
window.uploadCookiesFile = uploadCookiesFile;