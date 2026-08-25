/**
 * The fixture set must not expire.
 *
 * This suite exists because of a specific failure. The engagement fixtures were
 * originally anchored to a frozen calendar date for determinism. That is right
 * for a pure unit fixture and wrong the moment one meets a live `now()`: months
 * later every seeded engagement had fallen outside the 30-day activity window,
 * `countActiveEngagements` correctly returned 0, the plan gate correctly
 * allowed a fourth engagement, and the e2e suite reported
 * `creating past the limit returns 402` as a failure.
 *
 * Nothing had changed in the code. The bug was silent, time-delayed, and — the
 * expensive part — it presented as a product defect in billing rather than as a
 * stale fixture. Someone reading only that failure would have gone looking for
 * a bug in the plan gate, which is correct, and might well have "fixed" it.
 *
 * So the guard is not "the numbers are right today". It is that the fixtures
 * are *structurally incapable* of expiring.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countActiveEngagements } from '@/domain/engagement/count-active';
import {
  ACTIVE_WINDOW_DAYS,
  EVAL_NOW,
  EXPECTED_ACTIVE_AT_EVAL_NOW,
  RETENTION,
  engagements,
} from '../fixtures/engagements';
import { LIVE_ORIGIN, LIVE_SPAN_DAYS, SEED_NOW, days } from '../fixtures/clock';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));


describe('the fixture timeline is anchored to now, not to a calendar', () => {
  it('places EVAL_NOW at the present, so the window has not slid past it', () => {
    const drift = Math.abs(EVAL_NOW.getTime() - SEED_NOW.getTime());
    expect(drift, 'EVAL_NOW must be the current instant, not a fixed date').toBeLessThan(days(1));
  });

  it('derives the origin from seed time rather than from a literal', () => {
    expect(SEED_NOW.getTime() - LIVE_ORIGIN.getTime()).toBe(days(LIVE_SPAN_DAYS));
  });

  it('keeps the frozen anchor out of the live timeline', () => {
    // `T0` is legitimate and deliberately kept: pure unit fixtures that never
    // meet a live clock want a fixed date, because a failure message reading
    // `2026-01-11` is one a human can subtract in their head. The rule is not
    // "no frozen dates" — it is that nothing which will be compared against a
    // live `now()` may derive from one.
    const clock = readFileSync(join(FIXTURE_DIR, 'clock.ts'), 'utf8');
    const liveDefs = clock
      .split('\n')
      .filter((l) => /LIVE_ORIGIN|SEED_NOW|export function live/.test(l))
      .filter((l) => !/^\s*(\/\/|\*)/.test(l));

    expect(liveDefs.some((l) => /SEED_NOW = new Date\(\)/.test(l)), 'SEED_NOW must be the live clock').toBe(true);
    for (const line of liveDefs) {
      expect(line, 'a live anchor derived from the frozen T0 expires exactly as before').not.toMatch(/\bT0\b/);
    }
  });

  it('dates every engagement off the live helpers, never the frozen ones', () => {
    const text = readFileSync(join(FIXTURE_DIR, 'engagements.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders: string[] = [];
    for (const line of text.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      // Retention and activity columns are the ones a live clock reads.
      if (!/(lastActivityAt|archiveAt|purgeAt|startedAt|wrappedAt|createdAt)\s*:/.test(line)) continue;
      if (/\b(at|iso)\(/.test(line) && !/\blive(At|Iso)\(/.test(line)) offenders.push(line.trim());
      if (/new Date\(\s*['"`]\d{4}-/.test(line)) offenders.push(line.trim());
    }
    expect(offenders, 'these columns meet a live now(); date them with liveAt/liveIso').toEqual([]);
  });
});

describe('the fixture answers hold at any point in the future', () => {
  /**
   * The real proof. Because every row is relative to seed time, shifting the
   * whole timeline forward by years must not change a single answer. Run the
   * same assertions the suite relies on, evaluated far past any plausible
   * calendar date, against rows shifted by the same amount.
   */
  const HORIZONS = [days(0), days(400), days(365 * 5), days(365 * 25)];

  for (const shift of HORIZONS) {
    const label = shift === 0 ? 'today' : `${Math.round(shift / days(365))} years from now`;
    const now = new Date(EVAL_NOW.getTime() + shift);
    // Fixture rows carry ISO strings; the counter takes Dates.
    const shifted = engagements.map((e) => ({
      status: e.status,
      orgId: e.orgId,
      lastActivityAt: new Date(new Date(e.lastActivityAt).getTime() + shift),
    }));

    it(`counts the same active engagements per org — ${label}`, () => {
      for (const [orgId, expected] of Object.entries(EXPECTED_ACTIVE_AT_EVAL_NOW)) {
        const rows = shifted.filter((e) => e.orgId === orgId);
        expect(countActiveEngagements(rows, now), `org ${orgId} at ${label}`).toBe(expected);
      }
    });
  }

  it('keeps at least one org exactly at its plan limit, or the gate is never exercised', () => {
    // The fixture's whole point: a free org holding four `status = 'active'`
    // rows of which only three are active. A counter reading status alone
    // passes a naive fixture and fails this one — but only while the count
    // actually reaches the limit.
    const counts = Object.values(EXPECTED_ACTIVE_AT_EVAL_NOW);
    expect(Math.max(...counts), 'no org reaches a plan limit; the 402 path is untested').toBe(3);
  });

  it('states the retention timeline the fixtures were built against', () => {
    // If DATA-MODEL's timeline changes, these fixtures encode the old one.
    expect(RETENTION.archiveDays).toBe(ACTIVE_WINDOW_DAYS);
    expect(RETENTION.purgeDays).toBe(60);
    expect(RETENTION.warningOffsetDays).toEqual([0, 14, 23, 29]);
  });
});
