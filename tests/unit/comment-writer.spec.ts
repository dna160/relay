/**
 * `POST /api/comments` — the agency comment writer, as shipped.
 *
 * This is what turns `comments.internal` into a real column. Until it existed,
 * only the client could write, a client comment can never be internal, and so
 * every defence around internal threads — the parent self-join in the read, the
 * forced-internal reply in `postComment()` — was guarding a set that was empty
 * by construction. Those defences are asserted at the domain layer in
 * `tests/invariants/visibility.spec.ts`; this file asserts the route on top of
 * them, because a route is where an authorisation step gets skipped.
 *
 * ## How this runs without a database
 *
 * A route handler does not take its executor as an argument — it imports the
 * live client at module scope, which is the one place INV-9's "domain functions
 * receive an `Executor`" rule does not reach. So `@/db/client` is replaced with
 * a real drizzle instance over a driver this file answers for, and
 * `requireAgency()` with a fixed session. Everything between those two is the
 * shipped code, running its real branches in its real order.
 *
 * `publishEvent()` is deliberately **not** mocked. It emits `pg_notify` through
 * the same executor, so whether an internal comment announces itself is visible
 * in the captured statements — which means the one assertion that looked like
 * it needed a live bus does not.
 *
 * ## What is asserted, and on what
 *
 * On the **bound parameters of the statements the route issued**, never on what
 * the fake driver was told to return. The driver's answers are the situation;
 * the bound parameters are the decision the code made about it.
 *
 * Deliberately in `tests/unit/` rather than `tests/invariants/`: a new `.skip`
 * inside the invariant directory trips QA's own `check-invariant-weakening`
 * gate as a false positive, and that gate should stay unable to tell a new
 * skipped block from a live suite someone re-skipped — catching the second is
 * what it is for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  insertedValues,
  makeFakeDatabase,
  rowFor,
  theStatement,
  type CapturedStatement,
} from '../invariants/_query-capture';

const ORG = 'org-under-test';
const USER = 'user-under-test';
const ENGAGEMENT = '0193a5f0-c302-7000-8000-c3c3c3c30202';
const OTHER_ENGAGEMENT = '0193a5f0-c302-7000-8000-c3c3c3c30999';
const CARD = '0193a5f0-f601-7000-8000-f6f6f6f60101';
const PARENT = '0193a5f0-aaaa-7000-8000-aaaaaaaa0001';

/* -------------------------------------------------------------- statements */

/**
 * `loadEngagementDetail` selects the whole engagements row, so it is the one
 * statement carrying `client_org_name`. Matching on the join alone would also
 * catch `bumpActivity`'s plan lookup, which joins the same two tables — and
 * answering that one with an engagement row is how a fake starts testing
 * itself.
 */
const ENGAGEMENT_LOOKUP = /"engagements"\."client_org_name"/i;
const CARD_LOOKUP = /from "cards"\s+inner join "engagements"/i;
const PARENT_LOOKUP = /select "id", "parent_id", "internal" from "comments"/i;
const INSERT = /insert\s+into\s+"comments"/i;
const NOTIFY = /pg_notify/i;

/* ------------------------------------------------------------------ harness */

interface Situation {
  /** The engagement the org owns, or `null` for "no such engagement". */
  engagement?: { id?: string; status?: string } | null;
  /** What the card resolves to, or `null` for "not this org's card". */
  card?: { cardId?: string; engagementId?: string } | null;
  /** The parent comment `postComment` finds, or `null` for "no such reply". */
  parent?: { id: string; parentId: string | null; internal: boolean } | null;
}

let situation: Situation = {};

const harness = makeFakeDatabase(() => ({ sql }: { sql: string }) => {
  if (ENGAGEMENT_LOOKUP.test(sql)) {
    const engagement = situation.engagement;
    if (engagement === null) return [];
    return [rowFor(sql, { id: engagement?.id ?? ENGAGEMENT, status: engagement?.status ?? 'active' })];
  }
  if (CARD_LOOKUP.test(sql)) {
    const card = situation.card;
    if (card === null) return [];
    return [
      rowFor(sql, {
        engagement_id: card?.engagementId ?? ENGAGEMENT,
        id: card?.cardId ?? CARD,
      }),
    ];
  }
  if (PARENT_LOOKUP.test(sql)) {
    const parent = situation.parent;
    if (!parent) return [];
    return [[parent.id, parent.parentId, parent.internal]];
  }
  return undefined;
});

vi.mock('@/db/client', () => ({ db: harness.db }));
vi.mock('@/app/api/_guards', () => ({
  requireAgency: () => Promise.resolve({ kind: 'agency', userId: USER, orgId: ORG }),
}));

const { POST } = await import('@/app/api/comments/route');

interface Body {
  engagementId?: string;
  cardId?: string;
  body?: string;
  parentId?: string | null;
  internal?: boolean;
  [key: string]: unknown;
}

async function post(
  body: Body,
  where: Situation = {},
): Promise<{ status: number; payload: Record<string, unknown>; statements: CapturedStatement[] }> {
  situation = where;
  harness.reset();
  const response = await POST(
    new Request('http://localhost:3000/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const payload = (await response.json()) as Record<string, unknown>;
  return { status: response.status, payload, statements: [...harness.statements] };
}

const valid: Body = { engagementId: ENGAGEMENT, cardId: CARD, body: 'looks right to me' };
const errorCode = (payload: Record<string, unknown>): string | undefined =>
  (payload.error as { code?: string } | undefined)?.code;

beforeEach(() => {
  situation = {};
  harness.reset();
});

/* ------------------------------------------------------------------- cases */

describe('the happy path, so every refusal below is a refusal of something that works', () => {
  it('writes the comment and answers 201', async () => {
    const { status, payload, statements } = await post(valid);
    expect(status).toBe(201);
    const written = insertedValues(theStatement(statements, INSERT));
    expect(written.body).toBe('looks right to me');
    expect(written.card_id).toBe(CARD);
    expect(written.author_user_id).toBe(USER);
    expect(written.author_contact_id).toBeNull();
    expect(payload.comment).toBeTruthy();
  });

  it('returns the comment in the same shape the GET half emits, so it can be appended without a refetch', () => {
    // Field-for-field against `AgencyComment`, which is what the read returns.
    const shape = [
      'id',
      'cardId',
      'parentId',
      'body',
      'internal',
      'side',
      'authorName',
      'authorUserId',
      'authorContactId',
      'createdAt',
    ];
    return post(valid).then(({ payload }) => {
      const comment = payload.comment as Record<string, unknown>;
      expect(Object.keys(comment).sort()).toEqual([...shape].sort());
      expect(comment.side).toBe('agency');
    });
  });
});

describe('authorisation happens before the write, not after it', () => {
  it('refuses a card belonging to another org with a 404, and writes nothing', async () => {
    /**
     * A 403 would confirm the card exists. On a board the caller cannot see,
     * "this exists and is not yours" is the fact worth withholding — the same
     * reasoning as the client-side refusals, applied between two agencies.
     */
    const { status, payload, statements } = await post(valid, { card: null });
    expect(status).toBe(404);
    expect(errorCode(payload)).toBe('NOT_VISIBLE');
    expect(errorCode(payload)).not.toBe('FORBIDDEN');
    expect(
      statements.filter((s) => INSERT.test(s.sql)),
      'a comment was written onto another org’s card',
    ).toEqual([]);
  });

  it('scopes the card lookup by the session org, never by anything in the body', async () => {
    const { statements } = await post(valid);
    const lookup = theStatement(statements, CARD_LOOKUP);
    expect(lookup.sql).toMatch(/"organizations"\."id"|"engagements"\."org_id"\s*=\s*\$/);
    expect(lookup.params, 'the card lookup is not scoped to the session org').toContain(ORG);
  });

  it('refuses a valid card smuggled in under another engagement', async () => {
    /**
     * Amendment A5: an agency mutation names its engagement so the
     * authorisation check has a subject before any row is read. The body
     * supplies a *subject*, not a fact — the card's own engagement is then
     * checked against it. Without step 4 a caller could name an engagement they
     * own and a card they do not, and the engagement check would pass on the
     * wrong subject.
     */
    const { status, payload, statements } = await post(valid, {
      card: { cardId: CARD, engagementId: OTHER_ENGAGEMENT },
    });
    expect(status).toBe(404);
    expect(errorCode(payload)).toBe('NOT_VISIBLE');
    expect(
      statements.filter((s) => INSERT.test(s.sql)),
      'a comment was written under an engagement the card does not belong to',
    ).toEqual([]);
  });

  it('gives the same refusal for a foreign card and a mismatched engagement', async () => {
    const foreign = await post(valid, { card: null });
    const mismatched = await post(valid, {
      card: { cardId: CARD, engagementId: OTHER_ENGAGEMENT },
    });
    expect(
      JSON.stringify(mismatched.payload),
      'the two refusals differ, so a caller can tell which of the two ids was wrong',
    ).toBe(JSON.stringify(foreign.payload));
  });

  it('refuses an engagement the org does not own before it looks at the card at all', async () => {
    const { status, statements } = await post(valid, { engagement: null });
    expect(status).toBe(404);
    expect(
      statements.filter((s) => CARD_LOOKUP.test(s.sql)),
      'the card was read before the engagement was authorised',
    ).toEqual([]);
  });
});

describe('a wrapped engagement is read-only, and the check runs before the insert', () => {
  /**
   * Amendment A9 exists because both client mutations were missing this. A
   * fresh writer is exactly where it gets forgotten again — and forgotten here
   * it would be invisible, because the comment would save and everything would
   * look fine until someone noticed an archived engagement still accruing
   * discussion.
   */
  it('returns 423 ENGAGEMENT_ARCHIVED and writes nothing', async () => {
    const { status, payload, statements } = await post(valid, {
      engagement: { id: ENGAGEMENT, status: 'archived' },
    });
    expect(status).toBe(423);
    expect(errorCode(payload)).toBe('ENGAGEMENT_ARCHIVED');
    expect(statements.filter((s) => INSERT.test(s.sql))).toEqual([]);
  });

  it('returns 410 for a purged engagement', async () => {
    const { status, statements } = await post(valid, {
      engagement: { id: ENGAGEMENT, status: 'purged' },
    });
    expect(status).toBe(410);
    expect(statements.filter((s) => INSERT.test(s.sql))).toEqual([]);
  });

  it('runs the writability check before the insert, not after it', async () => {
    // Ordering, asserted the same way as the card lookup: on the sequence of
    // statements the route issued. A check that runs after the write is not a
    // check, it is a log line.
    const { statements } = await post(valid);
    const engagementRead = statements.findIndex((s) => ENGAGEMENT_LOOKUP.test(s.sql));
    const insert = statements.findIndex((s) => INSERT.test(s.sql));
    expect(engagementRead, 'the engagement was never read').toBeGreaterThanOrEqual(0);
    expect(insert, 'nothing was written on the happy path').toBeGreaterThan(engagementRead);
  });

  it('reads the engagement before the card, so the 423 is not masked by a 404', async () => {
    const { statements } = await post(valid);
    expect(statements.findIndex((s) => ENGAGEMENT_LOOKUP.test(s.sql))).toBeLessThan(
      statements.findIndex((s) => CARD_LOOKUP.test(s.sql)),
    );
  });
});

describe('the body is a subject, not a source of truth', () => {
  it('rejects an unknown field rather than ignoring it', async () => {
    const { status } = await post({ ...valid, orgId: 'someone-elses-org' });
    expect(status).toBe(400);
  });

  it('rejects an empty body and a body past the limit', async () => {
    expect((await post({ ...valid, body: '' })).status).toBe(400);
    expect((await post({ ...valid, body: 'x'.repeat(20_001) })).status).toBe(400);
  });

  it('rejects a non-uuid card id before any statement is issued', async () => {
    const { status, statements } = await post({ ...valid, cardId: 'not-a-uuid' });
    expect(status).toBe(400);
    expect(statements).toEqual([]);
  });

  it('writes the card id the lookup resolved, not the one the body sent', async () => {
    const { statements } = await post(valid, { card: { cardId: CARD, engagementId: ENGAGEMENT } });
    expect(insertedValues(theStatement(statements, INSERT)).card_id).toBe(CARD);
  });
});

describe('internal comments, and the parent defences at the route', () => {
  it('lets an agency member write an internal comment — the reason this route exists', async () => {
    const { status, statements } = await post({ ...valid, internal: true });
    expect(status).toBe(201);
    expect(insertedValues(theStatement(statements, INSERT)).internal).toBe(true);
  });

  it('defaults to a public comment when the flag is absent', async () => {
    const { statements } = await post(valid);
    expect(insertedValues(theStatement(statements, INSERT)).internal).toBe(false);
  });

  it('forces a reply under an internal root internal, even when the caller asks for public', async () => {
    const { statements } = await post(
      { ...valid, parentId: PARENT, internal: false },
      { parent: { id: PARENT, parentId: null, internal: true } },
    );
    expect(
      insertedValues(theStatement(statements, INSERT)).internal,
      'a public reply under an internal root puts half an internal conversation on the ' +
        'client’s screen with its root missing',
    ).toBe(true);
  });

  it('refuses a reply to a reply through the route as well as at the domain', async () => {
    const { status, statements } = await post(
      { ...valid, parentId: PARENT },
      { parent: { id: PARENT, parentId: 'the-root', internal: false } },
    );
    expect(status).toBe(400);
    expect(statements.filter((s) => INSERT.test(s.sql))).toEqual([]);
  });

  it('refuses a parent that is not on this card, with nothing written', async () => {
    const { status, statements } = await post({ ...valid, parentId: PARENT }, { parent: null });
    expect(status).toBe(404);
    expect(statements.filter((s) => INSERT.test(s.sql))).toEqual([]);
  });
});

describe('an internal comment announces nothing', () => {
  /**
   * `GET /api/client/events` filters a frame on whether the contact can see the
   * *card*, which an internal comment's card usually is. The frame carries no
   * body — but its arrival is a signal, and "something was just said about your
   * card" is precisely the fact an internal thread exists to withhold. Both
   * sides share the bus, so there is no way to tell one and not the other.
   *
   * Assertable here because `publishEvent()` emits `pg_notify` through the same
   * executor: the presence or absence of that statement is the whole question,
   * and it needs no live bus to observe.
   */
  it('publishes comment.created for a public comment', async () => {
    const { statements } = await post(valid);
    const notify = statements.filter((s) => NOTIFY.test(s.sql));
    expect(notify.length, 'a public comment published no event').toBe(1);
    expect(JSON.stringify(notify[0]?.params ?? [])).toContain('comment.created');
  });

  it('publishes nothing at all for an internal comment', async () => {
    const { statements } = await post({ ...valid, internal: true });
    expect(
      statements.filter((s) => NOTIFY.test(s.sql)),
      'an internal comment announced itself; the frame’s arrival is the leak, ' +
        'whatever the frame contains',
    ).toEqual([]);
  });

  it('publishes nothing for a reply forced internal by its root', async () => {
    // The case the route cannot decide from its own input: `internal: false`
    // was asked for and the comment is internal anyway, so the publish gate has
    // to read the *written* row rather than the request.
    const { statements } = await post(
      { ...valid, parentId: PARENT, internal: false },
      { parent: { id: PARENT, parentId: null, internal: true } },
    );
    expect(
      statements.filter((s) => NOTIFY.test(s.sql)),
      'the publish gate read the request rather than what was written',
    ).toEqual([]);
  });

  it('publishes nothing when the write was refused', async () => {
    const { statements } = await post(valid, { engagement: { id: ENGAGEMENT, status: 'archived' } });
    expect(statements.filter((s) => NOTIFY.test(s.sql))).toEqual([]);
  });
});
