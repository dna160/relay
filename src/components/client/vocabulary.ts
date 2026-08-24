/**
 * What the client calls things.
 *
 * Six words, and none of them are the agency's. `awaiting_client` is not
 * "awaiting client" to the person it is waiting on — it is "Your review".
 * `ClientCardState` cannot express `draft` or `internal_review`, so this map is
 * total and there is no state here that could be named by accident.
 */

import type { ClientCardState } from '@/lib/types';

const CLIENT_STATE_LABELS: Record<ClientCardState, string> = {
  assigned: 'Queued',
  in_progress: 'In progress',
  awaiting_client: 'Your review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  signed_off: 'Signed off',
};

export function clientStateLabel(state: ClientCardState): string {
  return CLIENT_STATE_LABELS[state];
}
