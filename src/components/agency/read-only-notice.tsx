/**
 * The archived engagement, stated once at the top of a surface.
 *
 * An archived engagement refuses every mutation with 423 `ENGAGEMENT_ARCHIVED`.
 * The surface predicts that from the header's `status` rather than discovering
 * it on submit — but predicting it is only half the job. Every individual
 * control that goes away has to say *why*, and something on the page has to say
 * it once, in full, with the two things that are still true: everything is here
 * to read, and the export still works.
 *
 * Not `role="alert"`. Archived is a resting state, not an incident, and the
 * reader is about to spend a while in it.
 */

import { formatPurgeDate, purgeDateISO } from '@/lib/format';
import { cn, mono, muted } from '@/components/style-tokens';
import { ExportControl } from './export-control';

export function ReadOnlyNotice({
  engagementId,
  daysToPurge,
  nowMs,
}: {
  engagementId: string;
  daysToPurge: number | null;
  nowMs: number;
}) {
  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);

  return (
    <section
      aria-label="This engagement is read-only"
      className="rounded-md border-hairline border-rule-strong bg-paper-2 p-3"
    >
      <h2 className="text-14 font-semibold text-ink">This engagement is read-only.</h2>
      <p className={cn('mt-1 max-w-prose text-14', muted)}>
        It was archived after thirty days without activity, so nothing new can be added, moved or
        decided. Every lane, card, version and note is still here to read
        {purgeOn ? (
          <>
            {' '}
            until{' '}
            <time dateTime={purgeOnISO ?? undefined} className={cn(mono, 'text-ink')}>
              {purgeOn}
            </time>
          </>
        ) : null}
        , and the export still works.
      </p>
      <div className="mt-3">
        <ExportControl engagementId={engagementId} tone="quiet" size="md" label="Export everything" />
      </div>
    </section>
  );
}
