/**
 * INV-1 — no client-facing response ever contains a private lane, a private
 * card, an agency-only state, an unpublished version, or an internal field.
 *
 * Never edit this file to make a build pass. If it fails, the code is wrong.
 * Every new query function reachable by a client contact needs a case here.
 */

import { describe, expect, it } from 'vitest';
import {
  toClientBoard,
  toClientCard,
  type CardRow,
  type LaneRow,
  type VersionRow,
} from '../../src/domain/projection/client-view';

const lanes: LaneRow[] = [
  { id: 'l1', name: 'Deliverables', position: 0, visibility: 'published' },
  { id: 'l2', name: 'Internal QA', position: 1, visibility: 'private' },
];

const baseCard = {
  description: null,
  dueAt: null,
  roundsUsed: 0,
  contractedRounds: 2,
  visibilityOverride: 'inherit' as const,
  assigneeId: 'u1',
  internalNotes: 'client is difficult; do not show',
  effortEstimate: 13,
};

const cards: CardRow[] = [
  { ...baseCard, id: 'c1', laneId: 'l1', title: 'Key art', state: 'awaiting_client', position: 0 },
  { ...baseCard, id: 'c2', laneId: 'l1', title: 'Unstarted', state: 'draft', position: 1 },
  { ...baseCard, id: 'c3', laneId: 'l1', title: 'Being reviewed', state: 'internal_review', position: 2 },
  { ...baseCard, id: 'c4', laneId: 'l1', title: 'Hidden one', state: 'in_progress', position: 3, visibilityOverride: 'private' },
  { ...baseCard, id: 'c5', laneId: 'l2', title: 'QA notes', state: 'in_progress', position: 0 },
];

const versions: VersionRow[] = [
  { id: 'v1', cardId: 'c1', versionNo: 1, filename: 'art-v1.png', sizeBytes: 10, sha256: 'a'.repeat(64), publishedToClientAt: new Date('2026-01-01') },
  { id: 'v2', cardId: 'c1', versionNo: 2, filename: 'art-v2.png', sizeBytes: 20, sha256: 'b'.repeat(64), publishedToClientAt: null },
];

describe('INV-1 client projection', () => {
  const board = toClientBoard(lanes, cards, versions);
  const flat = JSON.stringify(board);

  it('omits private lanes entirely', () => {
    expect(board.map((l) => l.id)).toEqual(['l1']);
    expect(flat).not.toContain('QA notes');
  });

  it('omits draft cards', () => {
    expect(flat).not.toContain('Unstarted');
  });

  it('omits cards overridden to private', () => {
    expect(flat).not.toContain('Hidden one');
  });

  it('collapses internal_review to in_progress', () => {
    const reviewed = board[0]!.cards.find((c) => c.id === 'c3');
    expect(reviewed?.state).toBe('in_progress');
    expect(flat).not.toContain('internal_review');
  });

  it('omits versions not published to the client', () => {
    const card = board[0]!.cards.find((c) => c.id === 'c1');
    expect(card?.versions.map((v) => v.versionNo)).toEqual([1]);
    expect(flat).not.toContain('art-v2.png');
  });

  it('never emits an internal field', () => {
    for (const key of ['assigneeId', 'internalNotes', 'effortEstimate', 'possession']) {
      expect(flat).not.toContain(key);
    }
    expect(flat).not.toContain('do not show');
  });

  it('flags only awaiting_client cards as awaiting the client', () => {
    const awaiting = board[0]!.cards.filter((c) => c.awaitingYou).map((c) => c.id);
    expect(awaiting).toEqual(['c1']);
  });
});

/* ------------------------------------------------------------------------ */
/* Strengthening, added when tests/fixtures landed. The cases above assert    */
/* the projection against a minimal hand-written board; these assert it       */
/* against the shared fixture, which every other suite and the e2e run also   */
/* use. A leak that only shows up on the richer board is still a leak.        */
/* ------------------------------------------------------------------------ */

import {
  CARD,
  EXPECTED_CLIENT_VISIBLE,
  MUST_NOT_LEAK,
  cards as fixtureCards,
  lanes as fixtureLanes,
  versions as fixtureVersions,
} from '@tests/fixtures';

describe('INV-1 against the shared fixture board', () => {
  const board = toClientBoard([...fixtureLanes], [...fixtureCards], [...fixtureVersions]);
  const flat = JSON.stringify(board);

  it('emits exactly the lanes, cards and versions the client is entitled to', () => {
    expect(board.map((l) => l.id)).toEqual([...EXPECTED_CLIENT_VISIBLE.laneIds]);
    expect(board.flatMap((l) => l.cards).map((c) => c.id).sort()).toEqual(
      [...EXPECTED_CLIENT_VISIBLE.cardIds].sort(),
    );
    expect(
      board.flatMap((l) => l.cards).flatMap((c) => c.versions).map((v) => v.id).sort(),
    ).toEqual([...EXPECTED_CLIENT_VISIBLE.versionIds].sort());
  });

  it('leaks none of the strings the fixture marks as agency-only', () => {
    for (const secret of MUST_NOT_LEAK) {
      expect(flat, `leaked: ${secret}`).not.toContain(secret);
    }
  });

  it('never emits a storage key, an actor id, or an internal note', () => {
    for (const key of ['storageKey', 'storage_key', 'assigneeId', 'internalNotes', 'effortEstimate', 'possession', 'visibilityOverride']) {
      expect(flat, key).not.toContain(key);
    }
  });

  it('emits no card in a state the client contract cannot represent', () => {
    for (const card of board.flatMap((l) => l.cards)) {
      expect(['draft', 'internal_review']).not.toContain(card.state);
    }
  });

  it('hides the unpublished third version of the three-version card', () => {
    const card = board.flatMap((l) => l.cards).find((c) => c.id === CARD.awaitingClient);
    expect(card?.versions.map((v) => v.versionNo)).toEqual([2, 1]);
  });
});

describe('INV-1 at the exported card serialiser', () => {
  /**
   * `toClientCard` is exported and therefore client-reachable. It now checks
   * visibility itself rather than trusting its caller: `toClientBoard` filters
   * first and this guard never fires, but the second caller will not filter,
   * and this is what stops them leaking. Hardened by the architect in round 2
   * after QA reported it; this suite asserts the fix rather than describing the
   * defect.
   */

  const publishedLane: LaneRow = { id: 'l1', name: 'Deliverables', position: 0, visibility: 'published' };
  const privateLane: LaneRow = { id: 'l2', name: 'Internal QA', position: 1, visibility: 'private' };
  const base = {
    description: null, dueAt: null, roundsUsed: 0, contractedRounds: 2,
    visibilityOverride: 'inherit' as const, assigneeId: 'u1',
    internalNotes: 'do not show', effortEstimate: 13,
  };

  it('refuses to serialise a draft card', () => {
    const draft: CardRow = { ...base, id: 'x1', laneId: 'l1', title: 'Unstarted', state: 'draft', position: 0 };
    expect(() => toClientCard(draft, publishedLane, [])).toThrow(/state is draft/);
  });

  it('refuses to serialise a card in a private lane', () => {
    const card: CardRow = { ...base, id: 'x2', laneId: 'l2', title: 'QA notes', state: 'in_progress', position: 0 };
    expect(() => toClientCard(card, privateLane, [])).toThrow(/lane is private/);
  });

  it('refuses to serialise a card overridden to private', () => {
    const card: CardRow = {
      ...base, id: 'x3', laneId: 'l1', title: 'Hidden one', state: 'in_progress',
      position: 0, visibilityOverride: 'private',
    };
    expect(() => toClientCard(card, publishedLane, [])).toThrow(/overridden to private/);
  });

  it('refuses a lane that does not own the card, so a caller cannot supply a permissive one', () => {
    const card: CardRow = { ...base, id: 'x4', laneId: 'l2', title: 'QA notes', state: 'in_progress', position: 0 };
    expect(() => toClientCard(card, publishedLane, [])).toThrow(/does not own this card/);
  });

  it('serialises a visible card, so the guard is not simply refusing everything', () => {
    const card: CardRow = { ...base, id: 'x5', laneId: 'l1', title: 'Key art', state: 'awaiting_client', position: 0 };
    const out = toClientCard(card, publishedLane, []);
    expect(out.state).toBe('awaiting_client');
    expect(JSON.stringify(out)).not.toContain('do not show');
  });
});


/* ========================================================================== */
/* ADR-006 — the guard, made mechanical.                                      */
/*                                                                            */
/* CLAUDE.md: "Every new query function that can be reached by a client       */
/* contact needs a case in tests/invariants/visibility.spec.ts. No            */
/* exceptions." That was a sentence someone had to remember, and ADR-006 says */
/* the guard is mechanical rather than procedural. Two phases carried the     */
/* same EXIT condition with nothing behind it.                                */
/*                                                                            */
/* Below: the query layer is enumerated from source, diffed against the       */
/* registry, and each entry is then required to name a real case in this file.*/
/* A new client-reachable query fails the build until someone writes its case.*/
/* ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clientScopedQueries, queriesImportedByClientRoutes } from './_source';
import {
  CAPTURE_SESSION,
  capture,
  captureScope,
  captureWithResult,
  columnsSelected,
  tablesTouched,
  type CapturedStatement,
} from './_query-capture';
import {
  loadClientBoard,
  loadClientDecidableVersion,
  loadClientDownloadTarget,
  loadClientEngagementHeader,
  loadClientQueue,
  loadClientShelf,
  loadClientVisibleCardId,
} from '@/db/queries/client-board';
import { findContact, loadLinkableEngagement } from '@/db/queries/client-auth';
import { loadClientVisibleNotes } from '@/db/queries/revision-notes';

/** This file, read back, so the registry can be checked against real cases. */
const THIS_SPEC = readFileSync(fileURLToPath(import.meta.url), 'utf8');

/**
 * Every client-reachable query, and the case that covers it.
 *
 * The key set is checked against the source tree, so it cannot silently fall
 * behind. The values are checked against the `it()` titles in this file, so an
 * entry cannot be satisfied by adding a line to this map.
 */
const COVERED_BY: Readonly<Record<string, string>> = {
  loadClientBoard:
    'the board read filters lane, card and version visibility in SQL, not afterwards',
  loadClientQueue:
    'the queue compiles the same statements as the board, so it cannot be a second unfiltered path',
  loadClientEngagementHeader:
    'the header joins the contact through the engagement, so another engagement’s contact matches nothing',
  loadClientDownloadTarget:
    'a download resolves only through published version, published lane and visible card',
  loadClientVisibleCardId:
    'a card id is resolved through the same predicate the board uses',
  loadClientDecidableVersion:
    'the version a decision binds to is resolved through the published-version predicate',
  loadClientShelf:
    'the shelf reads reference files scoped to the engagement and marked client-visible',
  loadClientVisibleNotes:
    'the revision thread carries no identifier and no internal note, and is narrowed by the engagement',
};

/**
 * Reached from a client route, and deliberately not covered by a case of their
 * own in the SQL sweep. Each needs a reason, and each has one somewhere in this
 * file — an entry here without a case below is a hole with a comment on it.
 */
const COVERED_ELSEWHERE: Readonly<Record<string, string>> = {
  clientScope:
    'the scope constructor itself, not a query. Asserted by INV-6’s suite: it cannot be built from a request.',
  loadLinkableEngagement:
    'a pre-session read; see “the two reads that happen before a session exists” below',
  findContact:
    'a pre-session read; see “the two reads that happen before a session exists” below',
};

/** Columns that must never appear in a select list on a client-reachable read. */
const AGENCY_ONLY_COLUMNS = [
  'internal_notes',
  'assignee_id',
  'effort_estimate',
  'actor_user_id',
  'decided_by_user_id',
];

/**
 * A statement is scoped when it carries at least one predicate that came from
 * the session. Not every statement can carry the engagement id — the version
 * leg of a board read is constrained to card ids the previous, scoped statement
 * produced — but every statement must be narrowed by *something* the client
 * cannot choose.
 */
function isScoped(statement: CapturedStatement): boolean {
  const byEngagement =
    /"engagement_id"\s*=\s*\$/.test(statement.sql) &&
    statement.params.includes(CAPTURE_SESSION.engagementId);
  const byLane = /"visibility"\s*=\s*\$/.test(statement.sql) && statement.params.includes('published');
  const byPublication = /"published_to_client_at"\s+is\s+not\s+null/i.test(statement.sql);
  const byContact = statement.params.includes(CAPTURE_SESSION.contactId);
  return byEngagement || byLane || byPublication || byContact;
}

describe('INV-1 the query layer is enumerated, not remembered', () => {
  const enumerated = clientScopedQueries();

  it('finds the client-reachable query layer at all, so an empty diff is not a pass', () => {
    expect(
      enumerated.length,
      'no exported function in src/db/queries/ takes a ClientScope. Either the ' +
        'query layer moved or this enumeration broke; both are worse than a failure.',
    ).toBeGreaterThan(0);
  });

  it('has a registered case for every query that takes a ClientScope', () => {
    const uncovered = enumerated
      .filter((fn) => !(fn.name in COVERED_BY))
      .map((fn) => `${fn.name} (${fn.file})`);
    expect(
      uncovered,
      'a client-reachable query with no case in visibility.spec.ts. ADR-006: the ' +
        'guard is mechanical. Add the case, then add it to COVERED_BY.',
    ).toEqual([]);
  });

  /**
   * The same boundary, computed the other way. A query that takes a plain
   * `engagementId` because its caller resolved visibility first is invisible to
   * the signature check above — legitimately so, that is how `loadClientQueue`
   * is built — but it is still on a path a client contact can reach, and the
   * import graph sees it whatever its parameters say.
   *
   * `loadClientVisibleNotes` is exactly that case, and it is why this check
   * exists: the signature sweep alone reported full coverage while a
   * client-reachable read had none.
   */
  it('has a registered case for every query a client route actually imports', () => {
    const reachable = queriesImportedByClientRoutes();
    expect(reachable.length, 'no client route imports a query — the scan broke').toBeGreaterThan(3);
    const uncovered = reachable
      .filter((fn) => !(fn.name in COVERED_BY) && !(fn.name in COVERED_ELSEWHERE))
      .map((fn) => `${fn.name} (${fn.file})`);
    expect(
      uncovered,
      'a query reachable from a client route with no case in visibility.spec.ts. ' +
        'Taking an engagementId rather than a ClientScope does not put a read ' +
        'outside INV-1; it only puts it outside the signature check.',
    ).toEqual([]);
  });

  it('justifies every query it excuses from a case of its own', () => {
    const names = new Set(queriesImportedByClientRoutes().map((fn) => fn.name));
    const stale = Object.keys(COVERED_ELSEWHERE).filter((name) => !names.has(name));
    expect(stale, 'COVERED_ELSEWHERE excuses something no client route imports').toEqual([]);
    for (const [name, why] of Object.entries(COVERED_ELSEWHERE)) {
      expect(why.length, `${name} is excused without a reason`).toBeGreaterThan(30);
    }
  });

  it('carries no stale registry entry for a query that no longer exists', () => {
    const names = new Set([
      ...enumerated.map((fn) => fn.name),
      ...queriesImportedByClientRoutes().map((fn) => fn.name),
    ]);
    const stale = Object.keys(COVERED_BY).filter((name) => !names.has(name));
    expect(
      stale,
      'COVERED_BY names a function src/db/queries/ no longer exports. A registry ' +
        'that drifts is a registry that stops being evidence.',
    ).toEqual([]);
  });

  it('backs every registry entry with a real case in this file', () => {
    const missing = Object.entries(COVERED_BY)
      .filter(([, title]) => !THIS_SPEC.includes(`it('${title}'`))
      .map(([name, title]) => `${name} -> no it('${title}')`);
    expect(
      missing,
      'a registry entry with no test behind it. The map is the index, not the proof.',
    ).toEqual([]);
  });
});

describe('INV-1 at the query layer, against compiled SQL', () => {
  const scope = captureScope();

  it('the board read filters lane, card and version visibility in SQL, not afterwards', async () => {
    const statements = await capture((exec) => loadClientBoard(exec, scope));
    const sql = statements.map((s) => s.sql).join('\n');

    expect(statements.length, 'the board read compiled nothing').toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/"lanes"\."visibility"\s*=\s*\$/);
    expect(sql).toMatch(/"cards"\."state"\s*<>\s*\$/);
    expect(sql).toMatch(/"cards"\."visibility_override"\s*<>\s*\$/);
    expect(sql).toMatch(/"published_to_client_at"\s+is\s+not\s+null/i);

    const params = statements.flatMap((s) => [...s.params]);
    expect(params, 'the lane filter is not bound to published').toContain('published');
    expect(params, 'draft cards are not excluded in SQL').toContain('draft');
    expect(params, 'privately overridden cards are not excluded in SQL').toContain('private');
    expect(params).toContain(CAPTURE_SESSION.engagementId);

    for (const column of AGENCY_ONLY_COLUMNS) {
      expect([...columnsSelected(statements)], column).not.toContain(column);
    }
  });

  it('the queue compiles the same statements as the board, so it cannot be a second unfiltered path', async () => {
    const board = await capture((exec) => loadClientBoard(exec, scope));
    const queue = await capture((exec) => loadClientQueue(exec, scope));
    expect(
      queue.map((s) => s.sql),
      'the queue reached the database differently from the board. It is meant to be ' +
        'the board, filtered in memory — a second SQL path is a second thing to leak.',
    ).toEqual(board.map((s) => s.sql));
  });

  it('the header joins the contact through the engagement, so another engagement’s contact matches nothing', async () => {
    const statements = await capture((exec) =>
      loadClientEngagementHeader(exec, scope, new Date('2026-01-01T00:00:00.000Z')),
    );
    const sql = statements.map((s) => s.sql).join('\n');

    expect(sql).toMatch(/"client_contacts"\."engagement_id"\s*=\s*"engagements"\."id"/);
    const params = statements.flatMap((s) => [...s.params]);
    expect(params).toContain(CAPTURE_SESSION.contactId);
    expect(params).toContain(CAPTURE_SESSION.engagementId);

    const tables = tablesTouched(statements);
    for (const forbidden of ['lanes', 'cards', 'asset_versions']) {
      expect([...tables], `the header reached ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('a download resolves only through published version, published lane and visible card', async () => {
    const statements = await capture((exec) =>
      loadClientDownloadTarget(exec, scope, 'some-version-id'),
    );
    const sql = statements.map((s) => s.sql).join('\n');
    expect(sql).toMatch(/"published_to_client_at"\s+is\s+not\s+null/i);
    expect(sql).toMatch(/"lanes"\."visibility"\s*=\s*\$/);
    expect(sql).toMatch(/"cards"\."state"\s*<>\s*\$/);
    expect(sql).toMatch(/"cards"\."engagement_id"\s*=\s*\$/);
    expect(statements.flatMap((s) => [...s.params])).toContain(CAPTURE_SESSION.engagementId);
  });

  it('a card id is resolved through the same predicate the board uses', async () => {
    const statements = await capture((exec) =>
      loadClientVisibleCardId(exec, scope, 'some-card-id'),
    );
    const sql = statements.map((s) => s.sql).join('\n');
    expect(sql).toMatch(/"lanes"\."visibility"\s*=\s*\$/);
    expect(sql).toMatch(/"cards"\."state"\s*<>\s*\$/);
    expect(sql).toMatch(/"cards"\."visibility_override"\s*<>\s*\$/);
    expect(statements.flatMap((s) => [...s.params])).toContain(CAPTURE_SESSION.engagementId);
  });

  it('the version a decision binds to is resolved through the published-version predicate', async () => {
    const statements = await capture((exec) =>
      loadClientDecidableVersion(exec, scope, 'some-version-id'),
    );
    const sql = statements.map((s) => s.sql).join('\n');
    expect(sql).toMatch(/"published_to_client_at"\s+is\s+not\s+null/i);
    expect(sql).toMatch(/"lanes"\."visibility"\s*=\s*\$/);
    expect(sql).toMatch(/"cards"\."engagement_id"\s*=\s*\$/);
    expect(statements.flatMap((s) => [...s.params])).toContain(CAPTURE_SESSION.engagementId);
  });

  it('the shelf reads reference files scoped to the engagement and marked client-visible', async () => {
    const statements = await capture((exec) => loadClientShelf(exec, scope));
    const sql = statements.map((s) => s.sql).join('\n');
    expect(sql).toMatch(/"reference_files"\."engagement_id"\s*=\s*\$/);
    expect(sql).toMatch(/"client_visible"\s*=\s*\$/);
    const params = statements.flatMap((s) => [...s.params]);
    expect(params).toContain(CAPTURE_SESSION.engagementId);
    expect(params, 'agency-only reference files are not excluded in SQL').toContain(true);
  });

  it('the revision thread carries no identifier and no internal note, and is narrowed by the engagement', async () => {
    const { statements, result } = await captureWithResult((exec) =>
      loadClientVisibleNotes(exec, scope.engagementId, 'some-version-id'),
    );
    const sql = statements.map((s) => s.sql).join('\n');

    // Narrowed by the engagement, and by internal = false in SQL rather than in
    // the mapper — an internal note must not leave the database at all.
    expect(sql).toMatch(/"cards"\."engagement_id"\s*=\s*\$/);
    expect(sql).toMatch(/"revision_notes"\."internal"\s*=\s*\$/);
    const params = statements.flatMap((s) => [...s.params]);
    expect(params).toContain(CAPTURE_SESSION.engagementId);
    expect(params, 'internal notes are not excluded in SQL').toContain(false);

    /**
     * The read selects the author ids because it shares one statement with the
     * agency read; the client shape must not carry them. `MUST_NOT_LEAK` in the
     * fixtures lists a bare user uuid for exactly this reason — an id a client
     * can correlate is an identifier whether or not it has a name beside it.
     */
    const emitted = JSON.stringify(result ?? []);
    for (const key of ['authorUserId', 'authorContactId', 'internal', 'email']) {
      expect(emitted, `the client note shape emits ${key}`).not.toContain(key);
    }
  });

  /* One sweep over all of them, so a new query gets the floor for free. */

  const RUNNERS: ReadonlyArray<[string, (exec: Parameters<typeof loadClientBoard>[0]) => Promise<unknown>]> = [
    ['loadClientBoard', (exec) => loadClientBoard(exec, scope)],
    ['loadClientQueue', (exec) => loadClientQueue(exec, scope)],
    ['loadClientEngagementHeader', (exec) => loadClientEngagementHeader(exec, scope, new Date(0))],
    ['loadClientDownloadTarget', (exec) => loadClientDownloadTarget(exec, scope, 'v')],
    ['loadClientVisibleCardId', (exec) => loadClientVisibleCardId(exec, scope, 'c')],
    ['loadClientDecidableVersion', (exec) => loadClientDecidableVersion(exec, scope, 'v')],
    ['loadClientShelf', (exec) => loadClientShelf(exec, scope)],
    [
      'loadClientVisibleNotes',
      (exec) => loadClientVisibleNotes(exec, scope.engagementId, 'v'),
    ],
  ];

  it('runs every registered query, so the sweep below covers the whole layer', () => {
    expect(RUNNERS.map(([name]) => name).sort()).toEqual(Object.keys(COVERED_BY).sort());
  });

  it('narrows every statement it compiles by something the client did not choose', async () => {
    const offenders: string[] = [];
    for (const [name, run] of RUNNERS) {
      for (const statement of await capture(run)) {
        if (!isScoped(statement)) offenders.push(`${name}: ${statement.sql}`);
      }
    }
    expect(
      offenders,
      'an unscoped statement on a client-reachable read. Every row it returns is a ' +
        'row the session was never entitled to.',
    ).toEqual([]);
  });

  it('selects no agency-only column anywhere in the client-reachable layer', async () => {
    const offenders: string[] = [];
    for (const [name, run] of RUNNERS) {
      const selected = columnsSelected(await capture(run));
      for (const column of AGENCY_ONLY_COLUMNS) {
        if (selected.has(column)) offenders.push(`${name} selects ${column}`);
      }
    }
    expect(offenders, 'an internal column left the database on a client read').toEqual([]);
  });
});

/* ========================================================================== */
/* The two pre-session reads.                                                 */
/*                                                                            */
/* `loadLinkableEngagement` and `findContact` take no `ClientScope` — they    */
/* cannot, because the scope is built from the session this flow is about to  */
/* issue. They are therefore the only client-facing reads the enumeration     */
/* above cannot see, which makes them the two that need saying out loud.      */
/*                                                                            */
/* The claim is not "they are careful". It is that there is no lane, card or  */
/* file reachable from them at all.                                           */
/* ========================================================================== */

describe('INV-1 the two reads that happen before a session exists', () => {
  const OFF_LIMITS = [
    'lanes',
    'cards',
    'asset_versions',
    'reference_files',
    'approvals',
    'revision_notes',
    'state_transitions',
    'users',
    'organizations',
  ];

  it('the linkable-engagement read touches the engagements table and nothing else', async () => {
    const statements = await capture((exec) =>
      loadLinkableEngagement(exec, 'engagement-under-test'),
    );
    expect(statements.length, 'the read compiled nothing').toBe(1);
    expect([...tablesTouched(statements)]).toEqual(['engagements']);
    for (const table of OFF_LIMITS) {
      expect([...tablesTouched(statements)], table).not.toContain(table);
    }
  });

  it('the linkable-engagement read returns an id, a title and a status — nothing else', async () => {
    const statements = await capture((exec) =>
      loadLinkableEngagement(exec, 'engagement-under-test'),
    );
    expect([...columnsSelected(statements)].sort()).toEqual(['id', 'status', 'title']);
  });

  it('the contact lookup is scoped to one engagement, so the same email elsewhere is a different row', async () => {
    const statements = await capture((exec) =>
      findContact(exec, 'engagement-under-test', 'contact@client.example'),
    );
    expect(statements.length).toBe(1);
    const [statement] = statements;
    expect(statement?.sql).toMatch(/"client_contacts"\."engagement_id"\s*=\s*\$/);
    expect(statement?.sql).toMatch(/"client_contacts"\."email"\s*=\s*\$/);
    expect(statement?.params).toContain('engagement-under-test');
  });

  it('the contact lookup touches the client_contacts table and nothing else', async () => {
    const statements = await capture((exec) =>
      findContact(exec, 'engagement-under-test', 'contact@client.example'),
    );
    expect([...tablesTouched(statements)]).toEqual(['client_contacts']);
    for (const table of OFF_LIMITS) {
      expect([...tablesTouched(statements)], table).not.toContain(table);
    }
  });

  it('the contact lookup returns an id and a verification timestamp — never a token or an email body', async () => {
    const statements = await capture((exec) =>
      findContact(exec, 'engagement-under-test', 'contact@client.example'),
    );
    const selected = [...columnsSelected(statements)].sort();
    expect(selected).toEqual(['id', 'verified_at']);
    for (const column of ['token', 'code', 'secret', 'link']) {
      expect(selected.join(','), column).not.toContain(column);
    }
  });

  it('neither pre-session read can be handed a lane, card, or file id to widen it', () => {
    // Structural, and deliberately so: the signatures are the guarantee. A read
    // that takes no card id cannot be pointed at a card, whatever it selects.
    const signatures = clientScopedQueries().map((fn) => fn.name);
    expect(signatures).not.toContain('loadLinkableEngagement');
    expect(signatures).not.toContain('findContact');
    expect(loadLinkableEngagement.length, 'loadLinkableEngagement(exec, engagementId)').toBe(2);
    expect(findContact.length, 'findContact(exec, engagementId, email)').toBe(3);
  });
});
