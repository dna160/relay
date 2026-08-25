#!/usr/bin/env node
/**
 * A 200 MB upload completes without the app process RSS moving.
 *
 * PHASE-3's last EXIT condition, and the oldest UNPROVEN row on the board — it
 * has been open since round 1. INV-10's structural scans prove that no file in
 * `src/` reads a request body or streams an object, which is the *mechanism*;
 * nothing has ever measured the *consequence*. Those are different claims, and
 * this build has learned repeatedly that a guard reading something narrower
 * than the invariant claims is a guard that eventually lies.
 *
 * It became measurable only once object storage existed. Until MinIO landed in
 * `docker-compose.yml` and the CI job, the presign route 500'd, no PUT was ever
 * made, and there was nothing whose memory cost could be observed.
 *
 * ## What is actually being proved
 *
 * The app **serves the presign** — a real request, through the real route, with
 * a real agency session — and then 200 MB crosses from this process to object
 * storage without the app being in the path. If someone ever made the route
 * proxy the bytes, this fails immediately and unmistakably: 200 MB through a
 * 512 MB container is not a subtle regression.
 *
 * That is why the presign is fetched over HTTP rather than by importing
 * `presignUpload()`. Importing it would measure a library and prove nothing
 * about the server; the interesting question is whether the process that
 * answered the request also carried the payload.
 *
 * ## Why a delta, and why the budget is what it is
 *
 * "RSS does not move" cannot mean "RSS is identical". A Node server's resident
 * set breathes: JIT tiering, the pg pool, a GC that has not run yet. So the
 * assertion is that the peak stays within `RSS_BUDGET_MB` of the baseline —
 * generous against that noise, and two orders of magnitude below what
 * *buffering the upload* would cost. A regression that streams the body through
 * the app cannot hide inside 48 MB while moving 200.
 *
 * Baseline is a median of samples taken after the presign, not before it: the
 * presign request itself warms the route, and attributing that warm-up to the
 * upload would make the budget mean less than it says.
 *
 * Usage:
 *   node .github/scripts/check-upload-rss.mjs            # gate
 *   node .github/scripts/check-upload-rss.mjs --report   # print, never fail
 *
 * Requires a running server (production build preferred — a dev server's memory
 * is noisy and unrepresentative), a `DATABASE_URL` this may reseed, and object
 * storage. No `E2E_SEED_TOKEN`: the seed and the session are established out of
 * band through the product's own functions, because `/api/test/*` refuses to
 * mount in production and that refusal is a feature.
 */

import { execFileSync, spawnSync } from 'node:child_process';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const UPLOAD_MB = Number(process.env.RSS_UPLOAD_MB ?? 200);
const BUDGET_MB = Number(process.env.RSS_BUDGET_MB ?? 48);
const reportOnly = process.argv.includes('--report');

function fail(message) {
  console.error(`\n${message}`);
  if (!reportOnly) process.exit(1);
  return null;
}

/**
 * Seeds and mints an agency session out of band.
 *
 * `/api/test/seed` and `/api/test/session` refuse to mount when
 * `NODE_ENV === 'production'` — DEFECT-5's fix, and the half of that gate which
 * makes the endpoints safe to ship at all. This measurement wants a production
 * build, so it reaches the same two product functions from the other side of
 * the process boundary rather than asking for the gate to be relaxed. Same
 * arrangement as `check-fcp-budget.mjs`; see `tests/agency-session.ts`.
 */
function agencySession() {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tests/agency-session.ts'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status !== 0) throw new Error(`agency-session failed: ${r.stderr.slice(-500)}`);
  const line = r.stdout.trim().split('\n').filter(Boolean).pop();
  if (!line) throw new Error('agency-session printed nothing');
  return JSON.parse(line);
}

/* ------------------------------------------------------------ the process */

/**
 * The PID whose memory is the subject.
 *
 * Discovered from the listening socket rather than taken on trust: `npm run
 * start` is a wrapper, and measuring the wrapper's RSS while `next-server`
 * grows would report a flat line through any regression at all.
 */
function serverPid() {
  if (process.env.RSS_PID) return Number(process.env.RSS_PID);
  const port = new URL(BASE).port || '3000';
  try {
    const out = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    const pids = out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
    if (pids.length === 0) return null;
    // The largest pid is the child that actually serves; a wrapper is started
    // first and therefore numbered lower.
    return Math.max(...pids);
  } catch {
    return null;
  }
}

function rssMb(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
    const kb = Number(out.trim());
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null;
  } catch {
    return null;
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------- the flow */

async function json(path, init = {}) {
  const response = await fetch(BASE + path, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return { body: text === '' ? {} : JSON.parse(text), response };
}

const pid = serverPid();
if (pid === null) {
  fail(
    `No process is listening on ${BASE}. Start a production server first:\n` +
      '  npm run build && npm run start\n\n' +
      'A dev server would answer, but its memory is unminified, unbundled and\n' +
      'recompiling on demand — the number would not be the number.',
  );
  process.exit(1);
}

console.log('upload RSS budget — PHASE-3 EXIT');
console.log(`  server pid ${pid} at ${BASE}`);

const seed = agencySession();
const cookie = seed.cookie;

const sizeBytes = UPLOAD_MB * 1024 * 1024;

// The app does its work here: a real route, a real session, a real signature.
const { body: presigned } = await json('/api/uploads/presign', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    engagementId: seed.engagementId,
    cardId: seed.cardId,
    filename: `rss-probe-${Date.now()}.bin`,
    mime: 'application/octet-stream',
    size: sizeBytes,
  }),
});
const presign = presigned.presign;
console.log(`  presign mode: ${presign.mode}`);

/* ------------------------------------------------- baseline, then the bytes */

const baselineSamples = [];
for (let i = 0; i < 10; i += 1) {
  const v = rssMb(pid);
  if (v !== null) baselineSamples.push(v);
  await sleep(120);
}
const baseline = median(baselineSamples);
if (baseline === null) {
  fail(`Could not read RSS for pid ${pid}; the process may have exited.`);
  process.exit(1);
}
console.log(`  baseline RSS: ${baseline.toFixed(1)} MB (median of ${baselineSamples.length})`);

const during = [];
const sampler = setInterval(() => {
  const v = rssMb(pid);
  if (v !== null) during.push(v);
}, 120);

const started = Date.now();
try {
  if (presign.mode === 'single') {
    const body = Buffer.alloc(sizeBytes, 0x41);
    const put = await fetch(presign.url, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
    if (!put.ok) throw new Error(`PUT -> ${put.status}: ${(await put.text()).slice(0, 300)}`);
  } else {
    // ADR-015: multipart completes in the browser. This is that browser — the
    // part signatures came from the app and the parts themselves never touch it.
    const etags = [];
    let sent = 0;
    for (const part of presign.parts) {
      const length = Math.min(presign.partSize, sizeBytes - sent);
      if (length <= 0) break;
      const chunk = Buffer.alloc(length, 0x41);
      const put = await fetch(part.url, { method: 'PUT', body: chunk });
      if (!put.ok) {
        throw new Error(`part ${part.partNumber} -> ${put.status}: ${(await put.text()).slice(0, 200)}`);
      }
      const etag = put.headers.get('etag');
      if (!etag) throw new Error(`part ${part.partNumber} returned no ETag`);
      etags.push({ partNumber: part.partNumber, etag });
      sent += length;
    }
    const xml =
      '<CompleteMultipartUpload>' +
      etags
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
        .join('') +
      '</CompleteMultipartUpload>';
    const done = await fetch(presign.completeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body: xml,
    });
    if (!done.ok) {
      throw new Error(`complete -> ${done.status}: ${(await done.text()).slice(0, 300)}`);
    }
    console.log(`  uploaded ${etags.length} part(s) of up to ${(presign.partSize / 1024 / 1024).toFixed(0)} MB`);
  }
} catch (error) {
  clearInterval(sampler);
  fail(`The upload did not complete: ${error.message}`);
  process.exit(1);
}

// Let the process settle: a spike that appears one tick after the last PUT is
// still the upload's, and stopping the sampler at the last byte would miss it.
for (let i = 0; i < 12; i += 1) {
  const v = rssMb(pid);
  if (v !== null) during.push(v);
  await sleep(150);
}
clearInterval(sampler);

const elapsed = (Date.now() - started) / 1000;
const peak = Math.max(...during);
const delta = peak - baseline;

console.log(`  uploaded ${UPLOAD_MB} MB in ${elapsed.toFixed(1)}s`);
console.log(`  peak RSS: ${peak.toFixed(1)} MB over ${during.length} samples`);
console.log(`  delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} MB (budget ${BUDGET_MB} MB)`);

if (during.length < 5) {
  fail(
    `Only ${during.length} RSS samples were taken. The upload finished faster than the\n` +
      'sampler could observe it, so a flat line here is an absence of measurement\n' +
      'rather than an absence of growth.',
  );
  process.exit(1);
}

if (delta > BUDGET_MB) {
  fail(
    `THE APP GREW BY ${delta.toFixed(1)} MB WHILE ${UPLOAD_MB} MB WAS UPLOADED.\n\n` +
      'INV-10: file bytes never traverse the app server. Uploads are presigned\n' +
      'direct to object storage, so the process that signed the URL must not have\n' +
      'grown by anything resembling the payload. Check whether a route has started\n' +
      'reading a request body or proxying a stream.',
  );
} else {
  console.log(
    `\nOK — ${UPLOAD_MB} MB uploaded and the app process moved ${delta.toFixed(1)} MB.\n` +
      'INV-10 measured, not merely scanned for.',
  );
}
