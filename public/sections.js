(function () {
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('emptyState');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtDate(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  }

  function buildExportUrl(sec) {
    const params = new URLSearchParams();
    params.set('ids', (sec.caseStudyIds || []).join(','));
    if ((sec.clientIds || []).length) params.set('logos', sec.clientIds.join(','));
    return `/export?${params.toString()}`;
  }

  function cardHTML(sec) {
    const csCount = (sec.caseStudyIds || []).length;
    const lgCount = (sec.clientIds || []).length;
    return `
      <article class="sec-card" data-id="${escapeHtml(sec.id)}">
        <div class="sec-card-name">${escapeHtml(sec.name)}</div>
        ${sec.description ? `<div class="sec-card-desc">${escapeHtml(sec.description)}</div>` : '<div class="sec-card-desc" style="opacity:0.5;font-style:italic">No description</div>'}
        <div class="sec-card-meta">
          <span>${csCount} stud${csCount === 1 ? 'y' : 'ies'}</span>
          <span>${lgCount} logo${lgCount === 1 ? '' : 's'}</span>
          ${sec.updatedAt ? `<span>Updated ${escapeHtml(fmtDate(sec.updatedAt))}</span>` : ''}
        </div>
        <div class="sec-card-foot">
          <a class="cv-btn" href="/?section=${encodeURIComponent(sec.id)}">Open</a>
          <a class="cv-btn cv-btn-primary" href="${escapeHtml(buildExportUrl(sec))}">Export</a>
          <div class="right">
            <button class="sec-card-icon" data-action="rename" title="Rename">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
            </button>
            <button class="sec-card-icon danger" data-action="delete" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function emptyCardHTML() {
    return `
      <a class="sec-card sec-empty-card" href="/">
        <div class="sec-empty-card-inner">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New section
        </div>
      </a>
    `;
  }

  let sections = [];

  function render() {
    grid.innerHTML = sections.map(cardHTML).join('') + emptyCardHTML();
    emptyState.style.display = sections.length ? 'none' : 'block';
    grid.querySelectorAll('.sec-card[data-id]').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('[data-action="rename"]')?.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = sections.find((s) => s.id === id);
        if (!cur) return;
        const next = prompt('Rename section:', cur.name);
        if (next == null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed === cur.name) return;
        try {
          const res = await fetch(`/api/sections/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed })
          });
          if (!res.ok) throw new Error('rename_failed');
          const upd = await res.json();
          const idx = sections.findIndex((s) => s.id === id);
          if (idx !== -1) sections[idx] = upd;
          render();
        } catch (err) { console.error(err); alert('Could not rename.'); }
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = sections.find((s) => s.id === id);
        if (!cur) return;
        if (!confirm(`Delete saved section "${cur.name}"? This can't be undone.`)) return;
        try {
          const res = await fetch(`/api/sections/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('delete_failed');
          sections = sections.filter((s) => s.id !== id);
          render();
        } catch (err) { console.error(err); alert('Could not delete.'); }
      });
    });
  }

  async function load() {
    try {
      const res = await fetch('/api/sections');
      const data = await res.json();
      sections = data.sections || [];
      render();
    } catch (err) {
      console.error(err);
      grid.innerHTML = '';
      emptyState.textContent = 'Could not load sections.';
      emptyState.style.display = 'block';
    }
  }

  load();
})();
