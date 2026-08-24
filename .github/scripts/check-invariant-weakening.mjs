#!/usr/bin/env node
/**
 * "Never edit a file in `tests/invariants/` to make a build pass. If an
 * invariant test fails, the code is wrong." — CLAUDE.md, BUILD-PHASES.md.
 *
 * That rule is the load-bearing one in this repo and it is the easiest to break
 * at 2am, honestly, while genuinely believing the test is wrong. So it gets a
 * machine behind it rather than only a paragraph.
 *
 * This looks at what a change *removed* from `tests/invariants/`. Adding cases
 * and tightening assertions is always fine and needs no ceremony. Removing an
 * assertion, deleting a case, or turning a live suite back into a skipped one
 * is not automatically wrong — but it is always a decision someone should have
 * made deliberately, so it requires the `invariant-change` label on the pull
 * request.
 *
 * Usage:
 *   node .github/scripts/check-invariant-weakening.mjs <base-ref>
 *
 * Env:
 *   INVARIANT_CHANGE_APPROVED=true   set by CI when the PR carries the label
 */

import { execFileSync } from 'node:child_process';

const baseRef = process.argv[2];
if (!baseRef) {
  console.error('usage: check-invariant-weakening.mjs <base-ref>');
  process.exit(2);
}

const approved = process.env.INVARIANT_CHANGE_APPROVED === 'true';

let diff = '';
try {
  diff = execFileSync(
    'git',
    ['diff', '--unified=0', `${baseRef}...HEAD`, '--', 'tests/invariants'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
} catch (error) {
  console.error(`could not diff against ${baseRef}: ${error.message}`);
  process.exit(2);
}

if (diff.trim() === '') {
  console.log('tests/invariants/ unchanged.');
  process.exit(0);
}

/** Lines whose removal reduces what the suite proves. */
const WEAKENING = [
  { re: /^-.*\bexpect\s*\(/, why: 'an assertion was removed' },
  { re: /^-\s*(it|test)\s*(\.\w+)?\s*\(/, why: 'a test case was removed' },
  { re: /^-\s*describe\s*\(/, why: 'a live suite was removed' },
  { re: /^-.*\btoEqual\s*\(\s*\[\s*\]\s*\)/, why: 'an "expect no offenders" check was removed' },
];

/** Lines whose addition turns something live back into something skipped. */
const RESKIPPING = [{ re: /^\+.*\b(describe|it|test)\.skip\b/, why: 'a suite was re-skipped' }];

const findings = [];
let currentFile = 'tests/invariants';

for (const line of diff.split('\n')) {
  const header = line.match(/^\+\+\+ b\/(.+)$/);
  if (header) {
    currentFile = header[1];
    continue;
  }
  if (line.startsWith('---') || line.startsWith('+++')) continue;

  for (const { re, why } of [...WEAKENING, ...RESKIPPING]) {
    if (re.test(line)) {
      findings.push({ file: currentFile, why, line: line.trim() });
      break;
    }
  }
}

if (findings.length === 0) {
  console.log('tests/invariants/ was changed, and nothing was removed or re-skipped.');
  console.log('Additions and tightenings need no approval.');
  process.exit(0);
}

console.log(`${findings.length} weakening change(s) in tests/invariants/:\n`);
for (const f of findings) {
  console.log(`  ${f.file}\n    ${f.why}\n    ${f.line.slice(0, 140)}\n`);
}

if (approved) {
  console.log('The pull request carries the `invariant-change` label. Allowed.');
  process.exit(0);
}

console.error(
  'FAIL — an invariant suite was weakened.\n\n' +
    'If the invariant is still right, the code is wrong: fix the code.\n' +
    'If the invariant itself has genuinely changed, say so out loud — add the\n' +
    '`invariant-change` label to this pull request and record the reasoning in an ADR.\n' +
    'Silently deleting the assertion is the one option that is never available.',
);
process.exit(1);
