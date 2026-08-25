/**
 * The agency's in-product purge warning — the board strip that FLOWS.md §3 adds
 * above the lanes from fourteen days out.
 *
 * It is the in-app twin of the four emails the retention worker sends, at
 * archive and then +14d, +23d and +29d, and it states the same three facts they
 * do. **A warning missing any of the three is a bug:**
 *
 * 1. **The date**, absolute — `12 May 2026`. A relative countdown alone is
 *    unactionable in a calendar.
 * 2. **The count** — `41 files, 12 cards and 3 approvals`. Volume is what turns
 *    an abstract deletion into a felt one.
 * 3. **The one action that prevents it** — exactly one, named, and *different
 *    per side*. The agency's is **Keep this workspace**, a plan change. Export
 *    sits beside it as a secondary, because exporting is not retaining and the
 *    agency must never be allowed to believe it is.
 *
 * The client's twin offers **Export everything** and never mentions a plan. The
 * two are never swapped: a client cannot upgrade someone else's plan, and
 * telling them to would be absurd.
 *
 * Escalation is by weight and surface area — a heavier border and the count
 * broken onto its own mono line inside seven days. Never by hue. `--breach` does
 * not appear in a purge warning, because nothing has been breached: the
 * countdown is doing exactly what it said it would.
 */

import Link from 'next/link';
import {
  formatPurgeDate,
  formatRetentionCounts,
  formatRetentionCountsRecord,
  purgeBand,
  purgeDateISO,
  plural,
  type RetentionCounts,
} from '@/lib/format';
import { buttonClass, cn, mono, muted } from '@/components/style-tokens';
import { ExportControl } from './export-control';

const MS_DAY = 24 * 60 * 60 * 1000;

export function PurgeWarning({
  engagementId,
  engagementTitle,
  daysToPurge,
  lastActivityAt,
  counts,
  nowMs,
}: {
  engagementId: string;
  engagementTitle: string;
  daysToPurge: number | null;
  lastActivityAt: string;
  counts: RetentionCounts;
  nowMs: number;
}) {
  const band = purgeBand(daysToPurge);

  // Before fourteen days out the slate alone carries it. A strip that is always
  // on screen is a strip nobody reads on the day it matters.
  if (band === 'retained' || band === 'distant') return null;

  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);
  const quietFor = Math.max(0, Math.floor((nowMs - new Date(lastActivityAt).getTime()) / MS_DAY));
  const heavy = band === 'imminent' || band === 'today';

  return (
    <section
      // Not `alert`: an alert interrupts, and this is a scheduled fact stated
      // calmly and repeatedly. `--breach` and `role="alert"` are both reserved,
      // and this surface has earned neither.
      aria-labelledby={`purge-warning-${engagementId}`}
      className={cn(
        'rounded-md bg-paper-2 p-3 border-hairline',
        heavy ? 'border-ink' : 'border-rule-strong',
      )}
    >
      <h2 id={`purge-warning-${engagementId}`} className="text-14 font-semibold text-ink">
        {band === 'today' ? (
          <>
            Everything in this workspace is deleted today
            {purgeOn ? (
              <>
                ,{' '}
                <time dateTime={purgeOnISO ?? undefined} className={mono}>
                  {purgeOn}
                </time>
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            This workspace is deleted on{' '}
            <time dateTime={purgeOnISO ?? undefined} className={mono}>
              {purgeOn}
            </time>
            .
          </>
        )}
      </h2>

      {/* Inside seven days the count comes out of the sentence and onto its own
          line as a record. Same facts, more surface area. */}
      {heavy ? (
        <p className={cn(mono, 'mt-1 text-12 text-ink')}>
          {formatRetentionCountsRecord(counts)}
        </p>
      ) : null}

      <p className={cn('mt-1 max-w-prose text-14', muted)}>
        {heavy ? (
          <>Everything above goes with it.</>
        ) : (
          <>{formatRetentionCounts(counts)} go with it.</>
        )}{' '}
        {engagementTitle} has had no activity for {plural(quietFor, 'day', 'days')}.
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        {/*
          The one action, and it is a plan change rather than an export. Exporting
          takes a copy; only a retaining plan stops the destruction. Conflating
          the two here is the single most expensive copy mistake this strip could
          make.
        */}
        <Link
          href={`/w/${engagementId}/settings#settings-retention`}
          className={buttonClass('agency', 'md')}
        >
          Keep this workspace
        </Link>
        <ExportControl engagementId={engagementId} tone="ghost" size="md" label="Export everything" />
      </div>
    </section>
  );
}
