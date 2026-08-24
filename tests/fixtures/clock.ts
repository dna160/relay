/**
 * A frozen clock. Every fixture in this directory is expressed relative to it.
 *
 * Fixtures that encode a duration are worthless if the duration depends on when
 * the suite runs. Nothing here calls `Date.now()`; nothing here uses a local
 * timezone. All instants are UTC and all offsets are exact integers of
 * milliseconds, so an expected total can be written down and checked by hand.
 */

/** 2026-01-01T00:00:00.000Z. The origin of every fixture timeline. */
export const T0 = new Date('2026-01-01T00:00:00.000Z');

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** An instant `ms` after {@link T0}. */
export function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

export function hours(n: number): number {
  return n * HOUR;
}

export function days(n: number): number {
  return n * DAY;
}

/** ISO-8601 with milliseconds, the shape every serialiser in this codebase emits. */
export function iso(ms: number): string {
  return at(ms).toISOString();
}

// The possession tolerance lives in possession.json and is re-exported by
// possession.ts. It is stated once, next to the numbers it applies to.
