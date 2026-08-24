/**
 * PHASE-4 EXIT — "a Playwright run completes invite -> verify -> approve without
 * ever touching an agency route."
 *
 * The interesting half of that sentence is the second half. A flow that reaches
 * an approval has proved the feature works; a flow that reaches an approval
 * *and* provably never requested an agency route has proved the bundle split is
 * real. So this test records every same-origin request the page makes and
 * asserts on the whole set at the end — the route-level claim, not the outcome.
 *
 * Runs on `client-mobile` (Pixel 7). The client opens this link on a phone.
 */

import { expect, test } from '@playwright/test';
import { RouteRecorder, latestClientCode, seedFixtures, type SeedResult } from '../_helpers';

// The invite is issued by the agency out of band; the client's flow starts at
// the link in their inbox. The token comes back from the seed endpoint.
const CONTACT_EMAIL = 'rowan@bellweather.test';

test.describe('the client completes a decision without agency chrome', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ request }) => {
    seed = await seedFixtures(request);
  });

  test('invite -> verify -> approve, touching no agency route', async ({ page, request, baseURL }) => {
    expect(baseURL, 'baseURL must be configured').toBeTruthy();
    const recorder = new RouteRecorder(page, baseURL!);

    // 1. The link. No account, no password, no signup (ADR-005).
    await page.goto(`/e/${seed.engagementToken}`);

    // 2. Verify. Email in, code back, session scoped to one engagement (INV-6).
    await page.getByLabel(/email/i).fill(CONTACT_EMAIL);
    await page.getByRole('button', { name: /continue|send|verify/i }).click();

    const code = await latestClientCode(request, seed.engagementToken, CONTACT_EMAIL);
    await page.getByLabel(/code/i).fill(code);
    await page.getByRole('button', { name: /verify|continue/i }).click();

    // 3. The board. Published lanes only — the private lane must not be here,
    //    and neither must the draft card or the unpublished third version.
    await expect(page.getByRole('heading', { name: 'Deliverables' })).toBeVisible();
    await expect(page.getByText('Internal QA')).toHaveCount(0);
    await expect(page.getByText('Unstarted deliverable')).toHaveCount(0);
    await expect(page.getByText('key-art-v3-WIP-DO-NOT-SEND.png')).toHaveCount(0);

    // 4. The decision queue, then the decision itself.
    await page.getByRole('link', { name: /awaiting you|queue/i }).click();
    await page.getByRole('button', { name: /^approve$/i }).click();

    // 5. The card is approved and no longer awaits the client.
    await expect(page.getByText(/approved/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(0);

    // The exit condition, asserted at the route level.
    expect(
      recorder.agencyPaths(),
      `client flow touched agency routes. All paths: ${recorder.unique().join(', ')}`,
    ).toEqual([]);
  });

  test('requesting changes needs a note and the button stays disabled without one', async ({
    page,
    request,
  }) => {
    await page.goto(`/e/${seed.engagementToken}`);
    await page.getByLabel(/email/i).fill(CONTACT_EMAIL);
    await page.getByRole('button', { name: /continue|send|verify/i }).click();
    const code = await latestClientCode(request, seed.engagementToken, CONTACT_EMAIL);
    await page.getByLabel(/code/i).fill(code);
    await page.getByRole('button', { name: /verify|continue/i }).click();

    await page.getByRole('button', { name: /request changes/i }).click();
    // DESIGN-SYSTEM: "disabled until the note has content".
    await expect(page.getByRole('button', { name: /send|submit|request/i })).toBeDisabled();
    await page.getByRole('textbox', { name: /note|what.*change/i }).fill('The logo reads too small.');
    await expect(page.getByRole('button', { name: /send|submit|request/i })).toBeEnabled();
  });

  test('a client session for one engagement cannot reach another (INV-6)', async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto(`/e/${seed.engagementToken}`);
    await page.getByLabel(/email/i).fill(CONTACT_EMAIL);
    await page.getByRole('button', { name: /continue|send|verify/i }).click();
    const code = await latestClientCode(request, seed.engagementToken, CONTACT_EMAIL);
    await page.getByLabel(/code/i).fill(code);
    await page.getByRole('button', { name: /verify|continue/i }).click();

    // The same person, a different engagement, and a session that must not widen.
    const response = await page.request.get(`${baseURL}/e/${seed.otherEngagementToken}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    // Either a 404 or a fresh verify prompt. Never the second board, and never
    // a 403 — a 403 confirms the engagement exists (API-CONTRACT).
    expect(response.status(), 'a 403 leaks the existence of the other engagement').not.toBe(403);
    expect([200, 302, 404]).toContain(response.status());
    if (response.status() === 200) {
      await expect(page.getByText('Packaging refresh')).toHaveCount(0);
    }
  });

  test('the free export is reachable and never paywalled', async ({ page, request }) => {
    // PRD §5.6: the client's export is free, on every plan, always. It is the
    // thing that makes the purge safe to ship.
    await page.goto(`/e/${seed.engagementToken}`);
    await page.getByLabel(/email/i).fill(CONTACT_EMAIL);
    await page.getByRole('button', { name: /continue|send|verify/i }).click();
    const code = await latestClientCode(request, seed.engagementToken, CONTACT_EMAIL);
    await page.getByLabel(/code/i).fill(code);
    await page.getByRole('button', { name: /verify|continue/i }).click();

    const exportLink = page.getByRole('link', { name: /export/i });
    await expect(exportLink).toBeVisible();
    const response = await page.request.get('/api/client/export', { failOnStatusCode: false });
    expect(response.status(), 'the client export must never return 402').not.toBe(402);
  });
});
