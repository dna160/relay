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

