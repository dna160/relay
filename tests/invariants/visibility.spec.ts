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
