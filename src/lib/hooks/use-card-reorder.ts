'use client';

/**
 * Reordering, and only reordering.
 *
 * Every path through this hook ends in one call: `POST /api/cards/reorder` with
 * a list of `{ cardId, laneId, position }`. There is no branch that can reach
 * the transition route, and `relocate` has no access to a card's state to
 * change it even if one were added. That is ADR-003 expressed as a shape rather
 * than as a comment: a board people can move by hand becomes a board that lies.
 *
 * Two details that are easy to get wrong:
 *
 * - Insert position is expressed as "before this card id" rather than as an
 *   index, because an index computed before the card is removed and applied
 *   after it is removed is off by one exactly when the move is within one lane.
 * - The batch carries a dense integer ordering for every lane the move touched,
 *   not a fractional midpoint for the one card. The route takes integers, and
 *   sending the whole ordering means a concurrent refresh cannot land on a
 *   half-applied sequence.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgencyCard, AgencyLane } from '@/lib/types';
import { type ApiFailure, type ReorderItem, agencyApi } from '@/lib/api-client';

export interface Relocation {
  lanes: AgencyLane[];
  items: ReorderItem[];
  card: AgencyCard;
  index: number;
  laneName: string;
  total: number;
}

/** Pure. Produces the optimistic board and the batch the API needs. */
export function relocate(
  lanes: AgencyLane[],
  cardId: string,
  toLaneId: string,
  beforeCardId: string | null,
): Relocation | null {
  const next: AgencyLane[] = lanes.map((l) => ({ ...l, cards: [...l.cards] }));

  let moved: AgencyCard | undefined;
  let fromLaneId: string | undefined;
  for (const lane of next) {
    const i = lane.cards.findIndex((c) => c.id === cardId);
    if (i >= 0) {
      moved = lane.cards[i];
      fromLaneId = lane.id;
      lane.cards.splice(i, 1);
      break;
    }
  }
  if (!moved || !fromLaneId) return null;

  const target = next.find((l) => l.id === toLaneId);
  if (!target) return null;

  const found = beforeCardId ? target.cards.findIndex((c) => c.id === beforeCardId) : -1;
  const index = found >= 0 ? found : target.cards.length;
  target.cards.splice(index, 0, { ...moved, laneId: toLaneId });

  // Renumber every lane the move touched, densely, from zero.
  const touched = new Set([fromLaneId, toLaneId]);
  const items: ReorderItem[] = [];
  for (const lane of next) {
    if (!touched.has(lane.id)) continue;
    lane.cards = lane.cards.map((c, i) => ({ ...c, position: i }));
    for (const [i, card] of lane.cards.entries()) {
      items.push({ cardId: card.id, laneId: lane.id, position: i });
    }
  }

  const placed = target.cards[index];
  if (!placed) return null;

  return { lanes: next, items, card: placed, index, laneName: target.name, total: target.cards.length };
}

export interface CardReorder {
  lanes: AgencyLane[];
  failure: ApiFailure | null;
  /** Read by an `aria-live` region so a keyboard move is audible. */
  announcement: string;
  move: (cardId: string, toLaneId: string, beforeCardId: string | null) => Promise<void>;
}

export function useCardReorder(engagementId: string, serverLanes: AgencyLane[]): CardReorder {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<AgencyLane[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // A fresh server render is the truth; drop the optimistic copy when one lands.
  useEffect(() => {
    setOptimistic(null);
  }, [serverLanes]);

  const lanes = optimistic ?? serverLanes;
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  const move = useCallback(
    async (cardId: string, toLaneId: string, beforeCardId: string | null) => {
      const next = relocate(lanesRef.current, cardId, toLaneId, beforeCardId);
      if (!next) return;

      setOptimistic(next.lanes);
      setAnnouncement(
        `${next.card.title} moved to ${next.laneName}, position ${next.index + 1} of ${next.total}.`,
      );

      const result = await agencyApi.reorderCards({ engagementId, items: next.items });

      if (!result.ok) {
        setOptimistic(null);
        setFailure(result);
        setAnnouncement(`${next.card.title} could not be moved. ${result.message}`);
        return;
      }

      setFailure(null);
      router.refresh();
    },
    [engagementId, router],
  );

  return { lanes, failure, announcement, move };
}
