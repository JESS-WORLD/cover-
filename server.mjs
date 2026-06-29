import express from 'express';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
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

// ---------- Case study schema migration (lazy, read-time) ----------
// Older records have `video` / `poster` as top-level strings and no `scale`.
// On every read we project them into the new canonical shape:
//   media: [{ id, type:'video'|'image', url, poster?, caption?, order }]
//   scale: { teamSize, geo, duration }
// The original `video`/`poster` keys are preserved for back-compat — the
// editor sends the new shape on save and the spread-merge in PUT will
// effectively retire them over time without a destructive one-shot migration.
function newMediaId() {
  return 'm_' + crypto.randomBytes(5).toString('hex');
}
function migrateCaseStudy(cs) {
  if (!cs || typeof cs !== 'object') return cs;
  const out = { ...cs };

  // media[]
  const hasMedia = Array.isArray(out.media) && out.media.length > 0;
  if (!hasMedia) {
    const built = [];
    if (out.video) {
      built.push({
        id: newMediaId(),
        type: 'video',
        url: out.video,
        poster: out.poster || null,
        caption: '',
        order: 0
      });
    } else if (out.poster) {
      // poster without video → treat as a standalone image
      built.push({
        id: newMediaId(),
        type: 'image',
        url: out.poster,
        caption: '',
        order: 0
      });
    }
    out.media = built;
  } else {
    // Ensure each media item has the required keys (in case it was hand-edited)
    out.media = out.media.map((m, i) => ({
      id: m.id || newMediaId(),
      type: m.type === 'image' ? 'image' : 'video',
      url: m.url || '',
      poster: m.poster || null,
      caption: m.caption || '',
      order: typeof m.order === 'number' ? m.order : i
    })).sort((a, b) => a.order - b.order);
  }

  // scale
  const s = out.scale && typeof out.scale === 'object' ? out.scale : {};
  out.scale = {
    teamSize: typeof s.teamSize === 'string' ? s.teamSize : '',
    geo: typeof s.geo === 'string' ? s.geo : '',
    duration: typeof s.duration === 'string' ? s.duration : ''
  };

  return out;
}

// ---------- Case study API ----------
app.get('/api/case-studies', requireAuth, async (_req, res) => {
  const data = await readData();
  const list = (data.caseStudies || [])
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map(migrateCaseStudy);
  res.json({ caseStudies: list });
});

app.get('/api/case-studies/:id', requireAuth, async (req, res) => {
  const data = await readData();
  const cs = (data.caseStudies || []).find((c) => c.id === req.params.id);
  if (!cs) return res.status(404).json({ error: 'not_found' });
  res.json(migrateCaseStudy(cs));
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
      media: [],
      scale: { teamSize: '', geo: '', duration: '' },
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
  const selected = (data.caseStudies || []).filter((c) => ids.includes(c.id)).map(migrateCaseStudy);
  res.json({ caseStudies: selected, count: selected.length });
});

// ---------- Client-shareable export tokens ----------
// Team members create a share token from their selection; clients open the
// resulting /export?share=TOKEN URL without needing to log in. The token is
// a signed HMAC payload (stateless, no DB) listing the allowed case-study
// and logo ids + about flag + 90-day expiry. The /api/shares/:token endpoint
// returns ONLY the bundled selection — no way for a client to enumerate the
// rest of the library.
const SHARE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

app.post('/api/shares', requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((x) => typeof x === 'string')
    : [];
  const logoIds = Array.isArray(req.body?.logoIds)
    ? req.body.logoIds.filter((x) => typeof x === 'string')
    : [];
  const includeAbout = !!req.body?.includeAbout;
  if (!ids.length && !logoIds.length) {
    return res.status(400).json({ error: 'empty_selection' });
  }
  const token = signToken({
    kind: 'share',
    ids,
    logoIds,
    includeAbout,
    createdBy: req.user?.email || null,
    exp: Date.now() + SHARE_TTL_MS
  });
  res.json({ token });
});

// Public — anyone with the token can fetch the bundle. Returns ONLY the
// case studies / logos / about content named in the token; no other data
// from the live library is reachable through this endpoint.
app.get('/api/shares/:token', async (req, res) => {
  const payload = verifyToken(req.params.token);
  if (!payload || payload.kind !== 'share') {
    return res.status(404).json({ error: 'invalid_or_expired' });
  }
  const data = await readData();
  const allowedIds = new Set(payload.ids || []);
  const caseStudies = (data.caseStudies || [])
    .filter((c) => allowedIds.has(c.id))
    .map(migrateCaseStudy);
  const allowedLogoIds = new Set(payload.logoIds || []);
  const clients = (data.clients || []).filter((c) => allowedLogoIds.has(c.id));
  const includeAbout = !!payload.includeAbout;
  const about = includeAbout
    ? {
        intro: data.intro || {},
        founders: data.founders || [],
        topCreds: data.topCreds || [],
        services: {
          alwaysIncluded: data.alwaysIncluded || [],
          customServices: data.customServices || []
        }
      }
    : null;
  res.json({ caseStudies, clients, includeAbout, about });
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

// Ref-counted delete. Scans every place a media URL could appear in the data
// file (case studies' media[], legacy video/poster, client logos, intro/about
// video & poster fields, founders, services, sections) and refuses to unlink
// the file if any reference is found. Conservative on purpose — losing a
// referenced video is worse than leaving an orphan.
function collectMediaRefs(data) {
  const refs = new Set();
  const add = (v) => { if (typeof v === 'string' && v.startsWith('/media/')) refs.add(v); };
  const walk = (node) => {
    if (!node) return;
    if (typeof node === 'string') { add(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k]);
    }
  };
  walk(data);
  return refs;
}

app.delete('/api/media/:filename', requireAuth, async (req, res) => {
  const filename = req.params.filename;
  // Defense against path traversal — filenames are fingerprinted and live in
  // MEDIA_DIR only. Reject anything with a path separator or .. segment.
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ error: 'bad_filename' });
  }
  const fullUrl = `/media/${filename}`;
  await withDataLock(async () => {
    const data = await readData();
    const refs = collectMediaRefs(data);
    if (refs.has(fullUrl)) {
      return res.status(409).json({ ok: false, error: 'still_referenced' });
    }
    try {
      await unlink(join(MEDIA_DIR, filename));
      res.json({ ok: true, deleted: filename });
    } catch (err) {
      if (err.code === 'ENOENT') return res.json({ ok: true, deleted: filename, note: 'already_gone' });
      console.error('[media] delete failed:', err);
      res.status(500).json({ ok: false, error: 'delete_failed' });
    }
  });
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

// Token-protected endpoint for external cron (GitHub Actions).
// Independent of user session auth — uses bearer token from COVER_BACKUP_CRON_TOKEN.
// This is the primary backup trigger; the in-process setTimeout scheduler in
// backup.mjs is a quiet fallback for when the machine happens to be awake.
app.post('/api/backup/cron', async (req, res) => {
  const expected = process.env.COVER_BACKUP_CRON_TOKEN;
  if (!expected) {
    return res.status(503).json({ ok: false, error: 'cron_token_not_configured' });
  }
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const presented = m ? m[1].trim() : '';
  // Constant-time comparison to avoid timing attacks
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const result = await runBackup({ dataFile: DATA_FILE, mediaDir: MEDIA_DIR });
    console.log('[backup] cron snapshot complete:', JSON.stringify(result));
    res.json(result);
  } catch (err) {
    console.error('[backup] cron run failed:', err);
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
// /export is gated by team login UNLESS a valid share token is present.
// Clients receive URLs like /export?share=TOKEN and never need to log in.
app.get('/export', (req, res) => {
  const shareToken = req.query.share;
  if (typeof shareToken === 'string' && shareToken) {
    const payload = verifyToken(shareToken);
    if (payload && payload.kind === 'share') {
      return res.sendFile(join(PUBLIC_DIR, 'export.html'));
    }
    // Invalid/expired share token — fall through to gateHtml which will
    // redirect to /login. The page itself can render its own "expired" message
    // for clients but only if it gets served at all; better to be explicit.
  }
  return gateHtml('export.html')(req, res);
});
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
