/* Beans Extractor sidebar, history, theme and downloads */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  // One definition of "finished" for the whole file ('error' is accepted for older records).
  const TERMINAL = ['completed', 'failed', 'error', 'cancelled', 'interrupted'];
  const FAILED = ['failed', 'error'];
  const STOPPED = ['cancelled', 'interrupted'];

  const statusOf = item => String(item?.status || 'starting').toLowerCase();
  const isTerminal = item => TERMINAL.includes(statusOf(item));

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[ch]));

  const dateLabel = stamp => {
    if (!stamp) return '';
    try {
      return new Date(Number(stamp) * 1000).toLocaleString([], {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const durationLabel = value => {
    const n = Number(value || 0);
    if (!n) return '';
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);
    return h
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  const safeFetch = async (url, options) => {
    const response = await fetch(url, options);
    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(`Invalid response (${response.status})`);
    }

    if (!response.ok || data.success === false) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  };

  const ICONS = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  let downloadsTimer = null;
  let lastDownloads = [];

  /* ---------- Toast (replaces alert()) ---------- */

  let toastTimer = null;

  function toast(message, kind = '' , ms = 4500) {
    let el = $('beans-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'beans-toast';
      el.className = 'beans-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('error', kind === 'error');
    // Restart the transition if a toast is already showing.
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ---------- Tooltips for [data-tip] (icons, error details) ---------- */

  const tipEl = document.createElement('div');
  tipEl.className = 'beans-tip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);

  function showTip(anchor) {
    tipEl.textContent = anchor.dataset.tip;
    tipEl.classList.add('show');
    const rect = anchor.getBoundingClientRect();
    const width = tipEl.offsetWidth;
    const height = tipEl.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    const above = rect.top - height - 8;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${above >= 8 ? above : rect.bottom + 8}px`;
  }

  const hideTip = () => tipEl.classList.remove('show');

  document.addEventListener('mouseover', event => {
    const anchor = event.target.closest?.('[data-tip]');
    if (anchor) showTip(anchor);
    else hideTip();
  });
  document.addEventListener('focusin', event => {
    const anchor = event.target.closest?.('[data-tip]');
    if (anchor) showTip(anchor);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);

  // Re-render only when the markup changed, so hover states are not reset every poll.
  function setHtml(element, html) {
    if (!element || element.dataset.html === html) return false;
    element.dataset.html = html;
    element.innerHTML = html;
    hideTip();
    return true;
  }

  /* ---------- Settings tabs ---------- */

  function switchSettingsTab(tabName, btnElement) {
    const modal = $('settings-modal');
    if (!modal) return;

    modal.querySelectorAll('.beans-tab-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });

    if (btnElement) {
      btnElement.classList.add('active');
      btnElement.setAttribute('aria-selected', 'true');
    }

    modal.querySelectorAll('.beans-tab-panel').forEach(panel => panel.classList.remove('active'));
    $(`tab-${tabName}`)?.classList.add('active');
    modal.querySelector('.beans-settings-tabs')?.classList.toggle('is-hidden', tabName === 'legal');
    // Save/Cancel only apply to Preferences.
    $('settings-actions')?.classList.toggle('is-hidden', tabName !== 'preferences');
    // On a legal page the ✕ becomes a Back arrow; everywhere else it closes Settings.
    const closeBtn = $('settings-close');
    closeBtn?.classList.toggle('is-back', tabName === 'legal');
    closeBtn?.setAttribute('aria-label', tabName === 'legal' ? 'Back' : 'Close settings');
    $(`tab-${tabName}`)?.scrollTo?.(0, 0);
  }

  /* ---------- About: legal pages, cookies chooser, updates ---------- */

  const LEGAL_TITLES = { privacy: 'Privacy Policy', terms: 'Terms of Use', licenses: 'Licenses' };

  function showLegal(key) {
    const template = $(`legal-${key}`);
    if (!template) return;
    $('legal-title').textContent = LEGAL_TITLES[key] || '';
    $('legal-body').replaceChildren(template.content.cloneNode(true));
    switchSettingsTab('legal', null);
  }

  function backToAbout() {
    switchSettingsTab('about', $('tab-btn-about'));
  }

  function settingsCloseOrBack() {
    if ($('tab-legal')?.classList.contains('active')) backToAbout();
    else window.closeSettingsModal?.();
  }

  const UPDATE_CHECKED_KEY = 'beans-update-checked';
  const DAY_MS = 24 * 60 * 60 * 1000;

  let appUpdate = false;
  let engineUpdate = false;

  function refreshDots() {
    const has = appUpdate || engineUpdate;
    $('about-update-dot').hidden = !has;
    $('beans-settings-button')?.classList.toggle('has-update', has);
  }

  /* ---- Downloader engine (yt-dlp) ---- */

  const ENGINE_CHECKED_KEY = 'beans-engine-checked';
  const ENGINE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let engineMode = 'check'; // check | update | restart

  function setEngine(text, kind = '', mode = engineMode) {
    const status = $('engine-status');
    const button = $('engine-action');
    engineMode = mode;
    status.textContent = text;
    status.classList.toggle('is-new', kind === 'new');
    status.classList.toggle('is-error', kind === 'error');
    button.disabled = false;
    button.textContent = mode === 'update' ? 'Update' : mode === 'restart' ? 'Restart now' : 'Check';
  }

  async function loadEngineInfo() {
    try {
      const info = await safeFetch('/api/engine', { cache: 'no-store' });
      if (info.pending_restart) {
        setEngine(`Version ${info.staged_version} downloaded. Restart Beans Extractor to use it.`, 'new', 'restart');
      } else if (info.failed) {
        setEngine(`Last update could not be applied. Using built-in version ${info.version}.`, 'error', 'check');
      } else {
        setEngine(`Version ${info.version}${info.source === 'updated' ? ' (updated)' : ''}`, '', 'check');
      }
    } catch {
      setEngine('Version unavailable', '', 'check');
    }
  }

  async function checkEngine(manual) {
    if (engineMode === 'restart') return;
    const button = $('engine-action');
    if (manual) {
      button.disabled = true;
      $('engine-status').classList.remove('is-new', 'is-error');
      $('engine-status').textContent = 'Checking…';
    }
    try {
      const result = await safeFetch('/api/engine/check', { cache: 'no-store' });
      try { localStorage.setItem(ENGINE_CHECKED_KEY, String(Date.now())); } catch { /* storage unavailable */ }
      if (result.update_available) {
        engineUpdate = true;
        refreshDots();
        setEngine(`Version ${result.latest} is available (you have ${result.current}).`, 'new', 'update');
      } else if (manual) {
        setEngine(`Up to date · version ${result.current}`, '', 'check');
      }
    } catch (error) {
      if (manual) setEngine(error.message || 'Could not check for updates.', 'error', 'check');
    } finally {
      button.disabled = false;
    }
  }

  // Relaunch the app (the server exits and starts a fresh copy). Warns if downloads are running.
  async function restartApp() {
    const running = lastDownloads.filter(item => !isTerminal(item)).length;
    if (running && !confirm(`${running} download${running > 1 ? 's are' : ' is'} still in progress and will stop. Restart anyway?`)) return;

    $('engine-action').disabled = true;
    $('engine-status').classList.remove('is-error');
    $('engine-status').textContent = 'Restarting…';
    try {
      await safeFetch('/api/restart', { method: 'POST' });
    } catch (error) {
      setEngine(error.message || 'Could not restart. Please close and reopen the app.', 'error', 'restart');
    }
  }

  async function installEngine() {
    const button = $('engine-action');
    button.disabled = true;
    $('engine-status').classList.remove('is-new', 'is-error');
    $('engine-status').textContent = 'Downloading…';
    try {
      const result = await safeFetch('/api/engine/update', { method: 'POST' });
      engineUpdate = false;
      refreshDots();
      setEngine(`Version ${result.version} downloaded. Restart Beans Extractor to use it.`, 'new', 'restart');
      if (confirm(`Engine ${result.version} is ready. Restart Beans Extractor now to use it?`)) restartApp();
    } catch (error) {
      setEngine(error.message || 'Update failed.', 'error', 'update');
    }
  }

  function dailyEngineCheck() {
    let last = 0;
    try { last = Number(localStorage.getItem(ENGINE_CHECKED_KEY)) || 0; } catch { /* storage unavailable */ }
    if (Date.now() - last < ENGINE_INTERVAL_MS || navigator.onLine === false) return;
    checkEngine(false);
  }

  function setUpdateUi(result) {
    const status = $('update-status');
    const link = $('update-download');
    const has = Boolean(result?.update_available);

    appUpdate = has;
    refreshDots();
    if (link) {
      link.hidden = !has;
      if (has && result.url) link.href = result.url;
    }
    if (!status) return;

    status.classList.toggle('is-new', has);
    status.classList.remove('is-error');
    if (has) status.textContent = `Version ${result.latest} is available.`;
    else if (result?.note) status.textContent = result.note;
    else status.textContent = 'You are up to date.';
  }

  async function checkForUpdates(manual) {
    const button = $('update-check');
    const status = $('update-status');

    if (manual && button) {
      button.disabled = true;
      status.classList.remove('is-new', 'is-error');
      status.textContent = 'Checking…';
    }

    try {
      const result = await safeFetch('/api/update-check', { cache: 'no-store' });
      try { localStorage.setItem(UPDATE_CHECKED_KEY, String(Date.now())); } catch { /* storage unavailable */ }
      setUpdateUi(result);
    } catch (error) {
      // A silent daily check never bothers the user; a manual one explains.
      if (manual && status) {
        status.classList.add('is-error');
        status.textContent = error.message || 'Could not check for updates.';
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function dailyUpdateCheck() {
    let last = 0;
    try { last = Number(localStorage.getItem(UPDATE_CHECKED_KEY)) || 0; } catch { /* storage unavailable */ }
    if (Date.now() - last < DAY_MS || navigator.onLine === false) return;
    checkForUpdates(false);
  }

  function initializeAbout() {
    document.querySelectorAll('[data-legal]').forEach(button => {
      button.addEventListener('click', () => showLegal(button.dataset.legal));
    });
    $('update-check')?.addEventListener('click', () => {
      checkForUpdates(true);
      checkEngine(true);
    });
    $('engine-action')?.addEventListener('click', () => {
      if (engineMode === 'update') installEngine();
      else if (engineMode === 'restart') restartApp();
      else checkEngine(true);
    });
    loadEngineInfo();

    // Custom file chooser for the cookies file (the native control cannot be styled).
    const input = $('setting-cookies-file');
    $('beans-choose-cookies')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      const name = $('cookie-file-name');
      const file = input.files?.[0];
      name.textContent = file ? file.name : 'No file chosen';
      name.classList.toggle('has-file', Boolean(file));
      $('cookie-upload-status').textContent = '';
    });
  }

  /* ---------- Shell wiring ---------- */

  const shellEl = () => $('beans-app-shell');
  const collapseSidebar = () => shellEl()?.classList.remove('sidebar-expanded', 'history-active');

  function initializeSidebar() {
    const shell = shellEl();
    if (!shell) {
      console.error('Sidebar HTML is missing: #beans-app-shell');
      return;
    }

    $('beans-sidebar-toggle')?.addEventListener('click', () => {
      if (shell.classList.contains('sidebar-expanded')) collapseSidebar();
      else shell.classList.add('sidebar-expanded');
    });

    // The expanded sidebar floats over the page: clicking anywhere outside it closes it.
    document.addEventListener('click', event => {
      if (!shell.classList.contains('sidebar-expanded')) return;
      if (event.target.closest('#beans-sidebar')) return;
      collapseSidebar();
    });

    // Move the extractor card (and its error banner) into the workspace.
    const card = document.querySelector('.extractor-card');
    const workspace = shell.querySelector('.beans-workspace-content');

    if (card && workspace && !workspace.contains(card)) {
      workspace.appendChild(card);
    }

    $('beans-home-button')?.addEventListener('click', () => {
      showHome();
      collapseSidebar();
    });

    $('beans-url-history-button')?.addEventListener('click', () => {
      if (shell.classList.contains('history-active')) {
        collapseSidebar();
        return;
      }
      shell.classList.add('sidebar-expanded', 'history-active');
      refreshUrlHistory();
    });

    $('beans-downloads-button')?.addEventListener('click', () => {
      openDrawer();
      collapseSidebar();
    });
    $('beans-top-downloads')?.addEventListener('click', openDrawer);
    $('beans-close-drawer')?.addEventListener('click', closeDrawer);
    $('beans-drawer-scrim')?.addEventListener('click', closeDrawer);

    $('beans-settings-button')?.addEventListener('click', () => {
      collapseSidebar();
      if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal();
      }
    });

    $('beans-theme-toggle')?.addEventListener('click', toggleTheme);
    initializeAbout();
    $('beans-clear-urls')?.addEventListener('click', clearUrlHistory);
    $('beans-clear-downloads')?.addEventListener('click', clearDownloadHistory);

    // Delegated clicks for rows (rows are re-rendered often).
    $('beans-download-list')?.addEventListener('click', onDownloadListClick);
    $('beans-download-active')?.addEventListener('click', onActiveClick);
    $('beans-url-list')?.addEventListener('click', onUrlListClick);
    $('beans-url-list')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('.beans-url-item');
      if (row && event.target === row) {
        event.preventDefault();
        row.click();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if ($('settings-modal')?.style.display === 'flex') {
        if ($('tab-legal')?.classList.contains('active')) backToAbout();
        else window.closeSettingsModal?.();
      }
      else if ($('beans-download-drawer')?.classList.contains('open')) closeDrawer();
      else collapseSidebar();
    });
  }

  function showHome() {
    $('beans-home-button')?.classList.add('active');
    $('beans-home-button')?.setAttribute('aria-current', 'page');
    $('beans-url-history-button')?.classList.remove('active');
    closeDrawer();
  }

  /* ---------- Theme ---------- */

  async function loadTheme() {
    let theme = document.documentElement.getAttribute('data-theme') || 'dark';

    try {
      const data = await safeFetch('/api/theme', { cache: 'no-store' });
      theme = data.theme || theme;
    } catch {
      // Keep the theme the server rendered into the page.
    }

    applyTheme(theme, false);
  }

  function applyTheme(theme, persist = true) {
    const selected = theme === 'light' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', selected);

    const icon = $('beans-theme-icon');
    const label = $('beans-theme-label');

    if (icon) icon.textContent = selected === 'dark' ? '☾' : '☀';
    if (label) label.textContent = selected === 'dark' ? 'Dark mode' : 'Light mode';

    if (persist) {
      safeFetch('/api/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: selected })
      }).catch(error => console.warn('Could not save theme:', error));
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* ---------- URL history ---------- */

  // Puts a saved link in the box and analyses it, like the user pressing Analyze.
  function analyzeUrl(url) {
    showHome();
    window.resetToPhase2?.();

    const input = $('url-input');
    if (!input) return;
    input.value = url;
    input.focus();
    $('inspect-form')?.requestSubmit();
  }

  let lastUrls = [];

  async function refreshUrlHistory() {
    const list = $('beans-url-list');
    if (!list) return;

    try {
      const data = await safeFetch('/api/history/urls', { cache: 'no-store' });
      lastUrls = data.items || [];

      if (!lastUrls.length) {
        setHtml(list, '<div class="beans-empty-state">Your analyzed URLs will appear here.</div>');
        return;
      }

      setHtml(list, lastUrls.map((item, index) => `
        <div class="beans-url-item" role="button" tabindex="0" data-url-index="${index}">
          <span class="beans-url-item-title">${esc(item.title || 'Untitled media')}</span>
          <span class="beans-url-item-url">${esc(item.url)}</span>
          <span class="beans-url-item-meta">${esc(dateLabel(item.timestamp))}${item.duration ? ` · ${esc(durationLabel(item.duration))}` : ''}</span>
          <button type="button" class="beans-item-remove" data-act="remove-url"
                  data-tip="Remove from history" aria-label="Remove from history">${ICONS.close}</button>
        </div>
      `).join(''));
    } catch (error) {
      console.warn('Could not load URL history:', error);
    }
  }

  async function onUrlListClick(event) {
    const row = event.target.closest('.beans-url-item');
    if (!row) return;
    const item = lastUrls[Number(row.dataset.urlIndex)];
    if (!item) return;

    if (event.target.closest('[data-act="remove-url"]')) {
      row.classList.add('is-removing');
      try {
        await safeFetch('/api/history/urls', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.url })
        });
      } catch (error) {
        row.classList.remove('is-removing');
        toast(error.message || 'Could not remove this link.', 'error');
        return;
      }
      await refreshUrlHistory();
      return;
    }

    analyzeUrl(item.url);
  }

  async function clearUrlHistory() {
    if (!confirm('Clear URL history? This will not delete downloaded media.')) return;

    try {
      await safeFetch('/api/history/urls', { method: 'DELETE' });
      await refreshUrlHistory();
    } catch (error) {
      toast(error.message || 'Could not clear URL history.', 'error');
    }
  }

  /* ---------- Download status helpers ---------- */

  function statusLabel(status) {
    return ({
      queued: 'Queued',
      starting: 'Starting',
      downloading: 'Downloading',
      merging: 'Processing',
      subtitles: 'Subtitles',
      embedding: 'Embedding subtitles',
      cancelling: 'Cancelling',
      completed: 'Completed',
      failed: 'Failed',
      error: 'Failed',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted'
    })[status] || status.replaceAll('_', ' ');
  }

  // A download that is actually running: full card with progress.
  function activeCardHtml(item) {
    const status = statusOf(item);
    const percentText = item.overall_percent || item.percent || '0%';
    const percentNumber = Math.max(0, Math.min(100, parseFloat(percentText) || 0));
    const caption = status === 'cancelling' ? 'Cancelling…' : `${statusLabel(status)}…`;

    return `
      <div class="beans-active-card" data-active-task="${esc(item.task_id)}">
        <div class="beans-active-top">
          <span class="beans-status-dot"></span>
          <span>ACTIVE DOWNLOAD</span>
          <span class="beans-active-percent">${esc(percentText)}</span>
        </div>
        <div class="beans-download-title">${esc(item.title || item.url || 'Downloading media')}</div>
        <div class="beans-progress-track"><i style="width:${percentNumber}%"></i></div>
        <div class="beans-active-bottom">
          <span>${esc(caption)}</span>
          <button type="button" data-cancel-task="${esc(item.task_id)}"${status === 'cancelling' ? ' disabled' : ''}>Cancel</button>
        </div>
      </div>
    `;
  }

  // A download waiting its turn: same slim row as history, with a cancel button.
  function queuedRowHtml(item) {
    return `
      <article class="beans-download-item is-queued" data-task="${esc(item.task_id)}">
        <div class="beans-download-item-main">
          <div class="beans-download-title">
            <span class="beans-download-name" title="${esc(item.title || '')}">${esc(item.title || item.url || 'Media download')}</span>
          </div>
          <div class="beans-download-item-meta">Waiting in queue</div>
        </div>
        <div class="beans-download-item-tools">
          <button type="button" class="beans-tool" data-cancel-task="${esc(item.task_id)}"
                  data-tip="Cancel" aria-label="Cancel download">${ICONS.close}</button>
        </div>
      </article>
    `;
  }

  const sectionTitle = (label, count) =>
    `<h3 class="beans-section-title">${label}<span>${count}</span></h3>`;

  function inProgressHtml(items) {
    if (!items.length) return '';
    const running = items.filter(item => statusOf(item) !== 'queued');
    const queued = items.filter(item => statusOf(item) === 'queued');
    return sectionTitle('In progress', items.length)
      + (running.length ? `<div class="beans-group">${running.map(activeCardHtml).join('')}</div>` : '')
      + (queued.length ? `<div class="beans-group">${queued.map(queuedRowHtml).join('')}</div>` : '');
  }

  // One row = one fixed height. Completed, failed and stopped rows share the same layout.
  function historyRowHtml(item) {
    const status = statusOf(item);
    const done = status === 'completed';
    const failed = FAILED.includes(status);
    const stopped = STOPPED.includes(status);

    const embedded = Boolean(item.subtitles_embedded) ||
      /subtitles embedded successfully/i.test(String(item.subtitle_notice || ''));
    const kind = item.mode === 'mp3' ? 'Audio' : item.mode === 'image' ? 'Image' : 'Video';
    const date = esc(dateLabel(item.updated_at || item.timestamp));

    let meta;
    if (done) meta = `${kind} · ${date}`;
    else if (failed) meta = `<span class="beans-reason">${esc(item.error_short || 'Download failed')}</span> · ${date}`;
    else meta = `${esc(statusLabel(status))} · ${date}`;

    const tools = [];
    if (done && item.filename) {
      tools.push(`<button type="button" class="beans-tool" data-act="reveal" data-tip="Show in folder" aria-label="Show in folder">${ICONS.folder}</button>`);
    }
    if (failed) {
      const detail = String(item.error || item.error_short || 'Download failed').replace(/^ERROR:\s*/i, '');
      tools.push(`<button type="button" class="beans-tool" data-tip="${esc(detail)}" aria-label="Why it failed">${ICONS.info}</button>`);
    }
    if ((failed || stopped) && item.url) {
      tools.push(`<button type="button" class="beans-tool" data-act="retry" data-tip="Try again" aria-label="Try again">${ICONS.retry}</button>`);
    }

    const cls = done ? 'is-completed' : failed ? 'is-failed' : 'is-stopped';

    return `
      <article class="beans-download-item ${cls}" data-task="${esc(item.task_id)}">
        <div class="beans-download-item-main">
          <div class="beans-download-title">
            <span class="beans-download-name" title="${esc(item.title || '')}">${esc(item.title || 'Media download')}</span>${done && embedded ? '<span class="beans-cc-badge">CC</span>' : ''}
          </div>
          <div class="beans-download-item-meta">${meta}</div>
        </div>
        <div class="beans-download-item-tools">${tools.join('')}</div>
        <button type="button" class="beans-item-remove" data-act="remove"
                data-tip="Remove from history" aria-label="Remove from history">${ICONS.close}</button>
      </article>
    `;
  }

  /* ---------- Downloads drawer ---------- */

  async function refreshDownloads() {
    try {
      const data = await safeFetch('/api/history/downloads', { cache: 'no-store' });
      const items = data.items || [];
      lastDownloads = items;

      const activeItems = items.filter(item => !isTerminal(item));
      const historyItems = items.filter(isTerminal);

      // Badge: empty text hides it via CSS (.beans-nav-count:not(:empty)).
      const count = $('beans-download-count');
      if (count) count.textContent = activeItems.length ? String(activeItems.length) : '';

      setHtml($('beans-download-active'), inProgressHtml(activeItems));

      let listHtml = '';
      if (historyItems.length) {
        listHtml = sectionTitle('Finished', historyItems.length)
          + `<div class="beans-group">${historyItems.map(historyRowHtml).join('')}</div>`;
      } else if (!activeItems.length) {
        listHtml = '<div class="beans-empty-state">Files you download appear here</div>';
      }
      setHtml($('beans-download-list'), listHtml);
    } catch (error) {
      console.warn('Could not load download history:', error);
    }
  }

  async function onActiveClick(event) {
    const button = event.target.closest('[data-cancel-task]');
    if (!button || button.disabled) return;

    button.disabled = true;
    hideTip();
    try {
      await safeFetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: button.dataset.cancelTask })
      });
    } catch (error) {
      toast(error.message || 'Could not cancel this download.', 'error');
    }
    refreshDownloads();
  }

  async function onDownloadListClick(event) {
    const button = event.target.closest('button[data-act]');
    const row = event.target.closest('[data-task]');
    if (!button || !row) return;

    const taskId = row.dataset.task;
    const item = lastDownloads.find(entry => entry.task_id === taskId);
    const act = button.dataset.act;

    if (act === 'reveal') {
      try {
        await safeFetch(`/api/reveal/${encodeURIComponent(taskId)}`, { method: 'POST' });
      } catch (error) {
        toast(error.message || 'Could not find the file.', 'error');
      }
    } else if (act === 'remove') {
      row.classList.add('is-removing');
      try {
        await safeFetch(`/api/history/downloads/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      } catch (error) {
        row.classList.remove('is-removing');
        toast(error.message || 'Could not remove this item.', 'error');
        return;
      }
      await refreshDownloads();
    } else if (act === 'retry' && item) {
      retryDownload(item, button);
    }
  }

  // Restart the same download (same quality) without going back through Analyze.
  async function retryDownload(item, button) {
    const body = {
      url: item.url,
      mode: item.mode || 'video',
      height: item.height ?? null,
      format_id: item.format_id ?? null
    };
    if (body.mode === 'image') body.image_url = item.image_url;

    button.disabled = true;
    hideTip();
    try {
      await safeFetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (error) {
      toast(error.message || 'Could not start the download.', 'error');
    } finally {
      button.disabled = false;
      refreshDownloads();
    }
  }

  function openDrawer() {
    $('beans-download-drawer')?.classList.add('open');
    $('beans-drawer-scrim')?.classList.add('visible');
    $('beans-download-drawer')?.setAttribute('aria-hidden', 'false');

    refreshDownloads();

    if (downloadsTimer) clearInterval(downloadsTimer);
    downloadsTimer = setInterval(refreshDownloads, 1200);
  }

  function closeDrawer() {
    $('beans-download-drawer')?.classList.remove('open');
    $('beans-drawer-scrim')?.classList.remove('visible');
    $('beans-download-drawer')?.setAttribute('aria-hidden', 'true');
    hideTip();

    if (downloadsTimer) clearInterval(downloadsTimer);
    downloadsTimer = null;
  }

  async function clearDownloadHistory() {
    if (!confirm('Clear download history? Downloaded media and resumable partial files will be kept.')) return;

    try {
      await safeFetch('/api/history/downloads', { method: 'DELETE' });
      await refreshDownloads();
    } catch (error) {
      toast(error.message || 'Could not clear download history.', 'error');
    }
  }

  // Functions used by inline onclick handlers in the HTML.
  window.switchSettingsTab = switchSettingsTab;
  window.beansToast = toast;
  window.settingsCloseOrBack = settingsCloseOrBack;
  window.showHome = showHome;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
  window.toggleTheme = toggleTheme;
  window.refreshUrlHistory = refreshUrlHistory;
  window.refreshDownloads = refreshDownloads;
  window.clearUrlHistory = clearUrlHistory;
  window.clearDownloadHistory = clearDownloadHistory;

  document.addEventListener('DOMContentLoaded', () => {
    initializeSidebar();
    loadTheme();
    refreshUrlHistory();
    refreshDownloads();
    setTimeout(() => { dailyUpdateCheck(); dailyEngineCheck(); }, 4000);

    $('inspect-form')?.addEventListener('submit', () => {
      setTimeout(refreshUrlHistory, 1600);
    });

    // Light background refresh keeps the sidebar badge current even with the drawer closed.
    setInterval(() => {
      refreshUrlHistory();
      if (!downloadsTimer) refreshDownloads();
    }, 5000);
  });
})();