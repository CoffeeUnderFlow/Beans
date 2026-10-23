/* Beans Extractor sidebar, history, theme and downloads */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

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
  let historyRefreshTimer = null;

  // Connect the existing HTML elements.
  function initializeSidebar() {
    const shell = $('beans-app-shell');
    if (!shell) {
      console.error('Sidebar HTML is missing: #beans-app-shell');
      return;
    }

    // Move existing application branding into the sidebar.
    const brand = document.querySelector('.app-branding');
    const brandTarget = shell.querySelector('.beans-sidebar-brand');

    if (brand && brandTarget && !brandTarget.contains(brand)) {
      brandTarget.appendChild(brand);
    }

    // The sidebar replaces the old hamburger menu.
    $('menuToggle')?.remove();

    // Move the existing extractor card into the workspace.
    const card = document.querySelector('.extractor-card');
    const workspace = shell.querySelector('.beans-workspace-content');

    if (card && workspace && !workspace.contains(card)) {
      workspace.appendChild(card);
    }

    // Keep the error banner inside the extractor card.
    const error = $('error-banner');

    if (error && card && !card.contains(error)) {
      card.prepend(error);
    }

    $('beans-home-button')?.addEventListener('click', showHome);

    $('beans-url-history-button')?.addEventListener('click', () => {
      showHome();
      $('url-input')?.focus();
      refreshUrlHistory();
    });

    $('beans-downloads-button')?.addEventListener('click', openDrawer);
    $('beans-top-downloads')?.addEventListener('click', openDrawer);
    $('beans-close-drawer')?.addEventListener('click', closeDrawer);
    $('beans-drawer-scrim')?.addEventListener('click', closeDrawer);

    $('beans-settings-button')?.addEventListener('click', toggleSettingsExpand);

    $('beans-open-settings')?.addEventListener('click', () => {
      if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal();
      }
    });

    $('beans-theme-toggle')?.addEventListener('click', toggleTheme);
    $('beans-clear-urls')?.addEventListener('click', clearUrlHistory);
    $('beans-clear-downloads')?.addEventListener('click', clearDownloadHistory);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeDrawer();
    });
  }

  function showHome() {
    $('beans-page-title').textContent = 'Home';
    $('beans-home-button')?.classList.add('active');
    $('beans-url-history-button')?.classList.remove('active');
    closeDrawer();
  }

  function toggleSettingsExpand() {
    const panel = $('beans-settings-expand');
    if (!panel) return;

    panel.hidden = !panel.hidden;

    const chevron = $('beans-settings-chevron');
    if (chevron) {
      chevron.textContent = panel.hidden ? '⌄' : '⌃';
    }
  }

  // Theme
  async function loadTheme() {
    let theme = 'dark';

    try {
      const data = await safeFetch('/api/theme', { cache: 'no-store' });
      theme = data.theme || 'dark';
    } catch {
      // Use dark mode if the saved preference cannot be loaded.
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

    $('beans-theme-toggle')?.classList.toggle('is-light', selected === 'light');

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

  // URL history
  async function refreshUrlHistory() {
    const list = $('beans-url-list');
    if (!list) return;

    try {
      const data = await safeFetch('/api/history/urls', { cache: 'no-store' });
      const items = data.items || [];

      $('beans-url-history-button')?.classList.toggle('has-items', items.length > 0);

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
          if (!item) return;

          showHome();

          if ($('phase-2')) $('phase-2').style.display = 'block';
          if ($('phase-3')) $('phase-3').style.display = 'none';
          if ($('url-input')) $('url-input').value = item.url;

          $('url-input')?.focus();
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

  // Download status helpers
  function statusClass(status) {
    const value = String(status || '').toLowerCase();

    if (value === 'completed') return 'success';
    if (['failed', 'error', 'interrupted'].includes(value)) return 'danger';
    if (value === 'cancelled') return 'muted';

    return 'active';
  }

  function statusLabel(status) {
    const value = String(status || 'starting').toLowerCase();

    return ({
      queued: 'Queued',
      starting: 'Starting',
      downloading: 'Downloading',
      merging: 'Processing',
      subtitles: 'Subtitles',
      embedding: 'Embedding subtitles',
      finalizing: 'Finalizing',
      cancelling: 'Cancelling',
      completed: 'Completed',
      failed: 'Failed',
      error: 'Failed',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted'
    })[value] || value.replaceAll('_', ' ');
  }

  // Download drawer and history
  async function refreshDownloads() {
    try {
      const data = await safeFetch('/api/history/downloads', { cache: 'no-store' });
      const items = data.items || [];

      const activeItems = items.filter(item =>
        !['completed', 'failed', 'cancelled', 'interrupted']
          .includes(String(item.status || '').toLowerCase())
      );

      const count = $('beans-download-count');
      if (count) count.textContent = activeItems.length ? String(activeItems.length) : '';

      const activeContainer = $('beans-download-active');

      if (activeContainer) {
        activeContainer.innerHTML = activeItems.map(item => `
          <div class="beans-active-card" data-active-task="${esc(item.task_id)}">
            <div class="beans-active-top">
              <span class="beans-status-dot"></span>
              <span>${String(item.status).toLowerCase() === 'queued' ? 'QUEUED DOWNLOAD' : 'ACTIVE DOWNLOAD'}</span>
              <span class="beans-active-percent">${esc(item.overall_percent || item.percent || '0%')}</span>
            </div>
            <div class="beans-download-title">${esc(item.title || item.url || 'Downloading media')}</div>
            <div class="beans-progress-track">
              <i style="width:${Math.max(0, Math.min(100, parseFloat(item.overall_percent || item.percent) || 0))}%"></i>
            </div>
            <div class="beans-active-bottom">
              <span>${String(item.status).toLowerCase() === 'queued'
                ? 'Waiting in queue'
                : String(item.status).toLowerCase() === 'cancelling'
                  ? 'Cancelling…' : 'Downloading…'}</span>
              <button type="button" data-cancel-task="${esc(item.task_id)}">Cancel</button>
            </div>
          </div>
        `).join('');

        activeContainer.querySelectorAll('[data-cancel-task]').forEach(button => {
          button.addEventListener('click', async () => {
            const taskId = button.dataset.cancelTask;

            button.disabled = true;
            button.textContent = 'Cancelling...';

            try {
              await safeFetch('/api/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id: taskId })
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

      const terminalStatuses = [
        'completed', 'failed', 'error', 'cancelled', 'interrupted'
      ];

      const historyItems = items.filter(item =>
        terminalStatuses.includes(String(item.status || '').toLowerCase())
      );

      const historyContainer = $('beans-download-list');

      if (!historyContainer) return;

      historyContainer.innerHTML = historyItems.length
        ? historyItems.map(item => {
            const status = String(item.status || 'starting').toLowerCase();
            const canReveal = status === 'completed' && item.filename;
            const canRetry = ['failed', 'error', 'cancelled', 'interrupted'].includes(status) && item.url;
            const embedded = Boolean(item.subtitles_embedded) ||
              /subtitles embedded successfully/i.test(String(item.subtitle_notice || ''));

            const shortMeta = status === 'completed'
              ? `${item.mode === 'mp3' ? 'MP3 audio' : 'Video'}${embedded ? ' · CC' : ''}`
              : (item.error || statusLabel(status));

            const icon = status === 'completed' ? '✓'
              : ['failed', 'error'].includes(status) ? '!'
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
                    <span class="beans-status-pill ${statusClass(status)}">
                      ${status === 'completed' ? '' : esc(statusLabel(status))}
                    </span>
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
          }).join('')
        : '<div class="beans-empty-state">No completed or failed downloads yet.</div>';

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
          showHome();

          if ($('phase-2')) $('phase-2').style.display = 'block';
          if ($('phase-3')) $('phase-3').style.display = 'none';
          if ($('url-input')) $('url-input').value = button.dataset.retry;

          $('url-input')?.focus();
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

  // Keep functions used by inline HTML onclick handlers available globally.
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

    historyRefreshTimer = setInterval(() => {
      refreshUrlHistory();

      if ($('beans-download-drawer')?.classList.contains('open')) {
        refreshDownloads();
      }
    }, 5000);
  });
})();