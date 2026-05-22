(function () {
  const detailBody = document.getElementById('detailBody');
  const editToggleBtn = document.getElementById('editToggleBtn');
  const headerRight = document.querySelector('.cv-header-right');

  let cs = null;
  let editMode = false;
  let dirty = false;

  // ---------- helpers ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getId() {
    return new URLSearchParams(window.location.search).get('id');
  }

  function shouldStartInEdit() {
    return new URLSearchParams(window.location.search).get('edit') === '1';
  }

  function setDirty(v) {
    dirty = v;
    const bar = document.getElementById('editBar');
    if (bar) bar.classList.toggle('is-dirty', v);
    const status = document.getElementById('editStatus');
    if (status) status.textContent = v ? 'Unsaved changes' : 'All changes saved';
    const save = document.getElementById('saveBtn');
    if (save) save.disabled = !v;
  }

  // ---------- render ----------
  function render() {
    const industries = (cs.industries || []).map((t) => `
      <span class="cs-tag cs-tag-industry" data-industry>
        <span class="cv-editable" data-field="industry" contenteditable="false">${escapeHtml(t)}</span>
        <span class="cv-tag-x" title="Remove">&times;</span>
      </span>
    `).join('');

    const tags = (cs.tags || []).map((t) => `
      <span class="cs-tag" data-tag>
        <span class="cv-editable" data-field="tag" contenteditable="false">${escapeHtml(t)}</span>
        <span class="cv-tag-x" title="Remove">&times;</span>
      </span>
    `).join('');

    const phoneInner = cs.video
      ? `<video src="${escapeHtml(cs.video)}" autoplay muted loop playsinline ${cs.poster ? `poster="${escapeHtml(cs.poster)}"` : ''}></video>`
      : cs.poster
      ? `<img src="${escapeHtml(cs.poster)}" alt="${escapeHtml(cs.client || '')}" />`
      : `<div class="cv-phone-empty" id="phoneEmpty">Drop progress reel here</div>`;

    // Headline + suffix are no longer overlaid on the video.
    // They now live in the right-hand column (edit-only block) and
    // still drive the highlighted callout on dashboard cards + exports.

    const metricsHTML = `
      <section>
        <div class="cv-section-label">Outcomes</div>
        <ul class="cv-metrics" id="metricsList">
          ${(cs.metrics || []).map((m, i) => `
            <li class="cv-metric-row" data-metric-index="${i}">
              <span class="cv-editable" data-field="metric" data-index="${i}" contenteditable="false">${escapeHtml(m)}</span>
              <button class="cv-metric-del" title="Remove">&times;</button>
            </li>
          `).join('')}
        </ul>
        <button class="cv-add-btn" id="addMetricBtn">+ Add outcome</button>
      </section>
    `;

    // Edit-only "Card highlight" block — exposes headline + suffix
    // (the data still feeds dashboard cards + export decks).
    const cardHighlightHTML = `
      <section class="cv-card-highlight-edit">
        <div class="cv-section-label">Card highlight (shown on dashboard + exports)</div>
        <div class="cv-card-highlight-row">
          <div class="cv-card-highlight-pair">
            <label>Highlighted word/phrase</label>
            <div class="cv-editable" data-field="headline" contenteditable="false" data-placeholder="e.g. 1000+ high touch">${escapeHtml(cs.headline || '')}</div>
          </div>
          <div class="cv-card-highlight-pair">
            <label>Suffix</label>
            <div class="cv-editable" data-field="headlineSuffix" contenteditable="false" data-placeholder="e.g. experiences for influencers, media, and VIPs">${escapeHtml(cs.headlineSuffix || '')}</div>
          </div>
        </div>
      </section>
    `;

    const quoteBody = cs.quote?.body || '';
    const quoteAttr = cs.quote?.attribution || '';
    const hasQuote = !!(quoteBody || quoteAttr);
    const quoteHTML = `
      <section class="cv-quote-section" data-empty="${hasQuote ? 'false' : 'true'}">
        <div class="cv-section-label">Client</div>
        <blockquote class="cv-quote">
          "<span class="cv-editable" data-field="quote.body" contenteditable="false" data-placeholder="Add a client quote…">${escapeHtml(quoteBody)}</span>"
          <span class="cv-quote-attr">— <span class="cv-editable" data-field="quote.attribution" contenteditable="false" data-placeholder="Attribution">${escapeHtml(quoteAttr)}</span></span>
        </blockquote>
      </section>
    `;

    detailBody.innerHTML = `
      <div class="cv-edit-bar" id="editBar" style="display:none">
        <span class="cv-edit-status" id="editStatus">All changes saved</span>
        <button class="secondary" id="deleteCaseStudyBtn" title="Delete this case study" style="border-color:rgba(255,115,115,0.4);color:#ff9999;">Delete</button>
        <button class="secondary" id="cancelEditBtn">Done</button>
        <button id="saveBtn" disabled>Save</button>
      </div>

      <div class="cv-detail-tier"><span class="cv-editable" data-field="tier" contenteditable="false">${escapeHtml(cs.tier || '')}</span></div>
      <h1 class="cv-detail-title">
        <span class="cv-editable" data-field="client" contenteditable="false">${escapeHtml(cs.client || '')}</span><span class="pipe">|</span><span class="cv-editable" data-field="scope" contenteditable="false">${escapeHtml(cs.scope || '')}</span>
      </h1>

      <div class="cv-detail-industries cv-tag-editor" id="industryEditor" aria-label="Industries">
        ${industries}
        <button class="cv-tag-add" id="addIndustryBtn" type="button">+ Add industry</button>
      </div>

      <div class="cv-detail-tags cv-tag-editor" id="tagEditor">
        ${tags}
        <button class="cv-tag-add" id="addTagBtn">+ Add tag</button>
      </div>

      <div class="cv-detail-body">
        <div class="cv-phone" style="position:relative">
          <div class="cv-phone-frame" id="phoneFrame">
            ${phoneInner}
          </div>
          <div class="cv-video-controls">
            <button id="uploadVideoBtn">Upload reel</button>
            ${cs.video ? '<button id="removeVideoBtn">Remove</button>' : ''}
          </div>
          <input type="file" id="videoFile" accept="video/*" hidden />
        </div>
        <div class="cv-detail-right">
          ${cardHighlightHTML}
          ${metricsHTML}
          ${quoteHTML}
        </div>
      </div>
    `;

    document.title = `Cover — ${cs.client || 'Case Study'}`;

    wireEditing();
  }

  // ---------- editing ----------
  function setEditableMode(on) {
    document.body.classList.toggle('cv-edit-mode', on);
    document.querySelectorAll('.cv-editable').forEach((el) => {
      el.setAttribute('contenteditable', on ? 'true' : 'false');
    });
    const bar = document.getElementById('editBar');
    if (bar) bar.style.display = on ? 'flex' : 'none';
    if (editToggleBtn) editToggleBtn.textContent = on ? 'Exit edit' : 'Edit';
  }

  function captureFromDOM() {
    const get = (sel) => document.querySelector(sel)?.textContent.trim() ?? '';
    cs.tier = get('[data-field="tier"]');
    cs.client = get('[data-field="client"]');
    cs.scope = get('[data-field="scope"]');
    cs.headline = get('[data-field="headline"]');
    cs.headlineSuffix = get('[data-field="headlineSuffix"]');
    cs.metrics = Array.from(document.querySelectorAll('[data-field="metric"]'))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    const tags = Array.from(document.querySelectorAll('[data-field="tag"]'))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    cs.tags = tags;
    const industries = Array.from(document.querySelectorAll('[data-field="industry"]'))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    cs.industries = industries;
    const qb = get('[data-field="quote.body"]');
    const qa = get('[data-field="quote.attribution"]');
    cs.quote = (qb || qa) ? { body: qb, attribution: qa } : null;
  }

  function wireEditing() {
    document.querySelectorAll('.cv-editable').forEach((el) => {
      el.addEventListener('input', () => { captureFromDOM(); setDirty(true); });
      el.addEventListener('blur', () => captureFromDOM());
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && el.dataset.field !== 'metric' && el.dataset.field !== 'quote.body') {
          e.preventDefault();
          el.blur();
        }
      });
    });

    // Tag + Industry x-buttons (single delegation)
    document.querySelectorAll('.cv-tag-x').forEach((x) => {
      x.addEventListener('click', () => {
        const chip = x.closest('[data-tag], [data-industry]');
        chip?.remove();
        captureFromDOM();
        setDirty(true);
      });
    });

    // Add tag
    const addTagBtn = document.getElementById('addTagBtn');
    addTagBtn?.addEventListener('click', () => {
      const text = prompt('New capability tag:');
      if (!text) return;
      const editor = document.getElementById('tagEditor');
      const span = document.createElement('span');
      span.className = 'cs-tag';
      span.dataset.tag = '';
      span.innerHTML = `
        <span class="cv-editable" data-field="tag" contenteditable="${editMode ? 'true' : 'false'}">${escapeHtml(text)}</span>
        <span class="cv-tag-x" title="Remove">&times;</span>
      `;
      editor.insertBefore(span, addTagBtn);
      span.querySelector('.cv-tag-x').addEventListener('click', () => {
        span.remove();
        captureFromDOM();
        setDirty(true);
      });
      span.querySelector('.cv-editable').addEventListener('input', () => { captureFromDOM(); setDirty(true); });
      captureFromDOM();
      setDirty(true);
    });

    // Add industry — same UX, but lands in the industry editor
    const addIndustryBtn = document.getElementById('addIndustryBtn');
    addIndustryBtn?.addEventListener('click', () => {
      const suggestions = [
        'Tech', 'Beauty', 'Hospitality', 'Travel', 'Fashion & Luxury',
        'Product Launch', 'Entertainment', 'Food & Beverage',
        'Government & Social Impact', 'Media', 'Sports', 'AI',
        'Hotels', 'Emerging Business'
      ];
      const text = prompt(`New industry tag:\n\nCommon: ${suggestions.join(', ')}`);
      if (!text) return;
      const editor = document.getElementById('industryEditor');
      const span = document.createElement('span');
      span.className = 'cs-tag cs-tag-industry';
      span.dataset.industry = '';
      span.innerHTML = `
        <span class="cv-editable" data-field="industry" contenteditable="${editMode ? 'true' : 'false'}">${escapeHtml(text.trim())}</span>
        <span class="cv-tag-x" title="Remove">&times;</span>
      `;
      editor.insertBefore(span, addIndustryBtn);
      span.querySelector('.cv-tag-x').addEventListener('click', () => {
        span.remove();
        captureFromDOM();
        setDirty(true);
      });
      span.querySelector('.cv-editable').addEventListener('input', () => { captureFromDOM(); setDirty(true); });
      captureFromDOM();
      setDirty(true);
    });

    // Add metric
    document.getElementById('addMetricBtn')?.addEventListener('click', () => {
      const list = document.getElementById('metricsList');
      const idx = list.querySelectorAll('li').length;
      const li = document.createElement('li');
      li.className = 'cv-metric-row';
      li.dataset.metricIndex = String(idx);
      li.innerHTML = `
        <span class="cv-editable" data-field="metric" data-index="${idx}" contenteditable="${editMode ? 'true' : 'false'}">New outcome…</span>
        <button class="cv-metric-del" title="Remove">&times;</button>
      `;
      list.appendChild(li);
      const ed = li.querySelector('.cv-editable');
      ed.addEventListener('input', () => { captureFromDOM(); setDirty(true); });
      li.querySelector('.cv-metric-del').addEventListener('click', () => {
        li.remove(); captureFromDOM(); setDirty(true);
      });
      ed.focus();
      const range = document.createRange();
      range.selectNodeContents(ed);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      captureFromDOM();
      setDirty(true);
    });

    // Metric delete
    document.querySelectorAll('.cv-metric-del').forEach((b) => {
      b.addEventListener('click', () => {
        b.closest('li').remove();
        captureFromDOM();
        setDirty(true);
      });
    });

    // Save / cancel / delete
    document.getElementById('saveBtn')?.addEventListener('click', save);
    document.getElementById('cancelEditBtn')?.addEventListener('click', () => {
      if (dirty && !confirm('Discard unsaved changes?')) return;
      load();
    });
    document.getElementById('deleteCaseStudyBtn')?.addEventListener('click', deleteCaseStudy);

    // Video upload
    const upBtn = document.getElementById('uploadVideoBtn');
    const remBtn = document.getElementById('removeVideoBtn');
    const fileInput = document.getElementById('videoFile');
    upBtn?.addEventListener('click', () => fileInput.click());
    fileInput?.addEventListener('change', uploadVideo);
    remBtn?.addEventListener('click', () => {
      if (!confirm('Remove the current reel?')) return;
      cs.video = null;
      setDirty(true);
      render();
      setEditableMode(true);
    });
  }

  async function uploadVideo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    let status = document.getElementById('editStatus');
    if (status) status.textContent = `Uploading ${file.name}…`;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const upRes = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!upRes.ok) throw new Error('upload_failed');
      const upData = await upRes.json();

      // Preserve any in-flight text edits before persisting the new video URL.
      captureFromDOM();
      cs.video = upData.url;

      // Auto-save so the upload sticks even if the user leaves without
      // hitting Save. (Previously the upload only updated cs client-side and
      // the subsequent render() reset the dirty/save UI to "All changes saved",
      // which misled people into thinking it had persisted.)
      const saveRes = await fetch(`/api/case-studies/${encodeURIComponent(cs.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cs)
      });
      if (!saveRes.ok) throw new Error('save_failed');
      cs = await saveRes.json();

      render();
      setEditableMode(editMode);
      setDirty(false);
      status = document.getElementById('editStatus');
      if (status) status.textContent = 'Reel saved';
    } catch (err) {
      console.error(err);
      alert('Could not save the uploaded reel. Try again — the file uploaded but the case study didn’t pick it up.');
      const s = document.getElementById('editStatus');
      if (s) s.textContent = 'Upload failed.';
    }
  }

  async function deleteCaseStudy() {
    if (!cs?.id) return;
    if (!confirm(`Delete the "${cs.client || cs.id}" case study? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/case-studies/${encodeURIComponent(cs.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete_failed');
      window.location.href = '/';
    } catch (err) {
      console.error(err);
      alert('Could not delete case study.');
    }
  }

  async function save() {
    captureFromDOM();
    const status = document.getElementById('editStatus');
    if (status) status.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/case-studies/${encodeURIComponent(cs.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cs)
      });
      if (!res.ok) throw new Error('save failed');
      cs = await res.json();
      setDirty(false);
      if (status) status.textContent = 'Saved';
    } catch (err) {
      console.error(err);
      if (status) status.textContent = 'Save failed';
      alert('Could not save changes.');
    }
  }

  // ---------- toggle edit ----------
  editToggleBtn?.addEventListener('click', () => {
    editMode = !editMode;
    setEditableMode(editMode);
  });

  // ---------- load ----------
  async function load() {
    const id = getId();
    if (!id) {
      detailBody.innerHTML = '<div class="cv-empty">No case study selected.</div>';
      return;
    }
    try {
      const res = await fetch(`/api/case-studies/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('not_found');
      cs = await res.json();
      render();
      setDirty(false);
      if (editMode || shouldStartInEdit()) {
        editMode = true;
        if (editToggleBtn) editToggleBtn.textContent = 'Exit edit';
        setEditableMode(true);
        // Strip the ?edit=1 from the URL so a refresh doesn't loop
        const url = new URL(window.location.href);
        if (url.searchParams.has('edit')) {
          url.searchParams.delete('edit');
          history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
        }
      }
    } catch (err) {
      console.error('Failed to load case study', err);
      detailBody.innerHTML = '<div class="cv-empty">Case study not found.</div>';
    }
  }

  load();
})();
