'use client';

/**
 * The card's state chip, and the front half of the signature moment.
 *
 * It composes the `Chip` primitive and adds exactly one thing the primitive
 * cannot know: **whether the label that just changed was possession changing
 * hands.** `Chip` crossfades an incoming label in two beats; given `attach` it
 * strikes and seats it instead, over five (MOTION.md §4a).
 *
 * The answer is derivable and is not a prop. `POSSESSION` is the state
 * machine's own table — the same one the possession bar's fallback reads — so
 * the side is a function of the state this chip is already rendering. A card
 * going `draft → internal_review` stays with the agency and takes the
 * crossfade. A card going `internal_review → awaiting_client` hands the ball
 * over, and that is the one thing in this product that gets five beats.
 *
 * Nothing fires on first render: `useOneEvent` reports no event until it has
 * seen a change, so a board that has just been server-rendered is still.
 *
 * The hand-rolled crossfade this file used to carry is gone, and with it a
 * `matchMedia('(prefers-reduced-motion: reduce)')` branch. That branch was a
 * second implementation of a rule the token layer already enforces — under
 * reduce `--dur-beat` is `0ms` and every animation in the product lands on its
 * resting frame instantly. A component that reads the media query itself is a
 * component that can disagree with the stylesheet, and only one of them is
 * tested.
 *
 * The chip still carries no hue. Hue encodes possession; a state chip that also
 * carried colour would put two meanings on one channel.
 */

import { POSSESSION } from '@/domain/card/state-machine';
import type { CardState } from '@/lib/types';
import { useOneEvent } from '@/lib/hooks/use-one-event';
import { Chip } from '@/components/primitives';
import { stateLabel } from './vocabulary';

export function StateChip({ state, className }: { state: CardState; className?: string }) {
  const event = useOneEvent([['possession', POSSESSION[state]]] as const);

  return (
    <Chip
      tone="neutral"
      // The rendered label is abbreviated vocabulary; the state is the stable
      // identity behind it, so a vocabulary change cannot fake a transition.
      transitionKey={state}
      attach={event.kind === 'possession'}
      label="State"
      className={className}
    >
      {stateLabel(state)}
    </Chip>
  );
}
