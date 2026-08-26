/**
 * The permission vocabulary, and the one place role strength is defined.
 *
 * Kept in `src/domain/` and re-exported from `src/lib/types.ts` — the same
 * arrangement `CardState` and `Possession` already have. The shapes are shared
 * by both sides of the app and are never redeclared (DELIVERY-PLAN §VI); the
 * *logic* that produces them lives next to the definition so that a change to
 * the ordering cannot be made without reading the function that depends on it.
 */

/** ADR-021 §1. Strongest first — `ROLE_STRENGTH` depends on this order. */
export const PROJECT_ROLE_ORDER = ['lead', 'contributor', 'reviewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLE_ORDER)[number];

export const ORG_ROLE_ORDER = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLE_ORDER)[number];

/**
 * Where an effective role came from. `null` role means denied, and a denial has
 * no provenance — `{ role: null, via: null }` is the only shape a denial takes.
 */
export type AccessVia = 'project' | 'org';

export interface AccessResult {
  readonly role: ProjectRole | null;
  readonly via: AccessVia | null;
}

/** The single denial value. Exported so no call site has to spell it. */
export const DENIED: AccessResult = { role: null, via: null };

/**
 * Higher is stronger. Nothing outside this file may compare two roles.
 *
 * `null` is deliberately absent rather than mapped to 0: a null role is not a
 * weak grant, it is the absence of one, and giving it a number is the first
 * step towards it being comparable to — and therefore beatable by — something.
 */
const ROLE_STRENGTH: Readonly<Record<ProjectRole, number>> = {
  lead: 3,
  contributor: 2,
  reviewer: 1,
};

export function isStrongerThan(a: ProjectRole, b: ProjectRole): boolean {
  return ROLE_STRENGTH[a] > ROLE_STRENGTH[b];
}

/**
 * Whether a project role can be handed a card.
 *
 * A `reviewer` is the client-side person — the PRD's word for what the v1 code
 * calls a client contact — and a deliverable is *requested of* the agency, not
 * assigned to the person waiting for it. `cards.assignee_id` references `users`
 * and the client projection never emits it, so a reviewer in an assignee picker
 * would be an id the write path refuses and a name the client can never be
 * shown next to.
 *
 * A `switch` rather than a set literal, so that a fourth project role is a
 * compile error here instead of a silent exclusion from every picker.
 *
 * ## This is a read-side rule today, and must not stay one
 *
 * Nothing on the write path calls this. It cannot: during Phase 9's shadow
 * window the write path must not consult the graph at all, or it stops
 * returning the shipped answer (ADR-023 rule 1). The write path is
 * `assertAssigneeInOrg()` in `src/domain/card/mutate.ts`, which is org-scoped
 * and role-blind.
 *
 * That gap is closed today by three things and none of them is this function:
 *
 *   1. `cards.assignee_id` REFERENCES `users(id)`. A `client_contacts` row is
 *      not a `users` row, so a reviewer's id is refused by the database.
 *   2. `assertAssigneeInOrg()` refuses it first, with a 404.
 *   3. No account holds project role `reviewer` yet — Phase 10 issues them.
 *
 * **The obligation is on ADR-021 step 4.** When `assertAssigneeInOrg()` is
 * replaced by a graph-based check, that check must ask `canHoldAssignment()`
 * and not merely "does this account have any access" — otherwise the picker
 * excludes reviewers and the check accepts them, which is the read/write
 * divergence this pair exists to prevent.
 *
 * Until then the divergence is *observable rather than assumed*: any account
 * the shipped list includes and this function excludes shows up in the ledger
 * as `assignable_set_differs` with `side: 'shipped'`, per request, in
 * production. The harness catches this class before step 4 can make it live.
 */
export function canHoldAssignment(role: ProjectRole): boolean {
  switch (role) {
    case 'lead':
    case 'contributor':
      return true;
    case 'reviewer':
      return false;
  }
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLE_ORDER as readonly string[]).includes(value);
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLE_ORDER as readonly string[]).includes(value);
}
