#!/usr/bin/env node
/**
 * The client board's First Contentful Paint, measured and gated.
 *
 * ARCHITECTURE's non-functional requirement is "client board FCP under 1.5s on
 * 4G". That was a sentence in a document. A sentence in a document is not a
 * budget — nothing failed when it was missed, and nobody knew the number. This
 * measures it on a throttled profile and exits non-zero when it is over, which
 * is the difference between a budget and a note.
 *
 * ## Why it is a script and not a Playwright spec
 *
 * `tests/e2e/**` belongs to the front-end agent finishing the client flow. This
 * needs to be a gate that CI runs and a number an operator can reproduce, so it
 * drives Chromium through Playwright's Node API directly and owns its own
 * plumbing.
 *
 * ## What "4G" means here, exactly
 *
 * Chrome DevTools' **Slow 4G** preset — 1.6 Mbit/s down, 750 kbit/s up, 150 ms
 * RTT — plus 4x CPU throttling. That is the conservative reading of "4G": it is
 * a phone on a real cell network with a mid-range processor, which is the
 * client in the PRD, not a laptop on office wifi with the word 4G written on
 * it. The numbers are stated here rather than referenced by preset name so that
 * a Chrome release renaming a preset cannot silently move the budget.
 *
 * ## Why the median of several runs
 *
 * A single navigation on a throttled connection is noisy enough that one run
 * can be 300 ms either side of the truth, which would make this gate flake and
 * then be deleted. It takes the median of RUNS navigations.
 *
 * Usage:
 *   node .github/scripts/check-fcp-budget.mjs            # gate
 *   node .github/scripts/check-fcp-budget.mjs --report   # print, never fail
 *
 * Requires a running production server (`next build && next start`) and a
 * `DATABASE_URL` this process may reseed.
 */

import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** ARCHITECTURE NFR. Milliseconds. */
const BUDGET_MS = Number(process.env.FCP_BUDGET_MS ?? 1500);
const RUNS = Number(process.env.FCP_RUNS ?? 5);

/** A published lane from `tests/fixtures/board.ts`. Present only on the real board. */
const BOARD_MARKER = process.env.FCP_BOARD_MARKER ?? 'Deliverables';

/** Chrome DevTools "Slow 4G", spelled out. */
const NETWORK = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};
const CPU_SLOWDOWN = 4;

const reportOnly = process.argv.includes('--report');

function die(message) {
  console.error(`\nFAIL — ${message}`);
  process.exit(reportOnly ? 0 : 1);
}

/**
 * Seeds and obtains a verified client session.
 *
 * Delegates to `tests/fcp-session.ts`, which reaches the seed and the session
 * signer directly. It cannot go over HTTP: this gate measures a production
 * build, and `/api/test/*` is unmounted when `NODE_ENV === 'production'` — as
 * it must be. Measuring a dev server instead would be the easy alternative and
 * a worthless one: unminified, unbundled, compiled on demand. The number would
 * not be the number.
 */
function clientSession() {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fcp-session.ts'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    die(`tests/fcp-session.ts failed:\n${(result.stderr || result.stdout || '').slice(-800)}`);
  }
  const line = result.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    die(`tests/fcp-session.ts printed no JSON:\n${result.stdout.slice(-400)}`);
  }
  if (!parsed.engagementToken || !parsed.cookieValue) die('the session helper returned an incomplete session');
  return parsed;
}

/** One cold navigation. Returns FCP in milliseconds. */
async function measure(browser, url, cookieValue) {
  const context = await browser.newContext({
    // A phone, because the client is on one. Matches the client-mobile project.
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  await context.addCookies([
    {
      name: 'relay_client_session',
      value: cookieValue,
      url: BASE,
    },
  ]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

  const response = await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
  if (!response || response.status() >= 400) {
    await context.close();
    die(`${url} returned ${response ? response.status() : 'no response'} — measuring an error page proves nothing`);
  }

  const fcp = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const existing = performance.getEntriesByName('first-contentful-paint')[0];
        if (existing) {
          resolve(existing.startTime);
          return;
        }
        new PerformanceObserver((list, observer) => {
          for (const entry of list.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              observer.disconnect();
              resolve(entry.startTime);
            }
          }
        }).observe({ type: 'paint', buffered: true });
        setTimeout(() => resolve(-1), 45_000);
      }),
  );
  /**
   * Prove it measured the board.
   *
   * An unauthenticated request to this URL renders the sign-in form, which
   * paints faster than the board and would produce a comfortable, meaningless
   * number. The existing e2e performance spec measures exactly that page. So
   * the run is only counted if the board actually rendered: a published lane
   * from the fixtures has to be in the DOM, and the URL has to still be the
   * board rather than a redirect to verify.
   */
  await page.waitForLoadState('domcontentloaded');
  const landed = page.url();
  const html = await page.content();
  if (!landed.endsWith('/board')) {
    await context.close();
    die(`the board redirected to ${landed} — the session cookie was not accepted`);
  }
  if (!html.includes(BOARD_MARKER)) {
    await context.close();
    die(
      `the rendered page does not contain ${JSON.stringify(BOARD_MARKER)}, so this is not the ` +
        'client board. Measuring a sign-in form instead of the board is how an FCP budget ' +
        'passes while proving nothing.',
    );
  }

  await context.close();
  return fcp;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const { engagementToken, cookieValue } = clientSession();
const url = new URL(`/e/${engagementToken}/board`, BASE).toString();

const browser = await chromium.launch();
const samples = [];
try {
  for (let i = 0; i < RUNS; i += 1) {
    const fcp = await measure(browser, url, cookieValue);
    if (fcp < 0) die('the board never reported a first-contentful-paint');
    samples.push(fcp);
  }
} finally {
  await browser.close();
}

const p50 = median(samples);
const worst = Math.max(...samples);

console.log('client board — First Contentful Paint');
console.log(`  profile   Slow 4G (1.6 Mbit/s down, 750 kbit/s up, 150 ms RTT), CPU 4x, Pixel 7 viewport`);
console.log(`  url       ${url.replace(engagementToken, '<token>')}`);
console.log(`  samples   ${samples.map((s) => `${Math.round(s)}ms`).join(', ')}`);
console.log(`  median    ${Math.round(p50)}ms`);
console.log(`  worst     ${Math.round(worst)}ms`);
console.log(`  budget    ${BUDGET_MS}ms  (ARCHITECTURE NFR: client board FCP under 1.5s on 4G)`);

if (p50 > BUDGET_MS) {
  die(
    `median FCP ${Math.round(p50)}ms exceeds the ${BUDGET_MS}ms budget by ${Math.round(p50 - BUDGET_MS)}ms.\n` +
      '  This is a budget, not a note: make the board faster or change the NFR out loud.',
  );
}

console.log(`\nOK — ${Math.round(BUDGET_MS - p50)}ms of headroom.`);
