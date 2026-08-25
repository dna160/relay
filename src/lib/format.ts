/**
 * Presentation-only formatters.
 *
 * Two rules from DESIGN-SYSTEM.md are encoded here rather than left to each
 * caller:
 *
 * 1. Monospace marks records. Everything this module returns that would be
 *    cited in a dispute — a version number, a hash prefix, a countdown, a
 *    duration, a timestamp — is meant to be set in `font-mono`.
 * 2. Nothing here decides colour. Hue encodes possession, and possession is a
 *    server-derived fact (INV-5), not something a formatter infers.
 *
 * Every function that needs the current time takes it as an argument with a
 * default, so a server render and the hydration that follows it agree, and so
 * the behaviour is testable without freezing the clock globally.
 *
 * There is no vocabulary here — no state names, no action names, no bucket
 * names. Those live beside the components that speak them
 * (`components/agency/vocabulary.ts`, `components/client/vocabulary.ts`),
 * because the two surfaces do not use the same words for the same row and
 * because a shared strings module is how "Send to internal review" ended up in
 * the client bundle the first time this was built.
 */

import type { Possession } from '@/lib/types';

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

/** Deterministic month names — `toLocaleDateString` differs server to client. */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `6d`, `4h`, `12m`, `< 1m`. One unit only: a possession bar is read in a
 * glance and `6d 4h 12m` is not read in a glance.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '< 1m';
  if (ms >= MS_DAY) return `${Math.floor(ms / MS_DAY)}d`;
  if (ms >= MS_HOUR) return `${Math.floor(ms / MS_HOUR)}h`;
  if (ms >= MS_MINUTE) return `${Math.floor(ms / MS_MINUTE)}m`;
  return '< 1m';
}

/** The possession bar's label: `client · 6d`. */
export function formatPossession(side: Possession, ms: number): string {
  return `${side} · ${formatDuration(ms)}`;
}

/** `12.4 MB`. Decimal units, because that is what the upload dialog said. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['kB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const label = units[unit] ?? 'TB';
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${label}`;
}

/** `3a91f2…` — enough to match by eye, short enough to sit in a row. */
export function shortHash(sha256: string, chars = 6): string {
  if (!sha256) return '—';
  return `${sha256.slice(0, chars)}…`;
}

/** `v4`. */
export function versionPip(versionNo: number): string {
  return `v${versionNo}`;
}

/** `3/2` — used against contracted rounds, `∞` when none were contracted. */
export function formatRounds(used: number, contracted: number | null): string {
  return `${used}/${contracted ?? '∞'}`;
}

/**
 * The only condition under which `--breach` may be used on a card. A round
 * count that merely equals the contract is not a breach; exceeding it is.
 */
export function roundsBreached(used: number, contracted: number | null): boolean {
  return contracted !== null && used > contracted;
}

/** `24 Aug` — year appended only when it is not the current one. */
export function formatDate(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const month = MONTHS[d.getUTCMonth()] ?? '';
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return sameYear
    ? `${d.getUTCDate()} ${month}`
    : `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/** `2026-08-24 14:02` — a decision timestamp, set in mono, cited in a dispute. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

export interface DueLabel {
  /** `24 Aug` */
  date: string;
  /** `in 3d`, `today`, `3d over`. Mono. */
  countdown: string;
  /** A due date in the past. Weight, never hue — see `roundsBreached` for red. */
  overdue: boolean;
}

/**
 * Deadline pressure is weight plus a mono countdown. It is deliberately not a
 * colour: when everything turns red on a Wednesday the signal is gone.
 */
export function formatDue(iso: string | null, now: number = Date.now()): DueLabel | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return null;
  const deltaDays = Math.round((due - now) / MS_DAY);
  const countdown =
    deltaDays === 0 ? 'today' : deltaDays > 0 ? `in ${deltaDays}d` : `${-deltaDays}d over`;
  return { date: formatDate(iso, now), countdown, overdue: deltaDays < 0 };
}

/** `PURGE IN 48d`. Null on a retaining plan — paid plans have no countdown. */
export function formatPurgeCountdown(daysToPurge: number | null): string | null {
  if (daysToPurge === null) return null;
  return `PURGE IN ${Math.max(0, daysToPurge)}d`;
}

/* ------------------------------------------------------------- retention */

/**
 * The escalation band a purge countdown is in.
 *
 * COMPONENTS.md §6 escalates the `WrapSlate` **by weight and surface area,
 * never by hue**, across exactly four bands, and FLOWS.md §3 attaches an
 * additional surface to each. Both documents describe the same four thresholds,
 * so they are computed once here rather than restated as two sets of magic
 * numbers on two surfaces that would drift apart the first time one is edited.
 *
 * `retained` is not a fifth step on the same ladder — it is the absence of the
 * ladder. A retaining plan has no countdown at all, and the strip says so with
 * a badge rather than disappearing.
 *
 * **No band is ever `--breach`.** A scheduled deletion the user was warned
 * about four times is the contract working, not a breached commitment, and
 * `--breach` is exhaustively `roundsUsed > contractedRounds` (see
 * `roundsBreached` above). Spending the red here would spend it everywhere.
 */
export type PurgeBand = 'retained' | 'distant' | 'near' | 'imminent' | 'today';

export function purgeBand(daysToPurge: number | null): PurgeBand {
  if (daysToPurge === null) return 'retained';
  if (daysToPurge <= 0) return 'today';
  if (daysToPurge <= 7) return 'imminent';
  if (daysToPurge <= 14) return 'near';
  return 'distant';
}

/**
 * True from 14 days out, which is where FLOWS.md §3 adds the board strip to the
 * slate. Before that the slate alone carries it; a strip that is always on
 * screen is a strip nobody reads on the day it matters.
 */
export function purgeWarningIsDue(daysToPurge: number | null): boolean {
  const band = purgeBand(daysToPurge);
  return band === 'near' || band === 'imminent' || band === 'today';
}

/**
 * The absolute date the countdown lands on — `12 May 2026`.
 *
 * FLOWS.md §3's first fact: "absolute, never 'in 14 days' alone. A relative
 * countdown alone is unactionable in a calendar." The year is always printed,
 * unlike `formatDate`, because a retention date is a diary entry and a bare
 * `12 May` in December is read as five months ago.
 *
 * Derived from `daysToPurge` because that is what the contract carries. If
 * `GET /api/engagements/:id` ever gains `purgeAt` this takes the row instead of
 * computing it, in one place.
 */
export function formatPurgeDate(daysToPurge: number | null, now: number = Date.now()): string | null {
  const iso = purgeDateISO(daysToPurge, now);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}`;
}

/** `2026-05-12`, for a `<time dateTime>`. Null on a retaining plan. */
export function purgeDateISO(daysToPurge: number | null, now: number = Date.now()): string | null {
  if (daysToPurge === null) return null;
  const d = new Date(now + Math.max(0, daysToPurge) * MS_DAY);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The volume that goes with the date. FLOWS.md §3's second fact: "Volume is
 * what converts an abstract deletion into a felt one."
 */
export interface RetentionCounts {
  files: number;
  cards: number;
  approvals: number;
}

/** `41 files, 12 cards and 3 approvals` — a sentence, for prose. */
export function formatRetentionCounts(c: RetentionCounts): string {
  return `${plural(c.files, 'file', 'files')}, ${plural(c.cards, 'card', 'cards')} and ${plural(
    c.approvals,
    'approval',
    'approvals',
  )}`;
}

/**
 * `12 May 2026 14:02 UTC` — the destruction timestamp on a purge certificate.
 *
 * Spelled out and zoned, unlike `formatTimestamp`'s `2026-05-12 14:02`, because
 * this one is read off a page and quoted into an email to a legal team. `UTC` is
 * printed rather than implied: a bare wall-clock time on a compliance artifact
 * is ambiguous by exactly the number of hours nobody will think to ask about.
 */
export function formatCertificateStamp(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UTC`;
}

/** `41 files · 12 cards · 3 approvals` — a record, for mono. */
export function formatRetentionCountsRecord(c: RetentionCounts): string {
  return `${plural(c.files, 'file', 'files')} · ${plural(c.cards, 'card', 'cards')} · ${plural(
    c.approvals,
    'approval',
    'approvals',
  )}`;
}

/**
 * The same record line, built only from the counts a purge certificate actually
 * carried — `null` when it carried none.
 *
 * Separate from `formatRetentionCountsRecord` rather than a widened version of
 * it, because the two have opposite obligations. A *warning* states all three
 * facts or it is a bug; a *certificate* states exactly what was signed and not
 * one number more. `purge_certificates` currently stores an object count and a
 * byte total and no card or approval count, and filling those in from anywhere
 * else would be a fabricated line on a compliance artifact.
 */
export function formatDestroyedCounts(c: Partial<RetentionCounts>): string | null {
  const parts: string[] = [];
  if (c.files !== undefined) parts.push(plural(c.files, 'file', 'files'));
  if (c.cards !== undefined) parts.push(plural(c.cards, 'card', 'cards'));
  if (c.approvals !== undefined) parts.push(plural(c.approvals, 'approval', 'approvals'));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** `WRAP +12d`. Days since the engagement was wrapped. */
export function formatWrapAge(wrappedAt: string | null, now: number = Date.now()): string | null {
  if (!wrappedAt) return null;
  const t = new Date(wrappedAt).getTime();
  if (Number.isNaN(t)) return null;
  return `WRAP +${Math.max(0, Math.floor((now - t) / MS_DAY))}d`;
}

/**
 * The two lifecycle records with their own labels removed.
 *
 * `formatPurgeCountdown` and `formatWrapAge` each carry their term inside the
 * string — `PURGE IN 48d`, `WRAP +12d` — which is right for a bare run of mono
 * on a strip and wrong inside a `Plate`, where the `<dt>` already prints the
 * term and the reader gets `PURGE  PURGE IN 48d`.
 *
 * These are a projection of those two functions and never a second computation
 * of them: same input, same arithmetic, one label stripped. Deriving rather
 * than recomputing is the point — two places that both work out how many days
 * are left is two places that can disagree about it, and this number ends up in
 * a retention notice.
 */
export function purgeCountdownValue(daysToPurge: number | null): string | null {
  const full = formatPurgeCountdown(daysToPurge);
  return full === null ? null : full.replace(/^PURGE /, '');
}

export function wrapAgeValue(wrappedAt: string | null, now: number = Date.now()): string | null {
  const full = formatWrapAge(wrappedAt, now);
  return full === null ? null : full.replace(/^WRAP /, '');
}

/** Plural without the "(s)" apology. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
