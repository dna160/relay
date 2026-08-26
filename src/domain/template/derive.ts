/**
 * "Save this engagement as a template" — the inverse of `applyTemplate()`, and
 * also pure.
 *
 * This is the function that makes templates get used. Nobody writes a template
 * definition by hand; they finish a job they liked the shape of and want the
 * next one to start there. It is also where the no-absolute-dates rule earns
 * itself: a live card is due on the 14th, and the 14th is meaningless to the
 * engagement that starts in March.
 *
 * ## What is dropped, and why the type does the dropping
 *
 * `TemplateCard` has four fields. A live card has sixteen columns. Everything
 * absent is absent because there is no field to put it in:
 *
 *   - **ids** — minted at stamp time (src/lib/types.ts, property 1).
 *   - **state / roundsUsed** — a template describes work, not its progress. A
 *     saved board that remembered `approved` would stamp a card the client had
 *     never seen into a state that says they signed it off, and it would do so
 *     without going through the machine (INV-2).
 *   - **assignee / internalNotes / effortEstimate** — internal fields. Note
 *     that this is the structural half of INV-1 pointing the other way: a
 *     template is agency-side, but it is also a thing that gets shared and
 *     re-stamped, and internal notes about a *previous client* riding along
 *     into the next engagement is the leak nobody would test for.
 *   - **versions, approvals, comments, files** — a template stamps the request,
 *     never the answer.
 *
 * Private lanes keep their visibility. A template is an agency artefact and the
 * private lane is usually the reason the shape was worth saving.
 */

import type { LaneVisibility, TemplateCard, TemplateDefinition, TemplateLane } from '@/lib/types';
import { TEMPLATE_LIMITS } from './definition';
import { TEMPLATE_DAY_MS } from './apply';

export interface LiveLaneRow {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly visibility: LaneVisibility;
}

export interface LiveCardRow {
  readonly laneId: string;
  readonly title: string;
  readonly description: string | null;
  readonly position: number;
  readonly dueAt: Date | null;
  readonly contractedRounds: number | null;
}

export interface DeriveTemplateInput {
  /**
   * The engagement's origin. `started_at` when it has one, `created_at`
   * otherwise — resolved by the caller, because "which timestamp is the start"
   * is a question about the engagement row and this function has no row.
   */
  readonly startedAt: Date;
  readonly lanes: readonly LiveLaneRow[];
  readonly cards: readonly LiveCardRow[];
  /** Labels currently on the shelf, stamped or file-derived. */
  readonly shelfGroups: readonly string[];
  /** The engagement's `contracted_rounds_default`. */
  readonly contractedRoundsDefault: number | null;
}

/**
 * ## Dates round-trip exactly
 *
 * `dueAfterDays` is the *rounded* day count, so a card due at 09:00 on day 3 of
 * an engagement that began at 14:00 saves as 3, not 2.79. The stamp then places
 * it at exactly `start + 3 days`, and deriving that board gives 3 again. The
 * rounding happens once, on the way in.
 *
 * ## Contracted rounds settle after one trip, and that is not a bug
 *
 * derive → apply → derive is a **fixed point from the second derivation on**,
 * not from the first, and the one field that moves is `contractedRounds`. A
 * card that stated no rounds of its own inherits `contractedRoundsDefault` at
 * stamp time, so the stamped card genuinely *has* that number and deriving the
 * new board reads it back as stated rather than inherited.
 *
 * Nothing here tries to undo that by re-nulling a card whose count happens to
 * equal the default. It cannot be done correctly: a card deliberately set to
 * two rounds and a card that inherited two are the same row, and guessing wrong
 * would silently re-point a card at whatever the *next* template's default
 * turns out to be. The board is identical either way; only the definition's
 * description of how it got there flattens, once.
 */
export function deriveTemplateDefinition(input: DeriveTemplateInput): TemplateDefinition {
  const byLane = new Map<string, LiveCardRow[]>();
  for (const card of input.cards) {
    const bucket = byLane.get(card.laneId);
    if (bucket) bucket.push(card);
    else byLane.set(card.laneId, [card]);
  }

  // Sorted here, not trusted from the query. `position` is the board's order
  // and it is what the next stamp will renumber from 0; a definition built in
  // whatever order the rows came back is a template that shuffles.
  const orderedLanes = [...input.lanes].sort(byPosition).slice(0, TEMPLATE_LIMITS.LANES_MAX);

  let budget = TEMPLATE_LIMITS.CARDS_MAX;
  const lanes: TemplateLane[] = orderedLanes.map((lane) => {
    const laneCards = [...(byLane.get(lane.id) ?? [])].sort(byPosition).slice(0, budget);
    budget -= laneCards.length;
    return {
      name: truncate(lane.name.trim(), TEMPLATE_LIMITS.LANE_NAME_MAX),
      visibility: lane.visibility,
      cards: laneCards.map((card): TemplateCard => toTemplateCard(card, input.startedAt)),
    };
  });

  const shelfGroups = dedupe(
    input.shelfGroups
      .map((label) => truncate(label.trim(), TEMPLATE_LIMITS.SHELF_GROUP_LABEL_MAX))
      .filter((label) => label.length > 0),
  ).slice(0, TEMPLATE_LIMITS.SHELF_GROUPS_MAX);

  return {
    version: 1,
    lanes,
    shelfGroups,
    contractedRoundsDefault: clampRounds(input.contractedRoundsDefault),
  };
}

function toTemplateCard(card: LiveCardRow, startedAt: Date): TemplateCard {
  return {
    title: truncate(card.title.trim(), TEMPLATE_LIMITS.CARD_TITLE_MAX),
    description:
      card.description === null
        ? null
        : truncate(card.description, TEMPLATE_LIMITS.CARD_DESCRIPTION_MAX),
    contractedRounds: clampRounds(card.contractedRounds),
    dueAfterDays: dueAfterDaysFrom(card.dueAt, startedAt),
  };
}

/**
 * The whole point of the phase's "no absolute dates" rule, in four lines.
 *
 * Two clamps, both deliberate:
 *
 *   - **Negative becomes 0.** A card due before the engagement started is a
 *     real thing on a real board — a deadline inherited from the contract, or
 *     a start date corrected afterwards — but "days after the start" has no
 *     room for it, and a template that stamped a card already overdue on day
 *     one would put every new workspace into breach on creation. Day zero is
 *     the honest reading: due immediately.
 *   - **Beyond the cap becomes null.** A due date ten years out is a typo or a
 *     placeholder, and carrying it forward would fail `parseTemplateDefinition`
 *     on the way back in — a save that produces an unreadable row is worse than
 *     a save that drops one date.
 */
function dueAfterDaysFrom(dueAt: Date | null, startedAt: Date): number | null {
  if (dueAt === null) return null;
  const days = Math.round((dueAt.getTime() - startedAt.getTime()) / TEMPLATE_DAY_MS);
  if (!Number.isFinite(days)) return null;
  if (days > TEMPLATE_LIMITS.DUE_AFTER_DAYS_MAX) return null;
  return Math.max(0, days);
}

/**
 * A live column is `integer` and unbounded; the definition is capped. A board
 * carrying `contracted_rounds = 500` saves as 99 rather than failing the whole
 * save — the number is advisory on the next engagement, and refusing to save a
 * shape over one field would send the agency back to copying boards by hand.
 */
function clampRounds(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value)) return null;
  return Math.min(Math.max(0, value), TEMPLATE_LIMITS.CONTRACTED_ROUNDS_MAX);
}

function byPosition(a: { position: number }, b: { position: number }): number {
  return a.position - b.position;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function dedupe(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}
