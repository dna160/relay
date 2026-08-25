/**
 * INV-3 — An approval references exactly one immutable `asset_version` and
 * stores that version's sha256 at decision time.
 *
 * "Approved" must survive a dispute six months later (ADR-004). Approving a
 * mutable card cannot do that; approving a hash can.
 *
 * UNSKIPPED IN: Phase 3 — the structural and schema half. The cases that need
 * a running Postgres stay skipped below and name their phase.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { linesMatching, sourceFiles } from './_source';
import { allMigrationSql, createTableBody, hasMigrations } from './_sql';
import { approvals, versions } from '@tests/fixtures';

const RECORDER = 'src/domain/approval/record-decision.ts';

describe('INV-3 approvals bind to an immutable version hash', () => {
  it('a recorded decision copies the version sha256 rather than referencing it', () => {
    const recorder = sourceFiles().find((f) => f.path === RECORDER);
    expect(recorder, `${RECORDER} is missing`).toBeDefined();
    if (!recorder) return;

    // The hash is read from the version and written into the approval, in the
    // same transaction. A join at read time answers "what does this hash to
    // now"; the dispute asks "what did the person who clicked approve see".
    expect(recorder.text).toMatch(/versionSha256\s*:\s*\w+\.sha256/);
    expect(recorder.text, 'the read and the copy must share one transaction').toMatch(
      /db\.transaction|tx\.insert\s*\(\s*approvals\s*\)/,
    );
  });

  it('nothing outside the recorder writes an approval row', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file.path === RECORDER) continue;
      for (const line of linesMatching(file, /insert\s*\(\s*approvals\s*\)|INSERT\s+INTO\s+approvals/i)) {
        offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'an approval written outside record-decision.ts').toEqual([]);
  });

  it('never recomputes the stored hash from the version at read time', () => {
    // `versionSha256: assetVersions.sha256` in a *select* is the join that
    // silently repairs a tampered file and destroys the evidence.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const line of linesMatching(file, /versionSha256\s*:\s*assetVersions\.sha256/)) {
        offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'the stored hash was re-derived from the version').toEqual([]);
  });

  it('a decision cannot be recorded against a card, only against a version', () => {
    const body = createTableBody('approvals');
    if (body === null) return; // Phase 3 creates it.
    expect(body).toMatch(/"asset_version_id"\s+uuid\s+NOT NULL/i);
    expect(body, 'approvals must have no card_id column').not.toMatch(/"card_id"/i);
  });

  it('stores the hash at full width and never nullable', () => {
    const body = createTableBody('approvals');
    if (body === null) return;
    expect(body).toMatch(/"version_sha256"\s+char\(64\)\s+NOT NULL/i);
  });

  it('the database refuses changes_requested without a note', () => {
    if (!hasMigrations()) return;
    const body = createTableBody('approvals');
    if (body === null) return;
    expect(body, 'the CHECK from DATA-MODEL.md is missing').toMatch(
      /CHECK\s*\([^)]*decision[^)]*=\s*'approved'\s+OR[^)]*note[^)]*IS NOT NULL/i,
    );
  });

  /**
   * The decider rule moved out of this file, and the move is the point.
   *
   * This case used to read `num_nonnulls(contact, user) = 1` out of migration
   * `0002`'s `CREATE TABLE`. A migration is history: its text cannot change, so
   * the assertion pinned what the schema *was* and would have kept passing if
   * the live constraint were altered — or dropped entirely. Migration `0004`
   * then replaced that CHECK, and the old assertion went on passing while
   * describing a rule the product had deliberately abandoned.
   *
   * That is the same shape as the other three escapes found this build: the
   * guard reads something narrower than the invariant claims. So the rule is
   * now asserted against `pg_constraint` and by handing Postgres rows it must
   * refuse — `inv-03-approval-binds-version.db.spec.ts`, `npm run test:db`.
   *
   * What stays here is the half the database does not own and cannot: *exactly*
   * one decider at write time. After an erasure Postgres cannot tell "never had
   * a decider" from "had one, and they were erased", so that half belongs to
   * `recordDecision()` — and this is the scan that keeps it there.
   */
  it('the recorder derives all three decider columns from one actor', () => {
    const recorder = sourceFiles().find((f) => f.path === RECORDER);
    expect(recorder, `${RECORDER} is missing`).toBeDefined();
    if (!recorder) return;

    // One discriminated actor in, three columns out. Two independent reads of
    // the actor is how a row acquires a side that disagrees with its id.
    expect(recorder.text, 'decided_by_side must come from the actor discriminant').toMatch(
      /decidedBySide\s*:\s*\w+\.actor\.kind/,
    );
    expect(recorder.text, 'the contact id must be conditional on the actor kind').toMatch(
      /decidedByContactId\s*:[^,]*actor\.kind\s*===\s*'client'/,
    );
    expect(recorder.text, 'the user id must be conditional on the actor kind').toMatch(
      /decidedByUserId\s*:[^,]*actor\.kind\s*===\s*'agency'/,
    );
  });

  it('the current decider constraint is in the migration set, and the old one is gone', () => {
    if (!hasMigrations()) return;
    const sql = allMigrationSql();
    // Not a substitute for the live check — a migration that was never applied
    // says nothing. This catches the other direction: a live database patched
    // by hand, with no migration behind it.
    expect(sql, 'no migration establishes the side/decider agreement rule').toMatch(
      /decided_by_side['"\s]*=\s*'client'[\s\S]{0,200}decided_by_user_id[\s\S]{0,40}IS NULL/i,
    );
    expect(sql, 'decided_by_side must be NOT NULL').toMatch(
      /ALTER COLUMN "decided_by_side" SET NOT NULL/i,
    );
    expect(
      sql,
      'the impossible num_nonnulls rule is still being established somewhere',
    ).toMatch(/DROP CONSTRAINT "approvals_one_decider"/i);
  });

  it('every fixture approval states its side rather than implying it', () => {
    for (const approval of approvals) {
      expect(
        approval.decidedBySide,
        `approval ${approval.id} does not say which side decided`,
      ).toMatch(/^(client|agency)$/);
      // And the side agrees with whichever id it carries — the same rule the
      // database enforces, checked against the fixture the seed uses.
      if (approval.decidedBySide === 'client') {
        expect(approval.decidedByUserId, `${approval.id} is client-side but names a user`).toBeNull();
      } else {
        expect(
          approval.decidedByContactId,
          `${approval.id} is agency-side but names a contact`,
        ).toBeNull();
      }
    }
  });

  it('the domain rejects a note-less changes_requested before the constraint does', () => {
    const recorder = sourceFiles().find((f) => f.path === RECORDER);
    if (!recorder) return;
    // A constraint violation is a 500. The client deserves a 400 that says
    // what is missing, which means the domain checks first.
    expect(recorder.text).toMatch(/changes_requested[\s\S]{0,200}validationFailed|validationFailed[\s\S]{0,200}note/);
  });

  it('every fixture approval carries the hash of the version it names', () => {
    for (const approval of approvals) {
      const version = versions.find((v) => v.id === approval.assetVersionId);
      expect(version, `approval ${approval.id} names a version that does not exist`).toBeDefined();
      expect(approval.versionSha256).toBe(version!.sha256);
      expect(approval.versionSha256).toHaveLength(64);
    }
  });
});

describe.skip('INV-3 under a live database', () => {
  /** UNSKIP IN: Phase 3 — these need a running Postgres to drive recordDecision. */

  it('changes_requested without a note is rejected with 400, not 500', () => {
    expect.fail('Phase 3: recordDecision throws VALIDATION_FAILED before the CHECK fires');
  });

  it('a stored decision still verifies after the version row is re-read', () => {
    expect.fail('Phase 3: stored sha256 equals the version sha256 at read time, by copy not by join');
  });

  it('a client cannot decide on a version that was never published to them', () => {
    expect.fail('Phase 3/4: an unpublished version is NOT_VISIBLE (404), never 403');
  });

  it('the certificate outlives the version row it was taken from', () => {
    expect.fail(
      'Phase 6: after purge the approval row is gone too, but the copied hash is what the ' +
        'certificate manifest was built from. Approving a hash is what survives.',
    );
  });
});
