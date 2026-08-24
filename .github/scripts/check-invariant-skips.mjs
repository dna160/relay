#!/usr/bin/env node
/**
 * The handover contract, enforced.
 *
 * `docs/BUILD-PHASES.md`: "Every EXIT condition has a command or a test." Two of
 * those exit conditions are about the invariant suite itself, and neither is
 * checkable by running the suite — a skipped test passes.
 *
 *   1. Every skipped suite must name the phase that unskips it. A skipped suite
 *      that says why is a deferral; one that says nothing is a hole.
 *   2. At Phase 8, nothing may be skipped. PHASE-8 INVARIANTS: "Runs all ten in
 *      CI on every push. None may be skipped at this point."
 *
 * Also checks that all ten invariants still have a spec file at all, because
 * the cheapest way to make an invariant suite pass is to delete it.
 *
 * Usage:
 *   node .github/scripts/check-invariant-skips.mjs           # gate on the phase in PROGRESS.md
 *   node .github/scripts/check-invariant-skips.mjs --phase 8 # gate on an explicit phase
 *   node .github/scripts/check-invariant-skips.mjs --report  # print, never fail
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const INVARIANTS_DIR = join(ROOT, 'tests', 'invariants');

/** The phase at which no invariant suite may be skipped. */
const ALL_LIVE_PHASE = 8;

/** CLAUDE.md names ten. A missing file is a missing invariant. */
const REQUIRED = [
  { id: 'INV-1', match: /visibility\.spec\.ts$/ },
  { id: 'INV-2', match: /inv-02-.*\.spec\.ts$/ },
  { id: 'INV-3', match: /inv-03-.*\.spec\.ts$/ },
  { id: 'INV-4', match: /inv-04-.*\.spec\.ts$/ },
  { id: 'INV-5', match: /inv-05-.*\.spec\.ts$/ },
  { id: 'INV-6', match: /inv-06-.*\.spec\.ts$/ },
  { id: 'INV-7', match: /inv-07-.*\.spec\.ts$/ },
  { id: 'INV-8', match: /inv-08-.*\.spec\.ts$/ },
  { id: 'INV-9', match: /inv-09-.*\.spec\.ts$/ },
  { id: 'INV-10', match: /inv-10-.*\.spec\.ts$/ },
];

const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const phaseArgIndex = args.indexOf('--phase');
const explicitPhase = phaseArgIndex === -1 ? null : Number(args[phaseArgIndex + 1]);

function currentPhase() {
  if (explicitPhase !== null && !Number.isNaN(explicitPhase)) return explicitPhase;
  try {
    const progress = readFileSync(join(ROOT, 'docs', 'state', 'PROGRESS.md'), 'utf8');
    const match = progress.match(/\*\*Current phase:\*\*\s*(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function specFiles() {
  return readdirSync(INVARIANTS_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort();
}

const phase = currentPhase();
const files = specFiles();
const failures = [];
const rows = [];

for (const { id, match } of REQUIRED) {
  if (!files.some((f) => match.test(f))) {
    failures.push(`${id}: no spec file matching ${match} in tests/invariants/`);
  }
}

for (const file of files) {
  const text = readFileSync(join(INVARIANTS_DIR, file), 'utf8');
  const skips = [...text.matchAll(/\b(describe|it|test)\.skip\b/g)].length;
  const namesAPhase = /UNSKIP IN:\s*Phase\s*\d/i.test(text) || /Phase\s*\d/.test(text);
  rows.push({ file, skips, namesAPhase });

  if (skips > 0 && !namesAPhase) {
    failures.push(
      `${file}: ${skips} skipped block(s) and no "UNSKIP IN: Phase N" header. ` +
        'A skipped suite that names its phase is a deferral; one that does not is a hole.',
    );
  }

  if (skips > 0 && phase >= ALL_LIVE_PHASE) {
    failures.push(
      `${file}: ${skips} skipped block(s) at Phase ${phase}. ` +
        'PHASE-8 INVARIANTS: all ten run in CI on every push, none skipped.',
    );
  }
}

const totalSkips = rows.reduce((n, r) => n + r.skips, 0);

console.log(`Invariant suites at Phase ${phase}\n`);
console.log('  skipped  spec');
console.log('  -------  ----------------------------------------------------');
for (const row of rows) {
  const mark = row.skips === 0 ? '     -  ' : String(row.skips).padStart(7) + ' ';
  console.log(`  ${mark} ${row.file}`);
}
console.log(`\n  ${totalSkips} skipped block(s) across ${rows.length} spec files.`);
if (phase < ALL_LIVE_PHASE) {
  console.log(`  Skips are permitted until Phase ${ALL_LIVE_PHASE}, each naming its phase.`);
}

if (failures.length > 0) {
  console.error('\nFAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  if (!reportOnly) process.exit(1);
} else {
  console.log('\nOK');
}
