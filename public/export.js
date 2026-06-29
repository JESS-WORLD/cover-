(function () {
  const deck = document.getElementById('exportDeck');
  const titleEl = document.getElementById('exportTitle');
  const printBtn = document.getElementById('printBtn');
  const copyBtn = document.getElementById('copyLinkBtn');
  const presentBtn = document.getElementById('presentBtn');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getIds() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('ids') || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  function getLogoIds() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('logos') || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  function getIncludeAbout() {
    return new URLSearchParams(window.location.search).get('about') === '1';
  }

  // Defaults mirror about.js DEFAULTS so an unset field still produces good copy.
  const ABOUT_DEFAULTS = {
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

  function pick(intro, field) {
    const v = intro?.[field];
    if (v === undefined || v === null) return ABOUT_DEFAULTS[field] ?? '';
    return v;
  }

  // Build a single full-bleed about-page-style slide.
  // Mirrors the live About page's .cv-bg-section pattern.
  function bgSlide({ key, video, poster, bare = false, contentHTML }) {
    const hasMedia = !!(video || poster);
    const mediaHTML = video
      ? `<video src="${escapeHtml(video)}" autoplay muted loop playsinline preload="auto" ${poster ? `poster="${escapeHtml(poster)}"` : ''}></video>`
      : poster
      ? `<img src="${escapeHtml(poster)}" alt="" />`
      : '';
    return `
      <section class="cv-export-about-slide cv-bg-section${bare ? ' cv-bg-section--bare' : ''}" data-section="${escapeHtml(key)}" data-has-media="${hasMedia}">
        <div class="cv-bg-section-media">${mediaHTML}</div>
        ${bare ? '' : `<div class="cv-bg-section-content">${contentHTML}</div>`}
      </section>
    `;
  }

  function aboutSlidesHTML(intro, founders, topCreds, services) {
    intro = intro || {};
    const slides = [];

    // 1) Showreel — video only, no text overlay
    if (intro.showreelVideo || intro.showreelPoster) {
      slides.push(bgSlide({
        key: 'showreel',
        video: intro.showreelVideo,
        poster: intro.showreelPoster,
        bare: true
      }));
    }

    // 2) Hero — headline + lede (can carry video)
    slides.push(bgSlide({
      key: 'hero',
      video: intro.heroVideo,
      poster: intro.heroPoster,
      contentHTML: `
        <div class="cv-about-hero" style="padding: 0;">
          <h1>${pick(intro, 'heroHeadline')}</h1>
          <p>${pick(intro, 'heroLede')}</p>
        </div>
      `
    }));

    // 3) Top level creds
    const credsTitle = pick(intro, 'credsTitle');
    const credsItems = (topCreds || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    if (credsItems) {
      slides.push(bgSlide({
        key: 'creds',
        video: intro.credsVideo,
        poster: intro.credsPoster,
        contentHTML: `
          <div>
            ${credsTitle ? `<h2 class="cv-section-label" style="margin-bottom: 1.2rem; font-size: 0.78rem;">${escapeHtml(credsTitle)}</h2>` : ''}
            <ul class="cv-creds-list" style="grid-template-columns: 1fr 1fr; column-gap: 3rem;">${credsItems}</ul>
          </div>
        `
      }));
    }

    // 4) Manifesto — "We don't do projects / We build platforms"
    const m1 = pick(intro, 'manifestoLine1');
    const m2 = pick(intro, 'manifestoLine2');
    if (m1 || m2) {
      slides.push(bgSlide({
        key: 'about',
        video: intro.aboutVideo,
        poster: intro.aboutPoster,
        contentHTML: `
          <div style="text-align: center; width: 100%; display:flex; align-items:center; justify-content:center;">
            <h2 class="cv-reel-headline">${escapeHtml(m1)}${m2 ? `<br/><em>${escapeHtml(m2)}</em>` : ''}</h2>
          </div>
        `
      }));
    }

    // 5) Founders
    const foundersTitle = pick(intro, 'foundersTitle');
    const founderCards = (founders || []).map((f) => `
      <div class="cv-founder-card">
        <div class="cv-founder-name">${escapeHtml(f.name)}</div>
        <div class="cv-founder-title">${escapeHtml(f.title || '')}</div>
        <p class="cv-founder-bio">${escapeHtml(f.bio || '')}</p>
        ${f.tagline ? `<div class="cv-founder-tag">${escapeHtml(f.tagline)}</div>` : ''}
      </div>
    `).join('');
    if (founderCards) {
      slides.push(bgSlide({
        key: 'founders',
        video: intro.foundersVideo,
        poster: intro.foundersPoster,
        contentHTML: `
          ${foundersTitle ? `<h2 class="cv-section-label" style="margin-bottom: 1.2rem; font-size: 0.78rem;">${escapeHtml(foundersTitle)}</h2>` : ''}
          <div class="cv-founders">${founderCards}</div>
        `
      }));
    }

    // 6) Services
    const servicesTitle = pick(intro, 'servicesTitle');
    const alwaysTitle = pick(intro, 'alwaysIncludedTitle');
    const customTitle = pick(intro, 'customServicesTitle');
    const alwaysTags = (services?.alwaysIncluded || []).map((s) => `<span class="cs-tag">${escapeHtml(s)}</span>`).join('');
    const customTags = (services?.customServices || []).map((s) => `<span class="cs-tag">${escapeHtml(s)}</span>`).join('');
    if (alwaysTags || customTags) {
      slides.push(bgSlide({
        key: 'services',
        video: intro.servicesVideo,
        poster: intro.servicesPoster,
        contentHTML: `
          ${servicesTitle ? `<h2 class="cv-section-label" style="margin-bottom: 1.2rem; font-size: 0.78rem;">${escapeHtml(servicesTitle)}</h2>` : ''}
          <div class="cv-services-grid">
            <div class="cv-service-block">
              ${alwaysTitle ? `<div class="cv-section-label">${escapeHtml(alwaysTitle)}</div>` : ''}
              <div class="cv-service-tags">${alwaysTags}</div>
            </div>
            <div class="cv-service-block">
              ${customTitle ? `<div class="cv-section-label">${escapeHtml(customTitle)}</div>` : ''}
              <div class="cv-service-tags">${customTags}</div>
            </div>
          </div>
        `
      }));
    }

    // 7) CTA
    const c1 = pick(intro, 'ctaLine1');
    const c2 = pick(intro, 'ctaLine2');
    if (c1 || c2) {
      slides.push(bgSlide({
        key: 'cta',
        video: intro.ctaVideo,
        poster: intro.ctaPoster,
        contentHTML: `
          <div style="text-align: center; width: 100%;">
            <h2 class="cv-reel-headline">${escapeHtml(c1)}${c2 ? `<br/><em>${escapeHtml(c2)}</em>` : ''}</h2>
          </div>
        `
      }));
    }

    return slides.join('');
  }

  function densityFor(n) {
    if (n <= 8) return 'airy';
    if (n <= 18) return 'balanced';
    return 'dense';
  }

  function logoSlideHTML(clients) {
    if (!clients.length) return '';
    const tiles = clients.map((c) => c.logo
      ? `<div class="lp-tile"><img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)}" /></div>`
      : `<div class="lp-tile"><div class="lp-tile-fallback">${escapeHtml(c.name)}</div></div>`).join('');
    return `
      <section class="cv-export-slide lp-page" style="padding:3rem">
        <header class="lp-page-header">
          <div class="lp-page-eyebrow">Trusted by</div>
          <h1 class="lp-page-title">Brands we've <em>built platforms with</em>.</h1>
        </header>
        <div class="lp-grid" data-density="${densityFor(clients.length)}">${tiles}</div>
      </section>
    `;
  }

  function slideHTML(cs) {
    const tags = (cs.tags || []).map((t) => `<span class="cs-tag">${escapeHtml(t)}</span>`).join('');

    // Hero = first media item (server projects legacy video/poster into media on read).
    const media = Array.isArray(cs.media) ? cs.media : [];
    const hero = media[0];
    const phoneInner = hero
      ? (hero.type === 'video'
          ? `<video src="${escapeHtml(hero.url)}" autoplay muted loop playsinline preload="auto" ${hero.poster ? `poster="${escapeHtml(hero.poster)}"` : ''}></video>`
          : `<img src="${escapeHtml(hero.url)}" alt="${escapeHtml(hero.caption || cs.client || '')}" />`)
      : `<div class="cv-phone-empty">No reel uploaded</div>`;

    // Scale signals — small row under the eyebrow tier, only when populated.
    const sc = cs.scale || {};
    const scaleBits = [
      sc.teamSize && { label: 'Team', value: sc.teamSize },
      sc.geo && { label: 'Reach', value: sc.geo },
      sc.duration && { label: 'Duration', value: sc.duration }
    ].filter(Boolean);
    const scaleHTML = scaleBits.length ? `
      <div class="cv-export-scale">
        ${scaleBits.map((b) => `
          <div class="cv-export-scale-item">
            <span class="cv-export-scale-label">${escapeHtml(b.label)}</span>
            <span class="cv-export-scale-value">${escapeHtml(b.value)}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

    const metricsHTML = (cs.metrics || []).length ? `
      <section>
        <div class="cv-section-label">Outcomes</div>
        <ul class="cv-metrics">
          ${cs.metrics.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}
        </ul>
      </section>` : '';

    const quoteHTML = cs.quote && cs.quote.body ? `
      <section>
        <div class="cv-section-label">Client</div>
        <blockquote class="cv-quote">
          "${escapeHtml(cs.quote.body)}"
          ${cs.quote.attribution ? `<span class="cv-quote-attr">— ${escapeHtml(cs.quote.attribution)}</span>` : ''}
        </blockquote>
      </section>` : '';

    return `
      <section class="cv-export-slide">
        <div class="cv-detail-tier">${escapeHtml(cs.tier || '')}</div>
        <h1 class="cv-detail-title">${escapeHtml(cs.client || '')}<span class="pipe">|</span>${escapeHtml(cs.scope || '')}</h1>
        ${tags ? `<div class="cv-detail-tags">${tags}</div>` : ''}
        ${scaleHTML}
        <div class="cv-detail-body">
          <div class="cv-phone">
            <div class="cv-phone-frame">
              ${phoneInner}
            </div>
          </div>
          <div class="cv-detail-right">
            ${metricsHTML}
            ${quoteHTML}
          </div>
        </div>
      </section>
    `;
  }

  // Secondary media slide — emitted when a case study has 2+ media items.
  // On screen the items auto-scroll horizontally (matches the read-mode marquee
  // in view.js so the export feels like a continuation of Cover, not a flat doc).
  // For print, CSS pauses the animation and wraps the items so the page still
  // captures every photo. Shows ALL secondary media (no cap) — scroll makes
  // count irrelevant on screen, and print wrapping handles long lists too.
  function gallerySlideHTML(cs) {
    const media = Array.isArray(cs.media) ? cs.media : [];
    if (media.length <= 1) return '';
    const extras = media.slice(1);
    const tileHTML = (m) => {
      // Auto-play muted on loop so the export marquee actually animates
      // visually instead of sitting on static first frames.
      const inner = m.type === 'video'
        ? `<video src="${escapeHtml(m.url)}" muted loop autoplay playsinline preload="auto"${m.poster ? ` poster="${escapeHtml(m.poster)}"` : ''}></video>`
        : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.caption || '')}" loading="lazy" />`;
      return `
        <figure class="cv-export-marquee-item" aria-hidden="true">
          <div class="cv-export-marquee-frame">${inner}</div>
          ${m.caption ? `<figcaption>${escapeHtml(m.caption)}</figcaption>` : ''}
        </figure>
      `;
    };
    const oneSet = extras.map(tileHTML).join('');
    return `
      <section class="cv-export-slide cv-export-gallery">
        <div class="cv-detail-tier">${escapeHtml(cs.tier || '')} · More from ${escapeHtml(cs.client || '')}</div>
        <h2 class="cv-export-gallery-title">${escapeHtml(cs.client || '')}<span class="pipe">|</span><span class="cv-export-gallery-sub">selected media</span></h2>
        <div class="cv-export-marquee">
          <div class="cv-export-marquee-track">${oneSet}${oneSet}${oneSet}</div>
        </div>
      </section>
    `;
  }

  // Shared render — given the assembled selection, build the deck HTML and
  // wire post-render details (autoplay coercion, title). Used by both the
  // internal team path (auth API) and the client share path (public token).
  function renderDeck({ studies, logos, includeAbout, intro, founders, topCreds, services }) {
    const csLabel = `${studies.length} case stud${studies.length === 1 ? 'y' : 'ies'}`;
    const lgLabel = logos.length ? ` · ${logos.length} logo${logos.length === 1 ? '' : 's'}` : '';
    const aboutLabel = includeAbout ? ' · About' : '';
    titleEl.textContent = `${csLabel}${lgLabel}${aboutLabel}`;

    const aboutDeck = (includeAbout)
      ? aboutSlidesHTML(intro || {}, founders || [], topCreds || [], services || {})
      : '';

    const cover = includeAbout ? '' : `
      <section class="cv-export-cover">
        <h1>Every great story starts with an <em>experience</em>.</h1>
        <p>A curated selection from CAPE Creative.</p>
        <div class="cv-export-meta">${csLabel}${lgLabel}</div>
      </section>
    `;

    // Divider sits BETWEEN case studies (not between a study's own main +
    // gallery slides), and not after the very last study. Hidden in presenter
    // mode via CSS so scroll-snap stays clean.
    const studySlides = studies
      .map((cs) => slideHTML(cs) + gallerySlideHTML(cs))
      .join('<hr class="cv-export-divider" />');
    deck.innerHTML = cover + aboutDeck + studySlides + logoSlideHTML(logos);
    document.title = `Cover — ${csLabel}${lgLabel}${aboutLabel}`;

    // Chrome may block autoplay on first paint even with `muted` set.
    deck.querySelectorAll('video[autoplay][muted]').forEach((v) => {
      const tryPlay = () => v.play().catch(() => {});
      if (v.readyState >= 2) tryPlay();
      else v.addEventListener('loadedmetadata', tryPlay, { once: true });
    });
  }

  // Client share-link path: hit /api/shares/:token (public) for the whole
  // bundle. No way to enumerate other case studies — server only returns the
  // ids signed into the token. Also locks down the UI so the client can't
  // navigate elsewhere (logo not clickable, Copy share link hidden).
  async function loadFromShareToken(token) {
    document.body.classList.add('cv-share-mode');
    // Disable the logo link so clients can't click through to the dashboard.
    const logoLink = document.querySelector('.cv-logo');
    if (logoLink && logoLink.tagName === 'A') {
      logoLink.removeAttribute('href');
      logoLink.style.cursor = 'default';
    }
    let data;
    try {
      const res = await fetch(`/api/shares/${encodeURIComponent(token)}`);
      if (!res.ok) {
        deck.innerHTML = `
          <section class="cv-export-cover">
            <h1>This share link is no longer available.</h1>
            <p>It may have expired or been revoked. Reach out to your CAPE contact for a fresh link.</p>
          </section>
        `;
        return;
      }
      data = await res.json();
    } catch (err) {
      console.error(err);
      deck.innerHTML = '<section class="cv-export-cover"><h1>Could not load this share.</h1></section>';
      return;
    }
    renderDeck({
      studies: data.caseStudies || [],
      logos: data.clients || [],
      includeAbout: !!data.includeAbout,
      intro: data.about?.intro,
      founders: data.about?.founders,
      topCreds: data.about?.topCreds,
      services: data.about?.services
    });
  }

  async function load() {
    // Check for a client share token first — public path, no auth.
    const shareToken = new URLSearchParams(window.location.search).get('share');
    if (shareToken) {
      return loadFromShareToken(shareToken);
    }

    // Internal team path: pulls from authenticated endpoints.
    const ids = getIds();
    const logoIds = getLogoIds();

    if (!ids.length && !logoIds.length) {
      deck.innerHTML = `
        <section class="cv-export-cover">
          <h1>Nothing selected.</h1>
          <p>Open the dashboard, pick case studies + logos, then hit "Export selection".</p>
        </section>
      `;
      return;
    }

    const includeAbout = getIncludeAbout();
    const requests = [];
    if (ids.length) {
      requests.push(fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      }).then((r) => r.json()));
    } else {
      requests.push(Promise.resolve({ caseStudies: [] }));
    }
    if (logoIds.length) {
      requests.push(fetch('/api/clients/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: logoIds })
      }).then((r) => r.json()));
    } else {
      requests.push(Promise.resolve({ clients: [] }));
    }
    if (includeAbout) {
      requests.push(Promise.all([
        fetch('/api/founders').then((r) => r.json()),
        fetch('/api/services').then((r) => r.json()),
        fetch('/api/intro').then((r) => r.json())
      ]));
    } else {
      requests.push(Promise.resolve(null));
    }

    const [studyData, logoData, aboutPayload] = await Promise.all(requests);
    const studies = studyData.caseStudies || [];
    const allLogos = logoData.clients || [];
    const logosById = new Map(allLogos.map((c) => [c.id, c]));
    const logos = logoIds.map((id) => logosById.get(id)).filter(Boolean);
    let intro, founders, topCreds, services;
    if (includeAbout && aboutPayload) {
      const [foundersData, servicesData, introData] = aboutPayload;
      intro = introData;
      founders = foundersData?.founders || [];
      topCreds = foundersData?.topCreds || [];
      services = servicesData || {};
    }
    renderDeck({ studies, logos, includeAbout, intro, founders, topCreds, services });
  }

  printBtn.addEventListener('click', () => window.print());

  // Generates a stateless share token via /api/shares, then copies the
  // resulting /export?share=TOKEN URL. Previously just copied the current
  // URL which had ?ids=... and required login — useless for clients.
  copyBtn.addEventListener('click', async () => {
    const originalText = copyBtn.textContent;
    copyBtn.disabled = true;
    copyBtn.textContent = 'Generating link…';
    try {
      const ids = getIds();
      const logoIds = getLogoIds();
      const includeAbout = getIncludeAbout();
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, logoIds, includeAbout })
      });
      if (!res.ok) throw new Error('share_failed');
      const { token } = await res.json();
      const url = `${window.location.origin}/export?share=${encodeURIComponent(token)}`;
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = '✓ Link copied!';
      setTimeout(() => { copyBtn.textContent = originalText; copyBtn.disabled = false; }, 2000);
    } catch (err) {
      console.error(err);
      copyBtn.textContent = 'Failed — try again';
      copyBtn.disabled = false;
      setTimeout(() => { copyBtn.textContent = originalText; }, 2400);
    }
  });

  // ---------- Presenter mode ----------
  // Treat every top-level section in the deck as one slide. Arrow keys +
  // space advance, Escape exits, P toggles. The CSS in styles.css does the
  // heavy lifting (full-viewport slides, faded toolbar) when body has the
  // cv-presenter-mode class.
  let presenterOn = false;
  let presenterIdx = 0;
  let presenterControls = null;

  function getSlides() {
    return Array.from(deck.querySelectorAll(':scope > section'));
  }

  function updatePresenterCounter() {
    if (!presenterControls) return;
    const c = presenterControls.querySelector('.cv-presenter-counter');
    if (c) c.textContent = `${presenterIdx + 1} / ${getSlides().length}`;
  }

  function goToSlide(i) {
    const slides = getSlides();
    if (!slides.length) return;
    presenterIdx = Math.max(0, Math.min(slides.length - 1, i));
    slides[presenterIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
    updatePresenterCounter();
  }

  function onPresenterKey(e) {
    if (!presenterOn) return;
    // Ignore when typing in a field (defensive — no inputs on the export
    // page right now, but future-proof)
    if (e.target.matches?.('input, textarea, [contenteditable="true"]')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      goToSlide(presenterIdx + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      goToSlide(presenterIdx - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goToSlide(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goToSlide(getSlides().length - 1);
    } else if (e.key === 'Escape') {
      setPresenterMode(false);
    }
  }

  function buildPresenterControls() {
    const el = document.createElement('div');
    el.className = 'cv-presenter-controls';
    el.innerHTML = `
      <button class="cv-presenter-btn" data-action="prev" aria-label="Previous slide" title="Previous (↑)">↑</button>
      <span class="cv-presenter-counter" aria-live="polite">1 / 1</span>
      <button class="cv-presenter-btn" data-action="next" aria-label="Next slide" title="Next (↓)">↓</button>
      <button class="cv-presenter-btn cv-presenter-exit" data-action="exit" aria-label="Exit presentation" title="Exit (Esc)">×</button>
    `;
    el.querySelector('[data-action="prev"]').addEventListener('click', () => goToSlide(presenterIdx - 1));
    el.querySelector('[data-action="next"]').addEventListener('click', () => goToSlide(presenterIdx + 1));
    el.querySelector('[data-action="exit"]').addEventListener('click', () => setPresenterMode(false));
    document.body.appendChild(el);
    return el;
  }

  function setPresenterMode(on) {
    presenterOn = !!on;
    document.body.classList.toggle('cv-presenter-mode', presenterOn);
    if (presentBtn) presentBtn.textContent = presenterOn ? 'Exit presenting' : 'Present';

    if (presenterOn) {
      if (!presenterControls) presenterControls = buildPresenterControls();
      presenterControls.style.display = 'flex';
      document.addEventListener('keydown', onPresenterKey);
      // Jump to whatever slide is most-visible right now (so toggling P
      // mid-scroll doesn't snap you back to slide 0).
      const slides = getSlides();
      const mid = window.scrollY + window.innerHeight / 2;
      let best = 0, bestDist = Infinity;
      slides.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const top = window.scrollY + r.top;
        const d = Math.abs(top + r.height / 2 - mid);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      // Defer one tick so the CSS layout (slides become 100vh) lands first
      requestAnimationFrame(() => goToSlide(best));
    } else {
      if (presenterControls) presenterControls.style.display = 'none';
      document.removeEventListener('keydown', onPresenterKey);
    }
  }

  presentBtn?.addEventListener('click', () => setPresenterMode(!presenterOn));

  // Global 'P' shortcut to toggle (matches WRAP). Ignored when typing.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'p' && e.key !== 'P') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // don't hijack Cmd+P (print)
    if (e.target.matches?.('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    setPresenterMode(!presenterOn);
  });

  load().catch((err) => {
    console.error(err);
    deck.innerHTML = '<section class="cv-export-cover"><h1>Could not load export.</h1></section>';
  });
})();
