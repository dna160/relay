/**
 * The portfolio's attention list. Agency sessions only — a client contact sees
 * one engagement through `client-board.ts` and never a cross-engagement list,
 * so nothing in this file calls `clientScope()` and nothing in it is reachable
 * from a client route.
 *
 * Scoped to the org's **active** engagements. An archived engagement is
 * read-only and a purged one is gone; neither can be acted on, and an attention
 * list you cannot act on is a to-do list of regrets.
 */

import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { cards, engagements, stateTransitions } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { AttentionItem } from '@/lib/types';
import { rankAttention, type AttentionCardRow } from '@/domain/attention/rank';
import type { TransitionRow } from '@/domain/card/possession';

/**
 * The portfolio renders a list, not a ledger. A cap keeps one agency with four
 * hundred open cards from turning the home screen into a slow query; the tail
 * of a list ranked by actionability is by construction the part nobody acts on.
 */
export const ATTENTION_LIMIT = 50;

export async function loadAttention(
  exec: Executor,
  orgId: string,
  viewerUserId: string,
  now: Date,
  limit: number = ATTENTION_LIMIT,
): Promise<AttentionItem[]> {
  const engagementRows = await exec
    .select({ id: engagements.id, title: engagements.title })
    .from(engagements)
    .where(and(eq(engagements.orgId, orgId), eq(engagements.status, 'active')));

  if (engagementRows.length === 0) return [];
  const engagementIds = engagementRows.map((e) => e.id);
  const titleById = new Map(engagementRows.map((e) => [e.id, e.title]));

  const cardRows = await exec
    .select({
      cardId: cards.id,
      engagementId: cards.engagementId,
      cardTitle: cards.title,
      state: cards.state,
      assigneeId: cards.assigneeId,
      dueAt: cards.dueAt,
      roundsUsed: cards.roundsUsed,
      contractedRounds: cards.contractedRounds,
      createdAt: cards.createdAt,
    })
    .from(cards)
    // A signed-off card is finished; the ranker drops it too, but not reading
    // it is cheaper than reading it to throw it away.
    .where(and(inArray(cards.engagementId, engagementIds), ne(cards.state, 'signed_off')));

  if (cardRows.length === 0) return [];
  const cardIds = cardRows.map((c) => c.cardId);

  const transitions: TransitionRow[] = await exec
    .select({
      cardId: stateTransitions.cardId,
      toState: stateTransitions.toState,
      possession: stateTransitions.possession,
      occurredAt: stateTransitions.occurredAt,
    })
    .from(stateTransitions)
    .where(inArray(stateTransitions.cardId, cardIds));

  /**
   * The last movement per card, for the "silently rotting" bucket. Computed
   * from the transitions already in hand rather than with a second grouped
   * query — the set is the same rows and the arithmetic is a max().
   */
  const lastMoved = new Map<string, Date>();
  for (const t of transitions) {
    const current = lastMoved.get(t.cardId);
    if (!current || t.occurredAt.getTime() > current.getTime()) {
      lastMoved.set(t.cardId, t.occurredAt);
    }
  }

  const rows: AttentionCardRow[] = cardRows.map((c) => ({
    cardId: c.cardId,
    engagementId: c.engagementId,
    engagementTitle: titleById.get(c.engagementId) ?? '',
    cardTitle: c.cardTitle,
    state: c.state,
    assigneeId: c.assigneeId,
    dueAt: c.dueAt,
    roundsUsed: c.roundsUsed,
    contractedRounds: c.contractedRounds,
    // Never moved: the card has been sitting since it was created, and that is
    // exactly the silence the rot bucket is looking for.
    lastMovedAt: lastMoved.get(c.cardId) ?? c.createdAt,
  }));

  return rankAttention({ cards: rows, transitions, viewerUserId, now }).slice(0, limit);
}

/**
 * A cheap count for a badge, without ranking or serialising anything. Kept in
 * this file so that the definition of "needs attention" cannot drift from the
 * list — it is the same `WHERE`.
 */
export async function countAttentionCandidates(
  exec: Executor,
  orgId: string,
): Promise<number> {
  const rows = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(engagements, eq(engagements.id, cards.engagementId))
    .where(
      and(
        eq(engagements.orgId, orgId),
        eq(engagements.status, 'active'),
        ne(cards.state, 'signed_off'),
      ),
    );
  return rows[0]?.total ?? 0;
}
