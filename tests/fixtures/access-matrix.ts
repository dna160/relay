/**
 * INV-11's resolution table.
 *
 * Every expectation here is a **literal**, written by hand from `ADR-021` §6
 * and `ADR-022` D3. None of it is computed from a strength ordering. That is
 * the entire point: a table derived by the same `strongest()` the
 * implementation uses agrees with the implementation by construction and proves
 * nothing — the permission-check equivalent of verifying a hash against itself.
 *
 * Where a dimension repeats, the repetition is over the axis and the
 * expectation inside it is still a literal. That is not a shortcut: on those
 * axes *the answer not varying is the assertion*.
 *
 * ## Written independently, and it agreed
 *
 * The back-end wrote `src/domain/access/resolve-access.ts` from the same two
 * documents without seeing this file, and this file was written without seeing
 * that one. They agree on every cell, including the two that ADR-022 implies
 * rather than states (below). `docs/state/VERIFICATION.md` §6D records the
 * comparison. A disagreement would have been the more valuable outcome and it
 * is worth saying that it was looked for.
 *
 * The cross-check did find one thing: **`orgRolesDeriveProjectAccess`**. ADR-022
 * names per-org configuration as the escape hatch, `organizations` carries the
 * column `NOT NULL DEFAULT true`, and a matrix over roles alone would have
 * asserted only the half of the product where it is on. It is a real axis here.
 *
 * ## The rules this table is a transcription of
 *
 * 1. `effective = strongest(project_role, org_role → project)` — ADR-022 D3.
 * 2. Project-role strength, strongest first: `lead` > `contributor` >
 *    `reviewer`. `src/db/schema/enums.ts` says the order is load-bearing.
 * 3. `owner` and `admin` derive project access; `member` derives nothing and
 *    must hold a `project_memberships` row to see anything. ADR-022 D3, and the
 *    `ORG_ROLES` comment in `enums.ts` says it in those words.
 * 4. **Null on both means deny.** Never a default reviewer role. ADR-022 calls
 *    a fallback here "the classic way a permission system leaks", and warns
 *    that D3 makes the org-derived branch *more* attractive to reason loosely
 *    about, not less.
 * 5. The derivation is scoped to the project's **own** organization. The
 *    DELIVERY-PLAN's query joins `om.org_id = p.org_id`; an org role held
 *    anywhere else derives nothing. This is ADR-021 §1's central property read
 *    in the direction that matters for a leak.
 * 6. Derivation is switchable per organization (`orgRolesDeriveProjectAccess`,
 *    default true). Off, an org role derives nothing at all — that is what a
 *    Studio tenant buys to get a Chinese wall between competing clients.
 * 7. Teams are **not an authority**. `src/db/schema/access.ts` is explicit:
 *    granting a team expands into individual `project_memberships` rows
 *    carrying `granted_via_team_id`. A team membership alone resolves to deny,
 *    and `resolveAccess()` never reads `team_members` at all.
 *
 * ## The two values derived rather than stated
 *
 * Marked `derived: true`, and reported to the Architect as the cells where two
 * independent transcriptions were most likely to diverge:
 *
 * - **Which project role `owner`/`admin` derive.** ADR-022 says they "derive
 *   access to every project"; it does not say as what. `resolveAccess()`
 *   returns one of three project roles, and `lead` is the only one that serves
 *   the case the ADR was decided for — "the founder of a six-person studio
 *   expecting to see their own company's work". An owner resolving to
 *   `contributor` could not do the lead-only things on their own org's project,
 *   which would make the decision self-defeating.
 * - **`via` when both paths give the same role.** Recorded as `project`. The
 *   direct grant is the more specific authority and it is the one that survives
 *   a change to the org side, so attributing a tie to the org would make an
 *   audit row read as though revoking the project grant would change nothing.
 *
 * ## The cell most worth arguing about
 *
 * `admin` + project `reviewer`, derivation on → **`lead` via `org`**, not
 * `reviewer`. `strongest()` means the org grant wins, so adding an org admin to
 * a project as a reviewer does **not** narrow them. Someone will eventually try
 * exactly that to wall off one project, and it will not work: ADR-022 puts the
 * escape hatch in `orgRolesDeriveProjectAccess`, not in a downgrade-by-explicit-
 * grant. The table mirrors the decision rather than quietly improving on it. If
 * the product wants the other behaviour, that is an ADR, not a test edit.
 */

import { ORG_ROLES, PROJECT_ROLES } from '@/db/schema/enums';

export type OrgRole = (typeof ORG_ROLES)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** What `resolveAccess(accountId, projectId)` returns. ADR-021 §6. */
export interface Access {
  role: ProjectRole | null;
  via: 'project' | 'org' | null;
}

export interface MatrixCase {
  /** The account's role in an organization, or null for no org membership. */
  orgRole: OrgRole | null;
  /** The account's direct role on the project, or null for none. */
  projectRole: ProjectRole | null;
  /**
   * Whether the org membership above is in the project's own organization.
   *
   * `other` is the axis that proves the derivation is scoped. An owner of org A
   * asked about a project in org B must be answered from the project row alone.
   */
  orgIs: 'same' | 'other';
  /** `organizations.org_roles_derive_project_access` for the project's org. */
  derives: boolean;
  expected: Access;
  /** True where the value is read out of ADR-022 rather than stated by it. */
  derived?: true;
  why: string;
}

const DENY: Access = { role: null, via: null };

/**
 * The answer when nothing derives: the direct project grant, or nothing.
 *
 * Written once because it is the same sentence in three different situations —
 * no org membership, an org membership that derives nothing, and an org
 * membership in the wrong organization — and the point of those three
 * situations is that they are indistinguishable in the output. Each cell below
 * still names which of the three it is and why.
 */
function projectOnly(projectRole: ProjectRole | null): Access {
  return projectRole === null ? DENY : { role: projectRole, via: 'project' };
}

const PROJECT_AXIS = [null, 'reviewer', 'contributor', 'lead'] as const;
const ORG_AXIS = [null, 'member', 'admin', 'owner'] as const;

/* ------------------------------------ derivation ON, membership in this org */

/**
 * The only octant of the cube where the org side changes anything: the project's
 * own organization, with derivation enabled.
 *
 * Sixteen cells, written out one at a time. Eight of them differ from
 * `projectOnly`, and those eight are the entire blast radius of ADR-022 D3.
 */
const SAME_ORG_DERIVING: MatrixCase[] = [
  {
    orgRole: null,
    projectRole: null,
    orgIs: 'same',
    derives: true,
    expected: DENY,
    why: 'Rule 4. Both null is deny. This is the cell ADR-022 singles out by name.',
  },
  {
    orgRole: null,
    projectRole: 'reviewer',
    orgIs: 'same',
    derives: true,
    expected: { role: 'reviewer', via: 'project' },
    why: 'ADR-021 §1: a project membership does not require an org membership. The client-side reviewer inside your org with no visibility into the org.',
  },
  {
    orgRole: null,
    projectRole: 'contributor',
    orgIs: 'same',
    derives: true,
    expected: { role: 'contributor', via: 'project' },
    why: 'The freelancer on one project and nothing else.',
  },
  {
    orgRole: null,
    projectRole: 'lead',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'project' },
    why: 'A contract lead with no standing in the organization itself.',
  },

  {
    orgRole: 'member',
    projectRole: null,
    orgIs: 'same',
    derives: true,
    expected: DENY,
    why: 'Rule 3. `member` derives nothing. Being in the org is not being on the project — the cell that separates ADR-021 from the systems it says get this wrong.',
  },
  {
    orgRole: 'member',
    projectRole: 'reviewer',
    orgIs: 'same',
    derives: true,
    expected: { role: 'reviewer', via: 'project' },
    why: 'strongest(reviewer, nothing) = reviewer, and the reason is the project row.',
  },
  {
    orgRole: 'member',
    projectRole: 'contributor',
    orgIs: 'same',
    derives: true,
    expected: { role: 'contributor', via: 'project' },
    why: 'The ordinary agency staffer on a project they are staffed to.',
  },
  {
    orgRole: 'member',
    projectRole: 'lead',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'project' },
    why: 'strongest(lead, nothing) = lead.',
  },

  {
    orgRole: 'admin',
    projectRole: null,
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'org' },
    derived: true,
    why: 'ADR-022 D3: an admin derives access to every project in the org. Derived as `lead` — see the header.',
  },
  {
    orgRole: 'admin',
    projectRole: 'reviewer',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'org' },
    derived: true,
    why: 'THE CELL TO ARGUE ABOUT. strongest(reviewer, lead) = lead. An explicit reviewer grant does not narrow an org admin; the escape hatch is the org switch, not this cell.',
  },
  {
    orgRole: 'admin',
    projectRole: 'contributor',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'org' },
    derived: true,
    why: 'strongest(contributor, lead) = lead, and the org is the strictly stronger path, so it is the reason.',
  },
  {
    orgRole: 'admin',
    projectRole: 'lead',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'project' },
    derived: true,
    why: 'A tie. `via` is the project, because the direct grant is what survives the org switch being turned off.',
  },

  {
    orgRole: 'owner',
    projectRole: null,
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'org' },
    derived: true,
    why: 'ADR-022 D3, the case it was decided for: the founder seeing their own company\'s work without anyone having staffed them to it.',
  },
  {
    orgRole: 'owner',
    projectRole: 'reviewer',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'org' },
    derived: true,
    why: 'As the admin row. An owner cannot be demoted by a project grant.',
  },
  {
    orgRole: 'owner',
    projectRole: 'contributor',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'org' },
    derived: true,
    why: 'strongest(contributor, lead) = lead via org.',
  },
  {
    orgRole: 'owner',
    projectRole: 'lead',
    orgIs: 'same',
    derives: true,
    expected: { role: 'lead', via: 'project' },
    derived: true,
    why: 'A tie; the project is the reason, for the same switch-survival reason.',
  },
];

/* -------------------------------- the three octants where nothing derives */

/**
 * Same organization, derivation switched **off** — the Studio-tier Chinese wall.
 *
 * The org role must stop mattering entirely, including for `owner`. A switch
 * that leaves the owner deriving is not a wall, and "the owner is different"
 * is exactly the exception someone would add without meaning to weaken it.
 */
const SAME_ORG_NOT_DERIVING: MatrixCase[] = ORG_AXIS.flatMap<MatrixCase>((orgRole) =>
  PROJECT_AXIS.map((projectRole) => ({
    orgRole,
    projectRole,
    orgIs: 'same' as const,
    derives: false,
    expected: projectOnly(projectRole),
    why: `Derivation is off for this organization, so ${orgRole ?? 'no'} org role derives nothing and the project row is the whole answer. Rule 6 — and it must hold for \`owner\` too, or the wall has a door in it.`,
  })),
);

/**
 * An org role held in a **different** organization from the project's, with
 * derivation in whichever state.
 *
 * Every answer comes from the project row alone. If any of these resolve to
 * `lead via org`, the derivation is unscoped and an agency owner can read every
 * project of every other tenant on the platform — which is not a permission
 * bug, it is the whole product. Both switch states are enumerated because the
 * switch belongs to the *project's* org, and an implementation that reads it
 * off the account's own org instead would pass one state and fail the other.
 */
const OTHER_ORG: MatrixCase[] = [true, false].flatMap<MatrixCase>((derives) =>
  ORG_AXIS.flatMap<MatrixCase>((orgRole) =>
    PROJECT_AXIS.map((projectRole) => ({
      orgRole,
      projectRole,
      orgIs: 'other' as const,
      derives,
      expected: projectOnly(projectRole),
      why: `${orgRole ?? 'No'} org role, held in another organization, derives nothing here (rule 5) — with the project org's switch ${derives ? 'on' : 'off'}, which is not the account's to read.`,
    })),
  ),
);

/**
 * The full cube: 4 org roles × 4 project roles × 2 org scopings × 2 switch
 * states = 64 cells.
 */
export const ACCESS_MATRIX: readonly MatrixCase[] = [
  ...SAME_ORG_DERIVING,
  ...SAME_ORG_NOT_DERIVING,
  ...OTHER_ORG,
];

/**
 * The rows that are not part of the cross-product, and are the ones a matrix
 * over roles would never think to include.
 *
 * Each is a way of handing the resolver something that *looks* like an account
 * with a membership and is not one.
 */
export interface EdgeCase {
  id: string;
  why: string;
}

export const ACCESS_EDGE_CASES: readonly EdgeCase[] = [
  {
    id: 'team-membership-alone',
    why: 'An account in a team that has been granted the project, with no `project_memberships` row of its own. `src/db/schema/access.ts`: a team is a convenience for granting, not an authority — the grant expands into individual rows. If this resolves to anything but deny there are two authority paths, and revocation has two ways to be wrong.',
  },
  {
    id: 'team-membership-in-the-projects-org',
    why: 'The same, plus a team belonging to the project\'s organization. Team membership is not org membership: joining a team writes no `org_memberships` row, so nothing derives however the switch is set.',
  },
  {
    id: 'reviewer-contact-id-passed-as-account-id',
    why: 'A `client_contacts.id` handed to `resolveAccess()` as an account id. Both are uuids and neither type survives a route boundary. Must resolve to deny — never to the reviewer role, which is the answer a lenient fallback reaches for because it looks so nearly right. Reviewers hold sessions under INV-6 and have no account.',
  },
  {
    id: 'account-id-that-exists-nowhere',
    why: 'A well-formed uuid naming no account. Deny, and indistinguishably from every other deny — a resolver that answers differently for "no such account" confirms which ids exist.',
  },
  {
    id: 'project-id-that-exists-nowhere',
    why: 'Deny. The query drives from the project row, so no project means no result row, and an implementation that reads a missing row as "no restrictions" is null-means-allow in its purest form.',
  },
  {
    id: 'purged-project',
    why: 'A project whose engagement is `purged`. INV-7 leaves the engagement row standing as a tombstone, so the join still finds it. Access resolution is not a lifecycle check and must still answer from memberships — this row exists so the two questions are never quietly merged into one.',
  },
  {
    id: 'membership-row-in-another-projects-name',
    why: 'The account holds `lead` on project A and is asked about project B in the same org, with no org role. Deny. The predicate must bind the project id; a query that forgets it grants every project in the org to anyone holding one.',
  },
  {
    id: 'duplicate-org-membership-rows',
    why: 'Not reachable through the primary key today, and asserted so: `org_memberships` is keyed on (account_id, org_id). Recorded because strongest-of is the shape that breaks silently if a second row ever becomes possible, and a resolver taking the first row rather than the strongest would pass every other case in this file.',
  },
  {
    id: 'switch-read-from-the-accounts-own-org',
    why: 'The account is an owner of org A where derivation is off, and an owner of org B where it is on, asked about a project in B. The answer must be `lead via org` — the switch belongs to the object\'s organization, never to the caller\'s. The mirror case (on in A, off in B) must deny. A memo keyed only on the account would get one of these two wrong.',
  },
];

/** Every combination the axes admit, so the matrix cannot quietly become a sample. */
export function expectedCellCount(): number {
  return (ORG_ROLES.length + 1) * (PROJECT_ROLES.length + 1) * 2 * 2;
}
