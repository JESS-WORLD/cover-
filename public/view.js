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

    // Hero = first item in cs.media[] (server has projected legacy video/poster into media on read).
    const media = Array.isArray(cs.media) ? cs.media : [];
    const hero = media[0];
    const phoneInner = hero
      ? (hero.type === 'video'
          // preload="auto" tells the browser to start fetching immediately
          // (default "metadata" defers playback start until much later); the
          // explicit .play() in wirePlayback() below handles the autoplay-policy
          // case where Chrome silently blocks autoplay attribute on first load.
          ? `<video src="${escapeHtml(hero.url)}" autoplay muted loop playsinline preload="auto" ${hero.poster ? `poster="${escapeHtml(hero.poster)}"` : ''}></video>`
          : `<img src="${escapeHtml(hero.url)}" alt="${escapeHtml(hero.caption || cs.client || '')}" />`)
      : `<div class="cv-phone-empty" id="phoneEmpty">Add a video or image to feature</div>`;

    // Gallery strip — every media item, with edit controls. First item is annotated as "Hero".
    const galleryItemsHTML = media.map((m, i) => {
      const thumb = m.type === 'video'
        ? `<video src="${escapeHtml(m.url)}" muted playsinline preload="metadata"${m.poster ? ` poster="${escapeHtml(m.poster)}"` : ''}></video>`
        : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.caption || '')}" />`;
      return `
        <div class="cv-media-item${i === 0 ? ' is-hero' : ''}" data-media-index="${i}" data-media-id="${escapeHtml(m.id || '')}">
          <div class="cv-media-thumb">
            ${thumb}
            <span class="cv-media-badge">${m.type === 'video' ? 'Video' : 'Image'}${i === 0 ? ' · Hero' : ''}</span>
          </div>
          <input class="cv-media-caption cv-editable-input" data-field="media-caption" data-index="${i}" type="text" placeholder="Caption (optional)" value="${escapeHtml(m.caption || '')}" />
          <div class="cv-media-controls">
            <button class="cv-media-btn" data-action="up" data-index="${i}" title="Move up"${i === 0 ? ' disabled' : ''}>&uarr;</button>
            <button class="cv-media-btn" data-action="down" data-index="${i}" title="Move down"${i === media.length - 1 ? ' disabled' : ''}>&darr;</button>
            <button class="cv-media-btn cv-media-btn-del" data-action="remove" data-index="${i}" title="Remove">&times;</button>
          </div>
        </div>
      `;
    }).join('');

    const galleryHTML = `
      <div class="cv-media-gallery" id="mediaGallery">
        <div class="cv-media-strip">
          ${galleryItemsHTML || '<div class="cv-media-empty">No media yet — add the first item below.</div>'}
        </div>
        <div class="cv-media-add">
          <button class="cv-add-btn" id="addVideoBtn">+ Add video</button>
          <button class="cv-add-btn" id="addImageBtn">+ Add image</button>
          <span class="cv-media-hint">First item is the hero. Up/down to reorder.</span>
        </div>
        <input type="file" id="mediaFile" hidden />
      </div>
    `;

    // Read-mode thumbnail strip — only renders when there's more than the hero.
    // Clicking a thumb opens the lightbox.
    const readStripHTML = media.length > 1 ? `
      <div class="cv-readmedia-strip" id="readMediaStrip" aria-label="More from this case study">
        ${media.slice(1).map((m, j) => {
          const i = j + 1; // original index in cs.media
          const thumb = m.type === 'video'
            ? `<video src="${escapeHtml(m.url)}" muted playsinline preload="metadata"${m.poster ? ` poster="${escapeHtml(m.poster)}"` : ''}></video>`
            : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.caption || '')}" />`;
          return `
            <button class="cv-readmedia-thumb" data-media-open-index="${i}" type="button" aria-label="${escapeHtml(m.caption || (m.type === 'video' ? 'View video' : 'View image'))}">
              ${thumb}
              ${m.type === 'video' ? '<span class="cv-readmedia-play" aria-hidden="true">&#9658;</span>' : ''}
              ${m.caption ? `<span class="cv-readmedia-caption">${escapeHtml(m.caption)}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
    ` : '';

    // Scale signals — three small inline-editable fields. Always rendered in
    // edit mode so the user can fill them in; read-mode shows only populated
    // fields (handled in cv-edit-mode CSS + the placeholder rendering below).
    const sc = cs.scale || { teamSize: '', geo: '', duration: '' };
    const scaleHTML = `
      <section class="cv-scale-section">
        <div class="cv-section-label">At a glance</div>
        <div class="cv-scale-grid">
          <div class="cv-scale-field">
            <label>Team size</label>
            <div class="cv-editable" data-field="scale.teamSize" contenteditable="false" data-placeholder="e.g. 250 producers">${escapeHtml(sc.teamSize || '')}</div>
          </div>
          <div class="cv-scale-field">
            <label>Geo reach</label>
            <div class="cv-editable" data-field="scale.geo" contenteditable="false" data-placeholder="e.g. 70 cities · global">${escapeHtml(sc.geo || '')}</div>
          </div>
          <div class="cv-scale-field">
            <label>Duration</label>
            <div class="cv-editable" data-field="scale.duration" contenteditable="false" data-placeholder="e.g. 4 weeks">${escapeHtml(sc.duration || '')}</div>
          </div>
        </div>
      </section>
    `;

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
        <div class="cv-phone-column">
          <div class="cv-phone" style="position:relative">
            <div class="cv-phone-frame" id="phoneFrame">
              ${phoneInner}
            </div>
          </div>
          ${readStripHTML}
          ${galleryHTML}
        </div>
        <div class="cv-detail-right">
          ${cardHighlightHTML}
          ${scaleHTML}
          ${metricsHTML}
          ${quoteHTML}
        </div>
      </div>
    `;

    document.title = `Cover — ${cs.client || 'Case Study'}`;

    wireEditing();
    wireReadStrip();
    wirePhoneVideo();
  }

  // Chrome 117+ pauses muted-only videos as "video-only background media" to
  // save power (regardless of autoplay attribute). We can't override that
  // policy, but we can:
  //   1. Try to autoplay anyway (works in many cases, e.g. focused tab + visible),
  //   2. Show a play button overlay when paused so the user can click once,
  //   3. Click-to-toggle play/pause in edit mode (lightbox still handles read mode).
  function wirePhoneVideo() {
    const frame = document.getElementById('phoneFrame');
    if (!frame) return;
    const video = frame.querySelector('video');
    if (!video) {
      frame.classList.remove('is-paused', 'cv-phone-has-video');
      return;
    }
    frame.classList.add('cv-phone-has-video');

    // Inject the play indicator overlay if it isn't there yet.
    if (!frame.querySelector('.cv-phone-play-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'cv-phone-play-indicator';
      indicator.innerHTML = '<svg viewBox="0 0 24 24" width="56" height="56" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
      frame.appendChild(indicator);
    }

    const sync = () => frame.classList.toggle('is-paused', video.paused);
    sync();
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);

    // Try autoplay (often blocked for muted-only videos, but free if it works)
    const tryPlay = () => video.play().catch(() => {});
    if (video.readyState >= 1) tryPlay();
    else video.addEventListener('loadedmetadata', tryPlay, { once: true });

    // Click-to-play in edit mode (read mode falls through to lightbox handler)
    if (document.body.classList.contains('cv-edit-mode')) {
      frame.style.cursor = 'pointer';
      frame.addEventListener('click', (e) => {
        if (e.target.closest('button, input, a')) return;
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      });
    }
  }

  // ---------- read-mode media lightbox ----------
  let _lightboxEl = null;
  function ensureLightbox() {
    if (_lightboxEl) return _lightboxEl;
    const el = document.createElement('div');
    el.className = 'cv-lightbox';
    el.hidden = true;
    el.innerHTML = `
      <button class="cv-lightbox-close" type="button" aria-label="Close">&times;</button>
      <button class="cv-lightbox-nav cv-lightbox-prev" type="button" aria-label="Previous">&#10094;</button>
      <button class="cv-lightbox-nav cv-lightbox-next" type="button" aria-label="Next">&#10095;</button>
      <div class="cv-lightbox-stage"></div>
      <div class="cv-lightbox-caption" aria-live="polite"></div>
    `;
    document.body.appendChild(el);

    const close = () => closeLightbox();
    el.querySelector('.cv-lightbox-close').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('.cv-lightbox-prev').addEventListener('click', () => stepLightbox(-1));
    el.querySelector('.cv-lightbox-next').addEventListener('click', () => stepLightbox(1));

    document.addEventListener('keydown', (e) => {
      if (el.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') stepLightbox(-1);
      else if (e.key === 'ArrowRight') stepLightbox(1);
    });

    _lightboxEl = el;
    return el;
  }

  let _lightboxIndex = -1;
  function openLightbox(index) {
    const media = Array.isArray(cs?.media) ? cs.media : [];
    if (!media[index]) return;
    _lightboxIndex = index;
    const el = ensureLightbox();
    renderLightbox();
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    if (!_lightboxEl) return;
    _lightboxEl.hidden = true;
    // Pause any video so it doesn't keep playing in the background
    const v = _lightboxEl.querySelector('video');
    if (v) { try { v.pause(); } catch {} }
    document.body.style.overflow = '';
    _lightboxIndex = -1;
  }
  function stepLightbox(dir) {
    const media = Array.isArray(cs?.media) ? cs.media : [];
    if (!media.length) return;
    const next = (_lightboxIndex + dir + media.length) % media.length;
    _lightboxIndex = next;
    renderLightbox();
  }
  function renderLightbox() {
    const media = Array.isArray(cs?.media) ? cs.media : [];
    const m = media[_lightboxIndex];
    if (!m || !_lightboxEl) return;
    const stage = _lightboxEl.querySelector('.cv-lightbox-stage');
    const cap = _lightboxEl.querySelector('.cv-lightbox-caption');
    stage.innerHTML = m.type === 'video'
      ? `<video src="${escapeHtml(m.url)}" controls autoplay playsinline ${m.poster ? `poster="${escapeHtml(m.poster)}"` : ''}></video>`
      : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.caption || '')}" />`;
    cap.textContent = m.caption || '';
    cap.style.display = m.caption ? 'block' : 'none';
    // Hide prev/next when there's only one item
    const single = media.length <= 1;
    _lightboxEl.querySelector('.cv-lightbox-prev').style.display = single ? 'none' : '';
    _lightboxEl.querySelector('.cv-lightbox-next').style.display = single ? 'none' : '';
  }

  function wireReadStrip() {
    document.querySelectorAll('[data-media-open-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.mediaOpenIndex);
        if (Number.isFinite(idx)) openLightbox(idx);
      });
    });
    // Also allow clicking the hero (phone frame) to open the lightbox at index 0
    // in read mode — quick way to enlarge / show controls on a video.
    const phone = document.getElementById('phoneFrame');
    if (phone && Array.isArray(cs.media) && cs.media[0]) {
      phone.style.cursor = 'zoom-in';
      phone.addEventListener('click', (e) => {
        if (document.body.classList.contains('cv-edit-mode')) return; // edit mode = no lightbox
        // Don't hijack if user clicked an interactive control inside the frame
        if (e.target.closest('button, input, a')) return;
        openLightbox(0);
      });
    }
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

    // Scale signals
    cs.scale = {
      teamSize: get('[data-field="scale.teamSize"]'),
      geo: get('[data-field="scale.geo"]'),
      duration: get('[data-field="scale.duration"]')
    };

    // Media captions — order/structure is driven by direct cs.media mutations
    // in the add/move/remove handlers below; here we only sync caption text.
    if (Array.isArray(cs.media)) {
      document.querySelectorAll('[data-field="media-caption"]').forEach((input) => {
        const idx = Number(input.dataset.index);
        if (Number.isFinite(idx) && cs.media[idx]) {
          cs.media[idx].caption = (input.value || '').trim();
        }
      });
      // Re-stamp order indices so the server doesn't have to guess.
      cs.media.forEach((m, i) => { m.order = i; });
    }
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

    // Media gallery
    const fileInput = document.getElementById('mediaFile');
    let pendingType = 'video';
    document.getElementById('addVideoBtn')?.addEventListener('click', () => {
      pendingType = 'video';
      fileInput.accept = 'video/*';
      fileInput.click();
    });
    document.getElementById('addImageBtn')?.addEventListener('click', () => {
      pendingType = 'image';
      fileInput.accept = 'image/*';
      fileInput.click();
    });
    fileInput?.addEventListener('change', (e) => uploadMedia(e, pendingType));

    // Caption inputs — capture on input, mark dirty
    document.querySelectorAll('[data-field="media-caption"]').forEach((input) => {
      input.addEventListener('input', () => { captureFromDOM(); setDirty(true); });
    });

    // Up / down / remove on each media item
    document.querySelectorAll('.cv-media-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const action = btn.dataset.action;
        const idx = Number(btn.dataset.index);
        if (!Number.isFinite(idx) || !Array.isArray(cs.media)) return;
        if (action === 'up' && idx > 0) {
          captureFromDOM();
          [cs.media[idx - 1], cs.media[idx]] = [cs.media[idx], cs.media[idx - 1]];
          setDirty(true);
          render();
          setEditableMode(editMode);
        } else if (action === 'down' && idx < cs.media.length - 1) {
          captureFromDOM();
          [cs.media[idx + 1], cs.media[idx]] = [cs.media[idx], cs.media[idx + 1]];
          setDirty(true);
          render();
          setEditableMode(editMode);
        } else if (action === 'remove') {
          if (!confirm('Remove this media item? The file will be cleaned up if nothing else uses it.')) return;
          captureFromDOM();
          const removed = cs.media.splice(idx, 1)[0];
          setDirty(true);
          render();
          setEditableMode(editMode);
          // Best-effort: ask server to delete the underlying file. The server
          // refuses (409) if anything else still references the URL, which we
          // silently ignore — the UI removal already succeeded.
          if (removed?.url?.startsWith('/media/')) {
            const filename = removed.url.replace(/^\/media\//, '');
            fetch(`/api/media/${encodeURIComponent(filename)}`, { method: 'DELETE' })
              .catch(() => {/* network errors are OK — orphan cleanup is best-effort */});
          }
        }
      });
    });
  }

  async function uploadMedia(e, type) {
    const file = e.target.files?.[0];
    // Reset the input so re-uploading the same file works
    e.target.value = '';
    if (!file) return;
    let status = document.getElementById('editStatus');
    if (status) status.textContent = `Uploading ${file.name}…`;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const upRes = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!upRes.ok) throw new Error('upload_failed');
      const upData = await upRes.json();

      // Preserve any in-flight text edits before adding the new item.
      captureFromDOM();
      if (!Array.isArray(cs.media)) cs.media = [];
      const newId = 'm_' + Math.random().toString(36).slice(2, 12);
      cs.media.push({
        id: newId,
        type: type === 'image' ? 'image' : 'video',
        url: upData.url,
        poster: null,
        caption: '',
        order: cs.media.length
      });

      // Auto-save so the upload sticks even if the user leaves without
      // hitting Save (mirrors the previous behavior).
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
      if (status) status.textContent = `${type === 'video' ? 'Video' : 'Image'} added`;
    } catch (err) {
      console.error(err);
      alert(`Could not add the ${type}. The file may have uploaded but the case study didn't pick it up.`);
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
