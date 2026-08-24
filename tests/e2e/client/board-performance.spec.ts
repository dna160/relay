/**
 * The non-functional requirement with a number on it.
 *
 * ARCHITECTURE.md: "Client board first contentful paint under 1.5s on 4G — it
 * is the acquisition surface and the client is not motivated."
 *
 * A budget nobody measures is a wish. This throttles the network to a 4G
 * profile through CDP, loads the client board cold, and reads First Contentful
 * Paint out of the paint timeline. It runs on `client-mobile`, which is
 * Chromium, so CDP is available.
 */

import { expect, test } from '@playwright/test';
import { seedFixtures, type SeedResult } from '../_helpers';

/** ARCHITECTURE.md non-functional requirements. */
const FCP_BUDGET_MS = 1_500;

/**
 * Regular 4G, the profile Chrome DevTools ships: 4 Mbps down, 3 Mbps up, 20ms
 * RTT extra latency. Deliberately not "Slow 3G" — the NFR names 4G, and a
 * budget tested against a harsher profile than the one it promises is a budget
 * that will be quietly relaxed the first time it fails.
 */
const FOUR_G = {
  offline: false,
  downloadThroughput: (4 * 1024 * 1024) / 8,
  uploadThroughput: (3 * 1024 * 1024) / 8,
  latency: 20,
};

test.describe('client board performance', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ request }) => {
    seed = await seedFixtures(request);
  });

  test('first contentful paint stays under 1.5s on a throttled 4G profile', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CDP network emulation is Chromium-only');

    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', FOUR_G);
    // A cold load. The client opens this link once and has no warm cache.
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });

    await page.goto(`/e/${seed.engagementToken}`, { waitUntil: 'load' });

    const fcp = await page.evaluate(() => {
      const entry = performance.getEntriesByName('first-contentful-paint')[0];
      return entry ? entry.startTime : null;
    });

    expect(fcp, 'no first-contentful-paint entry was recorded').not.toBeNull();
    expect(
      fcp!,
      `client board FCP was ${Math.round(fcp ?? 0)}ms on 4G; the NFR is ${FCP_BUDGET_MS}ms`,
    ).toBeLessThan(FCP_BUDGET_MS);
  });

  test('the client bundle carries no agency route code', async ({ page }) => {
    // PHASE-4 EXIT: "the client bundle contains no agency route code." Checked
    // by looking at what the page actually downloaded, not at the import graph.
    const scripts: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (/\.js(\?|$)/.test(url)) scripts.push(url);
    });

    await page.goto(`/e/${seed.engagementToken}`, { waitUntil: 'networkidle' });

    const agencyChunks = scripts.filter((s) => /portfolio|templates|agency|backstage/i.test(s));
    expect(agencyChunks, `agency chunks in the client bundle: ${agencyChunks.join(', ')}`).toEqual([]);
  });

  test('the board is usable at 360px, the design system floor', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/e/${seed.engagementToken}`);

    // Nothing may overflow horizontally. A board a client has to pan sideways
    // on their phone is a board they close.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, 'the client board scrolls horizontally at 360px').toBe(false);
  });
});
