/**
 * THE ROUND TRIP — the feature, asserted as a loop rather than as two screens.
 *
 * Templates are the thing that makes creating a workspace nearly free, and
 * ephemerality only works if it is (PRD §5.7). But "there is a templates page"
 * and "an agency can reuse the shape of a job" are different claims, and only
 * the second one is worth anything. So this spec never asserts that a list
 * rendered. It saves a board, stamps a new engagement from it, and requires the
 * board that comes back to be the board that went in — lane for lane, card for
 * card, and with the private lane still private.
 *
 * That last clause is the one that matters most. A capture that quietly dropped
 * private lanes would produce a template that stamps a board missing exactly
 * the columns the agency runs its own work in, and nobody would find out until
 * the engagement after next. A capture that turned a private lane *published*
 * would be an INV-1 defect with a two-engagement fuse on it.
 *
 * Runs on `agency` (Desktop Chrome). Northline is on Pro — 15 active slots —
 * so the two engagements this creates are nowhere near the gate; the plan
 * surface is asserted in `plan-and-lifecycle.spec.ts` and is not this test's
 * subject.
 */

import { expect, test, type Page } from '@playwright/test';
import { seedFixtures, signInAsAgency } from '../_helpers';

const ADMIN = 'sam@northline.test';

/**
 * The org that owns `ENGAGEMENT.active` — the fixture board with a private lane
 * on it. Same note as `engagement-flow.spec.ts`: a test about that board has to
 * be signed in as the org holding it, or the route answers 404 on tenancy long
 * before a lane is read.
 */
const CARD_OWNER_ADMIN = 'ada@kestrel.test';

/** What goes in, and therefore what has to come back out. */
const SOURCE = {
  title: 'Docket source — brand refresh',
  publishedLane: 'Deliverables',
  privateLane: 'Internal QA',
  cards: ['Key art', 'Launch film'],
  privateCard: 'Legal sign-off',
};

const TEMPLATE_NAME = 'Brand refresh';

async function addLane(page: Page, name: string, keepPrivate: boolean): Promise<void> {
  await page.getByRole('button', { name: /add a lane/i }).click();
  await page.getByLabel(/lane name/i).fill(name);
  if (keepPrivate) {
    await page.getByLabel(/keep this lane private to the agency/i).check();
  }
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function addCard(page: Page, laneName: string, title: string): Promise<void> {
  const lane = page.getByRole('region', { name: laneName });
  await lane.getByRole('button', { name: /add a deliverable/i }).click();
  await page.getByLabel(/deliverable title/i).fill(title);
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
}

test.describe('templates round trip', () => {
  test.beforeEach(async ({ page, request }) => {
    await seedFixtures(request);
    await signInAsAgency(request, ADMIN, page);
  });

  test('save a board as a template, stamp a new engagement, get the same board', async ({
    page,
  }) => {
    /* ------------------------------------------------ 1. build a board worth keeping */

    await page.goto('/portfolio');
    await page.getByRole('button', { name: /new engagement/i }).click();
    await page.getByLabel(/what is being delivered/i).fill(SOURCE.title);
    await page.getByLabel(/^client$/i).fill('Adelheid Group');

    // Blank is the checked option before anyone touches the picker. Asserted
    // rather than assumed: if it ever stops being the default, every engagement
    // created without a deliberate choice starts stamped with somebody else's
    // shape.
    const blank = page.getByRole('radio', { name: /start blank/i });
    await expect(blank).toBeChecked();

    await page.getByRole('button', { name: /create engagement/i }).click();
    await expect(page.getByRole('heading', { name: SOURCE.title })).toBeVisible();

    await addLane(page, SOURCE.publishedLane, false);
    await addLane(page, SOURCE.privateLane, true);
    for (const title of SOURCE.cards) await addCard(page, SOURCE.publishedLane, title);
    await addCard(page, SOURCE.privateLane, SOURCE.privateCard);

    const sourceUrl = page.url();
    const sourceId = /\/w\/([^/]+)\//.exec(sourceUrl)?.[1];
    expect(sourceId, `could not read an engagement id out of ${sourceUrl}`).toBeTruthy();

    /* ---------------------------------------------------- 2. capture it as a docket */

    await page.goto(`/w/${sourceId ?? ''}/settings`);
    await page.getByRole('button', { name: /save as template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The dialog leads with what is being taken, not with a form. Both lanes are
    // named in it and the private one is stamped — a preview that showed only
    // the published lane would be describing a different capture from the one
    // about to happen.
    await expect(dialog.getByText(SOURCE.publishedLane, { exact: true })).toBeVisible();
    await expect(dialog.getByText(SOURCE.privateLane, { exact: true })).toBeVisible();
    await expect(dialog.getByText('PRIVATE', { exact: true })).toHaveCount(1);

    await dialog.getByLabel(/name this template/i).fill(TEMPLATE_NAME);
    await dialog.getByRole('button', { name: /^save as template$/i }).click();
    await expect(dialog.getByText(/saved as a template/i)).toBeVisible();
    await dialog.getByRole('button', { name: /^done$/i }).click();

    /* ---------------------------------------------------- 3. it is on the register */

    await page.goto('/templates');
    const entry = page.getByRole('listitem').filter({ hasText: TEMPLATE_NAME });
    await expect(entry).toHaveCount(1);
    // The counts are records and they are the ones the picker will show. Two
    // lanes, three cards — the private lane and its card included.
    await expect(entry).toContainText('2');
    await expect(entry).toContainText('3');

    /* ------------------------------------------------------- 4. stamp a new one */

    await page.goto('/portfolio');
    await page.getByRole('button', { name: /new engagement/i }).click();
    await page.getByLabel(/what is being delivered/i).fill('Stamped from the docket');
    await page.getByLabel(/^client$/i).fill('Northbank Coffee');
    await page.getByRole('radio', { name: TEMPLATE_NAME }).check();
    await page.getByRole('button', { name: /create engagement/i }).click();

    await expect(page.getByRole('heading', { name: 'Stamped from the docket' })).toBeVisible();

    /* ------------------------------- 5. the board that came back is the board saved */

    for (const lane of [SOURCE.publishedLane, SOURCE.privateLane]) {
      await expect(
        page.getByRole('heading', { name: lane }),
        `the stamped board is missing the ${lane} lane`,
      ).toBeVisible();
    }
    for (const title of [...SOURCE.cards, SOURCE.privateCard]) {
      await expect(
        page.getByRole('link', { name: title }),
        `the stamped board is missing the card ${title}`,
      ).toBeVisible();
    }

    // Visibility survived the round trip in both directions. Exactly one PRIVATE
    // stamp: the private lane is still private, and the published lane did not
    // become private on the way through.
    await expect(
      page.getByText('PRIVATE', { exact: true }),
      'lane visibility did not survive the round trip',
    ).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: SOURCE.privateLane }).getByText('PRIVATE', { exact: true }),
    ).toHaveCount(1);

    // Stamping did not copy content. A template describes a kind of job, not a
    // job: no versions came with it, so nothing on this board can be awaiting a
    // client, and every card is at the column default (INV-2).
    await expect(page.getByText(/awaiting client/i)).toHaveCount(0);
  });

  /**
   * The preview before stamping, against the live `GET /api/templates/:id`.
   *
   * Deliberately not a stubbed route. A fulfilled response hand-written beside
   * the component that reads it proves only that the component agrees with the
   * test author — the same shape of self-agreement the bundle audit's negative
   * control exists to rule out. So this captures a real fixture board, asks the
   * real route for it back, and requires the picker to name the lanes and the
   * deliverables that were actually in it.
   *
   * The fixture engagement carries a private lane, which is the assertion that
   * matters: a preview that showed only published lanes would understate what
   * a stamp produces, on the screen whose job is to make sure the workspace is
   * not a surprise.
   */
  test('the picker previews the docket it will stamp', async ({ page, request }) => {
    /*
      Kestrel, not Northline. `ENGAGEMENT.active` is the fixture board that
      carries a private lane, and it belongs to Kestrel Studio — signed in as
      anyone else the route answers 404 on tenancy long before a lane is read,
      which is the same trap `engagement-flow.spec.ts` documents at
      `CARD_OWNER_ADMIN`. The first run of this test picked Northline's empty
      draft instead and failed on an empty board rather than on the preview.
    */
    const seed = await seedFixtures(request);
    await signInAsAgency(request, CARD_OWNER_ADMIN, page);

    const created = await page.request.post('/api/templates', {
      data: { name: 'Campaign launch', fromEngagementId: seed.engagementId },
    });
    expect(created.status(), await created.text()).toBe(201);

    // What the fixture board actually holds, read from the board rather than
    // restated here: a literal list would go stale the day the fixtures move
    // and would then be asserting against a board nobody has.
    const boardResponse = await page.request.get(`/api/engagements/${seed.engagementId}/board`);
    const board = (await boardResponse.json()) as {
      lanes: { name: string; visibility: string; cards: { title: string }[] }[];
    };
    expect(board.lanes.length, 'the fixture board has no lanes to preview').toBeGreaterThan(1);
    const privateLanes = board.lanes.filter((l) => l.visibility === 'private');
    expect(
      privateLanes.length,
      'the fixture board has no private lane, so this test cannot check that one survives',
    ).toBeGreaterThan(0);

    await page.goto('/portfolio');
    await page.getByRole('button', { name: /new engagement/i }).click();
    await page.getByRole('radio', { name: /campaign launch/i }).check();

    const form = page.locator('form');

    // The unavailable state first: asserting the lanes below without this would
    // pass just as well against a panel that rendered nothing at all.
    await expect(form.getByText(/breakdown is unavailable/i)).toHaveCount(0);

    for (const lane of board.lanes) {
      await expect(
        form.getByText(lane.name, { exact: true }),
        `the preview does not name the ${lane.name} lane`,
      ).toBeVisible();
    }
    for (const card of board.lanes.flatMap((l) => l.cards).slice(0, 4)) {
      await expect(
        form.getByText(card.title, { exact: true }),
        `the preview does not name the deliverable ${card.title}`,
      ).toBeVisible();
    }
    await expect(
      form.getByText('PRIVATE', { exact: true }),
      'the preview did not mark the private lane',
    ).toHaveCount(privateLanes.length);
  });

  test('a template is offered but never imposed: blank stays the default', async ({ page }) => {
    // The picker's whole reason for not being a `<select>`. This is asserted on
    // its own because it is the property most likely to be lost quietly: a
    // "helpful" default of the most recent template would make every engagement
    // start as a copy of the last one, and nobody would report it as a bug.
    await page.goto('/portfolio');
    await page.getByRole('button', { name: /new engagement/i }).click();

    const options = page.getByRole('radio');
    await expect(options.first()).toHaveAccessibleName(/start blank/i);
    await expect(options.first()).toBeChecked();
  });
});
