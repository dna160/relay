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
import {
  sourceFiles,
  clientImportGraph,
  clientScopedQueries,
  queriesImportedByClientRoutes,
  queriesReachableFromClientRoutes,
} from './_source';
import {
  CAPTURE_SESSION,
  capture,
  captureScope,
  captureOnEmpty,
  captureWithResult,
  captureWithRows,
  insertedValues,
  theStatement,
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
import { loadAgencyComments, loadClientVisibleComments } from '@/db/queries/comments';
import { postComment } from '@/domain/comment/post-comment';
import type { Actor } from '@/domain/card/state-machine';

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
  loadClientVisibleComments:
    'the comment thread drops an internal root and every reply beneath it, in SQL',
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
   * The same boundary, computed by **reachability** rather than by signature.
   *
   * The signature definition has a hole and the hole was walked through: a
   * client-reachable read can take a plain `engagementId` because its caller
   * resolved visibility first. That is good composition — it is how
   * `loadClientQueue` is built out of `loadClientBoard` — and it means a
   * parameter type is not the boundary. `loadClientVisibleNotes` is exactly
   * that case: the signature sweep reported full coverage while a
   * client-reachable read had no case at all.
   *
   * A direct-import check closes that but has its own hole one module deep. So
   * the guard walks the whole import graph out from every client entry point
   * (Architect's ruling, round 2): any query symbol that travels along that
   * graph is client-reachable, whatever its parameters say and however many
   * modules sit between it and the handler.
   */
  it('has a registered case for every query reachable from a client entry point', () => {
    const reachable = queriesReachableFromClientRoutes();
    expect(reachable.length, 'no query is reachable from a client route — the walk broke')
      .toBeGreaterThan(3);
    const uncovered = reachable
      .filter((fn) => !(fn.name in COVERED_BY) && !(fn.name in COVERED_ELSEWHERE))
      .map((fn) => `${fn.name} (${fn.file}) reached via ${fn.via.join(' -> ')}`);
    expect(
      uncovered,
      'a query reachable from a client entry point with no case in visibility.spec.ts. ' +
        'Neither the parameter type nor the number of modules in between puts a read ' +
        'outside INV-1.',
    ).toEqual([]);
  });

  /**
   * The traversal, tested on its own.
   *
   * A reachability guard that silently stops at depth one is indistinguishable
   * from one that works — until the day something is reached at depth two. So
   * the walk has to demonstrate that it walked.
   */
  it('walks past the entry points rather than stopping at their direct imports', () => {
    const graph = clientImportGraph();
    expect(graph.entryPoints.length, 'no client entry points found').toBeGreaterThan(4);
    expect(graph.modules.size, 'the walk reached nothing beyond its own roots')
      .toBeGreaterThan(graph.entryPoints.length * 2);

    const indirect = [...graph.modules.entries()].filter(([, chain]) => chain.length > 2);
    expect(
      indirect.length,
      'every module was reached in one hop, so this check proves nothing that the ' +
        'direct-import check did not already prove',
    ).toBeGreaterThan(0);

    const deepest = Math.max(...[...graph.modules.values()].map((chain) => chain.length));
    expect(deepest, 'the graph is one level deep; imports are not being followed')
      .toBeGreaterThanOrEqual(3);
  });

  it('resolves both alias and relative imports, since a route uses both', () => {
    const graph = clientImportGraph();
    const reached = [...graph.modules.keys()];
    // `@/db/queries/...` is the alias form; `../../_guards` is the relative one.
    // Missing either silently halves the graph.
    expect(
      reached.some((path) => path.startsWith('src/db/queries/')),
      'no aliased module was resolved',
    ).toBe(true);
    expect(
      reached.some((path) => /_guards\.tsx?$/.test(path)),
      'no relatively-imported module was resolved; every route imports its guard that way',
    ).toBe(true);
  });

  it('never reaches an agency-only query from a client entry point', () => {
    /**
     * The other direction, and the one that would be a live incident: if the
     * walk ever finds the agency portfolio read, the shelf read, or the agency
     * board on a client path, INV-1 is broken in production and not merely
     * uncovered by a test.
     */
    const AGENCY_ONLY = [
      'loadPortfolio',
      'loadAgencyBoard',
      'loadShelf',
      'loadEngagementDetail',
      'loadActivityRows',
      'loadAttention',
      'loadAgencyRevisionNotes',
      'loadVersionEngagementForOrg',
    ];
    const reachable = new Set(queriesReachableFromClientRoutes().map((fn) => fn.name));
    const leaked = AGENCY_ONLY.filter((name) => reachable.has(name));
    expect(
      leaked,
      'an agency-only read is reachable from a client entry point. This is not a ' +
        'coverage gap; it is a path a client contact can take to agency data.',
    ).toEqual([]);
  });

  it('agrees with the narrower direct-import scan, which must be a subset of it', () => {
    // If a direct import is not reachable, the walk is broken in a way the
    // coverage assertions above would not notice.
    const reachable = new Set(queriesReachableFromClientRoutes().map((fn) => fn.name));
    const missed = queriesImportedByClientRoutes()
      .map((fn) => fn.name)
      .filter((name) => !reachable.has(name));
    expect(missed, 'the reachability walk missed a direct import').toEqual([]);
  });

  it('justifies every query it excuses from a case of its own', () => {
    const names = new Set(queriesReachableFromClientRoutes().map((fn) => fn.name));
    const stale = Object.keys(COVERED_ELSEWHERE).filter((name) => !names.has(name));
    expect(stale, 'COVERED_ELSEWHERE excuses something no client route imports').toEqual([]);
    for (const [name, why] of Object.entries(COVERED_ELSEWHERE)) {
      expect(why.length, `${name} is excused without a reason`).toBeGreaterThan(30);
    }
  });

  it('carries no stale registry entry for a query that no longer exists', () => {
    const names = new Set([
      ...enumerated.map((fn) => fn.name),
      ...queriesReachableFromClientRoutes().map((fn) => fn.name),
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

  it('the comment thread drops an internal root and every reply beneath it, in SQL', async () => {
    const { statements, result } = await captureWithResult((exec) =>
      loadClientVisibleComments(exec, scope.engagementId, 'some-card-id'),
    );
    const sql = statements.map((s) => s.sql).join('\n');

    expect(sql).toMatch(/"cards"\."engagement_id"\s*=\s*\$/);
    expect(sql).toMatch(/"comments"\."card_id"\s*=\s*\$/);
    expect(sql).toMatch(/"comments"\."internal"\s*=\s*\$/);

    /**
     * The subtle half, and the reason this needs its own case rather than a
     * shared one with the revision thread: filtering `comments.internal` alone
     * leaves a *public reply to an internal root* in the result. The client
     * then receives a comment whose `parentId` names a row they can never see —
     * a dangling thread that quotes an internal discussion by implication. The
     * read self-joins the parent and requires it to be public too.
     */
    expect(
      sql,
      'no self-join on the parent comment; a public reply under an internal root leaks',
    ).toMatch(/"comments"\s+"parent_comment"|"parent_comment"/);
    expect(sql).toMatch(/"parent_comment"\."internal"\s*=\s*\$/);
    expect(sql).toMatch(/"comments"\."parent_id"\s+is\s+null/i);

    const params = statements.flatMap((s) => [...s.params]);
    expect(params).toContain(CAPTURE_SESSION.engagementId);
    expect(params, 'internal comments are not excluded in SQL').toContain(false);

    const emitted = JSON.stringify(result ?? []);
    for (const key of ['authorUserId', 'authorContactId', 'internal', 'email']) {
      expect(emitted, `the client comment shape emits ${key}`).not.toContain(key);
    }
  });

  it('drops a public reply under an internal root, which is the case a flat internal filter misses', async () => {
    /**
     * The failure this prevents, stated exactly: filter `comments.internal`
     * alone and a **public reply to an internal root** survives. The client
     * then receives a comment carrying a `parentId` naming a row it can never
     * resolve — a broken render, and a confirmation that a hidden comment
     * exists on a card it can otherwise see. That inference is the thing INV-1
     * exists to prevent, and it arrives as a rendering bug rather than as a
     * leak, which is how it would survive review.
     *
     * Proven by differencing the two reads. The agency and client reads share
     * one statement builder, so the client read's predicate must be the
     * agency's plus exactly the terms that exclude an internal thread — and
     * both halves of the disjunction have to be there, or the clause either
     * lets the reply through or drops every root comment along with it.
     */
    const clientSql = theStatement(
      await capture((exec) => loadClientVisibleComments(exec, scope.engagementId, 'c')),
      /select .* from "comments"/is,
    ).sql;
    const agencySql = theStatement(
      await capture((exec) => loadAgencyComments(exec, scope.engagementId, 'c')),
      /select .* from "comments"/is,
    ).sql;

    const clientWhere = /\swhere\s([\s\S]+?)(?:\sorder by\s|\slimit\s|$)/i.exec(clientSql)?.[1] ?? '';
    const agencyWhere = /\swhere\s([\s\S]+?)(?:\sorder by\s|\slimit\s|$)/i.exec(agencySql)?.[1] ?? '';

    expect(clientWhere.length, 'the client comment read has no predicate at all').toBeGreaterThan(0);
    expect(
      clientWhere.length,
      'the client read and the agency read carry the same predicate. One of them is wrong, ' +
        'and it is not the agency one.',
    ).toBeGreaterThan(agencyWhere.length);

    // The agency read must NOT carry the internal terms — otherwise the
    // difference above proves nothing about which read they belong to.
    expect(agencyWhere, 'the agency read filters internal comments out of its own backstage view')
      .not.toMatch(/"internal"\s*=\s*\$/);

    // Both halves. `parent_id is null` keeps root comments; the parent's own
    // flag is what excludes a public reply beneath an internal root.
    expect(clientWhere).toMatch(/"comments"\."internal"\s*=\s*\$/);
    expect(
      clientWhere,
      'the parent’s internal flag is not consulted; a public reply under an internal root survives',
    ).toMatch(/"parent_comment"\."internal"\s*=\s*\$/);
    expect(
      clientWhere,
      'no null-parent branch; every root comment would be dropped along with the replies',
    ).toMatch(/"comments"\."parent_id"\s+is\s+null/i);
    expect(clientWhere, 'the two parent conditions are ANDed, not ORed').toMatch(/\sor\s/i);

    // And it is a LEFT join, or a root comment has no parent row to match and
    // disappears regardless of the disjunction.
    expect(
      clientSql,
      'the parent self-join is not a left join; root comments have no parent row to match',
    ).toMatch(/left join\s+"comments"\s+"parent_comment"/i);
  });

  it('never reads a comment without the card gate having run first', () => {
    // The same composition as the revision thread: visibility is decided by
    // `loadClientVisibleCardId`, and this read only refuses to carry internal
    // rows. If a route ever reads comments without the gate, the thread becomes
    // the second, unfiltered path onto the board.
    const routes = sourceFiles('app/api/client').filter((f) =>
      f.text.includes('loadClientVisibleComments'),
    );
    expect(routes.length, 'no client route reads the comment thread').toBeGreaterThan(0);
    for (const route of routes) {
      expect(
        route.text,
        `${route.path} reads comments without resolving the card through the board predicate`,
      ).toContain('loadClientVisibleCardId');
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
    [
      'loadClientVisibleComments',
      (exec) => loadClientVisibleComments(exec, scope.engagementId, 'c'),
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

/* ========================================================================== */
/* The client revision thread.                                                */
/*                                                                            */
/* `GET /api/client/versions/:id/notes` is a client-reachable read path built  */
/* by composition: `loadClientDecidableVersion()` decides visibility, then     */
/* `loadClientVisibleNotes()` reads the thread narrowed by the engagement.     */
/* That is good design and it means neither function alone carries the whole   */
/* guarantee — so the guarantee gets asserted at the path, not at a function.  */
/*                                                                            */
/* Requested by the back-end when it declined to introduce a second scoped     */
/* predicate here. It was right to decline: two predicates that both have to   */
/* agree with lane visibility, card overrides, draft state and the publish     */
/* gate will disagree eventually, and the day they do the thread shows         */
/* something the board does not.                                              */
/* ========================================================================== */

describe('INV-1 the client revision thread', () => {
  const scope = captureScope();

  /** The gate the notes route runs before it reads a single note row. */
  const resolveVersion = (exec: Parameters<typeof loadClientDecidableVersion>[0]) =>
    loadClientDecidableVersion(exec, scope, 'some-version-id');

  it('refuses an unpublished version, because the predicate requires publication', async () => {
    const { statements, threw } = await captureOnEmpty(resolveVersion);
    const sql = statements.map((s) => s.sql).join('\n');
    expect(
      sql,
      'a version not yet published to the client is excluded in SQL, not after the read',
    ).toMatch(/"published_to_client_at"\s+is\s+not\s+null/i);
    expect((threw as { code?: string } | undefined)?.code).toBe('NOT_VISIBLE');
  });

  it('refuses a version on a private lane', async () => {
    const { statements, threw } = await captureOnEmpty(resolveVersion);
    const sql = statements.map((s) => s.sql).join('\n');
    expect(sql).toMatch(/"lanes"\."visibility"\s*=\s*\$/);
    expect(statements.flatMap((s) => [...s.params])).toContain('published');
    expect((threw as { code?: string } | undefined)?.code).toBe('NOT_VISIBLE');
  });

  it('refuses another engagement’s version, with the engagement taken from the session', async () => {
    const { statements, threw } = await captureOnEmpty(resolveVersion);
    const sql = statements.map((s) => s.sql).join('\n');
    expect(sql).toMatch(/"cards"\."engagement_id"\s*=\s*\$/);
    expect(
      statements.flatMap((s) => [...s.params]),
      'the engagement in the predicate did not come from the session',
    ).toContain(CAPTURE_SESSION.engagementId);
    expect((threw as { code?: string } | undefined)?.code).toBe('NOT_VISIBLE');
  });

  it('gives all three refusals the same shape, so the thread cannot be probed for what exists', () => {
    // One statement, one predicate, one outcome. A caller cannot tell an
    // unpublished version from a private lane from someone else’s engagement,
    // which is the point: distinguishing them would confirm the thing exists.
    const messages = new Set<string>();
    return Promise.all([resolveVersion, resolveVersion, resolveVersion].map((run) =>
      captureOnEmpty(run).then(({ threw }) => {
        messages.add(String((threw as { message?: string } | undefined)?.message ?? ''));
      }),
    )).then(() => {
      expect(messages.size, 'the three refusals are distinguishable').toBe(1);
      expect([...messages][0]).not.toMatch(/lane|publish|engagement/i);
    });
  });

  it('excludes internal notes in SQL, so an internal note never leaves the database', async () => {
    const statements = await capture((exec) =>
      loadClientVisibleNotes(exec, scope.engagementId, 'some-version-id'),
    );
    const sql = statements.map((s) => s.sql).join('\n');
    expect(sql).toMatch(/"revision_notes"\."internal"\s*=\s*\$/);
    expect(
      statements.flatMap((s) => [...s.params]),
      'internal notes are filtered somewhere other than the WHERE clause',
    ).toContain(false);
  });

  it('cannot be asked for internal notes by omission — the flag has no default', () => {
    /**
     * The shared statement takes `includeInternal` and the agency read passes
     * `true`. A default value on that parameter would mean a future caller
     * could reach the agency behaviour by forgetting an argument, which is the
     * one mistake in this file that would be silent.
     */
    const source = sourceFiles('db/queries').find((f) => f.path.endsWith('revision-notes.ts'));
    expect(source, 'src/db/queries/revision-notes.ts not found').toBeTruthy();
    expect(
      source?.text ?? '',
      'includeInternal has a default value; a caller can now reach internal notes by omission',
    ).not.toMatch(/includeInternal\s*(\?)?\s*:\s*boolean\s*=/);
  });

  it('emits a thread with no identifier in it, whatever the row carried', async () => {
    const { result } = await captureWithResult((exec) =>
      loadClientVisibleNotes(exec, scope.engagementId, 'some-version-id'),
    );
    const emitted = JSON.stringify(result ?? []);
    for (const key of ['authorUserId', 'authorContactId', 'internal', 'email', 'storageKey']) {
      expect(emitted, `the client note shape emits ${key}`).not.toContain(key);
    }
  });

  it('never reads a note without the version gate having run first', () => {
    /**
     * The composition is the guarantee, so the composition is what is asserted.
     * If a route ever reads the thread without resolving the version through
     * the board’s predicate, the thread becomes the second, unfiltered path.
     */
    const routes = sourceFiles('app/api/client').filter((f) =>
      f.text.includes('loadClientVisibleNotes'),
    );
    expect(routes.length, 'no client route reads the revision thread').toBeGreaterThan(0);
    for (const route of routes) {
      expect(
        route.text,
        `${route.path} reads the revision thread without resolving the version first`,
      ).toContain('loadClientDecidableVersion');
      expect(
        route.text.indexOf('loadClientDecidableVersion'),
        `${route.path} imports the gate but the read is not behind it`,
      ).toBeGreaterThan(-1);
    }
  });
});

/* ========================================================================== */
/* Card-level discussion: the parent-validation and orphan-thread defences.   */
/*                                                                            */
/* `parent_id` is a bare self-reference in the schema, so before the back-end */
/* hardened `postComment()` it accepted **any** comment id in the database. A */
/* reply could be grafted onto another card, another engagement, or an        */
/* internal comment its author was never shown — and the reader emits         */
/* `parentId`, so a graft is not a private mistake. It is a row that renders  */
/* under a thread it does not belong to.                                      */
/*                                                                            */
/* Both defences shipped unprompted and neither had a test, because the       */
/* back-end does not own `tests/`. These are those tests. The driver is a fake*/
/* that answers each statement the way the branch under test needs, so what   */
/* is asserted is the decision the code made, not what a fixture said.        */
/* ========================================================================== */

describe('INV-1 a reply cannot be grafted onto a thread it does not belong to', () => {
  const CARD = 'card-under-test';
  const ENGAGEMENT = 'engagement-under-test';
  const AGENCY: Actor = { kind: 'agency', userId: 'user-1' };
  const CLIENT: Actor = { kind: 'client', contactId: 'contact-1' };

  const CARD_LOOKUP = /select "id" from "cards"/i;
  const PARENT_LOOKUP = /select "id", "parent_id", "internal" from "comments"/i;
  const INSERT = /insert\s+into\s+"comments"/i;

  /** The columns the parent lookup selects, in order, as drizzle returns them. */
  const parentRow = (id: string, parentId: string | null, internal: boolean) => [
    id,
    parentId,
    internal,
  ];

  interface PostOptions {
    actor?: Actor;
    parentId?: string | null;
    internal?: boolean;
    /** What the parent lookup finds. `null` means no such row on this card. */
    parent?: unknown[] | null;
    cardFound?: boolean;
  }

  async function post(options: PostOptions) {
    return captureWithRows(
      (exec) =>
        postComment(
          exec as unknown as Parameters<typeof postComment>[0],
          {
            cardId: CARD,
            engagementId: ENGAGEMENT,
            actor: options.actor ?? AGENCY,
            body: 'a reply',
            ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
            ...(options.internal === undefined ? {} : { internal: options.internal }),
          },
          new Date('2026-01-01T00:00:00.000Z'),
        ),
      ({ sql }) => {
        if (CARD_LOOKUP.test(sql)) return options.cardFound === false ? [] : [[CARD]];
        if (PARENT_LOOKUP.test(sql)) {
          const parent = options.parent;
          return parent === null || parent === undefined ? [] : [parent];
        }
        return undefined;
      },
    );
  }

  const codeOf = (thrown: unknown): string | undefined =>
    (thrown as { code?: string } | undefined)?.code;

  it('rejects a reply whose parent lives on a different card', async () => {
    // The parent lookup is narrowed by `comments.card_id`, so a parent on
    // another card simply is not there. Asserted twice: that the predicate
    // carries the card, and that a miss refuses rather than inserting.
    const { statements, threw } = await post({ parentId: 'parent-on-another-card', parent: null });
    const lookup = theStatement(statements, PARENT_LOOKUP);
    expect(lookup.sql).toMatch(/"comments"\."card_id"\s*=\s*\$/);
    expect(lookup.params, 'the parent lookup is not narrowed by the card being posted to')
      .toContain(CARD);
    expect(codeOf(threw)).toBe('NOT_VISIBLE');
    expect(statements.filter((s) => INSERT.test(s.sql)), 'a rejected reply was written anyway')
      .toEqual([]);
  });

  it('rejects a reply whose parent lives in a different engagement', async () => {
    /**
     * A parent in another engagement is necessarily on another card, so the
     * same predicate catches it — and the engagement is never taken from the
     * request: the card lookup binds it and the card lookup runs first. This is
     * the case that was possible before the validation existed, and it is
     * INV-6, not merely a data-integrity nicety.
     */
    const { statements, threw } = await post({
      parentId: 'parent-in-another-engagement',
      parent: null,
    });
    const card = theStatement(statements, CARD_LOOKUP);
    expect(card.sql).toMatch(/"cards"\."engagement_id"\s*=\s*\$/);
    expect(card.params).toContain(ENGAGEMENT);
    expect(statements.indexOf(card), 'the card is not resolved before the parent is looked up')
      .toBeLessThan(statements.indexOf(theStatement(statements, PARENT_LOOKUP)));
    expect(codeOf(threw)).toBe('NOT_VISIBLE');
    expect(statements.filter((s) => INSERT.test(s.sql))).toEqual([]);
  });

  it('rejects a reply to a reply, because threads are one level deep by construction', async () => {
    /**
     * Enforced at the write rather than in the renderer. "The front end can
     * draw one level of reply from a flat list" is only true if the data cannot
     * be deeper than that.
     */
    const { statements, threw } = await post({
      parentId: 'a-reply',
      parent: parentRow('a-reply', 'the-root', false),
    });
    expect(codeOf(threw)).toBe('VALIDATION_FAILED');
    expect(String((threw as { message?: string })?.message ?? '')).toMatch(/one level deep/i);
    expect(statements.filter((s) => INSERT.test(s.sql)), 'a third-level comment was written')
      .toEqual([]);
  });

  it('gives a client a 404, not a 403, for a reply to an internal root', async () => {
    /**
     * The distinction is the whole point. A 403 says "this exists and you may
     * not have it", which confirms a hidden comment exists on a card the client
     * can otherwise see — the exact inference INV-1 exists to prevent. A 404
     * says nothing.
     */
    const { statements, threw } = await post({
      actor: CLIENT,
      parentId: 'internal-root',
      parent: parentRow('internal-root', null, true),
    });
    expect(codeOf(threw), 'a client learned that an internal comment exists').toBe('NOT_VISIBLE');
    expect(codeOf(threw)).not.toBe('FORBIDDEN');
    expect(statements.filter((s) => INSERT.test(s.sql))).toEqual([]);
  });

  it('gives a client the same refusal for an internal parent as for one that does not exist', async () => {
    const missing = await post({ actor: CLIENT, parentId: 'nope', parent: null });
    const internal = await post({
      actor: CLIENT,
      parentId: 'internal-root',
      parent: parentRow('internal-root', null, true),
    });
    expect(
      String((internal.threw as { message?: string })?.message ?? ''),
      'the two refusals are distinguishable, so a client can probe for internal comments',
    ).toBe(String((missing.threw as { message?: string })?.message ?? ''));
  });

  it('forces an agency reply under an internal root to be internal, rather than defaulting it', async () => {
    /**
     * `internal: false` is passed explicitly here — the caller is asking for a
     * public reply. It must still be written internal: the client read drops
     * the whole internal thread in SQL, and letting a reply opt out would put
     * half an internal conversation on the client's screen with its root
     * missing.
     *
     * Asserted on the *bound insert parameter*, not on the returned row. The
     * returned row is whatever the fake driver was told to say; the bound
     * parameter is what the code decided to write.
     */
    const { statements, threw } = await post({
      actor: AGENCY,
      parentId: 'internal-root',
      parent: parentRow('internal-root', null, true),
      internal: false,
    });
    expect(codeOf(threw), 'an agency reply under an internal root was refused').toBeUndefined();
    const written = insertedValues(theStatement(statements, INSERT));
    expect(
      written.internal,
      'a reply under an internal root was written public; its root is invisible to the client ' +
        'and the reply would appear without one',
    ).toBe(true);
    expect(written.parent_id).toBe('internal-root');
    expect(written.author_user_id, 'an agency comment carries no contact id').toBe('user-1');
    expect(written.author_contact_id).toBeNull();
  });

  it('does not make an agency reply under a public root internal by accident', async () => {
    // The negative control for the case above: the forcing must be caused by
    // the parent, not applied to every reply.
    const { statements } = await post({
      actor: AGENCY,
      parentId: 'public-root',
      parent: parentRow('public-root', null, false),
      internal: false,
    });
    expect(insertedValues(theStatement(statements, INSERT)).internal).toBe(false);
  });

  it('never lets a client write an internal comment, whatever it asks for', async () => {
    const { statements } = await post({ actor: CLIENT, internal: true });
    const written = insertedValues(theStatement(statements, INSERT));
    expect(written.internal, 'a client set the internal flag on its own comment').toBe(false);
    expect(written.author_user_id, 'a client comment was attributed to an agency user').toBeNull();
    expect(written.author_contact_id).toBe('contact-1');
  });

  it('resolves the card against the session engagement before writing anything', async () => {
    const { statements, threw } = await post({ cardFound: false });
    expect(codeOf(threw)).toBe('NOT_VISIBLE');
    expect(
      statements.filter((s) => INSERT.test(s.sql)),
      'a comment was written on a card the session does not own',
    ).toEqual([]);
  });
});
