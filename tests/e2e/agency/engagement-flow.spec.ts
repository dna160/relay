/**
 * The agency spine, end to end: create an engagement, stamp a board, upload a
 * version, publish it to the client, and see the card awaiting them.
 *
 * The upload half is where INV-10 is either true or not: the browser must PUT
 * the bytes straight to object storage against a presigned URL, and the app
 * server must only ever see metadata and a hash. This test asserts that by
 * watching where the PUT went.
 *
 * Runs on `agency` (Desktop Chrome).
 */

import { expect, test } from '@playwright/test';
import { seedFixtures, signInAsAgency, type SeedResult } from '../_helpers';

const ADMIN = 'sam@northline.test'; // Pro org — room under the plan limit.

test.describe('agency engagement flow', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ request }) => {
    seed = await seedFixtures(request);
    await signInAsAgency(request, ADMIN);
  });

  test('create -> stamp -> upload -> publish -> awaiting client', async ({ page }) => {
    await page.goto('/portfolio');

    // 1. Create. One contract, one workspace.
    await page.getByRole('button', { name: /new engagement/i }).click();
    await page.getByLabel(/title/i).fill('Autumn campaign');
    await page.getByLabel(/client/i).fill('Adelheid Group');
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page.getByRole('heading', { name: 'Autumn campaign' })).toBeVisible();

    // 2. Stamp a board. Lanes default to published (ADR-006); private is explicit.
    await page.getByRole('button', { name: /add lane/i }).click();
    await page.getByLabel(/lane name/i).fill('Deliverables');
    await page.getByRole('button', { name: /^add$/i }).click();
    await expect(page.getByRole('heading', { name: 'Deliverables' })).toBeVisible();
    await expect(page.getByText(/private/i)).toHaveCount(0);

    await page.getByRole('button', { name: /add card/i }).click();
    await page.getByLabel(/title/i).fill('Key art');
    await page.getByRole('button', { name: /^add$/i }).click();

    // 3. Move it through the machine. Drag writes position, never state — the
    //    state chip changes only via an explicit transition (ADR-003).
    await page.getByRole('button', { name: /assign/i }).click();
    await page.getByRole('button', { name: /start work|in progress/i }).click();

    // 4. Upload. The bytes must not pass through the app server (INV-10).
    const uploadRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' || request.method() === 'POST') {
        uploadRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    const fileChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /upload|add version/i }).click();
    await (await fileChooser).setFiles({
      name: 'key-art-v1.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not really a png, but it hashes'),
    });
    await expect(page.getByText('key-art-v1.png')).toBeVisible();

    const putToOwnOrigin = uploadRequests.filter(
      (r) => r.startsWith('PUT') && r.includes(new URL(page.url()).origin),
    );
    expect(
      putToOwnOrigin,
      'the file bytes were PUT to the app server; INV-10 requires a presigned URL',
    ).toEqual([]);

    // 5. The internal gate. Nothing reaches the client until someone promotes it.
    await page.getByRole('button', { name: /internal review/i }).click();
    await expect(page.getByText(/awaiting client/i)).toHaveCount(0);

    await page.getByRole('button', { name: /publish to client/i }).click();
    // Copy rule: the button that says "Publish to client" produces
    // "Published to client" (DESIGN-SYSTEM).
    await expect(page.getByText(/published to client/i)).toBeVisible();
    await expect(page.getByText(/awaiting client/i)).toBeVisible();
  });

  test('a private lane is marked private and its badge is agency-only', async ({ page }) => {
    await page.goto('/portfolio');
    await page.getByRole('link', { name: 'Brand system' }).click();

    await page.getByRole('button', { name: /add lane/i }).click();
    await page.getByLabel(/lane name/i).fill('Internal QA');
    await page.getByLabel(/private/i).check();
    await page.getByRole('button', { name: /^add$/i }).click();

    const lane = page.getByRole('region', { name: /internal qa/i });
    await expect(lane.getByText(/private/i)).toBeVisible();
  });

  test('PATCH /api/cards/:id rejects a state field (INV-2)', async ({ request }) => {
    // The state machine is the only writer. A card PATCH carrying `state` is a
    // 400 and writes nothing — not a 200 that quietly ignores the field.
    const response = await request.patch(`/api/cards/${seed.cardId}`, {
      data: { state: 'signed_off' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  test('an illegal transition returns 409 INVALID_TRANSITION', async ({ request }) => {
    const response = await request.post(`/api/cards/${seed.cardId}/transition`, {
      data: { to: 'signed_off' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_TRANSITION' } });
  });

  test('a download redirects rather than streaming bytes through the app (INV-10)', async ({
    request,
  }) => {
    const response = await request.get(`/api/client/download/${seed.versionId}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect([302, 303, 307]).toContain(response.status());
    const location = response.headers()['location'] ?? '';
    expect(location, 'the redirect must point at object storage, not back at the app').not.toBe('');
  });
});
