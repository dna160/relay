/**
 * The e2e completeness check's parser, against the shapes Playwright emits.
 *
 * `check-e2e-skips.mjs` is the gate that stops a silently-skipped test being
 * read as a pass. It only runs in CI, after the e2e job, and it is the kind of
 * script whose regex quietly stops matching when a reporter changes its output
 * — at which point it reports zero skips forever and the hole it was written to
 * close is open again with a green check mark over it.
 *
 * So the parser gets a corpus here, in `npm run verify`, and the corpus
 * includes the case that matters most: a **self-closing** `<testcase/>`, which
 * is what a passing test looks like and which a naive
 * `<testcase>([\s\S]*?)</testcase>` pattern does not match at all. A parser that
 * cannot see passing tests reports `0 of 0` and calls it clean.
 */

import { describe, expect, it } from 'vitest';
import { countTests, skippedTests } from '../../.github/scripts/check-e2e-skips.mjs';

/** The two shapes Playwright's JUnit reporter actually writes. */
const PASSED = '<testcase name="a decision is recorded" classname="client/decision.spec.ts" time="1.2"/>';
const SKIPPED =
  '<testcase name="upload -&gt; publish -&gt; awaiting client, with the bytes going direct (INV-10)" ' +
  'classname="agency/engagement-flow.spec.ts" time="0">\n' +
  '  <skipped/>\n' +
  '</testcase>';
const FAILED =
  '<testcase name="an illegal transition returns 409" classname="agency/engagement-flow.spec.ts" time="0.4">\n' +
  '  <failure message="expected 409"/>\n' +
  '</testcase>';

function report(...cases: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="agency">\n${cases.join('\n')}\n</testsuite>\n</testsuites>`;
}

describe('the JUnit skip parser', () => {
  it('finds a skipped test and names it', () => {
    const found = skippedTests(report(PASSED, SKIPPED, FAILED));
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toContain('bytes going direct (INV-10)');
    expect(found[0]?.suite).toBe('agency/engagement-flow.spec.ts');
  });

  it('counts self-closing testcases, which is what a passing test looks like', () => {
    // The assertion that stops the gate going blind. A parser matching only
    // `<testcase>…</testcase>` sees no passing tests, reports a total of zero,
    // and every run is trivially "complete".
    expect(countTests(report(PASSED, PASSED, SKIPPED))).toBe(3);
  });

  it('does not count a passing test as skipped', () => {
    expect(skippedTests(report(PASSED, PASSED))).toEqual([]);
  });

  it('does not count a failing test as skipped', () => {
    // A failure is loud and already fails the job. Conflating the two would
    // make this gate's message wrong at exactly the moment someone reads it.
    expect(skippedTests(report(FAILED))).toEqual([]);
  });

  it('does not let one testcase swallow the next', () => {
    // The lazy-group hazard `queriesImportedByClientRoutes` was fixed for: a
    // non-greedy `[\s\S]*?` anchored at an earlier element can still span
    // several before it finds a closing tag, so a passing test sitting between
    // two skipped ones gets reported as skipped too.
    const found = skippedTests(report(SKIPPED, PASSED, SKIPPED));
    expect(found).toHaveLength(2);
    for (const t of found) expect(t.name).toContain('INV-10');
  });

  it('reports an empty report as empty rather than as clean', () => {
    // `countTests` returning 0 is what the gate turns into a failure. A suite
    // that ran nothing proved nothing, and it exits 0 while doing so.
    expect(countTests('<testsuites></testsuites>')).toBe(0);
    expect(skippedTests('<testsuites></testsuites>')).toEqual([]);
  });
});
