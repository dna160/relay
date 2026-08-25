/**
 * Types for the e2e completeness check's exported parser.
 *
 * Declared by hand rather than turning `allowJs` on, for the same reason as
 * `check-chunk-purity.d.mts`: one import should not pull every script in this
 * directory into the typecheck.
 */

export interface SkippedTest {
  name: string;
  suite: string;
}

/** Every `<testcase>` in a JUnit report that carries a `<skipped/>` child. */
export declare function skippedTests(report: string): SkippedTest[];

/** How many `<testcase>` elements the report contains at all. */
export declare function countTests(report: string): number;
