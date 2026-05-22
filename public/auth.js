// Cover — Auth module. Include on every page after the body opens.
// Reads cookie/localStorage, redirects to /login if missing/expired,
// patches fetch to send Authorization: Bearer for /api/* calls,
// and injects a small user menu into the header.

(function () {
  'use strict';

  const COOKIE = 'cover_token';
  const PUBLIC_PATHS = ['/login'];

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getToken() {
    const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
    if (m) return decodeURIComponent(m[1]);
    try { return localStorage.getItem(COOKIE) || null; } catch { return null; }
  }

  function decode(token) {
    try {
      const [data] = token.split('.');
      const b = data.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b + '='.repeat((4 - (b.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function getUser() {
    const t = getToken();
    if (!t) return null;
    const p = decode(t);
    if (!p) return null;
    if (p.exp && p.exp < Date.now()) return null;
    return { name: p.name || (p.email || '').split('@')[0] || 'User', email: p.email || '' };
  }

  // Auth gate
  const path = window.location.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  if (!isPublic) {
    const user = getUser();
    if (!user) {
      window.location.href = '/login';
      return;
    }
    window.COVER_USER = user;
  }

  // Patch fetch to send Authorization for /api calls
  const origFetch = window.fetch;
  window.fetch = function (url, options = {}) {
    const t = getToken();
    if (t && typeof url === 'string' && url.startsWith('/api/')) {
      options.headers = options.headers || {};
      if (options.headers instanceof Headers) options.headers.set('Authorization', 'Bearer ' + t);
      else options.headers['Authorization'] = 'Bearer ' + t;
    }
    return origFetch.call(this, url, options);
  };

  // Inject user menu
  function inject() {
    const user = window.COVER_USER;
    if (!user) return;
    const slot = document.querySelector('.cv-header-right');
    if (!slot) return;
    if (slot.querySelector('.cv-user-menu')) return;

    const wrap = document.createElement('div');
    wrap.className = 'cv-user-menu';
    const initial = (user.name.charAt(0) || '?').toUpperCase();
    wrap.innerHTML = `
      <button class="cv-user-btn" id="cvUserBtn" aria-label="Account">
        <span class="cv-user-avatar">${escapeHtml(initial)}</span>
      </button>
      <div class="cv-user-dropdown" id="cvUserDropdown">
        <div class="cv-user-info">
          <span class="cv-user-name">${escapeHtml(user.name)}</span>
          <span class="cv-user-email">${escapeHtml(user.email)}</span>
        </div>
        <button class="cv-user-action" id="cvBackupBtn">Back up now</button>
        <div class="cv-user-action-hint" id="cvBackupHint">Snapshot to Cloudflare R2</div>
        <button class="cv-user-signout" id="cvSignOut">Sign out</button>
      </div>
    `;
    slot.appendChild(wrap);

    const btn = document.getElementById('cvUserBtn');
    const dd = document.getElementById('cvUserDropdown');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dd.classList.toggle('open');
    });
    document.addEventListener('click', () => dd.classList.remove('open'));
    document.getElementById('cvSignOut').addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST' }); } catch {}
      document.cookie = COOKIE + '=; Path=/; Max-Age=0';
      try { localStorage.removeItem(COOKIE); } catch {}
      window.location.href = '/login';
    });

    // Manual backup-now button
    const backupBtn = document.getElementById('cvBackupBtn');
    const backupHint = document.getElementById('cvBackupHint');
    backupBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const original = backupBtn.textContent;
      backupBtn.disabled = true;
      backupBtn.textContent = 'Backing up…';
      backupHint.textContent = 'Uploading to Cloudflare R2…';
      try {
        const res = await fetch('/api/backup/run', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (data.error === 'r2_not_configured') {
            backupBtn.textContent = 'Not configured';
            backupHint.textContent = 'R2 keys missing on server';
          } else {
            backupBtn.textContent = 'Backup failed';
            backupHint.textContent = data.error || 'Try again later';
          }
        } else {
          backupBtn.textContent = 'Backed up ✓';
          const summary = `${(data.jsonBytes/1024).toFixed(1)} KB JSON + ${data.mediaFiles} new media file${data.mediaFiles === 1 ? '' : 's'} (${data.mediaSkipped} already mirrored)`;
          backupHint.textContent = summary;
        }
        setTimeout(() => {
          backupBtn.disabled = false;
          backupBtn.textContent = original;
          backupHint.textContent = 'Snapshot to Cloudflare R2';
        }, 4000);
      } catch (err) {
        console.error(err);
        backupBtn.textContent = 'Backup failed';
        backupHint.textContent = 'Network error';
        setTimeout(() => {
          backupBtn.disabled = false;
          backupBtn.textContent = original;
          backupHint.textContent = 'Snapshot to Cloudflare R2';
        }, 3000);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
