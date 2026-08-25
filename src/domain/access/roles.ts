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

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLE_ORDER as readonly string[]).includes(value);
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLE_ORDER as readonly string[]).includes(value);
}
