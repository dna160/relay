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
 *   2. Every invariant has a phase from which it may no longer be skipped. For
 *      the v1 ten that is Phase 8 — PHASE-8 INVARIANTS: "Runs all ten in CI on
 *      every push. None may be skipped at this point." The four v1.1
 *      invariants each carry their own, from `CLAUDE.md`; see `REQUIRED`.
 *
 * Also checks that each invariant still has a spec file at all, from the phase
 * that introduces it onward, because the cheapest way to make an invariant
 * suite pass is to delete it — or to never write it.
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

/**
 * The phase at which the v1 ten may no longer be skipped. PHASE-8 INVARIANTS:
 * "Runs all ten in CI on every push. None may be skipped at this point."
 */
const ALL_LIVE_PHASE = 8;

/**
 * Every invariant, the file that must exist for it, the phase from which that
 * file must exist, and the phase from which it may no longer be skipped.
 *
 * The v1 ten are unchanged: they exist from the first commit and PHASE-8
 * INVARIANTS says none of them may be skipped from Phase 8 on.
 *
 * The four v1.1 invariants are the reason this table replaced a flat list. They
 * arrived with `docs/PRD.md` v2.0 and `ADR-021`, `CLAUDE.md` marks each
 * not-yet-live with its owning phase, and under the old rule the first of them
 * to be written would have failed this gate the moment `PROGRESS.md` reached
 * Phase 8 — a correct, deliberately-skipped suite failing the check that exists
 * to catch undeclared skips. The fix is not to relax the rule; it is to say
 * which phase each invariant goes live in, which is what `CLAUDE.md` already
 * says in prose.
 *
 * `liveFrom` is the phase at which the suite may no longer be skipped, and it
 * is deliberately *after* the phase that builds the feature where the phase
 * file says so. INV-11 is the case in point: PHASE-9 EXIT is "INV-11 unskipped
 * only after deletion [of the old permission path]", which happens at the end
 * of Phase 9 after seven consecutive days at zero shadow-harness
 * disagreements. So it is required live from Phase 10, and a skip inside Phase
 * 9 is a deferral rather than a hole.
 *
 * `existsFrom` is separate and earlier, because the cheapest way to make an
 * invariant suite pass is to not write it. A structural half can and should
 * exist from the phase that introduces the invariant, before anything it
 * guards has been built — an invariant over an empty set holds.
 */
const REQUIRED = [
  { id: 'INV-1', match: /visibility\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-2', match: /inv-02-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-3', match: /inv-03-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-4', match: /inv-04-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-5', match: /inv-05-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-6', match: /inv-06-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-7', match: /inv-07-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-8', match: /inv-08-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-9', match: /inv-09-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  { id: 'INV-10', match: /inv-10-.*\.spec\.ts$/, existsFrom: 0, liveFrom: 8 },
  // v1.1. CLAUDE.md, "The platform layer (v1.1) — four more, not yet live".
  { id: 'INV-11', match: /inv-11-.*\.spec\.ts$/, existsFrom: 9, liveFrom: 10 },
  { id: 'INV-12', match: /inv-12-.*\.spec\.ts$/, existsFrom: 10, liveFrom: 11 },
  { id: 'INV-13', match: /inv-13-.*\.spec\.ts$/, existsFrom: 12, liveFrom: 13 },
  { id: 'INV-14', match: /inv-14-.*\.spec\.ts$/, existsFrom: 12, liveFrom: 13 },
];

/** Which invariant a spec file belongs to, for the per-invariant skip rule. */
function invariantFor(file) {
  return REQUIRED.find((inv) => inv.match.test(file)) ?? null;
}

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

for (const { id, match, existsFrom } of REQUIRED) {
  if (phase < existsFrom) continue;
  if (!files.some((f) => match.test(f))) {
    failures.push(
      `${id}: no spec file matching ${match} in tests/invariants/, and Phase ${phase} ` +
        `is at or past the phase that introduces it (${existsFrom}). The cheapest way ` +
        'to make an invariant suite pass is to not write it.',
    );
  }
}

for (const file of files) {
  const text = readFileSync(join(INVARIANTS_DIR, file), 'utf8');
  const skips = [...text.matchAll(/\b(describe|it|test)\.skip\b/g)].length;
  const namesAPhase = /UNSKIP IN:\s*Phase\s*\d/i.test(text) || /Phase\s*\d/.test(text);
  const inv = invariantFor(file);
  const liveFrom = inv?.liveFrom ?? ALL_LIVE_PHASE;
  rows.push({ file, skips, namesAPhase, id: inv?.id ?? '—', liveFrom });

  if (skips > 0 && !namesAPhase) {
    failures.push(
      `${file}: ${skips} skipped block(s) and no "UNSKIP IN: Phase N" header. ` +
        'A skipped suite that names its phase is a deferral; one that does not is a hole.',
    );
  }

  if (skips > 0 && phase >= liveFrom) {
    failures.push(
      `${file}: ${skips} skipped block(s) at Phase ${phase}, and ${inv?.id ?? 'this suite'} ` +
        `must be live from Phase ${liveFrom}. ` +
        (liveFrom === ALL_LIVE_PHASE
          ? 'PHASE-8 INVARIANTS: all ten run in CI on every push, none skipped.'
          : 'The phase that unskips it has passed.'),
    );
  }
}

const totalSkips = rows.reduce((n, r) => n + r.skips, 0);

console.log(`Invariant suites at Phase ${phase}\n`);
console.log('  skipped  live from  spec');
console.log('  -------  ---------  -------------------------------------------');
for (const row of rows) {
  const mark = row.skips === 0 ? '     -  ' : String(row.skips).padStart(7) + ' ';
  const live = String(`phase ${row.liveFrom}`).padStart(9);
  console.log(`  ${mark}  ${live}  ${row.file}`);
}
console.log(`\n  ${totalSkips} skipped block(s) across ${rows.length} spec files.`);

if (phase < ALL_LIVE_PHASE) {
  console.log(`  The v1 ten may be skipped until Phase ${ALL_LIVE_PHASE}, each naming its phase.`);
}
const deferred = REQUIRED.filter(
  (inv) => inv.liveFrom > ALL_LIVE_PHASE && phase < inv.liveFrom,
).map((inv) => `${inv.id} until phase ${inv.liveFrom}`);
if (deferred.length > 0) {
  console.log(`  v1.1, deferred by CLAUDE.md: ${deferred.join(', ')}.`);
}
const missing = REQUIRED.filter(
  (inv) => phase < inv.existsFrom && !files.some((f) => inv.match.test(f)),
).map((inv) => `${inv.id} (phase ${inv.existsFrom})`);
if (missing.length > 0) {
  console.log(`  Not yet required to exist: ${missing.join(', ')}.`);
}

if (failures.length > 0) {
  console.error('\nFAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  if (!reportOnly) process.exit(1);
} else {
  console.log('\nOK');
}
