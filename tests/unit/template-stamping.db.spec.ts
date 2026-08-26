/**
 * The stamping **path**, against the database that is actually running.
 *
 * ## Why this is a separate file from `template-determinism.spec.ts`
 *
 * The same split INV-3 got, for the same reason. `applyTemplate()` is pure — no
 * executor, no clock, no id factory — so *stamping a template twice produces
 * structurally identical graphs* is a property of a function and is asserted in
 * `npm run verify`, on a machine with nothing installed. An invariant that can
 * only be checked where the infrastructure is is an invariant that goes
 * unchecked on most commits.
 *
 * What is left over after that split is everything the pure function
 * deliberately does not do, and none of it can be checked by reading source:
 *
 * - **The column defaults decide.** `applyTemplate()` emits no `state` — that is
 *   what keeps `domain/card/state-machine.ts` the sole writer of `cards.state`
 *   (INV-2) — and the claim "a stamped card starts at the column default" is
 *   therefore a claim about Postgres, not about TypeScript. A structural scan
 *   proving the field is absent proves the *stamp* is innocent and says nothing
 *   about what lands in the row.
 * - **One transaction.** A half-stamped board is worse than a failed create.
 *   Only a real transaction can be interrupted.
 * - **The plan gate on the create path.** Phase 7 adds a caller to
 *   `assertCanOpenEngagement()`, and INV-8's whole claim is that billing and
 *   expiry read one counter. The interesting case is the *failed* create: it
 *   must consume no plan slot and leave no lane behind.
 * - **jsonb is not a type.** A definition round-trips through a real jsonb
 *   column, is read back by the real parse, and stamps the same board. In the
 *   portable half that round trip is `JSON.parse(JSON.stringify(...))`, which
 *   is a good proxy and is not the column.
 *
 * Runs under `npm run test:db`. Never edit this file to make a build pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as schema from '@/db/schema';
import { cards, engagements, lanes, organizations, templates } from '@/db/schema';
import type { Database } from '@/db/types';
import { openEngagement } from '@/domain/engagement/open';
import { stampTemplate } from '@/domain/template/stamp';
import { loadTemplate } from '@/db/queries/templates';
import { parseTemplateDefinition } from '@/domain/template/definition';
import { isDomainError } from '@/domain/errors';
import { TEMPLATE_FIXTURE, normaliseStamp } from '@tests/fixtures';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const MINUTE = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-05-04T09:00:00.000Z');

describe('PHASE-7 the stamping path, against a live database', () => {
  let pool: pg.Pool;
  let db: Database;
  const orgIds: string[] = [];

  beforeAll(async () => {
    expect(
      DATABASE_URL,
      'The stamping path is a claim about a transaction and three column ' +
        'defaults. Asserting it against source text is a check that cannot see ' +
        'its own subject. Set DATABASE_URL.',
    ).not.toBe('');
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
  }, MINUTE);

  afterAll(async () => {
    // Cascades would reach the boards; a failed run should still leave a
    // database the next run can use rather than a puzzle.
    if (orgIds.length > 0) {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
    }
    await pool.end();
  }, MINUTE);

  /** A fresh organisation, so no two cases can see each other's plan usage. */
  async function makeOrg(plan: 'free' | 'pro' | 'studio' = 'studio'): Promise<string> {
    const id = uuidv7();
    orgIds.push(id);
    await db.insert(organizations).values({
      id,
      name: `Stamp ${id}`,
      // The whole id, not a prefix: uuid v7 leads with a millisecond timestamp,
      // so `id.slice(0, 8)` is the same eight characters for every org this
      // suite creates in the same second and the slug's UNIQUE refuses the
      // second one. Time-ordered ids are not distinct ids at their head.
      slug: `stamp-${id}`,
      plan,
    });
    return id;
  }

  /** The board as Postgres holds it: lanes in order, each with its own cards. */
  async function readBoard(engagementId: string): Promise<unknown> {
    const laneRows = await db
      .select()
      .from(lanes)
      .where(eq(lanes.engagementId, engagementId))
      .orderBy(asc(lanes.position));
    const out = [];
    for (const lane of laneRows) {
      const cardRows = await db
        .select()
        .from(cards)
        .where(and(eq(cards.engagementId, engagementId), eq(cards.laneId, lane.id)))
        .orderBy(asc(cards.position));
      out.push({ ...lane, cards: cardRows });
    }
    return out;
  }

  async function open(orgId: string, title: string, now = NOW): Promise<string> {
    const result = await openEngagement(
      db,
      {
        orgId,
        title,
        clientOrgName: 'Bellweather',
        template: { id: null, definition: TEMPLATE_FIXTURE },
      },
      now,
    );
    return result.engagement.id;
  }

  /* ------------------------------------------------------ the exit condition */

  it('two engagements stamped from one template hold structurally identical boards', async () => {
    const orgId = await makeOrg();
    const first = await open(orgId, 'First');
    const second = await open(orgId, 'Second');
    expect(first).not.toBe(second);

    // The same normalisation the portable half uses, applied to rows that made
    // a round trip through Postgres. Ids are real uuid v7s minted by the
    // product, timestamps are written by the product's clock, and both stamps
    // share a `started_at` because both engagements were created at `NOW`.
    expect(normaliseStamp(await readBoard(first)).shape).toEqual(
      normaliseStamp(await readBoard(second)).shape,
    );
  }, MINUTE);

  it('and does not compare equal to a board stamped from a different template', async () => {
    // The floor. Two boards read out of the same tables and normalised the same
    // way have every opportunity to compare equal for the wrong reason.
    const orgId = await makeOrg();
    const full = await open(orgId, 'Full');
    const trimmed = await openEngagement(
      db,
      {
        orgId,
        title: 'Trimmed',
        clientOrgName: 'Bellweather',
        template: {
          id: null,
          definition: { ...TEMPLATE_FIXTURE, lanes: TEMPLATE_FIXTURE.lanes.slice(0, 2) },
        },
      },
      NOW,
    );
    expect(normaliseStamp(await readBoard(full)).shape).not.toEqual(
      normaliseStamp(await readBoard(trimmed.engagement.id)).shape,
    );
  }, MINUTE);

  /* ------------------------------------------- what only the columns can say */

  it('a stamped card takes the column default for state (INV-2)', async () => {
    const orgId = await makeOrg();
    const engagementId = await open(orgId, 'Defaults');
    const rows = await db.select().from(cards).where(eq(cards.engagementId, engagementId));

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      // `draft` arrived from `cards.state DEFAULT 'draft'`. `applyTemplate()`
      // emits no `state` key at all, so this value cannot have come from the
      // stamp — which is the half of INV-2 the portable scan proves, and this
      // is the half that proves the column agrees.
      expect(row.state, row.title).toBe('draft');
      expect(row.roundsUsed, row.title).toBe(0);
      expect(row.visibilityOverride, row.title).toBe('inherit');
      expect(row.assigneeId, row.title).toBeNull();
      expect(row.internalNotes, row.title).toBeNull();
    }
  }, MINUTE);

  it('no state_transitions row is written by a stamp', async () => {
    // INV-5: every transition writes a row, and the possession clock derives
    // from that table alone. A stamped card has not transitioned — it was
    // created at the default — so a row here would start a clock on work
    // nobody has touched, and every possession total on the board would be
    // wrong from the first render.
    const orgId = await makeOrg();
    const engagementId = await open(orgId, 'No transitions');
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM state_transitions t
        JOIN cards c ON c.id = t.card_id WHERE c.engagement_id = $1`,
      [engagementId],
    );
    expect(rows[0]?.n).toBe('0');
  }, MINUTE);

  it('a private lane in the template is a private lane in the database', async () => {
    // INV-1's premise, read back off the column rather than off the object the
    // stamp built. `lanes.visibility DEFAULT 'published'` is the right default
    // for a lane nobody described; a template always described, and a stamp
    // that omitted the field would silently publish this one.
    const orgId = await makeOrg();
    const engagementId = await open(orgId, 'Visibility');
    const rows = await db
      .select({ name: lanes.name, visibility: lanes.visibility })
      .from(lanes)
      .where(eq(lanes.engagementId, engagementId))
      .orderBy(asc(lanes.position));

    expect(rows).toEqual([
      { name: 'Discovery', visibility: 'published' },
      { name: 'Internal QA', visibility: 'private' },
      { name: 'Delivery', visibility: 'published' },
      { name: 'Parked', visibility: 'published' },
    ]);
  }, MINUTE);

  it('due dates are measured from the engagement started_at that was written', async () => {
    const orgId = await makeOrg();
    const engagementId = await open(orgId, 'Dates');
    const [row] = await db
      .select({ startedAt: engagements.startedAt })
      .from(engagements)
      .where(eq(engagements.id, engagementId));
    expect(row).toBeDefined();
    const started = row?.startedAt;
    expect(started).toBeInstanceOf(Date);

    const dues = await db
      .select({ title: cards.title, dueAt: cards.dueAt })
      .from(cards)
      .where(eq(cards.engagementId, engagementId))
      .orderBy(asc(cards.createdAt), asc(cards.position));
    const byTitle = new Map(dues.map((c) => [c.title, c.dueAt]));

    // Not "some date got written" — the exact offsets the definition asked for,
    // from the row's own origin. Reading `started_at` back rather than reusing
    // the `now` the caller passed is the whole point of the two being separate
    // parameters: a backdated import lands on the right calendar.
    const base = (started as Date).getTime();
    expect(byTitle.get('Kickoff brief')?.getTime()).toBe(base);
    expect(byTitle.get('Audience research')?.getTime()).toBe(base + 7 * DAY);
    expect(byTitle.get('Final artwork')?.getTime()).toBe(base + 45 * DAY);
    expect(byTitle.get('Handover pack')).toBeNull();
    expect(byTitle.get('Accessibility sweep')).toBeNull();
  }, MINUTE);

  /* -------------------------------------------------------- one transaction */

  it('a stamp that fails partway leaves no half-written board', async () => {
    // `stampTemplate()` takes an `Executor` and never opens a transaction of
    // its own, so the caller's transaction is the transaction. That design
    // claim is only worth anything if a rollback actually reaches the lanes.
    const orgId = await makeOrg();
    const engagementId = await open(orgId, 'Rollback host');
    const before = await db.select().from(lanes).where(eq(lanes.engagementId, engagementId));

    const second = uuidv7();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(engagements).values({
          id: second,
          orgId,
          title: 'Doomed',
          clientOrgName: 'Bellweather',
          startedAt: NOW,
          lastActivityAt: NOW,
        });
        await stampTemplate(tx, { engagementId: second, definition: TEMPLATE_FIXTURE, startedAt: NOW }, NOW);
        throw new Error('the caller failed after the stamp');
      }),
    ).rejects.toThrow('the caller failed after the stamp');

    const orphanLanes = await db.select().from(lanes).where(eq(lanes.engagementId, second));
    const orphanCards = await db.select().from(cards).where(eq(cards.engagementId, second));
    const orphanEngagement = await db.select().from(engagements).where(eq(engagements.id, second));
    expect(orphanLanes).toEqual([]);
    expect(orphanCards).toEqual([]);
    expect(orphanEngagement).toEqual([]);

    // And the neighbouring board is untouched — a rollback that took the
    // wrong rows with it would be the worse bug.
    expect(await db.select().from(lanes).where(eq(lanes.engagementId, engagementId))).toHaveLength(
      before.length,
    );
  }, MINUTE);

  /* ------------------------------------------------ the plan gate, on create */

  it('a create refused by the plan gate stamps nothing and consumes no slot', async () => {
    // INV-8 on the path Phase 7 added. `free` allows three; the fourth create
    // must 402 — and the interesting half is what it leaves behind, because the
    // gate runs inside the same transaction as the insert and the stamp.
    const orgId = await makeOrg('free');
    for (const title of ['One', 'Two', 'Three']) await open(orgId, title);

    let code: string | null = null;
    try {
      await open(orgId, 'Four');
    } catch (error) {
      if (!isDomainError(error)) throw error;
      code = error.code;
      expect(error.status).toBe(402);
    }
    expect(code).toBe('PLAN_LIMIT_REACHED');

    const all = await db.select().from(engagements).where(eq(engagements.orgId, orgId));
    expect(all.map((e) => e.title).sort()).toEqual(['One', 'Three', 'Two']);

    // Four boards' worth of lanes would be 16. Three engagements got made, so
    // there must be exactly 12 — a stamp that ran before the gate refused would
    // show up here as an orphaned board with no engagement to hang off.
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM lanes l JOIN engagements e ON e.id = l.engagement_id WHERE e.org_id = $1',
      [orgId],
    );
    expect(rows[0]?.n).toBe('12');
  }, MINUTE);

  it('the slot frees when an engagement goes quiet, and the next stamp succeeds', async () => {
    // The counter's other half — active means running *and* touched inside the
    // window (PRD §5.6). Nobody deleted anything; the same one function
    // answered differently because the clock moved, and the gate followed it.
    const orgId = await makeOrg('free');
    for (const title of ['One', 'Two', 'Three']) await open(orgId, title);
    const later = new Date(NOW.getTime() + 31 * DAY);
    const fourth = await open(orgId, 'Four', later);
    expect(await db.select().from(lanes).where(eq(lanes.engagementId, fourth))).toHaveLength(4);
  }, MINUTE);

  /* --------------------------------------------------- jsonb is not a type */

  it('a definition round-trips through the real jsonb column and stamps the same board', async () => {
    const orgId = await makeOrg();
    const templateId = uuidv7();
    await db.insert(templates).values({
      id: templateId,
      orgId,
      name: 'Retainer',
      definition: TEMPLATE_FIXTURE,
    });

    const loaded = await loadTemplate(db, templateId, orgId);
    expect(loaded).not.toBeNull();
    // Read back through the product's own parse, not `as TemplateDefinition`.
    expect(loaded?.definition).toEqual(TEMPLATE_FIXTURE);

    const fromColumn = await openEngagement(
      db,
      {
        orgId,
        title: 'From the column',
        clientOrgName: 'Bellweather',
        template: { id: templateId, definition: loaded?.definition ?? TEMPLATE_FIXTURE },
      },
      NOW,
    );
    const fromMemory = await open(orgId, 'From memory');

    expect(normaliseStamp(await readBoard(fromColumn.engagement.id)).shape).toEqual(
      normaliseStamp(await readBoard(fromMemory)).shape,
    );
    expect(fromColumn.engagement.templateId).toBe(templateId);
  }, MINUTE);

  it('a raw jsonb row that no longer parses is refused rather than stamped', async () => {
    // The failure this exists for: the column hands back a row written by a
    // build with different rules, and a cast would stamp a board nobody
    // described. `state` is the key that matters — a definition that could set
    // it would be a second writer of `cards.state`.
    const orgId = await makeOrg();
    const templateId = uuidv7();
    const corrupt = JSON.parse(JSON.stringify(TEMPLATE_FIXTURE)) as {
      lanes: { cards: Record<string, unknown>[] }[];
    };
    corrupt.lanes[0]!.cards[0]!['state'] = 'approved';
    await db
      .insert(templates)
      .values({ id: templateId, orgId, name: 'Corrupt', definition: corrupt });

    const { rows } = await pool.query<{ definition: unknown }>(
      'SELECT definition FROM templates WHERE id = $1',
      [templateId],
    );
    expect(() => parseTemplateDefinition(rows[0]?.definition, 'stored definition')).toThrow();
  }, MINUTE);

  it('a template belonging to another organisation is absent, not forbidden', async () => {
    // 404, never 403. A 403 on a template id confirms the id exists, which is
    // the leak the NOT_VISIBLE rule exists to close.
    const mine = await makeOrg();
    const theirs = await makeOrg();
    const templateId = uuidv7();
    await db
      .insert(templates)
      .values({ id: templateId, orgId: theirs, name: 'Theirs', definition: TEMPLATE_FIXTURE });

    // Absent, and absent *identically* to an id that was never minted. A
    // refusal that can be told apart from "no such row" confirms the id exists,
    // which is the whole thing the 404-not-403 rule protects. The query layer
    // says it by returning nothing rather than by throwing, so what has to
    // match is the answer, not an error code.
    expect(await loadTemplate(db, templateId, mine)).toBeNull();
    expect(await loadTemplate(db, uuidv7(), mine)).toBeNull();

    // And the owning org still gets it, so the two nulls above are about
    // tenancy rather than about the row being unreadable for some other reason.
    const ours = await loadTemplate(db, templateId, theirs);
    expect(ours?.definition).toEqual(TEMPLATE_FIXTURE);
  }, MINUTE);
});
