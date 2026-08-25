/**
 * INV-11's behavioural half — the resolution matrix, against a real database.
 *
 * ## SKIPPED. UNSKIP IN: Phase 9, at EXIT — not before.
 *
 * `docs/phases/PHASE-9.md` EXIT is explicit and the order matters:
 *
 *   > Shadow harness live on every permission check. Seven consecutive days at
 *   > zero disagreements before the old path is deleted. INV-11 unskipped only
 *   > after deletion.
 *
 * The reason is not procedural. For the length of Phase 9 every permission
 * check calls both the old inline logic and `resolveAccess()` and **returns the
 * old result** (ADR-021, migration order, step 3). A matrix run against the
 * system in that state is asserting the answers of the thing being replaced,
 * and it would go green — which is worse than red, because a green invariant is
 * read as evidence. A passing INV-11 over a shadow harness still returning the
 * old answer is a lie in the one document an auditor reads first.
 *
 * So: written now, skipped now, and it names the condition rather than a date.
 * Unskipping is one word, and the thing that permits it is the disagreement
 * count reaching zero for seven consecutive days and the old checks being gone.
 *
 * ## Why this half is behavioural, and against Postgres rather than a fake
 *
 * INV-3's lesson, applied before it costs anything this time. INV-3 asserted a
 * database rule by reading `CREATE TABLE` out of a frozen migration; the text
 * could not change, so the assertion pinned what the schema *was* and went on
 * passing after the live constraint was replaced. The generalised shape, found
 * four times in one build: **the guard reads something narrower than the
 * invariant claims.**
 *
 * A permission check is the worst possible subject for a source scan. Reading
 * `strongest(` out of a file proves the word is present. It does not prove that
 * an org admin resolves to `lead`, that an admin in a *different* organization
 * resolves to nothing, or that both-null denies — and those are the entire
 * content of the invariant. Nor is a fake driver enough here: the resolution is
 * one SQL statement with two `LEFT JOIN`s and a predicate binding both the
 * account and the project, and every interesting failure is a join that matches
 * a row it should not. That is a claim about Postgres, so Postgres answers it.
 *
 * The structural half — where the decision may be made from, which cannot be
 * fooled by the shadow harness because it never asks the system anything — is
 * live today in `inv-11-access-resolution-is-one-function.spec.ts`.
 *
 * ## The table
 *
 * `tests/fixtures/access-matrix.ts`, written from ADR-021 §6 and ADR-022 D3 by
 * hand, every cell a literal. The back-end wrote `resolveAccessFrom()` from the
 * same two documents without seeing it. Two independent transcriptions that
 * agree are worth more than either alone.
 *
 * Runs under `npm run test:db`. Never edit this file to make a build pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import * as schema from '@/db/schema';
import type { Database } from '@/db/types';
import { resolveAccess, createAccessMemo } from '@/domain/access/resolve-access';
import { ACCESS_EDGE_CASES, ACCESS_MATRIX } from '@tests/fixtures/access-matrix';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const MINUTE = 60_000;

/** One disposable world: two organizations, one project in each, one account. */
interface World {
  accountId: string;
  /** The organization that owns `projectId`. */
  orgId: string;
  /** A second organization the account may hold a role in instead. */
  otherOrgId: string;
  projectId: string;
  /** A second project in `orgId`, for the wrong-project predicate case. */
  siblingProjectId: string;
  teamId: string;
  contactId: string;
}

describe.skip('INV-11 the resolution matrix, against a live permission graph', () => {
  /**
   * UNSKIP IN: Phase 9, at EXIT — after seven consecutive days at zero
   * shadow-harness disagreements and after the old permission path is deleted.
   * See the header. Until then this suite would be asserting the old answers.
   */

  let pool: pg.Pool;
  let db: Database;
  const worlds: World[] = [];

  beforeAll(async () => {
    expect(
      DATABASE_URL,
      "INV-11's matrix is a property of a running permission graph. Asserting a " +
        'permission check against source text is a check that cannot see its own ' +
        'subject. Set DATABASE_URL.',
    ).not.toBe('');
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
  }, MINUTE);

  afterAll(async () => {
    // Ordered by dependency; the cascades would do it, but a failed run should
    // leave a database the next run can use rather than a puzzle.
    for (const w of worlds) {
      await pool.query('DELETE FROM accounts WHERE id = $1', [w.accountId]);
      await pool.query('DELETE FROM engagements WHERE id = ANY($1)', [
        [w.projectId, w.siblingProjectId],
      ]);
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [[w.orgId, w.otherOrgId]]);
    }
    await pool.end();
  }, MINUTE);

  /**
   * A fresh, isolated world per case.
   *
   * Not one shared fixture with many accounts: the failures this matrix exists
   * to catch are joins that match a row belonging to someone else, and a shared
   * fixture makes those failures *less* visible by giving every query a
   * plausible row to find. Sixty-four small worlds is slower and honest.
   */
  async function makeWorld(label: string, derives: boolean): Promise<World> {
    const w: World = {
      accountId: uuidv7(),
      orgId: uuidv7(),
      otherOrgId: uuidv7(),
      projectId: uuidv7(),
      siblingProjectId: uuidv7(),
      teamId: uuidv7(),
      contactId: uuidv7(),
    };
    const slug = `${label}-${w.orgId.slice(0, 8)}`;

    await pool.query(
      `INSERT INTO organizations (id, name, slug, kind, org_roles_derive_project_access)
       VALUES ($1, $2, $3, 'team', $4), ($5, $6, $7, 'team', $8)`,
      [
        w.orgId,
        `owner org ${slug}`,
        `owner-${slug}`,
        derives,
        w.otherOrgId,
        `other org ${slug}`,
        `other-${slug}`,
        // The second organization's switch is deliberately the *opposite*.
        // The switch belongs to the object's org, never to the caller's, and a
        // world where both agree cannot tell the two readings apart.
        !derives,
      ],
    );

    await pool.query(
      `INSERT INTO engagements (id, org_id, client_org_name, title, status)
       VALUES ($1, $2, 'Bellweather', $3, 'active'), ($4, $2, 'Bellweather', $5, 'active')`,
      [w.projectId, w.orgId, `project ${slug}`, w.siblingProjectId, `sibling ${slug}`],
    );

    await pool.query(
      `INSERT INTO accounts (id, primary_email, name) VALUES ($1, $2, 'Matrix Account')`,
      [w.accountId, `matrix-${w.accountId}@relay.test`],
    );

    worlds.push(w);
    return w;
  }

  async function grantOrg(w: World, orgRole: string, orgIs: 'same' | 'other'): Promise<void> {
    await pool.query(
      `INSERT INTO org_memberships (account_id, org_id, role) VALUES ($1, $2, $3)`,
      [w.accountId, orgIs === 'same' ? w.orgId : w.otherOrgId, orgRole],
    );
  }

  async function grantProject(w: World, projectRole: string): Promise<void> {
    await pool.query(
      `INSERT INTO project_memberships (account_id, project_id, role) VALUES ($1, $2, $3)`,
      [w.accountId, w.projectId, projectRole],
    );
  }

  /* ------------------------------------------------------- the cross-product */

  for (const cell of ACCESS_MATRIX) {
    const name =
      `org=${String(cell.orgRole)} project=${String(cell.projectRole)} ` +
      `(${cell.orgIs} org, derivation ${cell.derives ? 'on' : 'off'}) ` +
      `-> ${String(cell.expected.role)} via ${String(cell.expected.via)}`;

    it(
      name,
      async () => {
        const w = await makeWorld('cell', cell.derives);
        if (cell.orgRole !== null) await grantOrg(w, cell.orgRole, cell.orgIs);
        if (cell.projectRole !== null) await grantProject(w, cell.projectRole);

        expect(await resolveAccess(db, w.accountId, w.projectId), cell.why).toEqual(cell.expected);
      },
      MINUTE,
    );
  }

  /* -------------------------------------------------- the cell ADR-022 names */

  it(
    'both null is deny, and the denial carries no provenance',
    async () => {
      // Given its own case rather than left as four rows among sixty-four.
      // ADR-022: "Null on both roles still means deny, not a default reviewer
      // role. A fallback is the classic way a permission system leaks, and this
      // decision makes the org-derived branch more attractive to reason loosely
      // about, not less."
      const w = await makeWorld('bothnull', true);
      const result = await resolveAccess(db, w.accountId, w.projectId);
      expect(result.role, 'a default role was handed out to an account with none').toBeNull();
      expect(result.via, 'a denial arrived with a reason attached to it').toBeNull();
    },
    MINUTE,
  );

  /* --------------------------------------------------------- the edge cases */

  /**
   * The reason from the fixture, so the assertion message and the table cannot
   * drift apart — and so deleting an edge case from the fixture fails here
   * rather than quietly leaving a test with no stated purpose.
   */
  function edge(id: string): string {
    const found = ACCESS_EDGE_CASES.find((c) => c.id === id);
    if (!found) throw new Error(`no edge case named ${id} in tests/fixtures/access-matrix.ts`);
    return found.why;
  }

  it(
    'a team membership grants nothing on its own',
    async () => {
      // `src/db/schema/access.ts`: a team is a convenience for granting, not an
      // authority. The grant expands into `project_memberships` rows. If a team
      // resolves too, the same grant is reachable two ways and revocable one.
      const w = await makeWorld('team', true);
      await pool.query(`INSERT INTO teams (id, org_id, name) VALUES ($1, $2, 'Delivery')`, [
        w.teamId,
        w.orgId,
      ]);
      await pool.query(`INSERT INTO team_members (team_id, account_id) VALUES ($1, $2)`, [
        w.teamId,
        w.accountId,
      ]);

      expect(
        await resolveAccess(db, w.accountId, w.projectId),
        edge('team-membership-in-the-projects-org'),
      ).toEqual({ role: null, via: null });
    },
    MINUTE,
  );

  it(
    'a reviewer contact id is not an account id',
    async () => {
      // Two uuid columns, neither type surviving a route boundary. The answer
      // that must not come back is `reviewer` — the one a lenient resolver
      // reaches for because it looks so nearly right. Reviewers hold sessions
      // under INV-6 and have no account at all.
      const w = await makeWorld('contact', true);
      await pool.query(
        `INSERT INTO client_contacts (id, engagement_id, email, name)
         VALUES ($1, $2, $3, 'Rowan')`,
        [w.contactId, w.projectId, `rowan-${w.contactId}@bellweather.test`],
      );

      expect(
        await resolveAccess(db, w.contactId, w.projectId),
        edge('reviewer-contact-id-passed-as-account-id'),
      ).toEqual({ role: null, via: null });
    },
    MINUTE,
  );

  it(
    'an account that does not exist and a project that does not exist deny identically',
    async () => {
      const w = await makeWorld('missing', true);
      await grantProject(w, 'lead');

      const noAccount = await resolveAccess(db, uuidv7(), w.projectId);
      const noProject = await resolveAccess(db, w.accountId, uuidv7());
      const neither = await resolveAccess(db, uuidv7(), uuidv7());

      expect(noAccount, edge('account-id-that-exists-nowhere')).toEqual({ role: null, via: null });
      expect(noProject, edge('project-id-that-exists-nowhere')).toEqual({ role: null, via: null });
      // Indistinguishability is the assertion. A resolver that answers
      // differently for "no such project" confirms which project ids exist to
      // a caller who is not entitled to know.
      expect(noProject, 'a missing project is distinguishable from a missing grant').toEqual(
        noAccount,
      );
      expect(neither).toEqual(noAccount);
    },
    MINUTE,
  );

  it(
    'a membership on one project grants nothing on its sibling',
    async () => {
      // The predicate must bind the project id. A query that forgets it grants
      // every project in the organization to anyone holding one — and every
      // same-org cell above would still pass.
      const w = await makeWorld('sibling', true);
      await grantProject(w, 'lead');

      expect(
        await resolveAccess(db, w.accountId, w.siblingProjectId),
        edge('membership-row-in-another-projects-name'),
      ).toEqual({ role: null, via: null });
    },
    MINUTE,
  );

  it(
    'a purged project still resolves from memberships, not from its lifecycle',
    async () => {
      // INV-7 leaves the engagement row standing as a tombstone. Access
      // resolution is not a lifecycle check; merging the two questions is how
      // "you may not see this" and "this is gone" become the same 404 for the
      // wrong reason.
      const w = await makeWorld('purged', true);
      await grantProject(w, 'contributor');
      await pool.query(`UPDATE engagements SET status = 'purged' WHERE id = $1`, [w.projectId]);

      expect(await resolveAccess(db, w.accountId, w.projectId), edge('purged-project')).toEqual({
        role: 'contributor',
        via: 'project',
      });
    },
    MINUTE,
  );

  it(
    'the derivation switch is read from the project\'s organization, never the caller\'s',
    async () => {
      // `makeWorld` gives the second organization the opposite switch setting
      // on purpose. Owner of both; asked about the project in the first. The
      // answer must follow the first organization's column in both directions,
      // which is the pair of runs a single-direction test cannot separate.
      for (const derives of [true, false]) {
        const w = await makeWorld('switch', derives);
        await pool.query(
          `INSERT INTO org_memberships (account_id, org_id, role)
           VALUES ($1, $2, 'owner'), ($1, $3, 'owner')`,
          [w.accountId, w.orgId, w.otherOrgId],
        );

        expect(
          await resolveAccess(db, w.accountId, w.projectId),
          edge('switch-read-from-the-accounts-own-org'),
        ).toEqual(derives ? { role: 'lead', via: 'org' } : { role: null, via: null });
      }
    },
    MINUTE,
  );

  it(
    'one account cannot hold two org membership rows in one organization',
    async () => {
      // Not reachable today, and asserted so. `strongest()` is the shape that
      // breaks silently if a second row becomes possible: a resolver taking the
      // first row rather than the strongest would pass every other case here.
      // The primary key is what makes that unreachable, so the primary key is
      // what gets the assertion.
      const w = await makeWorld('dupe', true);
      await grantOrg(w, 'member', 'same');
      await expect(
        grantOrg(w, 'owner', 'same'),
        edge('duplicate-org-membership-rows'),
      ).rejects.toThrow();
    },
    MINUTE,
  );

  /* ------------------------------------------------------------- the memo */

  it(
    'the request memo never answers for a different account or a different project',
    async () => {
      // `createAccessMemo()` is per request by construction, but its key is
      // ordinary code. A memo keyed on the account alone returns one project's
      // answer for another, and every test above would still pass because each
      // makes exactly one call.
      const w = await makeWorld('memo', true);
      await grantProject(w, 'lead');
      const memo = createAccessMemo();

      expect(await resolveAccess(db, w.accountId, w.projectId, memo)).toEqual({
        role: 'lead',
        via: 'project',
      });
      expect(
        await resolveAccess(db, w.accountId, w.siblingProjectId, memo),
        'the memo answered for a project it was never asked about',
      ).toEqual({ role: null, via: null });
      expect(
        await resolveAccess(db, uuidv7(), w.projectId, memo),
        'the memo answered for an account it was never asked about',
      ).toEqual({ role: null, via: null });
    },
    MINUTE,
  );

  it(
    'a revoked membership is not served from a memo made before the revocation',
    async () => {
      // DELIVERY-PLAN §VII: a cached grant survives revocation. The memo is
      // request-scoped precisely so that window is one request long, and this
      // pins the scope rather than the absence of caching — a *new* memo must
      // see the revocation even though the old one does not.
      const w = await makeWorld('revoke', true);
      await grantProject(w, 'lead');

      const stale = createAccessMemo();
      expect(await resolveAccess(db, w.accountId, w.projectId, stale)).toEqual({
        role: 'lead',
        via: 'project',
      });

      await pool.query('DELETE FROM project_memberships WHERE account_id = $1', [w.accountId]);

      expect(
        await resolveAccess(db, w.accountId, w.projectId, createAccessMemo()),
        'a fresh memo served a grant that had been revoked',
      ).toEqual({ role: null, via: null });
    },
    MINUTE,
  );
});
