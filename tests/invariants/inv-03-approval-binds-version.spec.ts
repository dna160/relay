/**
 * INV-3 — An approval references exactly one immutable `asset_version` and
 * stores that version's sha256 at decision time.
 *
 * "Approved" must survive a dispute six months later (ADR-004). Approving a
 * mutable card cannot do that; approving a hash can.
 *
 * UNSKIP IN: Phase 3 — Assets, versions, approvals.
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';

describe.skip('INV-3 approvals bind to an immutable version hash', () => {
  it('a recorded decision copies the version sha256 rather than referencing it', async () => {
    // recordDecision() must read asset_versions.sha256 and write it into
    // approvals.version_sha256 in the same transaction.
    expect.fail('Phase 3: implement src/domain/approval/record-decision.ts');
  });

  it('a decision cannot be recorded against a card, only against a version', () => {
    expect.fail('Phase 3: approvals.asset_version_id is NOT NULL and there is no card_id column');
  });

  it('changes_requested without a note is rejected', () => {
    expect.fail('Phase 3: enforce the CHECK constraint in the domain too, for the error message');
  });

  it('a stored decision still verifies after the version row is re-read', () => {
    expect.fail('Phase 3: stored sha256 must equal the version sha256 at read time');
  });
});
