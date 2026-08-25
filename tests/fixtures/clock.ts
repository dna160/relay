/**
 * Two clocks, and the difference between them is the whole point of this file.
 *
 * Fixtures that encode a duration are worthless if the duration depends on when
 * the suite runs. Every instant here is therefore an exact integer offset from
 * an origin, in UTC, so an expected total can be written down and checked by
 * hand. What differs between the two clocks is *which* origin, and that choice
 * is decided by one question:
 *
 *   **Will this instant ever be compared against a live `now()`?**
 *
 * ## No — the frozen clock, {@link T0}
 *
 * A pure unit test supplies its own `now`. Nothing about it moves when the
 * calendar does, so an absolute origin is not merely safe, it is better: a
 * failure message reads `2026-01-11T00:00:00.000Z` and the reader can subtract
 * in their head. `possession.json`, the retention arithmetic, the state-machine
 * replays — all frozen at `T0`.
 *
 * ## Yes — the live clock, {@link LIVE_ORIGIN}
 *
 * The moment a fixture row is inserted into a real database and read back by
 * code that calls `new Date()`, an absolute origin becomes a time bomb with a
 * visible fuse. `tests/fixtures/engagements.ts` seeds four `status = 'active'`
 * rows of which exactly three are inside the 30-day activity window (INV-8,
 * PRD §5.6). Anchored at `T0` that fixture was correct through January and
 * wrong from February onwards: by the time a Postgres was available to run it
 * against, every row was months stale, `countActiveEngagements()` correctly
 * returned 0, the plan gate correctly allowed a fourth engagement, and the e2e
 * test asserting 402 correctly failed. The gate was never broken. The fixture
 * had expired.
 *
 * So anything a live `now()` will be compared against — `last_activity_at`,
 * `archive_at`, `purge_at`, `started_at`, `wrapped_at` — is expressed as a
 * fixed offset from {@link LIVE_ORIGIN}, which is itself pinned relative to the
 * instant this module was loaded. The offsets are still hard-coded integers, so
 * the *relationships* between rows ("39 days idle", "purge falls five days from
 * now") are exactly as deterministic as they were before. What is no longer
 * hard-coded is the calendar date those relationships hang off, because that is
 * the one part of a fixture that cannot be written down in advance without
 * expiring.
 *
 * ## What this costs
 *
 * Two runs of the seed no longer produce byte-identical timestamp columns. That
 * property was worth something — a diff on a snapshot meant something — and it
 * is being traded deliberately, because it is not compatible with "correct when
 * a live clock reads it" and that is the stronger requirement. Ids, ordering,
 * row counts, states and every *interval* remain byte-identical, and those are
 * what assertions are written against.
 *
 * `tests/unit/fixtures.spec.ts` holds the guard that keeps this true: it
 * asserts the live timeline still tracks the wall clock, which is the assertion
 * that would have caught the original bug in February rather than in August.
 */

/** 2026-01-01T00:00:00.000Z. The origin of every *frozen* fixture timeline. */
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

/* ---------------------------------------------------------- the live clock */

/**
 * The instant this module was loaded — the closest thing a fixture has to
 * "seed time".
 *
 * Captured **once**, at import, and never re-read. Every live instant below is
 * derived from this single value, so a suite that runs for ten minutes sees one
 * consistent timeline rather than a set of rows that drift apart from each
 * other while it inserts them.
 */
export const SEED_NOW = new Date();

/**
 * How far into the live timeline "now" sits.
 *
 * The engagement fixture describes a hundred days of history ending roughly at
 * the present: the oldest row is created on day 0 and the newest activity lands
 * on day 99. Placing the origin a hundred days back is what makes day 100 —
 * `EVAL_NOW` in `engagements.ts` — the current instant.
 */
export const LIVE_SPAN_DAYS = 100;

/**
 * The origin of the live fixture timeline: {@link LIVE_SPAN_DAYS} before
 * {@link SEED_NOW}.
 *
 * Never an absolute calendar date. That is the entire fix.
 */
export const LIVE_ORIGIN = new Date(SEED_NOW.getTime() - LIVE_SPAN_DAYS * DAY);

/** An instant `ms` after {@link LIVE_ORIGIN}. */
export function liveAt(ms: number): Date {
  return new Date(LIVE_ORIGIN.getTime() + ms);
}

/** ISO-8601 `ms` after {@link LIVE_ORIGIN}. The live twin of {@link iso}. */
export function liveIso(ms: number): string {
  return liveAt(ms).toISOString();
}

// The possession tolerance lives in possession.json and is re-exported by
// possession.ts. It is stated once, next to the numbers it applies to.
