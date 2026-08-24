/**
 * Typed loader for `tests/fixtures/possession.json` — the fixture INV-5 and
 * PHASE-5 EXIT both name by path.
 *
 * The JSON holds the data and the hand-computed expected totals. This file
 * gives them a type and checks, at load time, that the file still says what the
 * types claim. It deliberately contains **no implementation of
 * `computePossession()`**: a fixture that ships its own reference implementation
 * tests the reference implementation.
 */

import type { CardState, Possession } from '@/domain/card/state-machine';
import raw from './possession.json';

export interface TransitionFixtureRow {
  from: CardState;
  to: CardState;
  /** Null only for `signed_off` — the clock stops and accrues to neither side. */
  possession: Possession | null;
  occurredAt: string;
}

export interface PossessionExpectation {
  agencyMs: number;
  clientMs: number;
  current: Possession | null;
  currentMs: number;
}

export interface PossessionCase {
  name: string;
  cardId: string;
  /** The instant the totals are evaluated at. Never `Date.now()`. */
  now: string;
  transitions: TransitionFixtureRow[];
  expected: PossessionExpectation;
  expectedHuman: string;
  roundsUsed: number;
}

interface PossessionFixture {
  toleranceMs: number;
  cases: PossessionCase[];
}

const fixture = raw as unknown as PossessionFixture;

/** Fails loudly at import time rather than producing a green test on a typo. */
function assertWellFormed(f: PossessionFixture): void {
  if (!Array.isArray(f.cases) || f.cases.length === 0) {
    throw new Error('possession.json: no cases');
  }
  if (f.toleranceMs !== 1000) {
    throw new Error(
      `possession.json: tolerance is ${f.toleranceMs}ms; PHASE-5 EXIT says 1s. ` +
        'Loosening the tolerance is how a broken clock passes.',
    );
  }
  for (const c of f.cases) {
    if (Number.isNaN(Date.parse(c.now))) throw new Error(`possession.json: bad now in "${c.name}"`);
    for (const t of c.transitions) {
      if (Number.isNaN(Date.parse(t.occurredAt))) {
        throw new Error(`possession.json: bad occurredAt in "${c.name}"`);
      }
      if (t.possession !== 'agency' && t.possession !== 'client' && t.possession !== null) {
        throw new Error(`possession.json: bad possession in "${c.name}"`);
      }
      if (t.possession === null && t.to !== 'signed_off') {
        throw new Error(
          `possession.json: "${c.name}" stops the clock on ${t.to}; only signed_off may do that`,
        );
      }
    }
    const e = c.expected;
    if (e.agencyMs < 0 || e.clientMs < 0 || e.currentMs < 0) {
      throw new Error(`possession.json: negative duration in "${c.name}"`);
    }
    if (e.current === null && e.currentMs !== 0) {
      throw new Error(`possession.json: "${c.name}" has no current possession but a non-zero currentMs`);
    }
  }
}

assertWellFormed(fixture);

export const possessionCases: readonly PossessionCase[] = fixture.cases;
export const POSSESSION_TOLERANCE_MS = fixture.toleranceMs;

export function possessionCase(name: string): PossessionCase {
  const found = possessionCases.find((c) => c.name === name);
  if (!found) throw new Error(`fixture: no possession case "${name}"`);
  return found;
}

/**
 * Rows as the database returns them: real `Date`s, in insertion order.
 *
 * Carries both `to` (the column name in DATA-MODEL.md) and `toState` (the field
 * name `domain/card/possession.ts` reads) so the fixture is structurally
 * assignable to `TransitionRow` without this file importing the domain module.
 * Fixtures depending on the code under test is how a fixture starts agreeing
 * with a bug.
 */
export function transitionsAsRows(c: PossessionCase): Array<{
  cardId: string;
  from: CardState;
  to: CardState;
  toState: CardState;
  possession: Possession | null;
  occurredAt: Date;
}> {
  return c.transitions.map((t) => ({
    cardId: c.cardId,
    from: t.from,
    to: t.to,
    toState: t.to,
    possession: t.possession,
    occurredAt: new Date(t.occurredAt),
  }));
}
