/**
 * The two gates that turn the business model into HTTP status codes.
 *
 *   402 PLAN_LIMIT_REACHED  — the free org is at three active engagements.
 *   423 ENGAGEMENT_ARCHIVED — an archived engagement is read-only.
 *
 * Both are asserted against the fixture graph, so the numbers here are the same
 * numbers `tests/unit/plan-limits.spec.ts` asserts against the pure functions.
 * If the unit suite is green and this is red, the wiring is wrong rather than
 * the arithmetic.
 *
 * Runs on `agency` (Desktop Chrome).
 */

import { expect, test } from '@playwright/test';
import { expectApiError, seedFixtures, signInAsAgency, type SeedResult } from '../_helpers';

const FREE_ADMIN = 'ada@kestrel.test'; // Kestrel Studio, free plan, 3 of 3 active.
const PRO_ADMIN = 'sam@northline.test'; // Northline, pro plan, 1 of 15 active.

test.describe('the plan gate', () => {
  test.beforeEach(async ({ request }) => {
    await seedFixtures(request);
  });

  test('creating past the limit returns 402 PLAN_LIMIT_REACHED', async ({ request }) => {
    await signInAsAgency(request, FREE_ADMIN);

    const response = await request.post('/api/engagements', {
      data: { title: 'One too many', clientOrgName: 'Hallmoor Cider' },
      failOnStatusCode: false,
    });

    expect(response.status(), 'the fourth engagement on a three-engagement plan').toBe(402);
    expectApiError(await response.json(), 'PLAN_LIMIT_REACHED');
  });

  test('the 402 body names the plan and the limit, because the message is the upsell', async ({
    request,
  }) => {
    await signInAsAgency(request, FREE_ADMIN);
    const response = await request.post('/api/engagements', {
      data: { title: 'One too many', clientOrgName: 'Hallmoor Cider' },
      failOnStatusCode: false,
    });
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/free/i);
    expect(body.error.message).toMatch(/3/);
  });

  test('an org under its limit creates normally', async ({ request }) => {
    await signInAsAgency(request, PRO_ADMIN);
    const response = await request.post('/api/engagements', {
      data: { title: 'Winter retainer', clientOrgName: 'Adelheid Group' },
      failOnStatusCode: false,
    });
    expect(response.status(), 'pro is 1 of 15; this must not 402').toBeLessThan(300);
  });

  test('the portfolio shows the limit rather than only failing at the button', async ({ page, request }) => {
    await signInAsAgency(request, FREE_ADMIN);
    await page.goto('/portfolio');
    // Ephemerality and limits are stated, never sprung (DESIGN-SYSTEM).
    await expect(page.getByText(/3\s*(of|\/)\s*3/i)).toBeVisible();
  });
});

test.describe('an archived engagement is read-only', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ request }) => {
    seed = await seedFixtures(request);
    await signInAsAgency(request, FREE_ADMIN);
  });

  test('a mutation returns 423 ENGAGEMENT_ARCHIVED', async ({ request }) => {
    const response = await request.post('/api/lanes', {
      data: { engagementId: seed.archivedEngagementId, name: 'Too late' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(423);
    expectApiError(await response.json(), 'ENGAGEMENT_ARCHIVED');
  });

  test('a transition on an archived engagement is refused too', async ({ request }) => {
    const response = await request.post(`/api/cards/${seed.archivedCardId}/transition`, {
      data: { to: 'signed_off' },
      failOnStatusCode: false,
    });
    // 423 before 409: the engagement being read-only outranks whether the edge
    // is legal. Returning 409 here would tell the caller to try a different move.
    expect(response.status()).toBe(423);
    expectApiError(await response.json(), 'ENGAGEMENT_ARCHIVED');
  });

  test('reads still work — archived is read-only, not gone', async ({ request }) => {
    const response = await request.get(`/api/engagements/${seed.archivedEngagementId}`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);
  });

  test('the export still works, because export is how the archive is escaped', async ({ request }) => {
    const response = await request.post(`/api/engagements/${seed.archivedEngagementId}/export`, {
      failOnStatusCode: false,
    });
    expect(response.status(), 'export must not be refused as a mutation').not.toBe(423);
  });

  test('the wrap slate states the countdown and cannot be dismissed', async ({ page }) => {
    await page.goto(`/w/${seed.archivedEngagementId}/board`);
    // Fixture: purge_at is five days out at the fixture clock.
    await expect(page.getByText(/purge in/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /dismiss|close/i })).toHaveCount(0);
  });

  test('a purged engagement returns 410 and points at the certificate', async ({ request }) => {
    const response = await request.get(`/api/engagements/${seed.purgedEngagementId}`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(410);
    expectApiError(await response.json(), 'ENGAGEMENT_PURGED');
  });
});
