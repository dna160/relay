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
 * When possession changes hands the bar is drawn top to bottom over the hue it
 * is replacing — three beats, delayed two so it begins on the beat the
 * label-attach strike lands (MOTION.md §3 R3). Nothing crossfades: a fade says
 * "this value was replaced", a wipe says "this mark was applied", and
 * possession changing hands is the one event in the product that has earned the
 * second reading.
 *
 * **The two layers are the `ColourBar` primitive's and this file does not
 * hand-roll them.** It used to: one element, the new hue on it, a changing
 * `key` to force a remount, and `animate-bar-draw origin-head`. That is what
 * MOTION.md §4c said to do, and it was wrong in a way that only showed up on a
 * stopwatch — `bar-draw`'s `both` fill holds the element at `scaleY(0)` through
 * the two-beat delay, and the remount destroys the outgoing bar in the same
 * frame, so the leading edge of the card was blank for 120ms during the one
 * event the whole element exists to report. A blink there does not read as
 * "possession is changing"; it reads as possession being briefly *unknown*.
 * One element cannot be both the ink being laid down and the ink being covered.
 * §4c now warns off the instruction it used to give.
 *
 * So the call sites below pass a fill and nothing else. The primitive keeps the
 * outgoing hue on an under-layer, draws the incoming one over it, and suppresses
 * the whole thing on first mount — the memory belongs with the mark, because
 * CSS cannot remember and every call site that hand-rolled it would have to.
 *
 * This module is `'use client'` for exactly one reason: knowing that possession
 * *changed* requires memory of what it was, and the server has none. Nothing
 * animates on first render — a bar with no outgoing hue has no under-layer and
 * carries no animation class in the markup at all — so the server-rendered
 * board is still and the FCP budget is untouched. The file is imported only
 * from `components/agency/`, so none of this reaches the client bundle, where
 * the budget actually lives.
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
import { ColourBar } from '@/components/primitives';
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
  // Geometry here, ink in the primitive. There is no `key`, no animation class
  // and no change detection at this call site by design — see the note above.
  return <ColourBar fill={fill} className="absolute inset-y-0 left-0 w-bar" />;
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
  const split = unstarted
    ? UNSTARTED_TITLE
    : `agency ${formatDuration(possession.agencyMs)} · client ${formatDuration(
        possession.clientMs,
      )}`;
  return (
    <span className="inline-flex items-center gap-2" title={split}>
      <ColourBar fill={fill} className="block h-4 w-bar" />
      <PossessionLabel possession={possession} state={state} />
    </span>
  );
}
