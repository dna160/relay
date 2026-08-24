/**
 * INV-5 — Every state transition writes a `state_transitions` row carrying
 * possession. The possession clock is derived from this table and nowhere else.
 *
 * Totals denormalise badly and cannot be recomputed after a bug (ADR-010).
 *
 * UNSKIPPED IN: Phase 2 (`transition-card.ts`, the transitions table) and
 * Phase 5 (`possession.ts`, the derived clock). Both landed.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { POSSESSION } from '@/domain/card/state-machine';
import { computePossession } from '@/domain/card/possession';
import { except, linesMatching, sourceFiles } from './_source';
import { allMigrationSql, createTableBody, hasMigrations } from './_sql';
import { POSSESSION_TOLERANCE_MS, possessionCases, transitionsAsRows } from '@tests/fixtures';

/** The one file permitted to persist a transition. Mirrors INV-2's persister. */
const SOLE_PERSISTER = 'src/domain/card/transition-card.ts';

/** Any column name that would be a stored running total. */
const DENORMALISED = /possession_ms|agency_ms|client_ms|possessionMs|agencyMs|clientMs|total_possession|possession_total/;

describe('INV-5 possession is derived from state_transitions alone', () => {
  it('every persisted transition appends exactly one state_transitions row', () => {
    const persister = sourceFiles().find((f) => f.path === SOLE_PERSISTER);
    expect(persister, `${SOLE_PERSISTER} is missing`).toBeDefined();
    if (!persister) return;

    // One insert, in the same function that writes cards.state, in one
    // transaction. If (2) could fail after (1) the clock loses a leg forever.
    const inserts = linesMatching(persister, /insert\s*\(\s*stateTransitions\s*\)/);
    expect(inserts, 'the sole persister must append a transition row').toHaveLength(1);
    expect(persister.text).toMatch(/possession\s*:\s*result\.possession/);
    expect(persister.text, 'the transition row and the state write share one transaction').toMatch(
      /\.update\s*\(\s*cards\s*\)[\s\S]*insert\s*\(\s*stateTransitions\s*\)/,
    );
  });

  it('nothing outside the sole persister writes a state_transitions row', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles(), SOLE_PERSISTER)) {
      for (const line of linesMatching(file, /insert\s*\(\s*stateTransitions\s*\)|INSERT\s+INTO\s+state_transitions/i)) {
        offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'a transition row written outside the persister').toEqual([]);
  });

  it('the transitions table carries possession and the instant it happened', () => {
    const body = createTableBody('state_transitions');
    if (body === null) return; // Phase 2 creates it.
    expect(body).toMatch(/"possession"/);
    expect(body).toMatch(/"occurred_at"/);
    expect(body).toMatch(/"card_id"\s+uuid\s+NOT NULL/i);
  });

  it('no table stores a running possession total', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('db/schema')) {
      for (const line of linesMatching(file, DENORMALISED)) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'a denormalised possession column in the schema').toEqual([]);

    if (hasMigrations()) {
      const sql = allMigrationSql();
      const columns = sql.match(DENORMALISED) ?? [];
      expect(columns, 'a denormalised possession column in a migration').toEqual([]);
    }
  });

  it('possession totals recompute from the transition fixture within 1s tolerance', () => {
    for (const c of possessionCases) {
      const actual = computePossession(transitionsAsRows(c), new Date(c.now));
      expect(Math.abs(actual.agencyMs - c.expected.agencyMs), c.name).toBeLessThanOrEqual(
        POSSESSION_TOLERANCE_MS,
      );
      expect(Math.abs(actual.clientMs - c.expected.clientMs), c.name).toBeLessThanOrEqual(
        POSSESSION_TOLERANCE_MS,
      );
    }
  });

  it('a card in signed_off accrues to neither party', () => {
    expect(POSSESSION.signed_off).toBeNull();

    const signedOff = possessionCases.find((c) => c.expected.current === null && c.transitions.length > 0);
    expect(signedOff, 'no signed-off case in the fixture').toBeDefined();
    if (!signedOff) return;

    const atDecision = computePossession(transitionsAsRows(signedOff), new Date(signedOff.now));
    const aYearLater = computePossession(
      transitionsAsRows(signedOff),
      new Date(Date.parse(signedOff.now) + 365 * 24 * 3_600_000),
    );
    expect(aYearLater.agencyMs).toBe(atDecision.agencyMs);
    expect(aYearLater.clientMs).toBe(atDecision.clientMs);
    expect(aYearLater.current).toBeNull();
  });

  it('the clock takes `now` as an argument rather than reading it', () => {
    // A clock that calls Date.now() cannot be recomputed over historical rows,
    // which is half of why ADR-010 refuses to store the total in the first place.
    const clock = sourceFiles('domain/card').filter((f) => /possession\.ts$/.test(f.path));
    expect(clock.length, 'src/domain/card/possession.ts is missing').toBe(1);
    for (const file of clock) {
      expect(linesMatching(file, /Date\.now\s*\(/), file.path).toEqual([]);
      expect(linesMatching(file, /new\s+Date\s*\(\s*\)/), file.path).toEqual([]);
    }
  });
});
