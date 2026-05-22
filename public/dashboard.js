(function () {
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('emptyState');
  const tierFiltersEl = document.getElementById('tierFilters');
  const searchInput = document.getElementById('searchInput');
  const selectModeBtn = document.getElementById('selectModeBtn');
  const selectionBar = document.getElementById('selectionBar');
  const selCount = document.getElementById('selCount');
  const selCountSuffix = document.getElementById('selCountSuffix');
  const logoTally = document.getElementById('logoTally');
  const logoCount = document.getElementById('logoCount');
  const clearSelBtn = document.getElementById('clearSelBtn');
  const exportSelBtn = document.getElementById('exportSelBtn');
  const attachLogosBtn = document.getElementById('attachLogosBtn');
  const saveSectionBtn = document.getElementById('saveSectionBtn');
  const includeAboutToggle = document.getElementById('includeAboutToggle');
  const includeAboutLabel = document.getElementById('includeAboutLabel');
  const newCaseStudyBtn = document.getElementById('newCaseStudyBtn');

  // Logo modal
  const logoModal = document.getElementById('logoModal');
  const logoModalClose = document.getElementById('logoModalClose');
  const lpGrid = document.getElementById('lpGrid');
  const lpSearch = document.getElementById('lpSearch');
  const lpAllBtn = document.getElementById('lpAllBtn');
  const lpWithLogosBtn = document.getElementById('lpWithLogosBtn');
  const lpNoneBtn = document.getElementById('lpNoneBtn');
  const lpCancelBtn = document.getElementById('lpCancelBtn');
  const lpSaveBtn = document.getElementById('lpSaveBtn');
  const lpCountText = document.getElementById('lpCountText');

  let allStudies = [];
  let allClients = [];
  let activeIndustry = 'all';
  let query = '';
  let selectMode = false;
  const selected = new Set();         // case study IDs
  const selectedLogos = new Set();    // client IDs
  let lpQuery = '';                   // search query inside logo modal
  let lpDraft = new Set();            // staged selections inside the open modal
  let editingSectionId = null;        // if we opened from /sections, this holds the section ID
  let focusedCardId = null;           // ID of card with the action bar open

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function buildIndustryChips(studies) {
    // Aggregate industries with usage counts (descending)
    const counts = new Map();
    studies.forEach((s) => {
      (s.industries || []).forEach((i) => counts.set(i, (counts.get(i) || 0) + 1));
    });
    const industries = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    tierFiltersEl.innerHTML =
      `<button class="cv-filter active" data-industry="all">All <span class="cv-filter-count">${studies.length}</span></button>` +
      industries.map(([name, n]) => `<button class="cv-filter" data-industry="${escapeHtml(name)}">${escapeHtml(name)} <span class="cv-filter-count">${n}</span></button>`).join('');

    tierFiltersEl.querySelectorAll('.cv-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        tierFiltersEl.querySelectorAll('.cv-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeIndustry = btn.dataset.industry;
        render();
      });
    });
  }

  function matches(cs) {
    if (activeIndustry !== 'all' && !(cs.industries || []).includes(activeIndustry)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    const hay = [cs.client, cs.scope, cs.tier, cs.headline, cs.headlineSuffix, ...(cs.industries || []), ...(cs.tags || []), ...(cs.metrics || [])]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  function cardHTML(cs) {
    const tags = (cs.tags || []).slice(0, 3);
    const overflow = (cs.tags || []).length - tags.length;
    const tagHTML = tags.map((t) => `<span class="cs-tag">${escapeHtml(t)}</span>`).join('') +
      (overflow > 0 ? `<span class="cs-tag cs-tag-overflow">+${overflow}</span>` : '');

    const headlineHTML = cs.headline
      ? `<mark>${escapeHtml(cs.headline)}</mark>${cs.headlineSuffix ? `<br/><span style="font-weight:600;font-size:0.6em;color:var(--cream-soft)">${escapeHtml(cs.headlineSuffix)}</span>` : ''}`
      : escapeHtml(cs.client || '');

    const isSelected = selected.has(cs.id);
    const isFocused = focusedCardId === cs.id;
    return `
      <article class="cs-card${isSelected ? ' is-selected' : ''}${isFocused ? ' is-focused' : ''}" data-id="${escapeHtml(cs.id)}" data-draft="${cs.draft ? 'true' : 'false'}">
        <button class="cs-card-checkbox${isSelected ? ' is-checked' : ''}" data-action="toggle-select" aria-label="Select case study">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <div class="cs-card-actions">
          <button type="button" class="cs-card-action-btn" data-action="card-menu" aria-label="Open actions">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
          </button>
        </div>
        <a class="cs-card-link" href="/view?id=${encodeURIComponent(cs.id)}">
          <div class="cs-card-preview">
            <div class="cs-card-preview-headline">${headlineHTML}</div>
          </div>
          <div class="cs-card-info">
            <div class="cs-card-tier">${escapeHtml((cs.industries || []).slice(0, 3).join(' · ') || cs.tier || '')}</div>
            <div class="cs-card-title">${escapeHtml(cs.client || '')} <span class="cs-scope">| ${escapeHtml(cs.scope || '')}</span></div>
            <div class="cs-card-tags">${tagHTML}</div>
          </div>
        </a>
      </article>
    `;
  }

  function addTileHTML() {
    return `
      <article class="cs-card cs-card-add" id="addCaseStudyTile" role="button" tabindex="0">
        <div class="cs-card-link" style="cursor:pointer; align-items:center; justify-content:center; min-height:280px; padding:2rem; text-align:center;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <div style="margin-top:0.85rem; font-weight:700; font-size:0.95rem; color:var(--cream);">New case study</div>
          <div style="margin-top:0.35rem; font-size:0.78rem; color:var(--text-muted);">Start a fresh entry, then fill it out in the editor.</div>
        </div>
      </article>
    `;
  }

  function render() {
    const filtered = allStudies.filter(matches);
    // Show the "+ New" tile only when no filter or search is active
    const showAdd = !query && activeIndustry === 'all';
    grid.innerHTML = filtered.map(cardHTML).join('') + (showAdd ? addTileHTML() : '');
    emptyState.style.display = filtered.length ? 'none' : 'block';
    if (showAdd) {
      const tile = document.getElementById('addCaseStudyTile');
      tile?.addEventListener('click', createCaseStudy);
      tile?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); createCaseStudy(); } });
    }

    grid.querySelectorAll('[data-action="toggle-select"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.closest('.cs-card')?.dataset?.id;
        if (!id) return;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        render();
        updateSelectionBar();
      });
    });

    grid.querySelectorAll('.cs-card[data-id]').forEach((card) => {
      const id = card.dataset.id;
      const menuBtn = card.querySelector('[data-action="card-menu"]');
      menuBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openActionBarForCaseStudy(id);
      });
    });
  }

  // ---------- Context action bar ----------
  const cardActionBar = document.getElementById('cardActionBar');
  const cabThumb = document.getElementById('cabThumb');
  const cabEyebrow = document.getElementById('cabEyebrow');
  const cabName = document.getElementById('cabName');
  const cabActions = document.getElementById('cabActions');
  const cabClose = document.getElementById('cabClose');

  function closeActionBar() {
    focusedCardId = null;
    cardActionBar?.classList.remove('active');
    cardActionBar?.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.cs-card.is-focused').forEach((el) => el.classList.remove('is-focused'));
  }

  function openActionBarForCaseStudy(id) {
    const cs = allStudies.find((c) => c.id === id);
    if (!cs || !cardActionBar) return;
    focusedCardId = id;
    cabEyebrow.textContent = cs.tier || 'Case study';
    cabName.textContent = `${cs.client}${cs.scope ? ' | ' + cs.scope : ''}`;
    // Use the headline mark as the thumbnail content (matches the card preview vibe)
    cabThumb.innerHTML = cs.headline
      ? `<div class="cv-cab-thumb-fallback">${escapeHtml((cs.headline || '').slice(0, 2).toUpperCase() || (cs.client || '?').charAt(0))}</div>`
      : `<div class="cv-cab-thumb-fallback">${escapeHtml((cs.client || '?').charAt(0).toUpperCase())}</div>`;

    cabActions.innerHTML = `
      <button type="button" class="cv-cab-btn" data-cab="edit">Edit</button>
      <button type="button" class="cv-cab-btn secondary" data-cab="duplicate">Duplicate</button>
      <button type="button" class="cv-cab-btn danger" data-cab="delete">Delete</button>
    `;

    cabActions.querySelector('[data-cab="edit"]').onclick = () => {
      window.location.href = `/view?id=${encodeURIComponent(id)}&edit=1`;
    };
    cabActions.querySelector('[data-cab="duplicate"]').onclick = async () => {
      try {
        const res = await fetch(`/api/case-studies/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
        if (!res.ok) throw new Error('duplicate_failed');
        const copy = await res.json();
        window.location.href = `/view?id=${encodeURIComponent(copy.id)}&edit=1`;
      } catch (err) { console.error(err); alert('Could not duplicate case study.'); }
    };
    cabActions.querySelector('[data-cab="delete"]').onclick = async () => {
      if (!confirm(`Delete the "${cs.client}" case study? This can't be undone.`)) return;
      try {
        const res = await fetch(`/api/case-studies/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete_failed');
        allStudies = allStudies.filter((c) => c.id !== id);
        selected.delete(id);
        closeActionBar();
        render();
        updateSelectionBar();
      } catch (err) { console.error(err); alert('Could not delete case study.'); }
    };

    cardActionBar.classList.add('active');
    cardActionBar.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('.cs-card.is-focused').forEach((el) => el.classList.remove('is-focused'));
    document.querySelector(`.cs-card[data-id="${CSS.escape(id)}"]`)?.classList.add('is-focused');
  }

  cabClose?.addEventListener('click', closeActionBar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeActionBar(); });
  // Clicking anywhere outside a card-menu trigger or the bar itself closes it
  document.addEventListener('click', (e) => {
    if (!focusedCardId) return;
    const t = e.target;
    if (cardActionBar.contains(t)) return;
    if (t.closest && t.closest('[data-action="card-menu"]')) return;
    closeActionBar();
  });

  function updateSelectionBar() {
    const n = selected.size;
    selCount.textContent = String(n);
    selCountSuffix.textContent = n === 1 ? 'y' : 'ies';
    logoCount.textContent = String(selectedLogos.size);
    logoTally.style.display = selectedLogos.size > 0 ? 'inline' : 'none';
    selectionBar.classList.toggle('active', selectMode || n > 0 || selectedLogos.size > 0);
  }

  async function createCaseStudy() {
    const client = prompt('Client name (e.g. "Mondelez", "James Beard Foundation"):');
    if (!client || !client.trim()) return;
    const scope = prompt('Scope or location (e.g. "International", "New York City"):', '') || '';
    try {
      const res = await fetch('/api/case-studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: client.trim(), scope: scope.trim() })
      });
      if (!res.ok) throw new Error('create_failed');
      const created = await res.json();
      window.location.href = `/view?id=${encodeURIComponent(created.id)}&edit=1`;
    } catch (err) {
      console.error(err);
      alert('Could not create case study.');
    }
  }

  newCaseStudyBtn?.addEventListener('click', createCaseStudy);

  selectModeBtn.addEventListener('click', () => {
    selectMode = !selectMode;
    selectModeBtn.textContent = selectMode ? 'Exit selection' : 'Selection mode';
    document.body.classList.toggle('cv-select-mode', selectMode);
    updateSelectionBar();
  });

  clearSelBtn.addEventListener('click', () => {
    selected.clear();
    selectedLogos.clear();
    render();
    updateSelectionBar();
  });

  function buildExportUrl() {
    const ids = Array.from(selected);
    const logoIds = Array.from(selectedLogos);
    const params = new URLSearchParams();
    params.set('ids', ids.join(','));
    if (logoIds.length) params.set('logos', logoIds.join(','));
    if (includeAboutToggle?.checked) params.set('about', '1');
    return `/export?${params.toString()}`;
  }

  includeAboutToggle?.addEventListener('change', () => {
    includeAboutLabel?.classList.toggle('is-on', includeAboutToggle.checked);
  });

  exportSelBtn.addEventListener('click', () => {
    if (!selected.size && !selectedLogos.size) return;
    window.location.href = buildExportUrl();
  });

  searchInput.addEventListener('input', (e) => {
    query = e.target.value.trim();
    render();
  });

  // ---------- Logo picker modal ----------
  function lpFilteredClients() {
    const q = lpQuery.toLowerCase();
    return allClients.filter((c) => !q || (c.name || '').toLowerCase().includes(q));
  }

  function renderLogoPicker() {
    const list = lpFilteredClients();
    lpGrid.innerHTML = list.map((c) => {
      const isSelected = lpDraft.has(c.id);
      const hasLogo = !!c.logo;
      const frame = hasLogo
        ? `<img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)} logo" />`
        : `<div class="lg-card-empty">${escapeHtml(c.name)}</div>`;
      return `
        <article class="lg-card${isSelected ? ' is-selected' : ''}" data-id="${escapeHtml(c.id)}">
          <button class="lg-card-check${isSelected ? ' is-checked' : ''}" data-action="lp-toggle" aria-label="Select">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <div class="lg-card-frame" data-empty="${hasLogo ? 'false' : 'true'}" data-action="lp-toggle">${frame}</div>
          <div class="lg-card-info"><span class="lg-card-name" style="border:0;background:transparent;">${escapeHtml(c.name)}</span></div>
        </article>
      `;
    }).join('');

    lpGrid.querySelectorAll('[data-action="lp-toggle"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.closest('.lg-card')?.dataset?.id;
        if (!id) return;
        if (lpDraft.has(id)) lpDraft.delete(id); else lpDraft.add(id);
        renderLogoPicker();
        updateLpFooter();
      });
    });
    updateLpFooter();
  }

  function updateLpFooter() {
    const n = lpDraft.size;
    lpCountText.textContent = `${n} selected`;
  }

  function openLogoModal() {
    if (!allClients.length) {
      // Lazy-load clients the first time the modal is opened
      fetch('/api/clients').then((r) => r.json()).then((d) => {
        allClients = d.clients || [];
        lpDraft = new Set(selectedLogos);
        renderLogoPicker();
        logoModal.classList.add('open');
        logoModal.setAttribute('aria-hidden', 'false');
      });
      return;
    }
    lpDraft = new Set(selectedLogos);
    renderLogoPicker();
    logoModal.classList.add('open');
    logoModal.setAttribute('aria-hidden', 'false');
  }

  function closeLogoModal() {
    logoModal.classList.remove('open');
    logoModal.setAttribute('aria-hidden', 'true');
  }

  attachLogosBtn.addEventListener('click', openLogoModal);
  logoModalClose.addEventListener('click', closeLogoModal);
  lpCancelBtn.addEventListener('click', closeLogoModal);
  logoModal.addEventListener('click', (e) => { if (e.target === logoModal) closeLogoModal(); });

  lpSearch.addEventListener('input', (e) => { lpQuery = e.target.value.trim(); renderLogoPicker(); });
  lpAllBtn.addEventListener('click', () => { lpFilteredClients().forEach((c) => lpDraft.add(c.id)); renderLogoPicker(); });
  lpWithLogosBtn.addEventListener('click', () => { lpFilteredClients().filter((c) => c.logo).forEach((c) => lpDraft.add(c.id)); renderLogoPicker(); });
  lpNoneBtn.addEventListener('click', () => { lpDraft.clear(); renderLogoPicker(); });

  lpSaveBtn.addEventListener('click', () => {
    selectedLogos.clear();
    lpDraft.forEach((id) => selectedLogos.add(id));
    closeLogoModal();
    updateSelectionBar();
  });

  // ---------- Save as section ----------
  saveSectionBtn.addEventListener('click', async () => {
    if (!selected.size && !selectedLogos.size) {
      alert('Select at least one case study or logo first.');
      return;
    }
    const isUpdate = !!editingSectionId;
    const promptMsg = isUpdate ? 'Update saved section name (or keep current):' : 'Name this saved section:';
    const defaultName = isUpdate ? '' : '';
    const name = prompt(promptMsg, defaultName);
    if (name == null) return;
    const trimmed = name.trim();
    if (!isUpdate && !trimmed) return;

    const payload = {
      caseStudyIds: Array.from(selected),
      clientIds: Array.from(selectedLogos),
      includeAbout: !!includeAboutToggle?.checked
    };
    if (trimmed) payload.name = trimmed;

    try {
      let res;
      if (isUpdate) {
        res = await fetch(`/api/sections/${encodeURIComponent(editingSectionId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/sections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      if (!res.ok) throw new Error('save_failed');
      const sec = await res.json();
      editingSectionId = sec.id;
      saveSectionBtn.textContent = 'Update section';
      saveSectionBtn.title = `Editing "${sec.name}"`;
      const orig = exportSelBtn.textContent;
      exportSelBtn.textContent = 'Saved · Export';
      setTimeout(() => { exportSelBtn.textContent = orig; }, 1800);
    } catch (err) {
      console.error(err);
      alert('Could not save section.');
    }
  });

  // ---------- Pre-load from ?section=ID ----------
  async function loadFromSectionParam() {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('section');
    if (!sid) return;
    try {
      const res = await fetch(`/api/sections/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const sec = await res.json();
      editingSectionId = sec.id;
      (sec.caseStudyIds || []).forEach((id) => selected.add(id));
      (sec.clientIds || []).forEach((id) => selectedLogos.add(id));
      if (includeAboutToggle && sec.includeAbout) {
        includeAboutToggle.checked = true;
        includeAboutLabel?.classList.add('is-on');
      }
      // Eager-load clients so the modal opens fast and tally renders
      const cr = await fetch('/api/clients').then((r) => r.json()).catch(() => null);
      if (cr) allClients = cr.clients || [];
      selectMode = true;
      selectModeBtn.textContent = 'Exit selection';
      document.body.classList.add('cv-select-mode');
      saveSectionBtn.textContent = 'Update section';
      saveSectionBtn.title = `Editing "${sec.name}"`;
    } catch (err) { console.warn('section preload skipped', err); }
  }

  async function load() {
    try {
      await loadFromSectionParam();
      const res = await fetch('/api/case-studies');
      const data = await res.json();
      allStudies = data.caseStudies || [];
      buildIndustryChips(allStudies);
      render();
      updateSelectionBar();
    } catch (err) {
      console.error('Failed to load case studies', err);
      grid.innerHTML = '';
      emptyState.textContent = 'Could not load case studies.';
      emptyState.style.display = 'block';
    }
  }

  load();
})();
