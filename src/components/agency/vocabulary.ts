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

import type { AttentionBucket, CardState, OrgRole } from '@/lib/types';

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

/* ---------------------------------------------------------------- org roles */

/**
 * What each organisation role is called, and what it actually gets you.
 *
 * The second half is the part that matters and it is why these are objects
 * rather than a string map. A role picker whose options read `Admin` / `Member`
 * asks somebody to guess, once, at a decision that hands a person the whole
 * agency's backstage — every private lane, every internal note, every
 * unpublished version, on every workspace in the organisation. The consequence
 * belongs next to the choice, not in documentation.
 *
 * `owner` has a label because a roster renders one, and it is deliberately not
 * offered as something to invite *into*: transferring ownership is not an
 * invitation, and an invite that could mint a second owner is a privilege
 * escalation wearing a form. `ORG_ROLE_ORDER` (`src/domain/access/roles.ts`)
 * is the vocabulary; this is only its rendering, and a fourth role added there
 * is a compile error here rather than a silent omission.
 */
const ORG_ROLE_COPY: Record<OrgRole, { label: string; grants: string }> = {
  owner: {
    label: 'Owner',
    grants:
      'Owns the organisation, its plan and its billing. Everything an admin can do, and the one account that cannot be removed by anybody else here.',
  },
  admin: {
    label: 'Admin',
    grants:
      'Everything a member can do, and can invite other teammates. Give this to the people who would answer for who has access.',
  },
  member: {
    label: 'Member',
    grants:
      'Works on every workspace in this organisation — boards, files, internal notes, and publishing to clients. This is the ordinary answer.',
  },
};

export function orgRoleLabel(role: OrgRole): string {
  return ORG_ROLE_COPY[role].label;
}

export function orgRoleGrants(role: OrgRole): string {
  return ORG_ROLE_COPY[role].grants;
}

/**
 * The roles a teammate invite may offer.
 *
 * Re-exported from `src/domain/access/roles.ts`, never re-derived. That
 * constant is what `POST /api/orgs/:id/invites` builds its Zod schema from —
 * `z.enum(INVITABLE_ORG_ROLES)` — so a picker assembled from a second list is a
 * picker that will one day offer a value the route rejects with a 400 the user
 * cannot act on. `owner` is absent from it, and the reason lives there beside
 * the decision rather than being restated here.
 *
 * The obvious spelling for a local version, `ORG_ROLE_ORDER.filter((r) => r !==
 * 'owner')`, is also a role literal branching outside the access domain, which
 * INV-11's static scan fails on sight — correctly. A file that has an opinion
 * about the role vocabulary is one line away from having an opinion about how
 * the roles rank.
 */
export { INVITABLE_ORG_ROLES } from '@/domain/access/roles';

/* -------------------------------------------------------------- people */

/**
 * What to call a person when the product may not know their name.
 *
 * Phase 10 made this load-bearing. Before invitations existed, every `users`
 * row was created by somebody onboarding an agency and a null name was a
 * rarity; an invited colleague has a null name **by construction** — they were
 * invited by address, and there is no surface on which they have yet told us
 * anything else. The projection already falls back to the address
 * (`assigneeLabel` in `src/domain/projection/agency-view.ts`), and this is the
 * same ladder one rung further, for the case where even that is missing.
 *
 * The last rung is deliberately not the empty string, and not an id.
 *
 *   - An **empty string** is what shipped, and it rendered a newly invited
 *     colleague as a blank gap on the card they had just been assigned. The
 *     first thing a new member saw was their own name missing, which reads as
 *     the product having lost them rather than as not yet knowing them.
 *   - An **id** names nobody. `0193a5f0-b201-…` on a card tile is worse than
 *     the blank, because it looks like a bug rather than an absence.
 *
 * So the floor is a true sentence about a person: somebody on this side holds
 * the card, and Relay has not been told what to call them yet. `Unassigned` is
 * **not** available as the fallback — the card *is* assigned, and saying
 * otherwise would put it in the wrong `rankAttention()` bucket in the reader's
 * head while `blocked_on_you` still counts it.
 */
export function personLabel(person: {
  name?: string | null;
  email?: string | null;
}): string {
  const name = person.name?.trim();
  if (name) return name;
  const email = person.email?.trim();
  if (email) return email;
  return 'A teammate';
}
