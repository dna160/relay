/**
 * The possession computation contract — `src/domain/card/possession.ts`.
 *
 * This suite was written against the documented contract before the module
 * existed and was unskipped when it landed. The expected totals live in
 * `tests/fixtures/possession.json` and are independently re-derived from the
 * rule in DATA-MODEL.md by `tests/unit/fixtures.spec.ts`, so a failure here is
 * the implementation, not the fixture.
 *
 * PHASE-5 EXIT: "possession totals recomputed from transitions match a fixture
 * within 1s of tolerance". That is the first test below.
 */

import { describe, expect, it } from 'vitest';
import {
  computePossession,
  possessionByCard,
  sumPossession,
} from '@/domain/card/possession';
import {
  POSSESSION_TOLERANCE_MS,
  possessionCase,
  possessionCases,
  transitionsAsRows,
} from '@tests/fixtures';

describe('computePossession against the fixture', () => {
  it.each(possessionCases.map((c) => [c.name, c] as const))(
    'case "%s" matches within the tolerance',
    (_name, c) => {
      const actual = computePossession(transitionsAsRows(c), new Date(c.now));
      expect(
        Math.abs(actual.agencyMs - c.expected.agencyMs),
        `agencyMs — ${c.expectedHuman}`,
      ).toBeLessThanOrEqual(POSSESSION_TOLERANCE_MS);
      expect(Math.abs(actual.clientMs - c.expected.clientMs)).toBeLessThanOrEqual(
        POSSESSION_TOLERANCE_MS,
      );
      expect(actual.current).toBe(c.expected.current);
      expect(Math.abs(actual.currentMs - c.expected.currentMs)).toBeLessThanOrEqual(
        POSSESSION_TOLERANCE_MS,
      );
    },
  );

  it('is exact, not merely inside the tolerance', () => {
    // The tolerance exists for wall-clock drift in an integration test. A pure
    // function over fixed instants has no drift and must land on the number.
    for (const c of possessionCases) {
      const actual = computePossession(transitionsAsRows(c), new Date(c.now));
      expect({ agencyMs: actual.agencyMs, clientMs: actual.clientMs }, c.name).toEqual({
        agencyMs: c.expected.agencyMs,
        clientMs: c.expected.clientMs,
      });
    }
  });
});

describe('the rules behind the numbers', () => {
  it('stops the clock at sign-off rather than accruing to the agency', () => {
    const c = possessionCase('full lifecycle through one revision round to sign-off');
    const result = computePossession(transitionsAsRows(c), new Date(c.now));
    expect(result.current).toBeNull();
    expect(result.currentMs).toBe(0);

    // A year passes after sign-off and the totals do not move.
    const muchLater = computePossession(
      transitionsAsRows(c),
      new Date(Date.parse(c.now) + 365 * 24 * 3_600_000),
    );
    expect(muchLater.agencyMs).toBe(result.agencyMs);
    expect(muchLater.clientMs).toBe(result.clientMs);
  });

  it('returns zeroes for a card that has never transitioned', () => {
    const c = possessionCase('no transitions at all');
    expect(computePossession([], new Date(c.now))).toEqual({
      agencyMs: 0,
      clientMs: 0,
      current: null,
      currentMs: 0,
    });
  });

  it('sorts by occurred_at rather than trusting row order', () => {
    const ordered = possessionCase('open card currently with the client');
    const shuffled = possessionCase('unordered rows sum to the same totals');
    expect(computePossession(transitionsAsRows(shuffled), new Date(shuffled.now))).toEqual(
      computePossession(transitionsAsRows(ordered), new Date(ordered.now)),
    );
  });

  it('keeps millisecond precision instead of rounding to seconds', () => {
    const c = possessionCase('sub-second segments');
    const result = computePossession(transitionsAsRows(c), new Date(c.now));
    expect(result.agencyMs).toBe(2_000);
    expect(result.clientMs).toBe(1_500);
  });

  it('is pure — same arguments, same answer, input untouched', () => {
    const c = possessionCase('full lifecycle through one revision round to sign-off');
    const rows = transitionsAsRows(c);
    const before = JSON.stringify(rows);
    const a = computePossession(rows, new Date(c.now));
    const b = computePossession(rows, new Date(c.now));
    expect(a).toEqual(b);
    expect(JSON.stringify(rows), 'computePossession sorted its argument in place').toBe(before);
  });

  it('never returns a negative duration when now precedes the last transition', () => {
    const c = possessionCase('open card currently with the client');
    const rows = transitionsAsRows(c);
    const past = new Date(Date.parse(c.transitions[0]!.occurredAt) - 3_600_000);
    const result = computePossession(rows, past);
    expect(result.agencyMs).toBeGreaterThanOrEqual(0);
    expect(result.clientMs).toBeGreaterThanOrEqual(0);
    expect(result.currentMs).toBeGreaterThanOrEqual(0);
  });

  it('treats two rows at the same instant as a zero-length segment', () => {
    const c = possessionCase('open card currently with the client');
    const rows = transitionsAsRows(c);
    const duplicated = [...rows, { ...rows[1]!, occurredAt: rows[1]!.occurredAt }];
    expect(() => computePossession(duplicated, new Date(c.now))).not.toThrow();
    expect(computePossession(duplicated, new Date(c.now)).clientMs).toBe(c.expected.clientMs);
  });
});

describe('aggregation', () => {
  it('groups a flat transition set by card in one pass', () => {
    const a = possessionCase('open card currently with the client');
    const b = possessionCase('one transition, never moved again');
    // The two cases carry different clocks; use the later one for both so the
    // grouped answer can be compared against a per-card computation.
    const now = new Date(Math.max(Date.parse(a.now), Date.parse(b.now)));
    const rows = [...transitionsAsRows(a), ...transitionsAsRows(b)];
    const grouped = possessionByCard(rows, now);

    expect(grouped.size).toBe(2);
    expect(grouped.get(a.cardId)).toEqual(computePossession(transitionsAsRows(a), now));
    expect(grouped.get(b.cardId)).toEqual(computePossession(transitionsAsRows(b), now));
  });

  it('does not let one card’s rows leak into another card’s total', () => {
    const a = possessionCase('open card currently with the client');
    const b = possessionCase('one transition, never moved again');
    const now = new Date(Math.max(Date.parse(a.now), Date.parse(b.now)));
    const grouped = possessionByCard([...transitionsAsRows(a), ...transitionsAsRows(b)], now);
    const alone = computePossession(transitionsAsRows(b), now);
    expect(grouped.get(b.cardId)?.agencyMs).toBe(alone.agencyMs);
  });

  it('rolls up to an engagement total without claiming a current possession', () => {
    const a = possessionCase('open card currently with the client');
    const b = possessionCase('one transition, never moved again');
    const now = new Date(Math.max(Date.parse(a.now), Date.parse(b.now)));
    const splits = [...possessionByCard([...transitionsAsRows(a), ...transitionsAsRows(b)], now).values()];
    const total = sumPossession(splits);

    expect(total.agencyMs).toBe(splits.reduce((n, s) => n + s.agencyMs, 0));
    expect(total.clientMs).toBe(splits.reduce((n, s) => n + s.clientMs, 0));
    // An engagement is not "with the client"; individual cards are.
    expect(total.current).toBeNull();
    expect(total.currentMs).toBe(0);
  });

  it('sums an empty set to zero rather than throwing', () => {
    expect(sumPossession([])).toEqual({ agencyMs: 0, clientMs: 0, current: null, currentMs: 0 });
  });
});

describe.skip('the attention model', () => {
  /**
   * UNSKIP IN: Phase 5. Module: `src/domain/card/attention.ts`, not yet present.
   * PRD §5.5 — cards rank by actionability, not deadline proximity. Buckets:
   * blocked_on_you, blocked_on_your_team, with_the_client, no_movement_7d
   * (`AttentionBucket` in src/lib/types.ts).
   */
  it('buckets a card by who is holding it, not by how close its due date is', () => {
    expect.fail('Phase 5: src/domain/card/attention.ts — bucket from POSSESSION[state], not dueAt');
  });

  it('ranks blocked_on_you above with_the_client regardless of due date', () => {
    expect.fail('Phase 5: proximity is one input, never the sort key (PRD §5.5)');
  });

  it('moves a card to no_movement_7d from the last transition, not the last edit', () => {
    expect.fail('Phase 5: staleness is measured from state_transitions.occurred_at');
  });

  it('flags roundsBreached only when rounds used exceeds rounds contracted', () => {
    expect.fail(
      'Phase 5: the fixture card "Launch film" is 3 of 2 and must be flagged; "Key art" is 1 of 2 ' +
        'and must not. A null contractedRounds is never a breach.',
    );
  });
});
