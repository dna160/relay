/**
 * The client projection, beyond INV-1.
 *
 * `tests/invariants/visibility.spec.ts` asserts the safety property: nothing
 * private ever comes out. This file asserts the rest of the contract — order,
 * shape, nullability, purity — the things that are not leaks but are still
 * wrong, and that a client on a phone will notice first.
 *
 * Live from Phase 0: `client-view.ts` is a seed file and already exists.
 */

import { describe, expect, it } from 'vitest';
import {
  isCardVisibleToClient,
  isLaneVisibleToClient,
  toClientBoard,
  type CardRow,
  type LaneRow,
  type VersionRow,
} from '@/domain/projection/client-view';
import {
  CARD,
  EXPECTED_CLIENT_VISIBLE,
  LANE,
  MUST_NOT_LEAK,
  SHA,
  VERSION,
  cards,
  lanes,
  versions,
} from '@tests/fixtures';

/** The fixtures are readonly; copying also proves the projection cannot mutate them. */
const project = (
  l: readonly LaneRow[] = lanes,
  c: readonly CardRow[] = cards,
  v: readonly VersionRow[] = versions,
) => toClientBoard([...l], [...c], [...v]);

describe('ordering', () => {
  it('returns published lanes in position order regardless of input order', () => {
    const shuffled = [...lanes].reverse();
    const board = project(shuffled);
    expect(board.map((l) => l.id)).toEqual([...EXPECTED_CLIENT_VISIBLE.laneIds]);
    expect(board.map((l) => l.position)).toEqual([0, 1]);
  });

  it('returns cards in position order within their lane', () => {
    const board = project(lanes, [...cards].reverse());
    const first = board.find((l) => l.id === LANE.published);
    expect(first?.cards.map((c) => c.position)).toEqual([0, 2, 4]);
    expect(first?.cards.map((c) => c.id)).toEqual([CARD.awaitingClient, CARD.internalReview, CARD.empty]);
  });

  it('returns versions newest first, because the client wants the latest', () => {
    const card = project()
      .flatMap((l) => l.cards)
      .find((c) => c.id === CARD.awaitingClient);
    expect(card?.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(card?.versions[0]?.id).toBe(VERSION.v2);
  });
});

describe('shape and nullability', () => {
  const board = project();
  const byId = new Map(board.flatMap((l) => l.cards).map((c) => [c.id, c]));

  it('emits every card the client is entitled to and nothing else', () => {
    expect([...byId.keys()].sort()).toEqual([...EXPECTED_CLIENT_VISIBLE.cardIds].sort());
  });

  it('emits an empty versions array, never undefined, for a card with no uploads', () => {
    const empty = byId.get(CARD.empty);
    expect(empty).toBeDefined();
    expect(empty?.versions).toEqual([]);
  });

  it('keeps a published lane in the response even when every card in it is hidden', () => {
    // A lane that vanishes when its only card goes private tells the client
    // something changed. An empty lane tells them nothing, which is correct.
    const onlyHidden = cards.filter((c) => c.id === CARD.privateOverride);
    const board2 = toClientBoard([...lanes], [...onlyHidden], []);
    expect(board2.map((l) => l.id)).toEqual([...EXPECTED_CLIENT_VISIBLE.laneIds]);
    expect(board2[0]?.cards).toEqual([]);
  });

  it('serialises dates as ISO strings and absences as null', () => {
    const awaiting = byId.get(CARD.awaitingClient);
    expect(awaiting?.dueAt).toBe('2026-04-07T00:00:00.000Z');
    expect(byId.get(CARD.empty)?.dueAt).toBeNull();
    expect(awaiting?.versions[0]?.publishedAt).toBe('2026-03-30T00:00:00.000Z');
  });

  it('passes a null contracted-round count through rather than defaulting it', () => {
    // `null` means "no round budget agreed", which is not the same as zero.
    const boardWithNull = toClientBoard(
      [...lanes],
      cards.filter((c) => c.id === CARD.inPrivateLane).map((c) => ({ ...c, laneId: LANE.published })),
      [],
    );
    expect(boardWithNull[0]?.cards[0]?.contractedRounds).toBeNull();
  });

  it('shows a client their own round budget even when the agency has overrun it', () => {
    const breached = byId.get(CARD.changesRequested);
    expect(breached?.roundsUsed).toBe(3);
    expect(breached?.contractedRounds).toBe(2);
  });

  it('carries only the version fields the contract names', () => {
    const version = byId.get(CARD.awaitingClient)?.versions[0];
    expect(Object.keys(version ?? {}).sort()).toEqual([
      'filename',
      'id',
      'publishedAt',
      'sha256',
      'sizeBytes',
      'versionNo',
    ]);
    // storage_key in particular: a client with a key can construct a URL.
    expect(JSON.stringify(version)).not.toContain('storage');
  });
});

describe('awaitingYou', () => {
  const byId = new Map(project().flatMap((l) => l.cards).map((c) => [c.id, c]));

  it('is true only while the ball is actually with the client', () => {
    expect(byId.get(CARD.awaitingClient)?.awaitingYou).toBe(true);
  });

  it('is false once the client has acted, in every direction', () => {
    // changes_requested and signed_off are both "done, from the client's side".
    expect(byId.get(CARD.changesRequested)?.awaitingYou).toBe(false);
    expect(byId.get(CARD.signedOff)?.awaitingYou).toBe(false);
  });

  it('is false for work the agency is still holding', () => {
    expect(byId.get(CARD.internalReview)?.awaitingYou).toBe(false);
    expect(byId.get(CARD.empty)?.awaitingYou).toBe(false);
  });

  it('matches the decision queue: awaitingYou is the queue predicate', () => {
    // GET /api/client/queue returns cards where awaitingYou is true.
    const queue = project().flatMap((l) => l.cards).filter((c) => c.awaitingYou);
    expect(queue.map((c) => c.id)).toEqual([CARD.awaitingClient]);
  });
});

describe('version attribution', () => {
  it('never attaches a version belonging to another card', () => {
    const board = project();
    for (const lane of board) {
      for (const card of lane.cards) {
        for (const v of card.versions) {
          const source = versions.find((row) => row.id === v.id);
          expect(source?.cardId, `${v.filename} attached to the wrong card`).toBe(card.id);
        }
      }
    }
  });

  it('emits exactly the published versions across the whole board', () => {
    const emitted = project()
      .flatMap((l) => l.cards)
      .flatMap((c) => c.versions)
      .map((v) => v.id)
      .sort();
    expect(emitted).toEqual([...EXPECTED_CLIENT_VISIBLE.versionIds].sort());
  });

  it('never emits the hash of an unpublished version', () => {
    expect(JSON.stringify(project())).not.toContain(SHA.v3);
  });
});

describe('purity', () => {
  it('does not mutate the rows it is given', () => {
    const l = lanes.map((x) => ({ ...x }));
    const c = cards.map((x) => ({ ...x }));
    const v = versions.map((x) => ({ ...x }));
    const before = JSON.stringify({ l, c, v });
    toClientBoard(l, c, v);
    expect(JSON.stringify({ l, c, v })).toBe(before);
  });

  it('is deterministic across calls', () => {
    expect(JSON.stringify(project())).toBe(JSON.stringify(project()));
  });

  it('handles an empty board without throwing', () => {
    expect(toClientBoard([], [], [])).toEqual([]);
  });

  it('drops a card whose lane is not in the lane set rather than throwing', () => {
    // A lane can disappear between two reads. The projection must not 500 on it.
    const orphan: CardRow[] = [{ ...cards[0]!, laneId: 'lane-that-is-gone' }];
    expect(() => toClientBoard([...lanes], orphan, [])).not.toThrow();
    expect(toClientBoard([...lanes], orphan, []).flatMap((l) => l.cards)).toEqual([]);
  });
});

describe('the visibility predicates on their own', () => {
  const published = lanes.find((l) => l.id === LANE.published)!;
  const privateLane = lanes.find((l) => l.id === LANE.private)!;

  it('agree with the board for every fixture card', () => {
    for (const card of cards) {
      const lane = lanes.find((l) => l.id === card.laneId)!;
      const visible = isCardVisibleToClient(card, lane);
      expect(visible, `${card.title}`).toBe(EXPECTED_CLIENT_VISIBLE.cardIds.includes(card.id));
    }
  });

  it('treat a private lane as fatal regardless of the card override', () => {
    expect(isLaneVisibleToClient(privateLane)).toBe(false);
    const inherited = { ...cards[0]!, laneId: privateLane.id };
    expect(isCardVisibleToClient(inherited, privateLane)).toBe(false);
  });

  it('treat the card override as fatal regardless of the lane', () => {
    const overridden = { ...cards[0]!, visibilityOverride: 'private' as const };
    expect(isCardVisibleToClient(overridden, published)).toBe(false);
  });
});

describe('nothing on the internal list ever appears', () => {
  it('holds against the full fixture board', () => {
    const flat = JSON.stringify(project());
    for (const secret of MUST_NOT_LEAK) {
      expect(flat, `leaked: ${secret}`).not.toContain(secret);
    }
  });
});
