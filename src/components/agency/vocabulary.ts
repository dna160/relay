/**
 * What the agency calls things.
 *
 * Kept out of `src/lib/format.ts` deliberately. The client surface imports that
 * module for byte sizes and hash prefixes, and a shared strings file put
 * "Send to internal review" into the client's JavaScript — visible in the built
 * chunk, invisible in review. Vocabulary is a surface concern, so it lives with
 * the surface.
 *
 * Copy rule: name things by what people control, and an action keeps its name
 * through the flow. The control that says "Publish to client" produces
 * "Published to client".
 */

import type { AttentionBucket, CardState } from '@/lib/types';

const STATE_LABELS: Record<CardState, string> = {
  draft: 'Draft',
  assigned: 'Assigned',
  in_progress: 'In progress',
  internal_review: 'Internal review',
  awaiting_client: 'Awaiting client',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  signed_off: 'Signed off',
};

export function stateLabel(state: CardState): string {
  return STATE_LABELS[state];
}

const ACTION_LABELS: Record<CardState, { verb: string; done: string }> = {
  draft: { verb: 'Return to draft', done: 'Returned to draft' },
  assigned: { verb: 'Assign', done: 'Assigned' },
  in_progress: { verb: 'Start work', done: 'Started work' },
  internal_review: { verb: 'Send to internal review', done: 'Sent to internal review' },
  awaiting_client: { verb: 'Publish to client', done: 'Published to client' },
  changes_requested: { verb: 'Request changes', done: 'Changes requested' },
  approved: { verb: 'Approve', done: 'Approved' },
  signed_off: { verb: 'Sign off', done: 'Signed off' },
};

export function actionLabel(to: CardState): string {
  return ACTION_LABELS[to].verb;
}

export function actionDoneLabel(to: CardState): string {
  return ACTION_LABELS[to].done;
}

const BUCKET_LABELS: Record<AttentionBucket, string> = {
  blocked_on_you: 'Blocked on you',
  blocked_on_your_team: 'Blocked on your team',
  with_the_client: 'With the client',
  no_movement_7d: 'No movement in 7 days',
};

/** Ranked by actionability, not deadline proximity (PRD §5.5). */
export const BUCKET_ORDER: readonly AttentionBucket[] = [
  'blocked_on_you',
  'blocked_on_your_team',
  'with_the_client',
  'no_movement_7d',
];

export function bucketLabel(bucket: AttentionBucket): string {
  return BUCKET_LABELS[bucket];
}
