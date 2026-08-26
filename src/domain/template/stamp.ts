/**
 * The I/O half of stamping: take the graph `applyTemplate()` computed and write
 * it.
 *
 * Split from `apply.ts` on purpose, and the split is the whole design. Every
 * decision — what a lane is called, what order it is in, when a card is due,
 * what it inherits — happens in the pure function, where it is testable by
 * calling it twice. This file makes no decisions. It inserts what it is given
 * and it takes an `Executor`, so the caller's transaction is the transaction.
 *
 * **Stamping is one transaction.** A half-stamped board is worse than a failed
 * create: the agency sees a workspace that looks made and is missing three
 * lanes, and there is nothing in the product that tells them which three. This
 * function never opens one of its own — `openEngagement()` already holds a row
 * lock on the organisation for the plan gate, and joining that is what makes
 * "engagement row + memberships + board" a single atomic fact.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { cards, engagements, lanes } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { TemplateDefinition } from '@/lib/types';
import { applyTemplate, type StampedGraph } from './apply';

export interface StampTemplateInput {
  readonly engagementId: string;
  readonly definition: TemplateDefinition;
  /** The engagement's `started_at`; the origin for every relative due date. */
  readonly startedAt: Date;
  /**
   * Overridable for tests and for a deterministic replay. Production leaves it
   * alone and gets `uuidv7`, which is time-ordered — so a stamped board's ids
   * sort in the order the lanes were written, same as every other insert path.
   */
  readonly newId?: () => string;
}

export async function stampTemplate(
  exec: Executor,
  input: StampTemplateInput,
  now: Date,
): Promise<StampedGraph> {
  const graph = applyTemplate(input.definition, {
    engagementId: input.engagementId,
    startedAt: input.startedAt,
    now,
    newId: input.newId ?? uuidv7,
  });

  // Lanes before cards: `cards.lane_id` references `lanes`, and the ids were
  // minted before either insert, so there is no returning-id round trip here.
  if (graph.lanes.length > 0) {
    await exec.insert(lanes).values(graph.lanes.map((lane) => ({ ...lane })));
  }

  if (graph.cards.length > 0) {
    /**
     * `state` is not in this object. Not `state: 'draft'`, not
     * `state: undefined` — the column's default writes it, which keeps
     * `domain/card/state-machine.ts` the only place in the codebase that names
     * a card state on a write (INV-2). `StampedCard` has no such field, so this
     * is enforced by the type rather than by this comment.
     */
    await exec.insert(cards).values(graph.cards.map((card) => ({ ...card })));
  }

  /**
   * The shelf groups. Written even when empty, because this is also the
   * re-stamp path and "the template named no groups" has to be able to clear a
   * previous answer rather than leave a stale one.
   */
  await exec
    .update(engagements)
    .set({ shelfGroupLabels: [...graph.shelfGroups] })
    .where(eq(engagements.id, input.engagementId));

  return graph;
}
