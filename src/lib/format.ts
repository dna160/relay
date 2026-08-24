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

/** `WRAP +12d`. Days since the engagement was wrapped. */
export function formatWrapAge(wrappedAt: string | null, now: number = Date.now()): string | null {
  if (!wrappedAt) return null;
  const t = new Date(wrappedAt).getTime();
  if (Number.isNaN(t)) return null;
  return `WRAP +${Math.max(0, Math.floor((now - t) / MS_DAY))}d`;
}

/** Plural without the "(s)" apology. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
