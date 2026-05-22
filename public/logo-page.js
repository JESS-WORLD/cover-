(function () {
  const grid = document.getElementById('lpGrid');
  const titleEl = document.getElementById('lpTitle');
  const printBtn = document.getElementById('printBtn');
  const copyBtn = document.getElementById('copyLinkBtn');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getIds() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  function densityFor(n) {
    if (n <= 8) return 'airy';
    if (n <= 18) return 'balanced';
    return 'dense';
  }

  function tileHTML(c) {
    if (c.logo) {
      return `<div class="lp-tile"><img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)}" /></div>`;
    }
    return `<div class="lp-tile"><div class="lp-tile-fallback">${escapeHtml(c.name)}</div></div>`;
  }

  async function load() {
    const ids = getIds();
    if (!ids.length) {
      grid.innerHTML = '';
      titleEl.textContent = 'No logos selected';
      return;
    }
    const res = await fetch('/api/clients/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    const clientsById = new Map((data.clients || []).map((c) => [c.id, c]));
    // Preserve the order from the URL (= the order the user picked them)
    const ordered = ids.map((id) => clientsById.get(id)).filter(Boolean);

    grid.dataset.density = densityFor(ordered.length);
    grid.innerHTML = ordered.map(tileHTML).join('');
    titleEl.textContent = `Trusted by — ${ordered.length} brand${ordered.length === 1 ? '' : 's'}`;
    document.title = `Cover — Trusted by ${ordered.length}`;
  }

  printBtn.addEventListener('click', () => window.print());

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    } catch {
      alert('Could not copy. URL: ' + window.location.href);
    }
  });

  load().catch((err) => {
    console.error(err);
    grid.innerHTML = '<p class="cv-empty">Could not load logos.</p>';
  });
})();
