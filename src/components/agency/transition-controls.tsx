'use client';

/**
 * The state controls. Separate from anything that reorders, because they are a
 * different kind of act: dragging a card is a change of opinion about priority,
 * transitioning it is a claim about the world that the state machine has to
 * agree with (ADR-003, INV-2).
 *
 * The legal edges are read from `domain/card/state-machine.ts` rather than
 * restated here. A UI with its own opinion about which moves exist is a UI that
 * will eventually offer one the server rejects with 409.
 *
 * Two deliberate omissions:
 * - No move *out of* `awaiting_client` is offered. Those edges are legal for an
 *   agency actor, but approving on the client's behalf would put the agency's
 *   identity on the client's decision, and the decision record is the product.
 * - `internal_review -> awaiting_client` goes through `POST /publish`, the
 *   gate, not through the generic transition route.
 */

import { useRouter } from 'next/navigation';
import { POSSESSION, canTransition } from '@/domain/card/state-machine';
import type { CardState } from '@/lib/types';
import { agencyApi } from '@/lib/api-client.agency';
import { actionDoneLabel, actionLabel } from './vocabulary';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, mono, muted } from '@/components/style-tokens';

const ALL_STATES = Object.keys(POSSESSION) as CardState[];

/** Legal edges the agency should be offered from a given state. */
export function agencyMoves(from: CardState): CardState[] {
  if (from === 'awaiting_client') return [];
  return ALL_STATES.filter((to) => canTransition(from, to));
}

export function TransitionControls({
  engagementId,
  cardId,
  state,
  compact,
  readOnly = false,
}: {
  engagementId: string;
  cardId: string;
  state: CardState;
  compact?: boolean;
  /**
   * An archived engagement refuses every transition with 423. Predicted from
   * the engagement's `status` rather than discovered on submit — a state move is
   * the single most consequential control on this surface, and finding out it
   * was closed *after* pressing it is how someone concludes the board is broken.
   */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const move = useAction(agencyApi.transitionCard);
  const publish = useAction(agencyApi.publishCard);
  const moves = agencyMoves(state);
  const pending = move.pending || publish.pending;
  const failure = move.failure ?? publish.failure;
  const done = move.done ?? publish.done;

  if (readOnly) {
    /*
     * The moves are named and shown closed, rather than removed. A reader who
     * knows this card should be publishable needs to see that the product agrees
     * with them and that the reason is the engagement, not the card.
     */
    return (
      <p className={cn(mono, 'text-12', muted)}>
        read-only · archived, so no card moves
      </p>
    );
  }

  /**
   * The confirmation line, rendered in every branch that can follow an action.
   *
   * It used to live only beside the buttons, which meant the one move that
   * removes them — `Publish to client`, the whole point of the internal gate —
   * was the only move in the product with no confirmation. The refresh
   * replaced "Published to client" with "with the client · no agency move" a
   * few hundred milliseconds after it appeared, so a screen reader on a polite
   * region frequently never announced it at all. The copy rule (DESIGN-SYSTEM:
   * the control that says "Publish to client" produces "Published to client")
   * was being kept by `useAction` and then thrown away by this component.
   */
  const status = (
    <p aria-live="polite" className={cn(mono, 'text-12', muted, 'min-h-4')}>
      {failure ? `${failure.code} — ${failure.message}` : (done ?? '')}
    </p>
  );

  if (state === 'awaiting_client') {
    return (
      <div className="flex flex-col gap-1">
        <p className={cn(mono, 'text-12', muted)}>with the client · no agency move</p>
        {status}
      </div>
    );
  }

  if (moves.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className={cn(mono, 'text-12', muted)}>signed off · no further moves</p>
        {status}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {moves.map((to) => (
          /*
           * The tone is read out of `POSSESSION`, not chosen per button. A
           * control's hue names the side that holds the work once it has been
           * pressed, so "Publish to client" is indigo and every move that keeps
           * the card with us is pine — and `signed_off`, where possession is
           * `null` because the ball is with nobody, is quiet rather than a
           * third hue.
           */
          <Button
            key={to}
            tone={POSSESSION[to] ?? 'quiet'}
            size={compact ? 'sm' : 'md'}
            disabled={pending}
            onClick={async () => {
              const throughTheGate = state === 'internal_review' && to === 'awaiting_client';
              /*
                Clear the *other* action before running this one.

                There are two `useAction`s here and one line to report them in,
                read as `move.done ?? publish.done`. `run()` clears its own
                state, not its sibling's, so a card that went to internal review
                and was then published showed "Sent to internal review" — the
                earlier action's confirmation, still non-null, shadowing the
                later one. The publish was correct; only the sentence about it
                was a round out of date, which is the worst kind of wrong for a
                line whose whole job is to say what just happened.
              */
              (throughTheGate ? move : publish).reset();
              const result = throughTheGate
                ? await publish.run(actionDoneLabel(to), cardId, { engagementId })
                : await move.run(actionDoneLabel(to), cardId, { engagementId, to });
              if (result.ok) router.refresh();
            }}
          >
            {actionLabel(to)}
          </Button>
        ))}
      </div>
      {status}
    </div>
  );
}
