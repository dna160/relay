/**
 * INV-3, against the database that is actually running.
 *
 * ## Why this file exists
 *
 * `inv-03-approval-binds-version.spec.ts` asserted the decider rule by reading
 * `CREATE TABLE "approvals"` out of migration `0002`. That text is frozen — a
 * migration is history and cannot change — so the assertion pinned what the
 * schema *was* on the day it was written, and would have gone on passing if the
 * live constraint were altered, or dropped outright.
 *
 * That is the third instance this build of one shape: **the guard reads
 * something narrower than the invariant claims.** A signature-based scan was
 * escapable by composition. A lowercase match was escapable by a capital
 * letter. A line-based scan was escapable by a newline. And a text scan of a
 * file that can never change stands in for a database that can.
 *
 * So the rule is asserted here the only way that cannot go stale: by handing
 * Postgres rows it must refuse, and rows it must accept, and believing what it
 * says.
 *
 * ## What the rule is now, and which half the database owns
 *
 * Migration `0004` replaced `num_nonnulls(contact, user) = 1` — which was
 * impossible, because both FKs are `ON DELETE SET NULL` and the first erasure
 * made every affected row violate its own CHECK — with:
 *
 *     (side = 'client' AND decided_by_user_id    IS NULL)
 *  OR (side = 'agency' AND decided_by_contact_id IS NULL)
 *
 * The database therefore owns **at most one decider, and it must agree with the
 * side**. It does *not* own "exactly one", and it cannot: after an erasure it
 * genuinely cannot tell *never had a decider* from *had one, and they were
 * erased*. That half is owned by `recordDecision()`, which builds all three
 * columns from one discriminated actor — and is asserted structurally in the
 * portable half of this invariant.
 *
 * Splitting the claim like this is the point. An invariant that says "the
 * database refuses two deciders or none" when the database does no such thing
 * is worse than no invariant, because it is believed.
 *
 * Runs under `npm run test:db`. Never edit this file to make a build pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedPurgeable, type SeededEngagement } from './_purge-harness';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const MINUTE = 60_000;
const SHA = 'a'.repeat(64);

describe('INV-3 the decider rule, against the live schema', () => {
  let pool: pg.Pool;
  let bucket: string;
  const seeded: SeededEngagement[] = [];

  beforeAll(async () => {
    expect(
      DATABASE_URL,
      'INV-3\'s decider rule is a property of a running database. Asserting it against ' +
        'migration text is what this file exists to stop doing. Set DATABASE_URL.',
    ).not.toBe('');
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    bucket = mkdtempSync(join(tmpdir(), 'relay-inv3-'));
  }, MINUTE);

  afterAll(async () => {
    for (const seed of seeded) {
      await pool.query('DELETE FROM audit_log WHERE engagement_id = $1', [seed.engagementId]);
      await pool.query('DELETE FROM engagements WHERE id = $1', [seed.engagementId]);
      await pool.query('DELETE FROM organizations WHERE id = $1', [seed.orgId]);
    }
    await pool.end();
    if (bucket) rmSync(bucket, { recursive: true, force: true });
  }, MINUTE);

  async function seed(label: string): Promise<SeededEngagement> {
    const s = await seedPurgeable(pool, join(bucket, label), { label });
    seeded.push(s);
    return s;
  }

  /** Attempts an insert and returns the constraint that refused it, or null. */
  async function insertApproval(
    versionId: string,
    columns: Record<string, string | null>,
  ): Promise<string | null> {
    const base: Record<string, string | null> = {
      id: uuidv7(),
      asset_version_id: versionId,
      decision: 'approved',
      version_sha256: SHA,
      note: null,
      decided_by_contact_id: null,
      decided_by_user_id: null,
      decided_by_side: 'client',
      ...columns,
    };
    const names = Object.keys(base);
    const placeholders = names.map((_, i) => `$${String(i + 1)}`).join(', ');
    try {
      await pool.query(
        `INSERT INTO approvals (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${placeholders})`,
        Object.values(base),
      );
      return null;
    } catch (error) {
      const e = error as { constraint?: string; code?: string; message?: string };
      return e.constraint ?? e.code ?? e.message ?? 'unknown';
    }
  }

  /* --------------------------------------------------- what it must refuse */

  it(
    'refuses a decider that disagrees with the side it claims',
    async () => {
      const s = await seed('inv3-disagree');
      const [version] = s.versionIds;

      // 'client' decided, but an agency user is named. One of those two facts
      // is a lie and the row does not get to hold both.
      expect(
        await insertApproval(version!, { decided_by_side: 'client', decided_by_user_id: s.userId }),
        'a client-side approval accepted an agency decider',
      ).toBe('approvals_one_decider');

      expect(
        await insertApproval(version!, {
          decided_by_side: 'agency',
          decided_by_contact_id: s.contactId,
        }),
        'an agency-side approval accepted a client decider',
      ).toBe('approvals_one_decider');
    },
    MINUTE,
  );

  it(
    'refuses an approval naming two deciders',
    async () => {
      const s = await seed('inv3-two');
      const [version] = s.versionIds;
      for (const side of ['client', 'agency']) {
        expect(
          await insertApproval(version!, {
            decided_by_side: side,
            decided_by_contact_id: s.contactId,
            decided_by_user_id: s.userId,
          }),
          `a ${side}-side approval accepted both a contact and a user`,
        ).toBe('approvals_one_decider');
      }
    },
    MINUTE,
  );

  it(
    'refuses an approval that does not say which side decided',
    async () => {
      const s = await seed('inv3-noside');
      const [version] = s.versionIds;
      // NOT NULL. This is the column that has to survive erasure; a row without
      // it is a row that will one day mean nothing.
      expect(
        await insertApproval(version!, {
          decided_by_side: null,
          decided_by_contact_id: s.contactId,
        }),
        'an approval was accepted with no side',
      ).toBe('23502'); // not_null_violation
    },
    MINUTE,
  );

  it(
    'refuses a side that is neither client nor agency',
    async () => {
      const s = await seed('inv3-badside');
      const [version] = s.versionIds;
      // `decided_by_side` is a bare `text` column — the enum is a TypeScript
      // fact, not a database one. The CHECK is what makes a third value
      // impossible, because a value that is neither satisfies neither branch.
      // Worth pinning: it holds by consequence rather than by intent, and a
      // future rewrite of the CHECK could lose it without meaning to.
      expect(
        await insertApproval(version!, { decided_by_side: 'both', decided_by_contact_id: null }),
        'an approval was accepted with a side of "both"',
      ).toBe('approvals_one_decider');
    },
    MINUTE,
  );

  it(
    'still refuses changes_requested without a note',
    async () => {
      const s = await seed('inv3-note');
      const [version] = s.versionIds;
      expect(
        await insertApproval(version!, {
          decision: 'changes_requested',
          note: null,
          decided_by_contact_id: s.contactId,
        }),
        'changes_requested was accepted with no note; the client is told nothing',
      ).toBe('approvals_changes_require_note');
    },
    MINUTE,
  );

  /* --------------------------------------------------- what it must accept */

  it(
    'accepts an anonymous approval that still says which side decided',
    async () => {
      const s = await seed('inv3-anon');
      const [version] = s.versionIds;
      // This is the row an erasure leaves behind. It has to be legal, or the
      // erasure that produces it cannot run — which is the defect 0004 fixed.
      expect(
        await insertApproval(version!, {
          decided_by_side: 'agency',
          decided_by_contact_id: null,
          decided_by_user_id: null,
        }),
        'an anonymised approval was refused; erasure cannot complete',
      ).toBeNull();
    },
    MINUTE,
  );

  /* ------------------------------------------- erasure, all four cascades */

  it(
    'erasing a client contact anonymises the approval without destroying it',
    async () => {
      const s = await seed('inv3-erase-contact');
      const before = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM approvals a JOIN asset_versions v ON v.id = a.asset_version_id
          WHERE v.card_id = $1`,
        [s.cardId],
      );
      expect(Number(before.rows[0]!.n), 'the fixture seeded no approval to erase').toBe(1);

      await pool.query('DELETE FROM client_contacts WHERE id = $1', [s.contactId]);

      const after = await pool.query<{
        decided_by_contact_id: string | null;
        decided_by_user_id: string | null;
        decided_by_side: string;
        version_sha256: string;
      }>(
        `SELECT a.decided_by_contact_id, a.decided_by_user_id, a.decided_by_side, a.version_sha256
           FROM approvals a JOIN asset_versions v ON v.id = a.asset_version_id
          WHERE v.card_id = $1`,
        [s.cardId],
      );
      expect(after.rows, 'the approval was destroyed with the person who made it').toHaveLength(1);
      const row = after.rows[0]!;
      expect(row.decided_by_contact_id, 'the erased contact is still named').toBeNull();
      expect(row.decided_by_user_id).toBeNull();
      // The fact that survives. Without it this row can no longer say whether
      // the client approved the work or the agency signed it off, which is the
      // first question anyone asks in a dispute.
      expect(row.decided_by_side, 'the surviving row no longer says which side decided').toBe(
        'client',
      );
      expect(row.version_sha256, 'the evidence hash did not survive the erasure').toBe(SHA);
    },
    MINUTE,
  );

  it(
    'erasing an agency user who signed off leaves the same anonymous record',
    async () => {
      // The ordinary case of someone leaving the company, and the fourth
      // failing delete path — the one the original defect report missed.
      const s = await seed('inv3-erase-user');
      const [version] = s.versionIds;
      await pool.query(
        `INSERT INTO approvals
           (id, asset_version_id, decision, decided_by_user_id, decided_by_side, version_sha256)
         VALUES ($1, $2, 'approved', $3, 'agency', $4)`,
        [uuidv7(), version!, s.userId, SHA],
      );

      await pool.query('DELETE FROM users WHERE id = $1', [s.userId]);

      const { rows } = await pool.query<{ decided_by_side: string; decided_by_user_id: string | null }>(
        `SELECT a.decided_by_side, a.decided_by_user_id
           FROM approvals a JOIN asset_versions v ON v.id = a.asset_version_id
          WHERE v.card_id = $1 AND a.decided_by_side = 'agency'`,
        [s.cardId],
      );
      expect(rows, 'the sign-off was destroyed when the person left').toHaveLength(1);
      expect(rows[0]!.decided_by_user_id).toBeNull();
      expect(rows[0]!.decided_by_side).toBe('agency');
    },
    MINUTE,
  );

  it(
    'deleting an engagement, and an organization, both now complete',
    async () => {
      // These are the two that failed outright before 0004. The engagement
      // delete is the ADR-007 tombstone reaper; the organization delete is
      // account deletion and GDPR erasure. Neither could run.
      const forEngagement = await seed('inv3-drop-engagement');
      await expect(
        pool.query('DELETE FROM engagements WHERE id = $1', [forEngagement.engagementId]),
        'deleting an engagement still fails; the tombstone reaper cannot run',
      ).resolves.toBeDefined();

      const forOrg = await seed('inv3-drop-org');
      await pool.query('DELETE FROM audit_log WHERE engagement_id = $1', [forOrg.engagementId]);
      await expect(
        pool.query('DELETE FROM organizations WHERE id = $1', [forOrg.orgId]),
        'deleting an organization still fails; account deletion cannot run',
      ).resolves.toBeDefined();

      const { rows } = await pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM organizations WHERE id = $1',
        [forOrg.orgId],
      );
      expect(Number(rows[0]!.n), 'the organization survived its own deletion').toBe(0);
    },
    MINUTE,
  );

  /* ------------------------------------------- the constraint is still there */

  it(
    'both CHECK constraints exist on the live table, not merely in a migration',
    async () => {
      // The assertion this file was written to replace read migration text,
      // which cannot change and therefore cannot report a drop. This reads
      // pg_constraint, which is the thing rows are actually checked against.
      const { rows } = await pool.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = 'approvals'::regclass AND contype = 'c'
          ORDER BY conname`,
      );
      const byName = Object.fromEntries(rows.map((r) => [r.conname, r.def]));

      expect(
        Object.keys(byName).sort(),
        'a CHECK constraint was dropped from approvals',
      ).toEqual(['approvals_changes_require_note', 'approvals_one_decider']);

      expect(byName['approvals_one_decider']).toMatch(/decided_by_side/);
      expect(byName['approvals_one_decider']).toMatch(/decided_by_user_id IS NULL/);
      expect(byName['approvals_one_decider']).toMatch(/decided_by_contact_id IS NULL/);
      expect(byName['approvals_changes_require_note']).toMatch(/note IS NOT NULL/);

      // And the column that carries the surviving fact is NOT NULL on the live
      // table. A nullable one would let a future writer omit it silently.
      const { rows: column } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'approvals' AND column_name = 'decided_by_side'`,
      );
      expect(column, 'decided_by_side does not exist on the live table').toHaveLength(1);
      expect(column[0]!.is_nullable, 'decided_by_side is nullable').toBe('NO');
    },
    MINUTE,
  );
});
