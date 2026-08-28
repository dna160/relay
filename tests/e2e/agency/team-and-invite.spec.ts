/**
 * The round trip the feature *is*: an organisation grows by one, and the
 * assignee picker stops collapsing.
 *
 * ## Why this is an e2e and could not be anything smaller
 *
 * Four of the five claims below are only true of a running application:
 *
 *   1. **The preview comes before anything is asked for.** A unit test can
 *      assert what `InviteFacts` renders; only a browser with no cookies can
 *      assert that a stranger sees it *first*, without a sign-in form in front.
 *   2. **A mail scanner does not spend the code.** `/signin/confirm` renders a
 *      button and POSTs on press. The property is about what the page does
 *      *not* do on load, and the only honest way to check an absence is to
 *      fetch the page and then look at the token.
 *   3. **A mismatched address is refused and the invitation survives.** Two
 *      sessions, one token, and a database row afterwards.
 *   4. **The picker's multi-member branch.** `AssigneePicker` collapses to a
 *      single "Assign to me" button when the org has one member — a deliberate
 *      special case, written against an org that *could* only have one, and
 *      never once exercised against a real second member until Phase 10 made
 *      one possible. This test is the first thing that executes that branch,
 *      and it asserts on the option list rather than on a screenshot, because
 *      what matters is that the second person is offered and is named.
 *
 * The fifth is the one that would embarrass us fastest: an invited colleague
 * has a **null `users.name`** by construction, and the picker used to render
 * `name ?? ''`. The first thing a new member would see is their own name
 * missing from the card they were just handed. The option list is asserted to
 * carry their address, not an empty string and not an id.
 *
 * Runs on `agency` (Desktop Chrome).
 */

import { expect, test, type APIRequestContext } from '@playwright/test';
import { seedFixtures, signInAsAgency } from '../_helpers';

/** Kestrel Studio: free plan, and — until this test runs — exactly one member. */
const OWNER = 'ada@kestrel.test';
const ORG_ID = '0193a5f0-a101-7000-8000-a1a1a1a10101';
const COLLEAGUE = 'newcolleague@kestrel.test';
const SOMEBODY_ELSE = 'sam@northline.test';

/**
 * Issues an invitation through the real route and returns the link the route
 * hands back.
 *
 * `inviteUrl` is returned by `POST /api/orgs/:id/invites` to the person who
 * just created it, so the test reads it the same way the agency does rather
 * than reaching into the database or scraping an email capture.
 */
async function invite(
  request: APIRequestContext,
  email: string,
): Promise<{ url: string; token: string }> {
  const response = await request.post(`/api/orgs/${ORG_ID}/invites`, {
    data: { email, role: 'member' },
  });
  expect(response.status(), 'POST /api/orgs/:id/invites').toBe(201);
  const body = (await response.json()) as { inviteUrl?: string };
  const url = body.inviteUrl;
  expect(typeof url, 'the route returns the link so the agency can resend it').toBe('string');
  const token = String(url).split('/invite/')[1] ?? '';
  expect(token.length, 'the invite link carries a token').toBeGreaterThan(10);
  return { url: String(url), token };
}

test.describe('inviting a teammate', () => {
  test.beforeEach(async ({ request }) => {
    await seedFixtures(request);
  });

  test('the preview names who, what and which role before asking for anything', async ({
    browser,
    request,
  }) => {
    await signInAsAgency(request, OWNER);
    const { url } = await invite(request, COLLEAGUE);

    // A genuinely fresh context: no session, no storage. This is the person
    // holding the emailed link, and it is the only way to prove the preview is
    // not behind a sign-in.
    const stranger = await browser.newContext();
    const page = await stranger.newPage();
    await page.goto(url);

    await expect(
      page.getByRole('heading', { name: /Kestrel Studio/i }),
      'the target organisation, named before anything is asked for',
    ).toBeVisible();
    await expect(page.getByText(/Ada Okonjo/), 'who invited you').toBeVisible();
    await expect(page.getByText(/MEMBER/), 'in what role').toBeVisible();

    /*
     * Masked, because this response is unauthenticated and anybody holding a
     * forwarded link can read it. Enough for the intended recipient to
     * recognise, not enough for anybody else to harvest.
     *
     * `•+` and not `•••`: `maskEmail` pads to the length of the local part, so
     * the number of dots is a fact about the address rather than a constant.
     * Pinning three was this assertion's own bug, caught on the first run — and
     * it is the shape worth noting, because a mask whose length leaks the local
     * part's length is a deliberate trade the domain made, not an accident.
     */
    /*
     * `.first()` because the masked address appears twice and both are right:
     * once in the facts ("Sent to n•••@…") and once in the ask ("prove that
     * n•••@… is yours"). A person reading the ask should not have to scroll
     * back up to remember which address they are being asked about.
     */
    await expect(
      page.getByText(/•+@kestrel\.test/).first(),
      'the invited address, masked',
    ).toBeVisible();
    await expect(
      page.getByText(COLLEAGUE, { exact: false }),
      'the address is never printed in full to an unauthenticated reader',
    ).toHaveCount(0);

    // And the ask comes after. A sign-in form here would mean the sequence had
    // been inverted, which is the whole thing this screen is arranged against.
    await expect(page.getByRole('link', { name: /confirm my email/i })).toBeVisible();
    await expect(page.locator('input[type="email"]'), 'no field before the preview').toHaveCount(0);

    await stranger.close();
  });

  test('an invitation grants nothing on its own', async ({ browser, request }) => {
    await signInAsAgency(request, OWNER);
    const { url } = await invite(request, COLLEAGUE);

    const stranger = await browser.newContext();
    const page = await stranger.newPage();
    await page.goto(url);

    /*
     * INV-12 from the outside: holding the token, the portfolio is still shut.
     *
     * The assertion is that they did not *arrive*, not that they landed on any
     * particular door. A signed-out request to `/portfolio` is bounced to
     * `/onboarding`, which sorts out the three identity states and sends a
     * stranger on to `/signin` — checking for one of those two by name would be
     * asserting on the shape of the bounce rather than on the property, and
     * that was this test's own first bug.
     */
    await page.goto('/portfolio');
    expect(new URL(page.url()).pathname, 'a token holder reached the portfolio').not.toBe(
      '/portfolio',
    );
    await expect(
      page.getByText(/Spring campaign/i),
      'a token holder was shown an engagement name',
    ).toHaveCount(0);

    await stranger.close();
  });

  test('a mismatched address is refused by name, and the invitation survives it', async ({
    browser,
    request,
  }) => {
    await signInAsAgency(request, OWNER);
    const { url, token } = await invite(request, COLLEAGUE);

    // A verified session for somebody the invitation does not name.
    const other = await browser.newContext();
    const page = await other.newPage();
    await signInAsAgency(page.request, SOMEBODY_ELSE, page);

    await page.goto(url);
    await page.getByRole('button', { name: /^Join Kestrel Studio/i }).click();

    await expect(
      page.getByText(/sent to a different address/i),
      'the refusal says which of the five things went wrong',
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign out and use the invited address/i }),
      'and offers the way forward rather than a dead end',
    ).toBeVisible();

    // The invitation is **not** consumed by a mismatch — burning it would turn
    // a forwarded email into a denial of service against the person it was
    // actually for. Asserted through the preview, which reports `state`.
    const preview = await request.get(`/api/invites/${token}`);
    expect(preview.ok(), 'the invitation is still resolvable').toBe(true);
    const body = (await preview.json()) as { invite?: { state?: string } };
    expect(body.invite?.state, 'a refused redemption must not spend the invitation').toBe('open');

    await other.close();
  });

  test('the emailed sign-in link is not consumed by opening it', async ({ browser, request }) => {
    await signInAsAgency(request, OWNER);

    const requested = await request.post('/api/auth/signin/request', {
      data: { email: COLLEAGUE },
    });
    expect(requested.ok(), 'a code is always issued, for any address').toBe(true);

    const code = await latestAccountCode(request, COLLEAGUE);
    const link = `/signin/confirm?email=${encodeURIComponent(COLLEAGUE)}&code=${code}`;

    // Three GETs, the way Safe Links and Proofpoint fetch every URL in an
    // inbound message before a human sees it. None of them may spend anything.
    const scanner = await browser.newContext();
    const page = await scanner.newPage();
    for (let i = 0; i < 3; i += 1) await page.goto(link);
    await expect(
      page.getByRole('button', { name: /sign me in/i }),
      'the page renders a button and consumes nothing on load',
    ).toBeVisible();

    // Still good afterwards: the same code still signs the person in. If any of
    // those GETs had consumed it, this press would fail.
    await page.getByRole('button', { name: /sign me in/i }).click();
    await expect(page).toHaveURL(/\/onboarding|\/portfolio/);

    await scanner.close();
  });

  test('redeeming grows the org, and the assignee picker stops collapsing', async ({
    browser,
    request,
  }) => {
    const seed = await seedFixtures(request);
    await signInAsAgency(request, OWNER);

    // Before: one member, so the picker is a button and not a menu of one.
    const before = await request.get(`/api/engagements/${seed.engagementId}/members`);
    const beforeBody = (await before.json()) as { members: unknown[] };
    expect(beforeBody.members, 'the fixture org starts with one member').toHaveLength(1);

    const { url } = await invite(request, COLLEAGUE);

    const joiner = await browser.newContext();
    const page = await joiner.newPage();

    // The real verification, not a shortcut: request a code, confirm it, and
    // come back to the invitation still waiting.
    await page.goto(url);
    await page.getByRole('link', { name: /confirm my email/i }).click();
    await page.locator('input[type="email"]').fill(COLLEAGUE);
    await page.getByRole('button', { name: /email me a code/i }).click();
    await expect(page.getByLabel(/your code/i)).toBeVisible();
    const code = await latestAccountCode(request, COLLEAGUE);
    await page.getByLabel(/your code/i).fill(code);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByRole('button', { name: /^Join Kestrel Studio/i })).toBeVisible();
    await page.getByRole('button', { name: /^Join Kestrel Studio/i }).click();

    // The destination is decided on the server and redirected to, so the
    // agency's routes never reach a chunk downloaded by somebody who is not yet
    // a member. See `src/app/invite/[token]/actions.ts`.
    await expect(page).toHaveURL(/\/portfolio/);

    // After: two members. This is the first moment in the product's life that
    // the picker's multi-member branch can execute.
    const after = await request.get(`/api/engagements/${seed.engagementId}/members`);
    const afterBody = (await after.json()) as {
      members: { id: string; name: string | null; email: string }[];
    };
    expect(afterBody.members, 'the organisation grew by one').toHaveLength(2);

    const joined = afterBody.members.find((m) => m.email === COLLEAGUE);
    expect(joined, 'the new member is assignable on this engagement').toBeDefined();
    expect(joined?.name, 'an invited colleague has no name until they set one').toBeNull();

    // And the picker offers them, named by their address rather than by an
    // empty string or an id — the defect that would greet a new member on the
    // first card they were handed.
    const card = await page.goto(`/w/${seed.engagementId}/c/${seed.cardId}`);
    expect(card?.status()).toBeLessThan(400);
    // The backstage `<dl>`'s row variant. `seed.cardId` is `awaiting_client`,
    // so this is the plain edit rather than the draft's forward control — the
    // same component either way, and the branch under test is the candidate
    // list rather than which variant drew it.
    const select = page.locator('select').first();
    await expect(select, 'a real picker, not the single-member button').toBeVisible();
    await expect(
      select.locator('option', { hasText: COLLEAGUE }),
      'the second member is offered, and is named by their address',
    ).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: /assign to me/i }),
      'the single-member special case must not survive a second member',
    ).toHaveCount(0);

    await joiner.close();
  });
});

/**
 * The account sign-in code, read out of band.
 *
 * `GET /api/test/last-code` takes an address and no engagement token for an
 * account code — the client's own codes are scoped to an engagement and are a
 * different capture. Gated on `E2E_SEED_TOKEN` like every other test route.
 */
async function latestAccountCode(request: APIRequestContext, email: string): Promise<string> {
  const token = process.env.E2E_SEED_TOKEN;
  if (!token) throw new Error('E2E_SEED_TOKEN is not set; see tests/e2e/_helpers.ts');
  const response = await request.get(`/api/test/last-code?email=${encodeURIComponent(email)}`, {
    headers: { 'x-e2e-seed-token': token },
  });
  if (!response.ok()) {
    throw new Error(`GET /api/test/last-code returned ${response.status()} for ${email}`);
  }
  const body = (await response.json()) as { code?: string };
  if (!body.code) throw new Error(`no account code captured for ${email}`);
  return body.code;
}
