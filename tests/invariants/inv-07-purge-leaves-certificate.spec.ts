/**
 * INV-7 — Purge destroys all object bytes and content rows for an engagement
 * and leaves exactly one `purge_certificate`.
 *
 * The certificate proves absence, not content. It is the compliance artifact
 * the agency forwards to its client's legal team, which is what turns the
 * paywall's downside into something they are glad to have.
 *
 * UNSKIP IN: Phase 6 — Ephemerality.
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';

describe.skip('INV-7 purge is total and leaves one certificate', () => {
  it('purging removes every content row reachable from the engagement', () => {
    expect.fail('Phase 6: walk the purge manifest against the schema; no table left behind');
  });

  it('purging deletes every object key it listed in the manifest', () => {
    expect.fail('Phase 6: storage delete count equals manifest object_count');
  });

  it('purge writes exactly one certificate, in the same transaction as deletion', () => {
    expect.fail('Phase 6: one row in purge_certificates, never zero and never two');
  });

  it('purge is idempotent — a forced mid-run failure is safe to rerun', () => {
    expect.fail('Phase 6: rerun after a kill at each step yields one certificate');
  });

  it('no purge path can run without having emitted warnings first', () => {
    expect.fail('Phase 6: purge asserts four warning rows exist before it destroys anything');
  });

  it('--plan prints a manifest and destroys nothing', () => {
    expect.fail('Phase 6: dry run leaves row counts and object counts unchanged');
  });
});
