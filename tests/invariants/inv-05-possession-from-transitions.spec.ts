/**
 * INV-5 — Every state transition writes a `state_transitions` row carrying
 * possession. The possession clock is derived from this table and nowhere else.
 *
 * Totals denormalise badly and cannot be recomputed after a bug (ADR-010).
 *
 * UNSKIP IN: Phase 2 (the transitions row) and Phase 5 (the derived clock).
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';

describe.skip('INV-5 possession is derived from state_transitions alone', () => {
  it('every persisted transition appends exactly one state_transitions row', () => {
    expect.fail('Phase 2: transitionCard() writes card + transition row in one transaction');
  });

  it('no table stores a running possession total', () => {
    expect.fail('Phase 5: structural scan of src/db/schema for possession_ms / agency_ms columns');
  });

  it('possession totals recompute from a transition fixture within 1s tolerance', () => {
    expect.fail('Phase 5: computePossession(transitions, now) against tests/fixtures/possession.json');
  });

  it('a card in signed_off accrues to neither party', () => {
    expect.fail('Phase 5: POSSESSION.signed_off is null and the clock stops');
  });
});
