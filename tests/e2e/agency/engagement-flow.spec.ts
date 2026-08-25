/**
 * The agency spine, end to end: create an engagement, stamp a board, move a
 * deliverable to the internal gate, upload a version, publish it to the client,
 * and see the card awaiting them.
 *
 * The upload half is where INV-10 is either true or not: the browser must PUT
 * the bytes straight to object storage against a presigned URL, and the app
 * server must only ever see metadata and a hash. That half is a separate test
 * and it is **conditioned on object storage existing**, because an assertion
 * that "no PUT reached the app server" is satisfied just as well by no PUT
 * happening at all. A byte-path proof that passes when there is no byte path is
 * not a proof, and it is the same failure shape as DEFECT-7.
 *
 * Runs on `agency` (Desktop Chrome).
 */

import { expect, test, type Page } from '@playwright/test';
import { seedFixtures, signInAsAgency, type SeedResult } from '../_helpers';

const ADMIN = 'sam@northline.test'; // Pro org — room under the plan limit.

/**
 * The org that owns `seed.cardId`.
 *
 * The fixture card lives on `ENGAGEMENT.active`, which belongs to Kestrel
 * Studio and not to Northline. A test about the *state machine* has to be
 * signed in as the org holding the card, or the route answers 404 on tenancy
 * long before an edge is evaluated — see the pair of transition tests below.
 */
const CARD_OWNER_ADMIN = 'ada@kestrel.test';

/**
 * Whether this run can exercise the byte path.
 *
 * Presigning needs credentials; the PUT that follows needs something at the
 * other end of the URL. Neither `docker-compose.yml` nor the `e2e` CI job
 * currently provides an S3-compatible service, so the upload flow is skipped
 * with its reason rather than passing vacuously. Owner: whoever adds a MinIO
 * service to the compose file and the CI job — the tests below are written and
 * will run the moment it exists.
 */
const HAS_OBJECT_STORAGE = Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID);

/**
 * Create an engagement, stamp one published lane, and put one deliverable in
 * it. Both tests below need this and neither is about it.
 *
 * The labels here are the product's words, not the database's. The title field
 * asks "What is being delivered?" because that names the thing the person is
 * creating; `title` is what the column is called and nobody filling in this
 * form is thinking about a column.
 */
async function stampABoard(page: Page, title: string): Promise<void> {
  await page.goto('/portfolio');

  // 1. Create. One contract, one workspace.
  await page.getByRole('button', { name: /new engagement/i }).click();
  await page.getByLabel(/what is being delivered/i).fill(title);
  await page.getByLabel(/client/i).fill('Adelheid Group');
  await page.getByRole('button', { name: /create engagement/i }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  // 2. Stamp a board. Lanes default to published (ADR-006); private is explicit.
  await page.getByRole('button', { name: /add a lane/i }).click();
  await page.getByLabel(/lane name/i).fill('Deliverables');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByRole('heading', { name: 'Deliverables' })).toBeVisible();

  /*
    Published by default, asserted at the badge rather than at the word.

    `getByText(/private/i)` used to stand here and it matched the lane's own
    visibility control, which reads "Make private" — a published lane offering
    the way to hide it. The fact under test is that the new lane carries no
    PRIVATE stamp, so the assertion is against the stamp: exact, uppercase, and
    scoped to the lane it is about.
  */
  const lane = page.getByRole('region', { name: 'Deliverables' });
  await expect(lane.getByText('PRIVATE', { exact: true })).toHaveCount(0);

  await lane.getByRole('button', { name: /add a deliverable/i }).click();
  await page.getByLabel(/deliverable title/i).fill('Key art');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByRole('link', { name: 'Key art' })).toBeVisible();
}

test.describe('agency engagement flow', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ page, request }) => {
    seed = await seedFixtures(request);
    // `page` too: the browser has its own cookie jar. See `signInAsAgency`.
    await signInAsAgency(request, ADMIN, page);
  });

  test('create -> stamp -> move to the internal gate', async ({ page }) => {
    await stampABoard(page, 'Autumn campaign');

    // Move it through the machine. Drag writes position, never state — the
    // state chip changes only via an explicit transition (ADR-003).
    await page.getByRole('button', { name: /^assign$/i }).click();
    await page.getByRole('button', { name: /start work/i }).click();
    await page.getByRole('button', { name: /send to internal review/i }).click();

    // The internal gate. Nothing reaches the client until someone promotes it,
    // and reaching `internal_review` is not promotion.
    await expect(page.getByRole('button', { name: /publish to client/i })).toBeVisible();
    await expect(page.getByText(/awaiting client/i)).toHaveCount(0);
  });

  test('upload -> publish -> awaiting client, with the bytes going direct (INV-10)', async ({
    page,
  }) => {
    test.skip(
      !HAS_OBJECT_STORAGE,
      'No object storage in this environment: S3_ENDPOINT and S3_ACCESS_KEY_ID are unset, so ' +
        'the presign 500s and no PUT is ever made. Asserting "no PUT reached the app server" ' +
        'against a run with no PUT in it would be a green light for an absent byte path.',
    );

    await stampABoard(page, 'Winter campaign');

    // The upload lives on the card, beside the version stack it appends to.
    await page.getByRole('link', { name: 'Key art' }).click();
    await page.waitForURL(/\/c\/[^/]+$/);

    await page.getByRole('button', { name: /^assign$/i }).click();
    await page.getByRole('button', { name: /start work/i }).click();

    const uploads: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT') uploads.push(request.url());
    });

    const fileChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /upload a version/i }).click();
    await (await fileChooser).setFiles({
      name: 'key-art-v1.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not really a png, but it hashes'),
    });
    await expect(page.getByText('key-art-v1.png')).toBeVisible();

    /*
      Wait for the phase, not for the filename.

      The row appears at `queued`, before a byte has moved, so reading the PUT
      list at that moment measures a request still in flight and reports "the
      byte path did not run" for an upload that was about to run. The panel
      names its four phases precisely so that a reader — and a test — can tell
      "nothing happened" from "not yet".
    */
    await expect(page.getByText('Done', { exact: true })).toBeVisible({ timeout: 30_000 });

    const origin = new URL(page.url()).origin;
    /*
      Both halves, and the positive one first. "Nothing was PUT to the app
      server" is only worth reading once "something was PUT somewhere" is
      established — otherwise the assertion is measuring an empty list.
    */
    expect(uploads, 'no PUT was made at all; the byte path did not run').not.toEqual([]);
    expect(
      uploads.filter((url) => url.startsWith(origin)),
      'the file bytes were PUT to the app server; INV-10 requires a presigned URL',
    ).toEqual([]);

    // The internal gate. A version exists but the client cannot see it yet.
    await page.getByRole('button', { name: /send to internal review/i }).click();
    await expect(page.getByText(/awaiting client/i)).toHaveCount(0);

    await page.getByRole('button', { name: /publish to client/i }).click();
    // Copy rule: the control that says "Publish to client" produces
    // "Published to client" (DESIGN-SYSTEM, and `useAction`'s `done`).
    await expect(page.getByText(/published to client/i)).toBeVisible();
    await expect(page.getByText(/awaiting client/i).first()).toBeVisible();
  });

  test('a private lane is marked private and its badge is agency-only', async ({ page }) => {
    await page.goto('/portfolio');
    // Northline's own engagement. The portfolio lists it because this session
    // is Northline's — the link is there, and the click below has never been
    // the thing that failed here.
    await page.getByRole('link', { name: 'Brand system' }).click();

    /*
      `Add a lane`, not `add lane`.

      The control has said "Add a lane" since it was written; the regex was
      written for a name nobody chose, so the click timed out thirty seconds
      later on an empty board that was rendering the button the whole time. The
      copy is the product's and it is the better of the two: an article makes it
      a thing being added rather than a database verb.
    */
    await page.getByRole('button', { name: /add a lane/i }).click();
    await page.getByLabel(/lane name/i).fill('Internal QA');
    await page.getByLabel(/private/i).check();
    await page.getByRole('button', { name: /^add$/i }).click();

    const lane = page.getByRole('region', { name: /internal qa/i });
    await expect(lane.getByText('PRIVATE', { exact: true })).toBeVisible();
  });

  test('PATCH /api/cards/:id rejects a state field (INV-2)', async ({ request }) => {
    // The state machine is the only writer. A card PATCH carrying `state` is a
    // 400 and writes nothing — not a 200 that quietly ignores the field.
    //
    // Answered on the schema, before the row is read, which is why this one is
    // indifferent to which org is signed in.
    const response = await request.patch(`/api/cards/${seed.cardId}`, {
      data: { state: 'signed_off' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  test('an illegal transition returns 409 INVALID_TRANSITION', async ({ request }) => {
    /*
      Signed in as the org that *owns* the card.

      This spec's `beforeEach` signs in as Northline, and `seed.cardId` belongs
      to Kestrel. The route resolved that first and answered 404, correctly, and
      the test read the 404 as a missing state machine. It was the most
      interesting failure of the five: it would have gone green if tenancy were
      broken, which makes it a test that could only ever have passed for the
      wrong reason. The tenancy half now has a test of its own, below.
    */
    await signInAsAgency(request, CARD_OWNER_ADMIN);

    const response = await request.post(`/api/cards/${seed.cardId}/transition`, {
      // `engagementId` per API-CONTRACT amendment A5: an agency mutation names
      // its engagement in the body so the authorisation check has a subject
      // before any row is read. Without it the route answers 400
      // VALIDATION_FAILED and this test asserts the schema rather than the
      // state machine — it went red for the wrong reason for a whole round.
      data: { engagementId: seed.engagementId, to: 'signed_off' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_TRANSITION' } });
  });

  test('a card in another org answers 404 before the state machine is consulted', async ({
    request,
  }) => {
    /*
      The same call as the test above, from Northline, whose card this is not.

      404 and never 403: a 403 would confirm the card exists (API-CONTRACT), and
      a 409 would be worse still — it would disclose the card's current state to
      an org that cannot see the card at all. Tenancy answers first, and the
      answer is indistinguishable from "no such card".
    */
    const response = await request.post(`/api/cards/${seed.cardId}/transition`, {
      data: { engagementId: seed.engagementId, to: 'signed_off' },
      failOnStatusCode: false,
    });
    expect(response.status(), 'another org must not learn the card exists').toBe(404);
    expect(await response.json()).not.toMatchObject({ error: { code: 'INVALID_TRANSITION' } });
  });

  test('a client download route is closed to an agency session', async ({ request }) => {
    /*
      `/api/client/download/:versionId` takes its engagement from a *client*
      session and nothing else (API-CONTRACT: "Client routes take the engagement
      from the session, never from the request body"). An agency session is not
      one, so this is 404 — and the INV-10 redirect it would otherwise perform
      is asserted where a client session exists, in
      `tests/e2e/client/invite-verify-approve.spec.ts`.

      This spec used to make that assertion here, with an agency session, and
      read the 404 as a broken redirect. The agency does not need a download
      route of its own to fix it: the API contract defines none, the agency's
      way out of a workspace is `POST /api/engagements/:id/export`, and inventing
      an endpoint so that a misplaced test can pass is how a contract stops being
      a contract.
    */
    const response = await request.get(`/api/client/download/${seed.versionId}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(response.status(), 'an agency session must not open a client download').toBe(404);
  });
});
