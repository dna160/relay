#!/usr/bin/env node
/**
 * Env drift is a deploy that boots and then 500s on the first request that
 * happens to touch the missing variable — often hours later, often on the
 * client surface, which is the one surface where a 500 costs an account.
 *
 * Three checks, all of them cheap:
 *
 *   1. Every `process.env.X` read anywhere in `src/` is documented in
 *      `.env.example`. Undocumented reads are how a variable reaches production
 *      without ever being set.
 *   2. Every variable in `.env.example` appears in the env registry table in
 *      `docs/RUNBOOK.md`, with a note on what happens when it is missing. The
 *      runbook is what someone reads at 3am; a variable it does not mention is
 *      a variable nobody will think to check.
 *   3. `.env.example` contains no real secret. It is committed, so anything
 *      that looks like a live key in it already leaked.
 *   4. Every variable in `.env.example` is actually set by the deploy topology
 *      in `.railway/railway.ts`. This is the link that was missing: a variable
 *      can be read by the code, documented in `.env.example`, described in the
 *      runbook, and *still* never reach the running container, because nothing
 *      put it there. That failure survives every other check in this file.
 *      Skipped, with a warning, until the topology file exists.
 *
 * Usage: node .github/scripts/check-env-registry.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Variables the platform or the toolchain provides. Documenting these in
 * `.env.example` would imply an operator has to set them, which is worse than
 * leaving them out.
 */
const PLATFORM_PROVIDED = [
  /^NODE_ENV$/,
  /^CI$/,
  /^PORT$/,
  /^TZ$/,
  /^npm_/,
  /^RAILWAY_/,
  /^NEXT_RUNTIME$/,
  /^VERCEL/,
  // Test-only, set by CI and by the e2e job. Never read in production paths.
  /^E2E_/,
];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', 'migrations']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

function read(path) {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return null;
  }
}

/* -------------------------------------------------- what the code actually reads */

const usages = new Map(); // name -> Set(file)
for (const file of walk(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8');
  const matches = [
    ...text.matchAll(/process\.env\.([A-Z0-9_]+)/g),
    ...text.matchAll(/process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g),
  ];
  for (const match of matches) {
    const name = match[1];
    if (PLATFORM_PROVIDED.some((re) => re.test(name))) continue;
    if (!usages.has(name)) usages.set(name, new Set());
    usages.get(name).add(relative(ROOT, file));
  }
}

/* --------------------------------------------------------- what is documented */

const envExample = read('.env.example');
if (envExample === null) {
  console.error('FAIL — .env.example is missing. It is the only registry the code has.');
  process.exit(1);
}

const documented = new Set(
  [...envExample.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]),
);

const runbook = read('docs/RUNBOOK.md');
const iac = read('.railway/railway.ts');

/* -------------------------------------------------------------------- checks */

const failures = [];

for (const [name, files] of [...usages].sort()) {
  if (!documented.has(name)) {
    failures.push(
      `${name} is read by ${[...files].join(', ')} and is not in .env.example. ` +
        'An undocumented variable is one nobody sets on the new environment.',
    );
  }
}

if (runbook === null) {
  failures.push('docs/RUNBOOK.md is missing — there is nowhere to look these up at 3am.');
} else {
  for (const name of [...documented].sort()) {
    if (!runbook.includes(name)) {
      failures.push(
        `${name} is in .env.example and not in the env registry in docs/RUNBOOK.md. ` +
          'Every variable needs a row saying what breaks when it is absent.',
      );
    }
  }
}

/**
 * The deploy topology. Railway deprecated Config as Code with a hard
 * 2026-12-01 cutoff and no opt-in for new services, so `.railway/railway.ts`
 * is what a new environment is actually built from and `railway.json` is not.
 *
 * `PLATFORM_PROVIDED` variables are excluded here too — Railway injects those —
 * and so is anything the topology has deliberately parked as a comment.
 */
const TOPOLOGY_EXEMPT = [
  // Set per-service by hand for the one-off migration/backfill container, not
  // part of the standing topology. Nothing reads it in a request path.
];

if (iac === null) {
  console.log(
    '  note: .railway/railway.ts does not exist, so the .env.example -> deploy ' +
      'link is unchecked. Railway Config as Code is deprecated (2026-12-01) and ' +
      'new services cannot opt in, so this file is required before Phase 8.\n',
  );
} else {
  for (const name of [...documented].sort()) {
    if (TOPOLOGY_EXEMPT.includes(name)) continue;
    if (!iac.includes(name)) {
      failures.push(
        `${name} is in .env.example and is never set by .railway/railway.ts. ` +
          'A variable the deploy topology does not set is one the container never ' +
          'sees, whatever the runbook says about it.',
      );
    }
  }
  // The inverse of a documentation problem: a test-only gate reaching a
  // deployed environment. The seed endpoint is gated on E2E_SEED_TOKEN and its
  // absence is what makes that endpoint safe to ship at all.
  // Comments stripped first: the file explains *why* E2E_SEED_TOKEN is absent,
  // and prose about a variable is not the variable.
  const iacCode = iac.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  if (/E2E_/.test(iacCode)) {
    failures.push(
      '.railway/railway.ts references an E2E_ variable. The test-only endpoints ' +
        'are gated on E2E_SEED_TOKEN being unset; setting it in a deployed ' +
        'environment exposes a database reset endpoint to the internet.',
    );
  }
}

// A committed placeholder is fine. A committed secret is not.
for (const line of envExample.split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*=\s*(.+)$/);
  if (!match) continue;
  const [, name, rawValue] = match;
  const value = rawValue.trim().replace(/^["']|["']$/g, '');
  if (value === '') continue;
  if (/^(change-me|changeme|replace-me|<.*>|\$\{.*\})/i.test(value)) continue;
  failures.push(
    `${name} has a non-placeholder value in .env.example. This file is committed; ` +
      'rotate that credential and replace the value with `change-me`.',
  );
}

/* -------------------------------------------------------------------- report */

console.log(`Env registry\n`);
console.log(`  ${usages.size} variable(s) read in src/`);
console.log(`  ${documented.size} variable(s) documented in .env.example`);
console.log(`  runbook: ${runbook === null ? 'MISSING' : 'present'}`);
console.log(`  deploy topology (.railway/railway.ts): ${iac === null ? 'MISSING' : 'present'}\n`);

const unread = [...documented].filter((n) => !usages.has(n));
if (unread.length > 0) {
  // Not a failure: a variable can be documented before the code that reads it
  // lands, and several here are Phase 6's. Worth printing so the list does not
  // quietly accumulate variables nothing has ever read.
  console.log(`  documented but not yet read (fine early, suspicious late):`);
  for (const n of unread) console.log(`    - ${n}`);
  console.log('');
}

if (failures.length > 0) {
  console.error('FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('OK');
