/**
 * INV-8 — Active-project count is one function, `countActiveEngagements()`.
 * Billing limits and expiry scheduling both call it. They may never diverge.
 *
 * Two implementations of "active" will drift, and the drift will bill someone
 * for a workspace it also deleted (ADR-008).
 *
 * UNSKIP IN: Phase 1 — Tenancy, identity, engagement lifecycle.
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';

describe.skip('INV-8 one definition of active', () => {
  it('exactly one function in the codebase defines active-engagement counting', () => {
    expect.fail('Phase 1: structural scan — one export of countActiveEngagements');
  });

  it('the plan gate calls it rather than re-querying', () => {
    expect.fail('Phase 1: src/domain/plan/ imports the counter, no status ACTIVE literal of its own');
  });

  it('the expiry scheduler calls the same function', () => {
    expect.fail('Phase 1: src/domain/retention/ imports the same counter');
  });

  it('activity older than the window makes an engagement inactive for both callers', () => {
    expect.fail('Phase 1: one fixture, two callers, identical answer');
  });
});
