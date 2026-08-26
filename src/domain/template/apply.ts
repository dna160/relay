/**
 * `applyTemplate()` — a definition in, an engagement graph out.
 *
 * ## Pure, and what that costs
 *
 * No `@/db/client` import, no `Executor` parameter, no `new Date()`, no
 * `uuidv7()` call. Everything non-deterministic is a parameter:
 *
 *   - `newId()`   — ids are minted at stamp time, so the definition can have
 *                   none (src/lib/types.ts, property 1).
 *   - `startedAt` — the origin the relative dates are measured from.
 *   - `now`       — the row timestamps.
 *
 * That is three injections and it buys the phase's exit condition outright:
 * *stamping a template twice produces structurally identical graphs.* With the
 * clock and the id factory outside, "identical modulo ids and timestamps" is a
 * property you can assert by calling the function twice with counters, rather
 * than a claim about a transaction. A version of this that read the clock
 * itself would make that test a race.
 *
 * It also buys Phase 12. Ingestion's safety model (INV-13) is that extraction
 * emits a `TemplateDefinition` a human confirms and only this function turns one
 * into lanes and cards — so this function must accept a definition that has no
 * `templates` row behind it. Nothing here mentions `templates`, by design.
 *
 * ## What it deliberately does not produce
 *
 * A `state`. Not a default, not `'draft'`, not a field left undefined for the
 * insert to fill: there is no `state` on `StampedCard` at all, so the insert
 * cannot pass one and `cards.state DEFAULT 'draft'` is what decides. That keeps
 * `domain/card/state-machine.ts` the only writer of that column (INV-2). A
 * stamped card starts where every card starts and moves only through the
 * machine.
 *
 * Nor an `assignee`, `internalNotes`, `effortEstimate`, or `roundsUsed`. A
 * template describes work, not who is doing it or how far along it is.
 */

import type { LaneVisibility, TemplateDefinition } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ApplyTemplateContext {
  /** The engagement being stamped. Already inserted; this only references it. */
  readonly engagementId: string;
  /**
   * The origin for every `dueAfterDays`. The engagement's `started_at`, which
   * `createEngagement()` sets to the creation moment — passed in rather than
   * assumed equal to `now` so that a re-stamp, a backdated import, or Phase
   * 12's "this SOW started on the 3rd" all land on the right calendar.
   */
  readonly startedAt: Date;
  /** `created_at` / `updated_at` for every row in the graph. */
  readonly now: Date;
  /** Injected so the function stays pure. Production passes `uuidv7`. */
  readonly newId: () => string;
}

/**
 * Rows, not entities. Deliberately the shape of an insert rather than of the
 * board projection: the caller's job is one `insert().values(graph.lanes)` per
 * table, and anything richer would tempt a second read.
 */
export interface StampedLane {
  readonly id: string;
  readonly engagementId: string;
  readonly name: string;
  readonly position: number;
  readonly visibility: LaneVisibility;
  readonly createdAt: Date;
}

export interface StampedCard {
  readonly id: string;
  readonly engagementId: string;
  readonly laneId: string;
  readonly title: string;
  readonly description: string | null;
  readonly position: number;
  readonly dueAt: Date | null;
  readonly contractedRounds: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StampedGraph {
  readonly lanes: readonly StampedLane[];
  readonly cards: readonly StampedCard[];
  /** Labels only. A shelf group is a label on a file, never a row of its own. */
  readonly shelfGroups: readonly string[];
}

/**
 * Positions are `0..n-1` in definition order, assigned here rather than carried
 * in the definition.
 *
 * A definition that carried its own positions could carry gaps, duplicates, or
 * a `position: 7` in a two-lane template, and every one of those is a board
 * that renders in an order nobody chose. Order is the array's order; the array
 * is the only place it lives.
 */
export function applyTemplate(
  definition: TemplateDefinition,
  ctx: ApplyTemplateContext,
): StampedGraph {
  const lanes: StampedLane[] = [];
  const cards: StampedCard[] = [];

  for (const [lanePosition, lane] of definition.lanes.entries()) {
    const laneId = ctx.newId();
    lanes.push({
      id: laneId,
      engagementId: ctx.engagementId,
      name: lane.name,
      position: lanePosition,
      // Stated, never defaulted. The column's `DEFAULT 'published'` answers
      // "nobody said" (ADR-006); a template always said, and a private lane
      // that silently published on a stamp is the INV-1 failure that hurts.
      visibility: lane.visibility,
      createdAt: ctx.now,
    });

    for (const [cardPosition, card] of lane.cards.entries()) {
      cards.push({
        id: ctx.newId(),
        engagementId: ctx.engagementId,
        laneId,
        title: card.title,
        description: card.description,
        position: cardPosition,
        dueAt: dueAtFrom(card.dueAfterDays, ctx.startedAt),
        // The card's own answer wins; the definition's default fills the
        // silence. `null` at both levels means "no contracted rounds", which is
        // what the nullable column means, so nothing translates it to a number.
        contractedRounds: card.contractedRounds ?? definition.contractedRoundsDefault,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    }
  }

  return { lanes, cards, shelfGroups: [...definition.shelfGroups] };
}

/**
 * `dueAfterDays` is a whole number of days from the start instant, not a
 * calendar-day walk.
 *
 * The calendar version needs a timezone, and there is no correct one to pick:
 * the agency, the client, and the server can be three. Adding `n × 24h` to the
 * start instant is timezone-free, exactly reversible (`deriveTemplateDefinition`
 * divides by the same constant), and wrong only by an hour twice a year — which
 * is a due date, not a deadline.
 */
function dueAtFrom(dueAfterDays: number | null, startedAt: Date): Date | null {
  if (dueAfterDays === null) return null;
  return new Date(startedAt.getTime() + dueAfterDays * DAY_MS);
}

export { DAY_MS as TEMPLATE_DAY_MS };
