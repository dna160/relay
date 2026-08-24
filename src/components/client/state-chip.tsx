/**
 * The client's state chip.
 *
 * A server component with no motion and no hooks, which is the difference that
 * matters on this surface: the client board's first contentful paint has a
 * 1.5s budget on 4G and a chip that hydrates for every card spends it.
 *
 * The vocabulary differs from the agency's on purpose. `awaiting_client` is not
 * "awaiting client" to the person it is waiting on — it is "Your review".
 *
 * `ClientCardState` cannot express `draft` or `internal_review`, so there is no
 * branch here that could render one.
 */

import type { ClientCardState } from '@/lib/types';
import { clientStateLabel } from './vocabulary';
import { chip, cn } from '@/components/style-tokens';

export function StateChip({ state, className }: { state: ClientCardState; className?: string }) {
  return (
    <span className={cn(chip, className)} data-state={state}>
      {clientStateLabel(state)}
    </span>
  );
}
