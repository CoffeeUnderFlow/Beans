/* Beans Extractor sidebar, history, theme and downloads */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  // One definition of "finished" for the whole file ('error' is accepted for older records).
  const TERMINAL = ['completed', 'failed', 'error', 'cancelled', 'interrupted'];
  const FAILED = ['failed', 'error'];
  const RETRYABLE = ['failed', 'error', 'cancelled', 'interrupted'];

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
        month: 'short', day: 'numeric',
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

  let downloadsTimer = null;

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
  }

  /* ---------- Shell wiring ---------- */

  function initializeSidebar() {
    const shell = $('beans-app-shell');
    if (!shell) {
      console.error('Sidebar HTML is missing: #beans-app-shell');
      return;
    }

    $('beans-sidebar-toggle')?.addEventListener('click', () => {
      shell.classList.toggle('sidebar-expanded');
    });

    // Move the extractor card (and its error banner) into the workspace.
    const card = document.querySelector('.extractor-card');
    const workspace = shell.querySelector('.beans-workspace-content');

    if (card && workspace && !workspace.contains(card)) {
      workspace.appendChild(card);
    }

    $('beans-home-button')?.addEventListener('click', showHome);

    $('beans-url-history-button')?.addEventListener('click', () => {
      shell.classList.add('sidebar-expanded');
      shell.classList.toggle('history-active');
      showHome();
      $('url-input')?.focus();
      refreshUrlHistory();
    });

    $('beans-downloads-button')?.addEventListener('click', openDrawer);
    $('beans-top-downloads')?.addEventListener('click', openDrawer);
    $('beans-close-drawer')?.addEventListener('click', closeDrawer);
    $('beans-drawer-scrim')?.addEventListener('click', closeDrawer);

    $('beans-settings-button')?.addEventListener('click', () => {
      shell.classList.add('sidebar-expanded');
      shell.classList.remove('history-active');
      if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal();
      }
    });

    $('beans-theme-toggle')?.addEventListener('click', toggleTheme);
    $('beans-clear-urls')?.addEventListener('click', clearUrlHistory);
    $('beans-clear-downloads')?.addEventListener('click', clearDownloadHistory);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if ($('settings-modal')?.style.display === 'flex') window.closeSettingsModal?.();
      else closeDrawer();
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

  function fillUrlInput(url) {
    showHome();

    if ($('phase-2')) $('phase-2').style.display = 'block';
    if ($('phase-3')) $('phase-3').style.display = 'none';
    if ($('url-input')) $('url-input').value = url;

    $('url-input')?.focus();
  }

  async function refreshUrlHistory() {
    const list = $('beans-url-list');
    if (!list) return;

    try {
      const data = await safeFetch('/api/history/urls', { cache: 'no-store' });
      const items = data.items || [];

      if (!items.length) {
        list.innerHTML = '<div class="beans-empty-state">Your analyzed URLs will appear here.</div>';
        return;
      }

      list.innerHTML = items.map((item, index) => `
        <button type="button" class="beans-url-item"
          data-url-index="${index}" title="${esc(item.url)}">
          <span class="beans-url-item-title">${esc(item.title || 'Untitled media')}</span>
          <span class="beans-url-item-url">${esc(item.url)}</span>
          <span class="beans-url-item-meta">
            ${esc(dateLabel(item.timestamp))}
            ${item.duration ? ` · ${esc(durationLabel(item.duration))}` : ''}
          </span>
        </button>
      `).join('');

      list.querySelectorAll('[data-url-index]').forEach(button => {
        button.addEventListener('click', () => {
          const item = items[Number(button.dataset.urlIndex)];
          if (item) fillUrlInput(item.url);
        });
      });
    } catch (error) {
      console.warn('Could not load URL history:', error);
    }
  }

  async function clearUrlHistory() {
    if (!confirm('Clear URL history? This will not delete downloaded media.')) return;

    try {
      await safeFetch('/api/history/urls', { method: 'DELETE' });
      await refreshUrlHistory();
    } catch (error) {
      alert(error.message || 'Could not clear URL history.');
    }
  }

  /* ---------- Download status helpers ---------- */

  function statusClass(status) {
    if (status === 'completed') return 'success';
    if (['failed', 'error', 'interrupted'].includes(status)) return 'danger';
    if (status === 'cancelled') return 'muted';
    return 'active';
  }

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

  function activeCardHtml(item) {
    const status = statusOf(item);
    const percentText = item.overall_percent || item.percent || '0%';
    const percentNumber = Math.max(0, Math.min(100, parseFloat(percentText) || 0));
    const caption = status === 'queued' ? 'Waiting in queue'
      : status === 'cancelling' ? 'Cancelling…'
      : `${statusLabel(status)}…`;

    return `
      <div class="beans-active-card" data-active-task="${esc(item.task_id)}">
        <div class="beans-active-top">
          <span class="beans-status-dot"></span>
          <span>${status === 'queued' ? 'QUEUED DOWNLOAD' : 'ACTIVE DOWNLOAD'}</span>
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

  function historyCardHtml(item) {
    const status = statusOf(item);
    const embedded = Boolean(item.subtitles_embedded) ||
      /subtitles embedded successfully/i.test(String(item.subtitle_notice || ''));
    const canReveal = status === 'completed' && item.filename;
    const canRetry = RETRYABLE.includes(status) && item.url;

    const kind = item.mode === 'mp3' ? 'MP3 audio' : item.mode === 'image' ? 'Image' : 'Video';
    const shortMeta = `${kind}${status === 'completed' && embedded ? ' · CC' : ''}`;

    const icon = status === 'completed' ? '✓'
      : FAILED.includes(status) ? '!'
      : ['cancelled', 'interrupted'].includes(status) ? '×' : '↓';

    return `
      <article class="beans-download-item compact-download-item">
        <div class="beans-download-item-icon ${statusClass(status)}">${icon}</div>
        <div class="beans-download-item-body">
          <div class="beans-download-title" title="${esc(item.title || '')}">
            ${esc(item.title || 'Media download')}
            ${status === 'completed' && embedded
              ? '<span class="beans-cc-badge" title="Subtitles embedded">CC</span>' : ''}
          </div>
          <div class="beans-download-item-meta">${esc(shortMeta)}</div>
          <div class="beans-download-item-footer">
            <span class="beans-status-pill ${statusClass(status)}">${status === 'completed' ? '' : esc(statusLabel(status))}</span>
            <span>${esc(dateLabel(item.updated_at || item.timestamp))}</span>
          </div>
          ${item.error && status !== 'completed'
            ? `<div class="beans-download-error">${esc(item.error)}</div>` : ''}
          ${status === 'completed' && item.subtitle_notice && !embedded
            ? `<div class="beans-download-note">${esc(item.subtitle_notice)}</div>` : ''}
          <div class="beans-download-actions">
            ${canReveal ? `<button type="button" data-reveal="${esc(item.task_id)}">Show file</button>` : ''}
            ${canRetry ? `<button type="button" data-retry="${esc(item.url)}">Try again</button>` : ''}
          </div>
        </div>
      </article>
    `;
  }

  /* ---------- Downloads drawer ---------- */

  async function refreshDownloads() {
    try {
      const data = await safeFetch('/api/history/downloads', { cache: 'no-store' });
      const items = data.items || [];

      const activeItems = items.filter(item => !isTerminal(item));
      const historyItems = items.filter(isTerminal);

      // Badge: empty text hides it via CSS (.beans-nav-count:not(:empty)).
      const count = $('beans-download-count');
      if (count) count.textContent = activeItems.length ? String(activeItems.length) : '';

      const activeContainer = $('beans-download-active');
      if (activeContainer) {
        activeContainer.innerHTML = activeItems.map(activeCardHtml).join('');

        activeContainer.querySelectorAll('[data-cancel-task]').forEach(button => {
          button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Cancelling...';

            try {
              await safeFetch('/api/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id: button.dataset.cancelTask })
              });
              await refreshDownloads();
            } catch (error) {
              alert(error.message || 'Could not cancel this download.');
              button.disabled = false;
              button.textContent = 'Cancel';
            }
          });
        });
      }

      const historyContainer = $('beans-download-list');
      if (!historyContainer) return;

      historyContainer.innerHTML = historyItems.length
        ? historyItems.map(historyCardHtml).join('')
        : '<div class="beans-empty-state">Files you download appear here</div>';

      historyContainer.querySelectorAll('[data-reveal]').forEach(button => {
        button.addEventListener('click', async () => {
          try {
            await safeFetch(`/api/reveal/${encodeURIComponent(button.dataset.reveal)}`, {
              method: 'POST'
            });
          } catch (error) {
            alert(error.message || 'Could not reveal the file.');
          }
        });
      });

      historyContainer.querySelectorAll('[data-retry]').forEach(button => {
        button.addEventListener('click', () => {
          closeDrawer();
          fillUrlInput(button.dataset.retry);
        });
      });
    } catch (error) {
      console.warn('Could not load download history:', error);
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

    if (downloadsTimer) clearInterval(downloadsTimer);
    downloadsTimer = null;
  }

  async function clearDownloadHistory() {
    if (!confirm('Clear download history? Downloaded media and resumable partial files will be kept.')) return;

    try {
      await safeFetch('/api/history/downloads', { method: 'DELETE' });
      await refreshDownloads();
    } catch (error) {
      alert(error.message || 'Could not clear download history.');
    }
  }

  // Functions used by inline onclick handlers in the HTML.
  window.switchSettingsTab = switchSettingsTab;
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