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
import { agencyApi } from '@/lib/api-client';
import { actionDoneLabel, actionLabel } from './vocabulary';
import { useAction } from '@/lib/hooks/use-action';
import { buttonSecondary, cn, mono, muted } from '@/components/style-tokens';

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
}: {
  engagementId: string;
  cardId: string;
  state: CardState;
  compact?: boolean;
}) {
  const router = useRouter();
  const move = useAction(agencyApi.transitionCard);
  const publish = useAction(agencyApi.publishCard);
  const moves = agencyMoves(state);
  const pending = move.pending || publish.pending;
  const failure = move.failure ?? publish.failure;
  const done = move.done ?? publish.done;

  if (state === 'awaiting_client') {
    return (
      <p className={cn(mono, 'text-12', muted)}>with the client · no agency move</p>
    );
  }

  if (moves.length === 0) {
    return <p className={cn(mono, 'text-12', muted)}>signed off · no further moves</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {moves.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            className={cn(buttonSecondary, compact && 'h-7 px-2 text-12')}
            onClick={async () => {
              const result =
                state === 'internal_review' && to === 'awaiting_client'
                  ? await publish.run(actionDoneLabel(to), cardId, { engagementId })
                  : await move.run(actionDoneLabel(to), cardId, { engagementId, to });
              if (result.ok) router.refresh();
            }}
          >
            {actionLabel(to)}
          </button>
        ))}
      </div>
      <p aria-live="polite" className={cn(mono, 'text-12', muted, 'min-h-4')}>
        {failure ? `${failure.code} — ${failure.message}` : (done ?? '')}
      </p>
    </div>
  );
}
