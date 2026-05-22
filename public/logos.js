(function () {
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('emptyState');
  const searchInput = document.getElementById('searchInput');
  const selectionBar = document.getElementById('selectionBar');
  const selCountEl = document.getElementById('selCount');
  const clearSelBtn = document.getElementById('clearSelBtn');
  const exportSelBtn = document.getElementById('exportSelBtn');
  const logoFile = document.getElementById('logoFile');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const selectWithLogosBtn = document.getElementById('selectWithLogosBtn');

  let clients = [];
  let query = '';
  const selected = new Set();
  let pendingUploadFor = null; // client id whose logo is being uploaded
  let focusedClientId = null;  // ID of client with the action bar open

  const cardActionBar = document.getElementById('cardActionBar');
  const cabThumb = document.getElementById('cabThumb');
  const cabEyebrow = document.getElementById('cabEyebrow');
  const cabName = document.getElementById('cabName');
  const cabActions = document.getElementById('cabActions');
  const cabClose = document.getElementById('cabClose');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function matches(c) {
    if (!query) return true;
    return (c.name || '').toLowerCase().includes(query.toLowerCase());
  }

  function cardHTML(c) {
    const isSelected = selected.has(c.id);
    const isFocused = focusedClientId === c.id;
    const hasLogo = !!c.logo;
    const frame = hasLogo
      ? `<img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)} logo" />`
      : `<div class="lg-card-empty">+ Upload logo</div>`;
    return `
      <article class="lg-card${isSelected ? ' is-selected' : ''}${isFocused ? ' is-focused' : ''}" data-id="${escapeHtml(c.id)}">
        <button class="lg-card-check${isSelected ? ' is-checked' : ''}" data-action="toggle-select" aria-label="Select">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <div class="lg-card-frame" data-empty="${hasLogo ? 'false' : 'true'}" data-action="upload" title="${hasLogo ? 'Replace logo' : 'Upload logo'}">
          ${frame}
        </div>
        <div class="lg-card-info">
          <input class="lg-card-name" data-action="rename" value="${escapeHtml(c.name)}" />
          <button class="lg-card-menu" data-action="menu" aria-label="Open actions" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
          </button>
        </div>
      </article>
    `;
  }

  function addCardHTML() {
    return `
      <article class="lg-card lg-card-add" data-action="add-client" role="button" tabindex="0">
        <div class="lg-card-add-inner">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add client
        </div>
      </article>
    `;
  }

  function render() {
    const filtered = clients.filter(matches);
    grid.innerHTML = filtered.map(cardHTML).join('') + addCardHTML();
    emptyState.style.display = filtered.length || query ? 'none' : 'block';
    if (!filtered.length && !query) emptyState.style.display = 'none';
    wireCards();
    updateSelectionBar();
  }

  function updateSelectionBar() {
    selCountEl.textContent = String(selected.size);
    selectionBar.classList.toggle('active', selected.size > 0);
  }

  function closeActionBar() {
    focusedClientId = null;
    cardActionBar?.classList.remove('active');
    cardActionBar?.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.lg-card.is-focused').forEach((el) => el.classList.remove('is-focused'));
  }

  function openActionBarForClient(id) {
    const c = clients.find((x) => x.id === id);
    if (!c || !cardActionBar) return;
    focusedClientId = id;

    cabEyebrow.textContent = 'Client logo';
    cabName.textContent = c.name;
    cabThumb.innerHTML = c.logo
      ? `<img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)} logo" />`
      : `<div class="cv-cab-thumb-fallback">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</div>`;

    const hasLogo = !!c.logo;
    cabActions.innerHTML = `
      <button type="button" class="cv-cab-btn" data-cab="${hasLogo ? 'replace' : 'upload'}">${hasLogo ? 'Replace logo' : 'Upload logo'}</button>
      ${hasLogo ? '<button type="button" class="cv-cab-btn secondary" data-cab="remove-logo">Remove logo</button>' : ''}
      <button type="button" class="cv-cab-btn danger" data-cab="delete">Delete client</button>
    `;

    cabActions.querySelector('[data-cab="upload"], [data-cab="replace"]').onclick = () => {
      pendingUploadFor = id;
      logoFile.click();
    };
    const removeBtn = cabActions.querySelector('[data-cab="remove-logo"]');
    if (removeBtn) removeBtn.onclick = async () => { await save(id, { logo: null }); closeActionBar(); };
    cabActions.querySelector('[data-cab="delete"]').onclick = async () => {
      if (!confirm(`Delete client "${c.name}"? This can't be undone.`)) return;
      await deleteClient(id);
      closeActionBar();
    };

    cardActionBar.classList.add('active');
    cardActionBar.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('.lg-card.is-focused').forEach((el) => el.classList.remove('is-focused'));
    document.querySelector(`.lg-card[data-id="${CSS.escape(id)}"]`)?.classList.add('is-focused');
  }

  cabClose?.addEventListener('click', closeActionBar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeActionBar(); });
  document.addEventListener('click', (e) => {
    if (!focusedClientId) return;
    const t = e.target;
    if (cardActionBar.contains(t)) return;
    if (t.closest && t.closest('[data-action="menu"]')) return;
    closeActionBar();
  });

  function wireCards() {
    grid.querySelectorAll('.lg-card').forEach((card) => {
      const id = card.dataset.id;

      // Add-client tile
      if (card.classList.contains('lg-card-add')) {
        card.addEventListener('click', addClient);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') addClient(); });
        return;
      }

      // Select toggle
      card.querySelector('[data-action="toggle-select"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        render();
      });

      // Upload (clicking the frame)
      card.querySelector('[data-action="upload"]')?.addEventListener('click', () => {
        pendingUploadFor = id;
        logoFile.click();
      });

      // Rename
      const name = card.querySelector('[data-action="rename"]');
      name?.addEventListener('blur', async () => {
        const next = name.value.trim();
        const cur = clients.find((c) => c.id === id);
        if (!next || !cur || next === cur.name) return;
        await save(id, { name: next });
      });
      name?.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

      // Open the top action bar
      card.querySelector('[data-action="menu"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openActionBarForClient(id);
      });
    });
  }

  async function load() {
    const res = await fetch('/api/clients');
    const data = await res.json();
    clients = data.clients || [];
    render();
  }

  async function save(id, patch) {
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!res.ok) throw new Error('save_failed');
      const updated = await res.json();
      const idx = clients.findIndex((c) => c.id === id);
      if (idx !== -1) clients[idx] = updated;
      render();
      // If the action bar is focused on this client, refresh it
      if (focusedClientId === id) openActionBarForClient(id);
    } catch (err) {
      console.error(err);
      alert('Could not save changes.');
    }
  }

  async function deleteClient(id) {
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete_failed');
      clients = clients.filter((c) => c.id !== id);
      selected.delete(id);
      render();
    } catch (err) {
      console.error(err);
      alert('Could not delete.');
    }
  }

  async function addClient() {
    const name = prompt('Client name:');
    if (!name) return;
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      if (!res.ok) throw new Error('create_failed');
      const created = await res.json();
      clients.push(created);
      render();
    } catch (err) {
      console.error(err);
      alert('Could not add client.');
    }
  }

  logoFile?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const id = pendingUploadFor;
    pendingUploadFor = null;
    logoFile.value = '';
    if (!file || !id) return;

    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('upload_failed');
      const { url } = await res.json();
      await save(id, { logo: url });
    } catch (err) {
      console.error(err);
      alert('Upload failed.');
    }
  });

  searchInput.addEventListener('input', (e) => {
    query = e.target.value.trim();
    render();
  });

  clearSelBtn.addEventListener('click', () => {
    selected.clear();
    render();
  });

  exportSelBtn.addEventListener('click', () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    window.location.href = `/logo-page?ids=${ids.map(encodeURIComponent).join(',')}`;
  });

  selectAllBtn.addEventListener('click', () => {
    clients.filter(matches).forEach((c) => selected.add(c.id));
    render();
  });

  selectWithLogosBtn.addEventListener('click', () => {
    clients.filter(matches).filter((c) => c.logo).forEach((c) => selected.add(c.id));
    render();
  });

  load().catch((err) => {
    console.error(err);
    grid.innerHTML = '';
    emptyState.textContent = 'Could not load logos.';
    emptyState.style.display = 'block';
  });
})();
