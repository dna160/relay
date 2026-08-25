#!/usr/bin/env node
/**
 * Nothing skips silently in CI.
 *
 * ## The failure this exists to make impossible again
 *
 * INV-10's two byte-path tests skip themselves when object storage is absent,
 * and that is *correct*: asserting "no PUT reached the app server" against a
 * run containing no PUT would be a green light for an absent byte path, so
 * refusing to conclude is better than concluding wrongly.
 *
 * But a skip is invisible. Playwright prints it, CI goes green, and the summary
 * line everyone actually reads says the suite passed. Neither
 * `docker-compose.yml` nor the e2e job provided an S3 endpoint, so for six
 * phases the upload half of the product's spine was never once exercised while
 * the job reported success every time.
 *
 * The tests were right to skip. The job was wrong to accept it. So: storage is
 * configured in CI now, and this asserts that the skips consequently do not
 * happen. A conditional skip is a statement about the environment — in an
 * environment we control, it must be false.
 *
 * ## Why the JUnit report rather than the exit code
 *
 * Playwright exits 0 on a run where every test skipped. The exit code answers
 * "did anything fail", and the question here is "did everything run". Those are
 * different questions and only one of them is asked by `npm run test:e2e`.
 * `playwright.config.ts` already emits JUnit XML in CI, so the answer is
 * already on disk.
 *
 * ## Deliberately not configurable
 *
 * There is no `--allow N`. The moment a skip budget exists, the budget is what
 * gets edited when a test starts skipping. If a test genuinely cannot run in
 * CI, that belongs in `SANCTIONED` below with a reason and a name, where it is
 * reviewable in a diff.
 *
 * Usage:
 *   node .github/scripts/check-e2e-skips.mjs
 *   node .github/scripts/check-e2e-skips.mjs --report   # print, never fail
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPORT = join(ROOT, 'playwright-report', 'junit.xml');
const reportOnly = process.argv.includes('--report');

/**
 * True only when this file is the process entry point.
 *
 * The parser below is exported and asserted by
 * `tests/unit/e2e-skip-report.spec.ts`; without this guard, importing it runs
 * the gate, which reads a report that does not exist and calls `process.exit`
 * inside the test runner.
 */
const IS_ENTRY_POINT =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

/**
 * Tests permitted to skip in CI, by exact name, each with a reason.
 *
 * Empty, and it should stay that way. An entry here is a claim that CI cannot
 * provide something the test needs — which is a claim about our own
 * infrastructure, and therefore usually a thing to fix rather than to record.
 */
const SANCTIONED = new Map(/* [name, why] */);

/**
 * Every `<testcase>` and whether it carries a `<skipped/>` child.
 *
 * Parsed with a regex rather than a parser because adding an XML dependency for
 * one shape of one file is a worse trade than a pattern with a test corpus
 * behind it — `tests/unit/e2e-skip-report.spec.ts` plants the shapes.
 */
export function skippedTests(report) {
  const out = [];
  // `<testcase ... />` (self-closing, a pass) or `<testcase ...> ... </testcase>`.
  for (const match of report.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = match[1] ?? '';
    const body = match[3] ?? '';
    if (!/<skipped\b/.test(body)) continue;
    const name = (attrs.match(/\bname="([^"]*)"/) ?? [])[1] ?? '(unnamed)';
    const suite = (attrs.match(/\bclassname="([^"]*)"/) ?? [])[1] ?? '';
    out.push({ name, suite });
  }
  return out;
}

export function countTests(report) {
  return [...report.matchAll(/<testcase\b/g)].length;
}

if (IS_ENTRY_POINT) {
  if (!existsSync(REPORT)) {
    console.error(
      `No JUnit report at ${REPORT}.\n` +
        'Expected `npm run test:e2e` to have run first — `playwright.config.ts`\n' +
        'emits JUnit in CI. A missing report is not a pass: it means the suite did\n' +
        'not run at all, which is the strongest form of the thing this checks for.',
    );
    process.exit(reportOnly ? 0 : 1);
  }

  const xml = readFileSync(REPORT, 'utf8');
  const skipped = skippedTests(xml);
  const total = countTests(xml);

  console.log('e2e completeness\n');
  console.log(`  ${total} test(s) in the report`);
  console.log(`  ${skipped.length} skipped`);

  if (total === 0) {
    console.error(
      '\nThe report contains no tests at all. A suite that ran nothing cannot have\n' +
        'proved anything, and it exits 0 while doing so.',
    );
    if (!reportOnly) process.exit(1);
  }

  const unsanctioned = skipped.filter((t) => !SANCTIONED.has(t.name));

  for (const t of skipped) {
    const why = SANCTIONED.get(t.name);
    console.log(`    ${why ? 'sanctioned' : 'UNSANCTIONED'}  ${t.suite} > ${t.name}`);
    if (why) console.log(`                  ${why}`);
  }

  if (unsanctioned.length > 0) {
    console.error(
      `\nFAIL — ${unsanctioned.length} e2e test(s) skipped in CI.\n\n` +
        'A conditional skip is a statement about the environment, and this is an\n' +
        'environment we control. The usual cause is a missing service: the INV-10\n' +
        'byte-path tests skip when S3_ENDPOINT and S3_ACCESS_KEY_ID are unset, which\n' +
        'is how the upload half of the spine went unexercised for six phases while\n' +
        'this job reported green every time.\n\n' +
        'Fix the environment. If a test genuinely cannot run here, add it to\n' +
        'SANCTIONED in this file with a reason, where a reviewer will see it.',
    );
    if (!reportOnly) process.exit(1);
  } else {
    console.log('\nOK — every e2e test ran.');
  }
}
