import express from 'express';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { runBackup, isConfigured as isBackupConfigured, startScheduler as startBackupScheduler } from './backup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'case-studies.json');
const MEDIA_DIR = join(DATA_DIR, 'media');

await mkdir(MEDIA_DIR, { recursive: true });

// Forward-compatible seed: if the live data file is missing any top-level
// keys present in the bundled seed (e.g. a new "clients" array introduced
// in a later release), copy them in. Existing keys are left untouched.
async function migrateMissingKeys() {
  const SEED_FILE = join(__dirname, 'data-seed', 'case-studies.json');
  try {
    const [liveRaw, seedRaw] = await Promise.all([
      readFile(DATA_FILE, 'utf8').catch(() => null),
      readFile(SEED_FILE, 'utf8').catch(() => null)
    ]);
    if (!liveRaw || !seedRaw) return;
    const live = JSON.parse(liveRaw);
    const seed = JSON.parse(seedRaw);
    let changed = false;
    for (const k of Object.keys(seed)) {
      if (!(k in live)) {
        live[k] = seed[k];
        changed = true;
        console.log(`[migrate] seeding missing top-level key: ${k}`);
      }
    }
    // Also fill in any newly-introduced intro fields (heroVideo etc.) so the
    // About page never sees an undefined.
    if (seed.intro && typeof seed.intro === 'object') {
      live.intro = live.intro || {};
      for (const k of Object.keys(seed.intro)) {
        if (!(k in live.intro)) {
          live.intro[k] = seed.intro[k];
          changed = true;
          console.log(`[migrate] seeding missing intro key: ${k}`);
        }
      }
    }
    if (changed) await writeFile(DATA_FILE, JSON.stringify(live, null, 2), 'utf8');
  } catch (err) {
    console.warn('[migrate] skipped:', err.message);
  }
}
// Migration runs before the lock is contended so it stays as-is.
await migrateMissingKeys();

const ALLOWED_DOMAIN = (process.env.COVER_ALLOWED_DOMAIN || 'capecreative.co').toLowerCase();
const TOKEN_SECRET = process.env.COVER_TOKEN_SECRET ||
  crypto.createHash('sha256').update('cover-dev-secret-' + (process.env.USER || 'local')).digest('hex');
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---------- Token signing (HMAC) ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}
function signToken(payload) {
  const data = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest());
  return `${data}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest());
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(data));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function getUserFromReq(req) {
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const cookie = getCookie(req, 'cover_token');
  return verifyToken(bearer || cookie);
}

function requireAuth(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// ---------- Data ----------
async function readData() {
  const raw = await readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}
async function writeData(data) {
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Serialize read-modify-write critical sections so concurrent PUTs from the
// same client (e.g. the About page firing intro/founders/services in parallel)
// don't clobber each other.
let __dataLock = Promise.resolve();
function withDataLock(fn) {
  const next = __dataLock.then(fn, fn);
  __dataLock = next.then(() => undefined, () => undefined);
  return next;
}

// ---------- Auth API ----------
app.post('/api/login', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!name || !email) return res.status(400).json({ error: 'name_and_email_required' });

  const domain = email.split('@')[1] || '';
  if (ALLOWED_DOMAIN && domain !== ALLOWED_DOMAIN) {
    return res.status(403).json({ error: 'restricted_domain', domain: ALLOWED_DOMAIN });
  }

  const payload = { name, email, exp: Date.now() + TOKEN_TTL_MS };
  const token = signToken(payload);
  res.cookie?.('cover_token', token, { httpOnly: false, maxAge: TOKEN_TTL_MS, sameSite: 'lax' });
  res.setHeader('Set-Cookie', `cover_token=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}; SameSite=Lax`);
  res.json({ ok: true, token, user: { name, email } });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'cover_token=; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: { name: user.name, email: user.email } });
});

// ---------- Case study API ----------
app.get('/api/case-studies', requireAuth, async (_req, res) => {
  const data = await readData();
  const list = (data.caseStudies || []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  res.json({ caseStudies: list });
});

app.get('/api/case-studies/:id', requireAuth, async (req, res) => {
  const data = await readData();
  const cs = (data.caseStudies || []).find((c) => c.id === req.params.id);
  if (!cs) return res.status(404).json({ error: 'not_found' });
  res.json(cs);
});

app.put('/api/case-studies/:id', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    const idx = (data.caseStudies || []).findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'not_found' });
    const incoming = req.body || {};
    data.caseStudies[idx] = { ...data.caseStudies[idx], ...incoming, id: req.params.id };
    await writeData(data);
    res.json(data.caseStudies[idx]);
  });
});

app.post('/api/case-studies', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.caseStudies = data.caseStudies || [];
    const client = String(req.body?.client || '').trim();
    if (!client) return res.status(400).json({ error: 'client_required' });
    const baseId = slugify(client);
    let id = baseId, n = 2;
    while (data.caseStudies.some((c) => c.id === id)) id = `${baseId}-${n++}`;
    const order = (data.caseStudies.reduce((m, c) => Math.max(m, c.order ?? 0), 0) || 0) + 1;
    const study = {
      id, client,
      scope: String(req.body?.scope || '').trim() || 'TBD',
      tier: String(req.body?.tier || '').trim() || 'New & In Progress',
      order,
      headline: '', headlineSuffix: '',
      tags: [], metrics: [],
      quote: null, video: null, poster: null,
      draft: true
    };
    data.caseStudies.push(study);
    await writeData(data);
    res.status(201).json(study);
  });
});

app.post('/api/case-studies/:id/duplicate', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.caseStudies = data.caseStudies || [];
    const src = data.caseStudies.find((c) => c.id === req.params.id);
    if (!src) return res.status(404).json({ error: 'not_found' });
    const baseClient = `${src.client || 'Untitled'} (copy)`;
    const baseId = slugify(baseClient);
    let id = baseId, n = 2;
    while (data.caseStudies.some((c) => c.id === id)) id = `${baseId}-${n++}`;
    const order = (data.caseStudies.reduce((m, c) => Math.max(m, c.order ?? 0), 0) || 0) + 1;
    const copy = { ...src, id, client: baseClient, order, draft: true };
    data.caseStudies.push(copy);
    await writeData(data);
    res.status(201).json(copy);
  });
});

app.delete('/api/case-studies/:id', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.caseStudies = data.caseStudies || [];
    const before = data.caseStudies.length;
    data.caseStudies = data.caseStudies.filter((c) => c.id !== req.params.id);
    if (data.caseStudies.length === before) return res.status(404).json({ error: 'not_found' });
    if (Array.isArray(data.savedSections)) {
      data.savedSections = data.savedSections.map((s) => {
        if ((s.caseStudyIds || []).includes(req.params.id)) {
          return { ...s, caseStudyIds: s.caseStudyIds.filter((x) => x !== req.params.id), updatedAt: Date.now() };
        }
        return s;
      });
    }
    await writeData(data);
    res.json({ ok: true });
  });
});

app.get('/api/services', requireAuth, async (_req, res) => {
  const data = await readData();
  res.json({
    alwaysIncluded: data.alwaysIncluded || [],
    customServices: data.customServices || []
  });
});

app.get('/api/founders', requireAuth, async (_req, res) => {
  const data = await readData();
  res.json({
    founders: data.founders || [],
    topCreds: data.topCreds || []
  });
});

app.put('/api/founders', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    if (Array.isArray(req.body?.founders)) data.founders = req.body.founders;
    if (Array.isArray(req.body?.topCreds)) data.topCreds = req.body.topCreds;
    await writeData(data);
    res.json({ founders: data.founders || [], topCreds: data.topCreds || [] });
  });
});

app.put('/api/services', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    if (Array.isArray(req.body?.alwaysIncluded)) data.alwaysIncluded = req.body.alwaysIncluded;
    if (Array.isArray(req.body?.customServices)) data.customServices = req.body.customServices;
    await writeData(data);
    res.json({ alwaysIncluded: data.alwaysIncluded || [], customServices: data.customServices || [] });
  });
});

app.get('/api/intro', requireAuth, async (_req, res) => {
  const data = await readData();
  res.json(data.intro || {});
});

app.put('/api/intro', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.intro = { ...(data.intro || {}), ...(req.body || {}) };
    await writeData(data);
    res.json(data.intro);
  });
});

app.post('/api/export', requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const data = await readData();
  const selected = (data.caseStudies || []).filter((c) => ids.includes(c.id));
  res.json({ caseStudies: selected, count: selected.length });
});

// ---------- Clients (logo library) ----------
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'client';
}

app.get('/api/clients', requireAuth, async (_req, res) => {
  const data = await readData();
  // Always alphabetical by name (case-insensitive) so new uploads slot in
  // automatically. `order` is no longer authoritative.
  const list = (data.clients || []).slice().sort((a, b) =>
    (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
  res.json({ clients: list });
});

app.post('/api/clients', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.clients = data.clients || [];
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    const baseId = slugify(name);
    let id = baseId, n = 2;
    while (data.clients.some((c) => c.id === id)) id = `${baseId}-${n++}`;
    const order = (data.clients.reduce((m, c) => Math.max(m, c.order ?? 0), 0) || 0) + 1;
    const client = { id, name, logo: req.body?.logo || null, order };
    data.clients.push(client);
    await writeData(data);
    res.status(201).json(client);
  });
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.clients = data.clients || [];
    const idx = data.clients.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'not_found' });
    const incoming = req.body || {};
    data.clients[idx] = { ...data.clients[idx], ...incoming, id: req.params.id };
    await writeData(data);
    res.json(data.clients[idx]);
  });
});

app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.clients = data.clients || [];
    const before = data.clients.length;
    data.clients = data.clients.filter((c) => c.id !== req.params.id);
    if (data.clients.length === before) return res.status(404).json({ error: 'not_found' });
    await writeData(data);
    res.json({ ok: true });
  });
});

app.post('/api/clients/export', requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const data = await readData();
  const selected = (data.clients || []).filter((c) => ids.includes(c.id));
  res.json({ clients: selected, count: selected.length });
});

// ---------- Saved Sections ----------
function newSectionId(name, existing) {
  const base = slugify(name) || 'section';
  let id = base, n = 2;
  while (existing.some((s) => s.id === id)) id = `${base}-${n++}`;
  return id;
}

app.get('/api/sections', requireAuth, async (_req, res) => {
  const data = await readData();
  const list = (data.savedSections || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json({ sections: list });
});

app.get('/api/sections/:id', requireAuth, async (req, res) => {
  const data = await readData();
  const sec = (data.savedSections || []).find((s) => s.id === req.params.id);
  if (!sec) return res.status(404).json({ error: 'not_found' });
  res.json(sec);
});

app.post('/api/sections', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.savedSections = data.savedSections || [];
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    const now = Date.now();
    const section = {
      id: newSectionId(name, data.savedSections),
      name,
      description: String(req.body?.description || '').trim() || null,
      caseStudyIds: Array.isArray(req.body?.caseStudyIds) ? req.body.caseStudyIds : [],
      clientIds: Array.isArray(req.body?.clientIds) ? req.body.clientIds : [],
      createdAt: now,
      updatedAt: now,
      createdBy: req.user?.email || null
    };
    data.savedSections.push(section);
    await writeData(data);
    res.status(201).json(section);
  });
});

app.put('/api/sections/:id', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.savedSections = data.savedSections || [];
    const idx = data.savedSections.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'not_found' });
    const incoming = req.body || {};
    data.savedSections[idx] = { ...data.savedSections[idx], ...incoming, id: req.params.id, updatedAt: Date.now() };
    await writeData(data);
    res.json(data.savedSections[idx]);
  });
});

app.delete('/api/sections/:id', requireAuth, async (req, res) => {
  await withDataLock(async () => {
    const data = await readData();
    data.savedSections = data.savedSections || [];
    const before = data.savedSections.length;
    data.savedSections = data.savedSections.filter((s) => s.id !== req.params.id);
    if (data.savedSections.length === before) return res.status(404).json({ error: 'not_found' });
    await writeData(data);
    res.json({ ok: true });
  });
});

// ---------- Media upload ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
    filename: (_req, file, cb) => {
      const ext = (extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
      const safeName = basename(file.originalname, extname(file.originalname))
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      const stamp = Date.now().toString(36);
      cb(null, `${safeName || 'media'}-${stamp}${ext || ''}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const url = `/media/${req.file.filename}`;
  res.json({ ok: true, url, mime: req.file.mimetype, size: req.file.size });
});

// ---------- Backup (Cloudflare R2) ----------
app.get('/api/backup/status', requireAuth, (_req, res) => {
  res.json({ configured: isBackupConfigured() });
});

app.post('/api/backup/run', requireAuth, async (_req, res) => {
  try {
    const result = await runBackup({ dataFile: DATA_FILE, mediaDir: MEDIA_DIR });
    res.json(result);
  } catch (err) {
    console.error('[backup] manual run failed:', err);
    res.status(500).json({ ok: false, error: err.message || 'backup_failed' });
  }
});

// ---------- Static + page routes ----------
const PUBLIC_DIR = join(__dirname, 'public');

function gateHtml(file) {
  return (req, res) => {
    const user = getUserFromReq(req);
    if (!user) return res.redirect('/login');
    res.sendFile(join(PUBLIC_DIR, file));
  };
}

// Page routes first — gate the HTML before static can serve it.
app.get('/login', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'login.html')));
app.get('/view', gateHtml('view.html'));
app.get('/about', gateHtml('about.html'));
app.get('/export', gateHtml('export.html'));
app.get('/logos', gateHtml('logos.html'));
app.get('/logo-page', gateHtml('logo-page.html'));
app.get('/sections', gateHtml('sections.html'));
app.get('/', gateHtml('index.html'));

// Then static for CSS/JS/fonts/etc. `index: false` prevents implicit index.html.
app.use('/media', express.static(MEDIA_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800')
}));
app.use(express.static(PUBLIC_DIR, { index: false }));

const PORT = process.env.PORT || 4040;
app.listen(PORT, () => {
  console.log(`Cover running on http://localhost:${PORT}`);
  console.log(`Allowed domain: ${ALLOWED_DOMAIN || '(any)'}`);
  // Kick off the nightly R2 backup loop (no-op if env vars aren't set yet)
  startBackupScheduler({ dataFile: DATA_FILE, mediaDir: MEDIA_DIR });
});
