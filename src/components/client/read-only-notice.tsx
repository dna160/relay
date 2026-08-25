/**
 * The archived workspace, stated once, in the client's words.
 *
 * Every write route returns 423 `ENGAGEMENT_ARCHIVED` on an archived engagement
 * — including the two a contact can reach, `POST /api/client/comments` and
 * `POST /api/client/versions/:id/decision` (amendment A9). The surface predicts
 * that from the header's `status` so that nobody types a note into a box that
 * cannot post it, and this is where the prediction is explained rather than
 * merely enacted.
 *
 * **Nothing here names a plan, a limit, or an upgrade.** Why the workspace froze
 * is the agency's account business; what it means for this contact is that they
 * can still read everything and still take a copy. Those are the only two facts
 * they can act on, so they are the only two stated.
 */

import { hrefs } from '@/lib/api-client.client';
import { formatPurgeDate, purgeDateISO } from '@/lib/format';
import { buttonClass, cn, mono, muted } from '@/components/style-tokens';

export function ReadOnlyNotice({
  daysToPurge,
  agencyName,
  nowMs,
}: {
  daysToPurge: number | null;
  agencyName: string;
  nowMs: number;
}) {
  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);

  return (
    <section
      aria-label="This workspace is read-only"
      className="rounded-md border-hairline border-rule-strong bg-paper-2 p-3"
    >
      <h2 className="text-14 font-semibold text-ink">This workspace is read-only.</h2>
      <p className={cn('mt-1 max-w-prose text-14', muted)}>
        It has been quiet for a while, so approvals, change requests and comments are closed. Every
        file and every decision is still here to read
        {purgeOn ? (
          <>
            {' '}
            until{' '}
            <time dateTime={purgeOnISO ?? undefined} className={cn(mono, 'text-ink')}>
              {purgeOn}
            </time>
          </>
        ) : null}
        , and the export still works. If you need something changed, contact {agencyName}.
      </p>
      <div className="mt-3">
        <a className={buttonClass('client', 'lg')} href={hrefs.clientExport()}>
          Export everything
        </a>
      </div>
    </section>
  );
}
