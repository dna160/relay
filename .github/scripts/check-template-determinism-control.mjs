#!/usr/bin/env node
/**
 * The negative control for PHASE-7's exit condition.
 *
 * > **EXIT:** stamping a template twice produces structurally identical graphs.
 *
 * `tests/unit/template-determinism.spec.ts` proves that sentence. This proves
 * the spec can fail — which is a different claim, and the one this build has
 * had to make separately every time. A determinism test is unusually good at
 * going quietly vacuous: normalise a field too hard and two different boards
 * compare equal, the suite stays green forever, and the exit condition has been
 * retired rather than proved.
 *
 * So: plant a defect in a copy of `src/domain/template/apply.ts`, alias the
 * real spec onto the copy, and require the spec to go **red**. Once per defect.
 *
 * ## What it found the first time it ran
 *
 * Eleven defects, eight caught, **three survived** — and all three were one
 * shape: *a stamp that is wrong the same way twice satisfies a comparison
 * between two stamps perfectly.*
 *
 *   - `contractedRounds: card.contractedRounds || default` — a card's own `0`
 *     swallowed by the template default. Both stamps swallow it identically.
 *   - every card re-parented onto `lanes[0]` — every id still real, every count
 *     unchanged, and one of the lanes cards were moved off is *private*.
 *   - `createdAt: new Date()` — purity broken, invisible because the comparison
 *     correctly strips timestamps.
 *
 * The five assertions under `the stamped graph is what the definition
 * described` exist because of that run, and all eleven are caught now.
 *
 * ## Run
 *
 *     node .github/scripts/check-template-determinism-control.mjs
 *     node .github/scripts/check-template-determinism-control.mjs --list
 *
 * Portable: no database, no build, no server. Roughly a second per defect.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SUBJECT = join(ROOT, 'src/domain/template/apply.ts');

/**
 * Each defect is a single substitution, and each is something a reasonable
 * person could write. Nothing here is a syntax error or an obviously absurd
 * edit — a control built out of nonsense proves the suite rejects nonsense.
 *
 * `find` is matched exactly once. If it stops matching — because the function
 * was refactored — the run is **inconclusive and exits 1**, never "passed".
 * "I planted nothing and found no survivor" is not a pass, which is the same
 * rule the bundle-purity probe is built on.
 */
const DEFECTS = [
  {
    id: 'published-private-lane',
    why: "INV-1's premise: a private lane silently published by the stamp",
    find: '      visibility: lane.visibility,',
    replace: "      visibility: 'published',",
  },
  {
    id: 'writes-card-state',
    why: 'INV-2: the stamp becomes a second writer of cards.state',
    find: '        title: card.title,',
    replace: "        title: card.title,\n        state: 'draft',",
  },
  {
    id: 'due-from-now',
    why: 'relative dates measured from the row clock instead of the start',
    find: '        dueAt: dueAtFrom(card.dueAfterDays, ctx.startedAt),',
    replace: '        dueAt: dueAtFrom(card.dueAfterDays, ctx.now),',
  },
  {
    id: 'day-zero-eaten',
    why: 'the falsiness bug: dueAfterDays 0 read as "no due date"',
    find: '  if (dueAfterDays === null) return null;',
    replace: '  if (!dueAfterDays) return null;',
  },
  {
    id: 'drops-empty-lanes',
    why: 'a lane with no cards quietly filtered out of the board',
    find: '  for (const [lanePosition, lane] of definition.lanes.entries()) {',
    replace:
      '  for (const [lanePosition, lane] of definition.lanes.filter((l) => l.cards.length > 0).entries()) {',
  },
  {
    id: 'zero-rounds-swallowed',
    why: "a card's own contractedRounds: 0 swallowed by the template default",
    find: '        contractedRounds: card.contractedRounds ?? definition.contractedRoundsDefault,',
    replace: '        contractedRounds: card.contractedRounds || definition.contractedRoundsDefault,',
  },
  {
    id: 'reparents-cards',
    why: 'every card hung off the first lane — all ids real, all counts right',
    find: '        laneId,',
    replace: '        laneId: lanes[0]?.id ?? laneId,',
  },
  {
    id: 'shared-id',
    why: 'a card minted with its lane’s id rather than its own',
    find: '        id: ctx.newId(),',
    replace: '        id: laneId,',
  },
  {
    id: 'impure-clock',
    why: 'non-determinism reintroduced: a row timestamp read from the wall clock',
    find: '        createdAt: ctx.now,\n        updatedAt: ctx.now,',
    replace: '        createdAt: new Date(),\n        updatedAt: ctx.now,',
  },
  {
    id: 'drops-shelf-groups',
    why: 'the reference shelf silently not stamped',
    find: '  return { lanes, cards, shelfGroups: [...definition.shelfGroups] };',
    replace: '  return { lanes, cards, shelfGroups: [] };',
  },
  {
    id: 'sorts-lanes-by-name',
    why: 'board order taken from the alphabet rather than from the definition',
    find: '  return { lanes, cards, shelfGroups: [...definition.shelfGroups] };',
    replace:
      '  return { lanes: [...lanes].sort((a, b) => a.name.localeCompare(b.name)), cards, shelfGroups: [...definition.shelfGroups] };',
  },
];

if (process.argv.includes('--list')) {
  for (const d of DEFECTS) console.log(`${d.id.padEnd(24)} ${d.why}`);
  process.exit(0);
}

const source = readFileSync(SUBJECT, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'relay-template-control-'));

const stale = DEFECTS.filter((d) => !source.includes(d.find));
if (stale.length > 0) {
  console.error('INCONCLUSIVE — these defects no longer apply to applyTemplate():\n');
  for (const d of stale) console.error(`  ${d.id}\n    wanted: ${JSON.stringify(d.find)}`);
  console.error(
    '\nThe function was refactored under the control. Re-anchor each one against the\n' +
      'current source. A control that plants nothing reports every defect as caught.',
  );
  process.exit(1);
}

console.log(`negative control — ${String(DEFECTS.length)} planted defects in applyTemplate()\n`);

const survivors = [];
for (const defect of DEFECTS) {
  const file = join(dir, `${defect.id}.ts`);
  writeFileSync(file, source.replace(defect.find, defect.replace));

  let output = '';
  let failed = false;
  try {
    output = execFileSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.control.config.ts'],
      { cwd: ROOT, env: { ...process.env, PLANTED: file }, encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (error) {
    failed = true;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const caught = [
    ...new Set(
      [...output.matchAll(/^\s+×\s+(.*?)(?:\s+\d+ms)?$/gm)].map((m) =>
        (m[1].split(' > ').pop() ?? m[1]).trim(),
      ),
    ),
  ];
  const counts = /Tests\s+(\d+) failed \| (\d+) passed/.exec(output);

  if (failed && caught.length > 0) {
    console.log(
      `  caught    ${defect.id.padEnd(24)} ${counts ? `${counts[1]} red`.padEnd(8) : ''}${caught[0]}`,
    );
  } else {
    survivors.push({ ...defect, output });
    console.log(`  SURVIVED  ${defect.id.padEnd(24)} ${defect.why}`);
  }
}

if (survivors.length > 0) {
  console.error(
    `\n${String(survivors.length)} of ${String(DEFECTS.length)} planted defects went undetected.\n` +
      'The determinism suite is green on code that is wrong. Do not widen the\n' +
      'normalisation — add the assertion that reads the graph against the\n' +
      'definition, which is the half a two-stamp comparison structurally cannot make.',
  );
  process.exit(1);
}

console.log(`\nOK — all ${String(DEFECTS.length)} planted defects were caught.`);
