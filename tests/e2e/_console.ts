/**
 * Watching the browser console for the faults that do not fail a test on their
 * own.
 *
 * Split out of `_helpers.ts` for the same reason `routes.ts` was: it imports
 * nothing from the app, and both Playwright projects use it.
 *
 * The fault this exists for is React's:
 *
 *   "A tree hydrated but some attributes of the server rendered HTML didn't
 *    match the client properties. This won't be patched up."
 *
 * The last sentence is the whole reason it is worth a test. React does not
 * repair that subtree — it leaves the server's DOM in place with no client
 * behaviour attached, so the links and buttons inside it are *present, correct
 * in the HTML, and inert*. Nothing throws. The page looks right in a
 * screenshot and right in an accessibility snapshot. What it looks like from a
 * test is a `click()` that times out on an element the snapshot proves is
 * there, thirty seconds later, in a test that is about something else
 * entirely.
 *
 * So a console watcher is not belt-and-braces here. It is the only place the
 * fault names itself.
 */

import { expect, type Page } from '@playwright/test';

/**
 * Console text that means a hydration fault.
 *
 * Matched on React's own wording rather than on `console.error` generally,
 * because the dev server is entitled to log. In particular the three
 * `/fonts/*.woff2` 404s on every page are expected until the faces are
 * self-hosted — `src/app/layout.tsx` says so and the `@font-face` rules fall
 * through to the CDN — and a watcher that flagged them would be turned off
 * within a week.
 */
const HYDRATION_SIGNATURES: readonly RegExp[] = [
  /hydrat/i,
  /did not match/i,
  /server rendered HTML/i,
  /won't be patched up/i,
  /text content does not match/i,
];

function isHydrationFault(text: string): boolean {
  return HYDRATION_SIGNATURES.some((re) => re.test(text));
}

export interface ConsoleWatch {
  /** Every hydration-shaped message seen since the watch started. */
  faults(): string[];
  /** Fails with the message itself, which names the component and attribute. */
  assertClean(context: string): void;
}

/**
 * Starts watching `page` immediately. Attach before the first `goto` — React
 * hydrates once, and a listener added afterwards has already missed it.
 */
export function watchConsole(page: Page): ConsoleWatch {
  const seen: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = message.text();
    if (isHydrationFault(text)) seen.push(text);
  });

  // React surfaces some hydration failures as a thrown error rather than a
  // logged one, depending on whether the mismatch is recoverable.
  page.on('pageerror', (error) => {
    if (isHydrationFault(error.message)) seen.push(error.message);
  });

  return {
    faults: () => [...seen],
    assertClean(context: string) {
      expect(
        seen,
        `hydration mismatch on ${context}. React abandons the subtree it hydrated, ` +
          'so controls inside it are rendered but inert. The message names the ' +
          `component and the attribute:\n${seen.join('\n')}`,
      ).toEqual([]);
    },
  };
}
