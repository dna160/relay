/**
 * INV-4 — `asset_versions` is append-only. Rows are never updated or deleted
 * except by the purge worker.
 *
 * The one sanctioned mutation is `published_to_client_at` passing the internal
 * gate, and `superseded_by` when a newer version lands. Both are set-once.
 *
 * UNSKIP IN: Phase 3 — Assets, versions, approvals.
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';

describe.skip('INV-4 asset_versions is append-only', () => {
  it('no code outside the purge worker deletes an asset_version', () => {
    expect.fail('Phase 3: structural scan for delete(assetVersions) outside src/workers/purge.ts');
  });

  it('the only permitted updates are the set-once publish and supersede columns', () => {
    expect.fail('Phase 3: scan .set({...}) against assetVersions for any other column');
  });

  it('publishing an already-published version is a no-op, not a re-stamp', () => {
    expect.fail('Phase 3: published_to_client_at is set once and never moved');
  });

  it('version_no is monotonic per card and never reused', () => {
    expect.fail('Phase 3: UNIQUE (card_id, version_no) plus allocation inside the transaction');
  });
});
