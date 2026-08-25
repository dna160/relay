'use client';

/**
 * PossessionBar — the signature element (DESIGN-SYSTEM.md).
 *
 * A 3px bar along a card's leading edge, filled in `--agency` or `--client`,
 * with a mono label giving elapsed time in that possession. At board level the
 * bars form a column of who is holding the work.
 *
 * ## The printed colour bar, and the second pass of ink
 *
 * `.colour-bar` (globals.css §7) reads the bar as a press control strip rather
 * than as a border: one knockout notch 5px from the head. That static mark is
 * what makes the bar read as ink laid *on* the card, and it is the reason the
 * motion below is a wipe and not a fade.
 *
 * When possession changes hands the bar is re-keyed and redrawn top to bottom
 * with `animate-bar-draw origin-head` — three beats, delayed two so it begins
 * on the beat the label-attach strike lands (MOTION.md §3 R3). **The hue is
 * already the new one when this runs.** Nothing crossfades: a fade says "this
 * value was replaced", a wipe says "this mark was applied", and possession
 * changing hands is the one event in the product that has earned the second
 * reading.
 *
 * This module is `'use client'` for exactly one reason: knowing that possession
 * *changed* requires memory of what it was, and the server has none. Nothing
 * animates on first render — `useOneEvent` reports no event until it has seen
 * one — so the server-rendered board is still and the FCP budget is untouched.
 * The file is imported only from `components/agency/`, so none of this reaches
 * the client bundle, where the budget actually lives.
 *
 * Agency surface only. Possession is internal-only in v1 (PRD §9) and this file
 * lives under `components/agency/` so that importing it into the client bundle
 * is a visible mistake rather than an invisible one.
 *
 * ## Two questions, one bar
 *
 * `computePossession` answers "how long has each side held this", and it takes
 * `state_transitions` and nothing else (ADR-010, INV-5). A card that has never
 * moved has opened no possession interval, so the clock reports `current: null`
 * for it — the honest answer, and the reason the clock's third argument was
 * removed (directive B5).
 *
 * The board asks a different question: "whose move is it". That one is answered
 * by `cards.state` through the state machine's own `POSSESSION` table, which is
 * where the state chip two lines up already gets its answer. A freshly created
 * card is in `draft`, the ball is with the agency, and rendering no holder at
 * all was the surface failing to say something it already knew.
 *
 * So the fallback is here, in the surface, and not in the clock: `state` is an
 * optional prop, consulted only when the clock reports no open interval. It
 * cannot put a number on the bar — there is no interval to measure and
 * inventing `< 1m` for a card created last Tuesday would be the invented
 * reading the clock was cleaned up to avoid. It shows the side and no duration,
 * and says why on hover.
 *
 * A signed-off card needs no special case: `POSSESSION.signed_off` is `null`,
 * so the fallback returns null there too and the bar still reads `closed`.
 */

import { POSSESSION } from '@/domain/card/state-machine';
import type { CardState, Possession, PossessionSplit } from '@/lib/types';
import { formatDuration, formatPossession } from '@/lib/format';
import { useOneEvent } from '@/lib/hooks/use-one-event';
import {
  POSSESSION_CLOSED_FILL,
  POSSESSION_CLOSED_TEXT,
  POSSESSION_FILL,
  POSSESSION_TEXT,
  cn,
  mono,
} from '@/components/style-tokens';

/** What the bar is about to draw: a side, and whether the clock has started. */
interface Held {
  side: Possession | null;
  /** True when `side` came from `cards.state` because no interval is open. */
  unstarted: boolean;
}

/**
 * The clock first, `cards.state` only as a fallback. Never the other way round:
 * once a transition exists it is the record, and `cards.state` is a projection
 * of it.
 */
function heldBy(possession: PossessionSplit, state?: CardState): Held {
  if (possession.current) return { side: possession.current, unstarted: false };
  const fallback = state ? POSSESSION[state] : null;
  return { side: fallback, unstarted: fallback !== null };
}

const UNSTARTED_TITLE =
  'No transition recorded yet. The possession clock starts the first time this card moves.';

/** The leading edge itself. Decorative: the label below carries the meaning. */
export function PossessionEdge({
  possession,
  state,
}: {
  possession: PossessionSplit;
  state?: CardState;
}) {
  const { side } = heldBy(possession, state);
  const fill = side ? POSSESSION_FILL[side] : POSSESSION_CLOSED_FILL;
  const drawn = useOneEvent([['possession', side]] as const);
  return (
    <span
      // A changed key is the whole mechanism: React remounts the bar and the
      // CSS animation runs from zero. MOTION.md §4c, step 2.
      key={drawn.seq}
      aria-hidden="true"
      className={cn(
        'colour-bar absolute inset-y-0 left-0 w-bar',
        fill,
        drawn.kind === 'possession' && 'animate-bar-draw origin-head',
      )}
    />
  );
}

/** `client · 6d`. Mono, because it is a record of who held the work. */
export function PossessionLabel({
  possession,
  state,
  className,
}: {
  possession: PossessionSplit;
  state?: CardState;
  className?: string;
}) {
  const { side, unstarted } = heldBy(possession, state);
  const tone = side ? POSSESSION_TEXT[side] : POSSESSION_CLOSED_TEXT;
  // No duration on the fallback: the side is known, the elapsed time is not.
  const text = side ? (unstarted ? side : formatPossession(side, possession.currentMs)) : 'closed';
  return (
    <span
      className={cn(mono, 'text-12', tone, className)}
      title={unstarted ? UNSTARTED_TITLE : undefined}
    >
      {text}
    </span>
  );
}

/**
 * Edge plus label as one block, for rows that are not cards — a portfolio row,
 * an engagement header. The split is spelled out in the title attribute rather
 * than on screen; the glance is the hue, the detail is on demand.
 *
 * `state` is optional here for the same reason it is optional above: an
 * engagement roll-up (`sumPossession`) has no single state to fall back to and
 * must keep reading `closed`.
 */
export function PossessionBar({
  possession,
  state,
}: {
  possession: PossessionSplit;
  state?: CardState;
}) {
  const { side, unstarted } = heldBy(possession, state);
  const fill = side ? POSSESSION_FILL[side] : POSSESSION_CLOSED_FILL;
  const drawn = useOneEvent([['possession', side]] as const);
  const split = unstarted
    ? UNSTARTED_TITLE
    : `agency ${formatDuration(possession.agencyMs)} · client ${formatDuration(
        possession.clientMs,
      )}`;
  return (
    <span className="inline-flex items-center gap-2" title={split}>
      <span
        key={drawn.seq}
        aria-hidden="true"
        className={cn(
          'colour-bar block h-4 w-bar',
          fill,
          drawn.kind === 'possession' && 'animate-bar-draw origin-head',
        )}
      />
      <PossessionLabel possession={possession} state={state} />
    </span>
  );
}
