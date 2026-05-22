(function () {
  // Section key -> { video field name, poster field name }
  const SECTION_FIELDS = {
    hero:     { video: 'heroVideo',     poster: 'heroPoster' },
    creds:    { video: 'credsVideo',    poster: 'credsPoster' },
    about:    { video: 'aboutVideo',    poster: 'aboutPoster' },
    showreel: { video: 'showreelVideo', poster: 'showreelPoster' },
    founders: { video: 'foundersVideo', poster: 'foundersPoster' },
    services: { video: 'servicesVideo', poster: 'servicesPoster' },
    cta:      { video: 'ctaVideo',      poster: 'ctaPoster' }
  };

  // Default copy — used when an editable field isn't set on the server yet
  const DEFAULTS = {
    heroHeadline: 'Every great story starts with an <em>experience</em>.',
    heroLede: 'We are a global team of creative innovators building game-changing partnerships with the world’s most influential brands. We don’t do projects. <strong>We build platforms.</strong>',
    credsTitle: 'Top level creds',
    manifestoLine1: 'We don’t do projects.',
    manifestoLine2: 'We build platforms.',
    foundersTitle: 'Our founders',
    servicesTitle: 'Services',
    alwaysIncludedTitle: 'Always included',
    customServicesTitle: 'Custom services',
    ctaLine1: 'Bring us your hardest project',
    ctaLine2: 'and we’ll make it win.'
  };

  const fileInput = document.getElementById('sectionFile');
  const editToggleBtn = document.getElementById('aboutEditToggleBtn');
  const editBar = document.getElementById('aboutEditBar');
  const editStatus = document.getElementById('aboutEditStatus');
  const saveBtn = document.getElementById('aboutEditSaveBtn');
  const cancelBtn = document.getElementById('aboutEditCancelBtn');

  let intro = {};
  let foundersData = { founders: [], topCreds: [] };
  let servicesData = { alwaysIncluded: [], customServices: [] };
  let editMode = false;
  let dirty = false;
  let pendingSection = null;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function intoOr(field) {
    const v = intro[field];
    // Only fall back to defaults when the field has *never* been set
    // (undefined / null). An empty string is an intentional deletion.
    if (v === undefined || v === null) return DEFAULTS[field] ?? '';
    return v;
  }

  function editable(html, bucket, field, opts = {}) {
    const tag = opts.tag || 'span';
    const attrs = `data-editable data-bucket="${bucket}" data-field="${field}"`;
    return `<${tag} class="cv-editable" ${attrs} contenteditable="${editMode ? 'true' : 'false'}">${html}</${tag}>`;
  }

  // Set the dirty flag + reflect in UI
  function setDirty(v) {
    dirty = v;
    if (editBar) editBar.classList.toggle('is-dirty', v);
    if (editStatus) editStatus.textContent = v ? 'Unsaved changes' : 'All changes saved';
    if (saveBtn) saveBtn.disabled = !v;
  }

  // ---- RENDER ----
  function renderHero() {
    const el = document.getElementById('aboutHero');
    el.style.padding = '0';
    // Use innerHTML so <em>/<strong> render. Editable spans wrap the textContent of each field.
    el.innerHTML = `
      <h1>${editable(intoOr('heroHeadline'), 'intro', 'heroHeadline')}</h1>
      <p>${editable(intoOr('heroLede'), 'intro', 'heroLede')}</p>
    `;
  }

  function renderCreds() {
    // The h2 lives in the HTML — we replace its textContent.
    const credsSection = document.querySelector('[data-section="creds"]');
    const h2 = credsSection.querySelector('h2');
    h2.innerHTML = editable(escapeHtml(intoOr('credsTitle')), 'intro', 'credsTitle');

    const list = document.getElementById('credsList');
    const items = foundersData.topCreds || [];
    list.innerHTML = items.map((c, i) => `
      <li>${editable(escapeHtml(c), 'topCreds', String(i))}</li>
    `).join('');
  }

  function renderManifesto() {
    const sec = document.querySelector('[data-section="about"] .cv-bg-section-content .cv-reel-headline');
    if (!sec) return;
    sec.innerHTML = `${editable(escapeHtml(intoOr('manifestoLine1')), 'intro', 'manifestoLine1')}<br/><em>${editable(escapeHtml(intoOr('manifestoLine2')), 'intro', 'manifestoLine2')}</em>`;
  }

  function renderFounders() {
    const sec = document.querySelector('[data-section="founders"]');
    sec.querySelector('h2').innerHTML = editable(escapeHtml(intoOr('foundersTitle')), 'intro', 'foundersTitle');

    const grid = document.getElementById('foundersGrid');
    grid.innerHTML = (foundersData.founders || []).map((f, i) => `
      <div class="cv-founder-card">
        <div class="cv-founder-name">${editable(escapeHtml(f.name || ''), 'founders', `${i}.name`)}</div>
        <div class="cv-founder-title">${editable(escapeHtml(f.title || ''), 'founders', `${i}.title`)}</div>
        <p class="cv-founder-bio">${editable(escapeHtml(f.bio || ''), 'founders', `${i}.bio`)}</p>
        <div class="cv-founder-tag">${editable(escapeHtml(f.tagline || ''), 'founders', `${i}.tagline`)}</div>
      </div>
    `).join('');
  }

  function renderServices() {
    const sec = document.querySelector('[data-section="services"]');
    sec.querySelector('h2').innerHTML = editable(escapeHtml(intoOr('servicesTitle')), 'intro', 'servicesTitle');

    // Replace the two inner labels too
    const labels = sec.querySelectorAll('.cv-service-block .cv-section-label');
    if (labels[0]) labels[0].innerHTML = editable(escapeHtml(intoOr('alwaysIncludedTitle')), 'intro', 'alwaysIncludedTitle');
    if (labels[1]) labels[1].innerHTML = editable(escapeHtml(intoOr('customServicesTitle')), 'intro', 'customServicesTitle');

    const a = document.getElementById('alwaysIncluded');
    const c = document.getElementById('customServices');
    a.innerHTML = (servicesData.alwaysIncluded || [])
      .map((s, i) => `<span class="cs-tag">${editable(escapeHtml(s), 'alwaysIncluded', String(i))}</span>`).join('');
    c.innerHTML = (servicesData.customServices || [])
      .map((s, i) => `<span class="cs-tag">${editable(escapeHtml(s), 'customServices', String(i))}</span>`).join('');
  }

  function renderCta() {
    const sec = document.querySelector('[data-section="cta"] .cv-reel-headline');
    if (!sec) return;
    sec.innerHTML = `${editable(escapeHtml(intoOr('ctaLine1')), 'intro', 'ctaLine1')}<br/><em>${editable(escapeHtml(intoOr('ctaLine2')), 'intro', 'ctaLine2')}</em>`;
  }

  function renderAll() {
    renderHero();
    renderCreds();
    renderManifesto();
    renderFounders();
    renderServices();
    renderCta();
    // Wire input listeners for every editable
    document.querySelectorAll('[data-editable]').forEach((el) => {
      el.addEventListener('input', () => setDirty(true));
      el.addEventListener('keydown', (e) => {
        // Allow newlines only in bio (multiline). Other fields: Enter blurs.
        if (e.key === 'Enter' && el.dataset.field !== 'bio' && !el.dataset.field?.endsWith('.bio')) {
          e.preventDefault();
          el.blur();
        }
      });
    });
    renderMediaForAllSections();
  }

  // ---- MEDIA (unchanged from earlier) ----
  function renderMediaForSection(sectionEl) {
    const key = sectionEl.dataset.section;
    const fields = SECTION_FIELDS[key];
    const video = intro[fields.video];
    const poster = intro[fields.poster];
    const mediaEl = sectionEl.querySelector('[data-media]');
    const removeBtn = sectionEl.querySelector('[data-remove]');
    // Only mutate the bottom-right control's label; leave the empty-state CTA alone
    const uploadBtn = sectionEl.querySelector('[data-controls] [data-upload]')
      || sectionEl.querySelector('[data-upload]');

    if (video) {
      mediaEl.innerHTML = `<video src="${escapeHtml(video)}" autoplay muted loop playsinline ${poster ? `poster="${escapeHtml(poster)}"` : ''}></video>`;
      sectionEl.dataset.hasMedia = 'true';
      removeBtn.style.display = '';
      uploadBtn.textContent = 'Replace reel';
    } else if (poster) {
      mediaEl.innerHTML = `<img src="${escapeHtml(poster)}" alt="" />`;
      sectionEl.dataset.hasMedia = 'true';
      removeBtn.style.display = '';
      uploadBtn.textContent = 'Replace reel';
    } else {
      mediaEl.innerHTML = '';
      sectionEl.dataset.hasMedia = 'false';
      removeBtn.style.display = 'none';
      uploadBtn.textContent = 'Upload reel';
    }
  }

  function renderMediaForAllSections() {
    document.querySelectorAll('.cv-bg-section').forEach(renderMediaForSection);
  }

  function showStatus(sectionEl, text) {
    let el = sectionEl.querySelector('.cv-bg-section-uploading');
    if (!el && text) {
      el = document.createElement('div');
      el.className = 'cv-bg-section-uploading';
      sectionEl.appendChild(el);
    }
    if (el) { if (text) el.textContent = text; else el.remove(); }
  }

  function wireSection(sectionEl) {
    const key = sectionEl.dataset.section;
    const fields = SECTION_FIELDS[key];
    // The bare/showreel section has two upload triggers (empty-state CTA + bottom-right control)
    sectionEl.querySelectorAll('[data-upload]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingSection = key;
        fileInput.click();
      });
    });
    sectionEl.querySelector('[data-remove]').addEventListener('click', async () => {
      if (!confirm('Remove this background reel?')) return;
      showStatus(sectionEl, 'Removing…');
      try {
        await fetch('/api/intro', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [fields.video]: null, [fields.poster]: null })
        }).then((r) => r.json()).then((d) => { intro = d; });
        renderMediaForSection(sectionEl);
        showStatus(sectionEl, '');
      } catch (err) {
        console.error(err); showStatus(sectionEl, 'Could not remove');
        setTimeout(() => showStatus(sectionEl, ''), 1800);
      }
    });
  }

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const key = pendingSection;
    pendingSection = null;
    fileInput.value = '';
    if (!file || !key) return;
    const sectionEl = document.querySelector(`[data-section="${key}"]`);
    showStatus(sectionEl, `Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('upload_failed');
      const { url, mime } = await res.json();
      const fields = SECTION_FIELDS[key];
      const isVideo = (mime || '').startsWith('video');
      const patch = isVideo ? { [fields.video]: url } : { [fields.video]: null, [fields.poster]: url };
      intro = await fetch('/api/intro', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      }).then((r) => r.json());
      renderMediaForSection(sectionEl);
      showStatus(sectionEl, 'Saved');
      setTimeout(() => showStatus(sectionEl, ''), 1400);
    } catch (err) {
      console.error(err); showStatus(sectionEl, 'Upload failed');
      setTimeout(() => showStatus(sectionEl, ''), 2200);
    }
  });

  // ---- EDIT MODE ----
  function setEditMode(on) {
    editMode = on;
    document.body.classList.toggle('cv-edit-mode', on);
    document.querySelectorAll('[data-editable]').forEach((el) => {
      el.setAttribute('contenteditable', on ? 'true' : 'false');
    });
    if (editBar) editBar.style.display = on ? 'flex' : 'none';
    if (editToggleBtn) editToggleBtn.textContent = on ? 'Exit edit' : 'Edit page';
  }

  function captureFromDOM() {
    // Bucket all current values from the contenteditable spans
    const patches = {
      intro: {},
      topCreds: [],
      founders: foundersData.founders.map((f) => ({ ...f })),
      alwaysIncluded: [],
      customServices: []
    };

    document.querySelectorAll('[data-editable]').forEach((el) => {
      const bucket = el.dataset.bucket;
      const field = el.dataset.field;
      const value = (el.innerText || '').trim();
      if (bucket === 'intro') {
        patches.intro[field] = value;
      } else if (bucket === 'topCreds') {
        patches.topCreds[parseInt(field, 10)] = value;
      } else if (bucket === 'founders') {
        const [iStr, prop] = field.split('.');
        const i = parseInt(iStr, 10);
        if (!patches.founders[i]) patches.founders[i] = { ...(foundersData.founders[i] || {}) };
        patches.founders[i][prop] = value;
      } else if (bucket === 'alwaysIncluded') {
        patches.alwaysIncluded[parseInt(field, 10)] = value;
      } else if (bucket === 'customServices') {
        patches.customServices[parseInt(field, 10)] = value;
      }
    });

    // Drop array holes AND empty strings — clearing a bullet should
    // delete it, not leave a stray empty marker.
    patches.topCreds = patches.topCreds.filter((x) => typeof x === 'string' && x.trim() !== '');
    patches.alwaysIncluded = patches.alwaysIncluded.filter((x) => typeof x === 'string' && x.trim() !== '');
    patches.customServices = patches.customServices.filter((x) => typeof x === 'string' && x.trim() !== '');
    return patches;
  }

  async function save() {
    const patches = captureFromDOM();
    editStatus.textContent = 'Saving…';
    try {
      const reqs = [
        fetch('/api/intro', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patches.intro) }).then((r) => r.json()),
        fetch('/api/founders', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ founders: patches.founders, topCreds: patches.topCreds }) }).then((r) => r.json()),
        fetch('/api/services', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alwaysIncluded: patches.alwaysIncluded, customServices: patches.customServices }) }).then((r) => r.json())
      ];
      const [newIntro, newFounders, newServices] = await Promise.all(reqs);
      intro = newIntro;
      foundersData = newFounders;
      servicesData = newServices;
      setDirty(false);
      editStatus.textContent = 'Saved';
      // Re-render to make sure everything reflects the canonical server state
      renderAll();
    } catch (err) {
      console.error(err);
      editStatus.textContent = 'Save failed';
      alert('Could not save changes.');
    }
  }

  editToggleBtn?.addEventListener('click', () => setEditMode(!editMode));
  cancelBtn?.addEventListener('click', () => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    load();
    setEditMode(false);
    setDirty(false);
  });
  saveBtn?.addEventListener('click', save);

  async function load() {
    const [introRes, foundersRes, servicesRes] = await Promise.all([
      fetch('/api/intro').then((r) => r.json()),
      fetch('/api/founders').then((r) => r.json()),
      fetch('/api/services').then((r) => r.json())
    ]);
    intro = introRes || {};
    foundersData = foundersRes || { founders: [], topCreds: [] };
    servicesData = servicesRes || { alwaysIncluded: [], customServices: [] };

    document.querySelectorAll('.cv-bg-section').forEach(wireSection);
    renderAll();
    setDirty(false);
  }

  load().catch((err) => {
    console.error(err);
    document.getElementById('aboutHero').innerHTML = '<p class="cv-empty">Could not load the about page.</p>';
  });
})();
