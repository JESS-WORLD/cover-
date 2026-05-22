// ============================================================
// Cloudflare R2 backup helper
// ============================================================
// Backs up the live data file + uploaded media to Cloudflare R2
// (S3-compatible). Run on a nightly schedule + on-demand via the
// admin endpoint.
//
// Required env vars:
//   COVER_R2_ACCOUNT_ID
//   COVER_R2_ACCESS_KEY_ID
//   COVER_R2_SECRET_ACCESS_KEY
//   COVER_R2_BUCKET
// ============================================================

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const KEEP_DAYS = 30; // prune snapshots older than this

function envReady() {
  return !!(
    process.env.COVER_R2_ACCOUNT_ID &&
    process.env.COVER_R2_ACCESS_KEY_ID &&
    process.env.COVER_R2_SECRET_ACCESS_KEY &&
    process.env.COVER_R2_BUCKET
  );
}

let _s3 = null;
async function getClient() {
  if (_s3) return _s3;
  if (!envReady()) throw new Error('r2_not_configured');
  const { S3Client } = await import('@aws-sdk/client-s3');
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.COVER_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.COVER_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.COVER_R2_SECRET_ACCESS_KEY
    }
  });
  return _s3;
}

function todayStamp() {
  // YYYY-MM-DD in UTC (consistent across machine timezones)
  return new Date().toISOString().slice(0, 10);
}

function mimeFor(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function putObject(key, body, contentType) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getClient();
  await s3.send(new PutObjectCommand({
    Bucket: process.env.COVER_R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
}

async function listExistingMediaKeys(prefix) {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = await getClient();
  const keys = new Set();
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.COVER_R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: token
    }));
    (resp.Contents || []).forEach((o) => keys.add(o.Key));
    token = resp.NextContinuationToken;
  } while (token);
  return keys;
}

async function deleteOldSnapshots() {
  const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getClient();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
  const cutoffStamp = cutoff.toISOString().slice(0, 10);

  const toDelete = [];
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.COVER_R2_BUCKET,
      Prefix: 'backups/',
      ContinuationToken: token,
      Delimiter: '/'
    }));
    for (const prefix of resp.CommonPrefixes || []) {
      // prefix.Prefix looks like "backups/2026-01-15/"
      const m = prefix.Prefix.match(/^backups\/(\d{4}-\d{2}-\d{2})\//);
      if (m && m[1] < cutoffStamp) {
        // List all objects under this old snapshot and queue for delete
        let innerToken;
        do {
          const inner = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.COVER_R2_BUCKET,
            Prefix: prefix.Prefix,
            ContinuationToken: innerToken
          }));
          (inner.Contents || []).forEach((o) => toDelete.push({ Key: o.Key }));
          innerToken = inner.NextContinuationToken;
        } while (innerToken);
      }
    }
    token = resp.NextContinuationToken;
  } while (token);

  // R2 supports batch delete up to 1000 keys per request
  while (toDelete.length) {
    const batch = toDelete.splice(0, 1000);
    await s3.send(new DeleteObjectsCommand({
      Bucket: process.env.COVER_R2_BUCKET,
      Delete: { Objects: batch, Quiet: true }
    }));
  }
}

export async function runBackup({ dataFile, mediaDir }) {
  if (!envReady()) {
    return { ok: false, error: 'r2_not_configured' };
  }

  const startedAt = Date.now();
  const stamp = todayStamp();
  const prefix = `backups/${stamp}`;
  const summary = { stamp, jsonBytes: 0, mediaFiles: 0, mediaBytes: 0, mediaSkipped: 0 };

  // 1) Always re-upload the JSON file (cheap, source of truth)
  const json = await readFile(dataFile);
  summary.jsonBytes = json.length;
  await putObject(`${prefix}/case-studies.json`, json, 'application/json');

  // 2) Mirror the media dir to a SINGLE shared `media/` prefix (not per-day)
  //    so we don't store duplicate copies of large videos every night.
  //    Media filenames are fingerprinted on upload so they're already unique.
  let existingMedia = new Set();
  try {
    existingMedia = await listExistingMediaKeys('media/');
  } catch (err) {
    // first run — no prior listing
    existingMedia = new Set();
  }

  let mediaFiles = [];
  try {
    mediaFiles = await readdir(mediaDir);
  } catch {
    mediaFiles = [];
  }

  for (const name of mediaFiles) {
    const key = `media/${name}`;
    if (existingMedia.has(key)) {
      summary.mediaSkipped += 1;
      continue;
    }
    const fullPath = join(mediaDir, name);
    let st;
    try { st = await stat(fullPath); } catch { continue; }
    if (!st.isFile()) continue;
    const buf = await readFile(fullPath);
    await putObject(key, buf, mimeFor(name));
    summary.mediaFiles += 1;
    summary.mediaBytes += buf.length;
  }

  // 3) Write a manifest for this snapshot — short readable record of what's in it
  const manifest = {
    stamp,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    jsonBytes: summary.jsonBytes,
    mediaFiles: mediaFiles.length,
    newMediaUploaded: summary.mediaFiles,
    newMediaBytes: summary.mediaBytes,
    mediaList: mediaFiles
  };
  await putObject(
    `${prefix}/manifest.json`,
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    'application/json'
  );

  // 4) Prune snapshots older than KEEP_DAYS (best-effort, don't fail the backup if this errors)
  let pruned = 0;
  try {
    await deleteOldSnapshots();
  } catch (err) {
    console.warn('[backup] prune failed:', err.message);
  }

  return {
    ok: true,
    ...summary,
    pruneAttempted: true,
    pruned,
    durationMs: Date.now() - startedAt
  };
}

export function isConfigured() {
  return envReady();
}

// --- Scheduler -----------------------------------------------------------
// Fire once a day at 3am Eastern (07:00 UTC, ignoring DST nuances — close enough).
// Uses setTimeout chaining so a long sleep doesn't drift like setInterval.
const TARGET_UTC_HOUR = 7;
const TARGET_UTC_MINUTE = 0;

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    TARGET_UTC_HOUR, TARGET_UTC_MINUTE, 0, 0
  ));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startScheduler({ dataFile, mediaDir }) {
  if (!envReady()) {
    console.log('[backup] R2 not configured — nightly scheduler not started');
    return;
  }
  function schedule() {
    const ms = msUntilNextRun();
    const next = new Date(Date.now() + ms);
    console.log(`[backup] next snapshot scheduled for ${next.toISOString()}`);
    setTimeout(async () => {
      try {
        const r = await runBackup({ dataFile, mediaDir });
        console.log('[backup] nightly snapshot complete:', JSON.stringify(r));
      } catch (err) {
        console.error('[backup] nightly snapshot failed:', err);
      } finally {
        schedule(); // chain to tomorrow
      }
    }, ms);
  }
  schedule();
}
