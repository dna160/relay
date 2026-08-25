/**
 * The client's in-product purge warning — the board strip FLOWS.md §3 adds above
 * the lanes from fourteen days out.
 *
 * The in-app twin of the same four notices the agency gets, on the same schedule
 * (archive, +14d, +23d, +29d), carrying the same three facts. The client is
 * warned because the alternative is a silent deletion of deliverables their
 * agency is contractually obliged to retain — which manufactures a breach out of
 * a scheduled event both parties were told about four times.
 *
 * **The one action here is Export everything, and it is never an upgrade.** A
 * client cannot upgrade someone else's plan, and showing them a pricing prompt
 * for their agency's account would be absurd on its face and would leak how that
 * account is configured. Nothing on this surface names a plan, a limit, or a
 * price. The agency's twin offers "Keep this workspace"; the two are never
 * swapped.
 *
 * The export is a plain anchor: no JavaScript, no queue, no waiting. The
 * client's export is never paywalled (PRD §5.6) and it is reachable from here
 * and from the wrap slate, so a contact who lands on any screen of this
 * workspace in its last fortnight is one tap from a copy of everything they can
 * see.
 *
 * Escalation is by weight and surface area. It never turns red: nothing has been
 * breached, and the product is calm about this because it told the truth about
 * it from screen one.
 */

import {
  formatPurgeDate,
  formatRetentionCounts,
  formatRetentionCountsRecord,
  purgeBand,
  purgeDateISO,
  type RetentionCounts,
} from '@/lib/format';
import { hrefs } from '@/lib/api-client.client';
import { buttonClass, cn, mono, muted } from '@/components/style-tokens';

export function PurgeWarning({
  daysToPurge,
  counts,
  agencyName,
  nowMs,
}: {
  daysToPurge: number | null;
  counts: RetentionCounts;
  agencyName: string;
  nowMs: number;
}) {
  const band = purgeBand(daysToPurge);
  if (band === 'retained' || band === 'distant') return null;

  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);
  const heavy = band === 'imminent' || band === 'today';

  return (
    <section
      aria-labelledby="client-purge-warning"
      className={cn(
        'rounded-md bg-paper-2 p-3 border-hairline',
        heavy ? 'border-ink' : 'border-rule-strong',
      )}
    >
      <h2 id="client-purge-warning" className="text-14 font-semibold text-ink">
        {band === 'today' ? (
          <>
            Everything here is deleted today
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

      {heavy ? (
        <p className={cn(mono, 'mt-1 text-12 text-ink')}>{formatRetentionCountsRecord(counts)}</p>
      ) : null}

      <p className={cn('mt-1 max-w-prose text-14', muted)}>
        {heavy ? (
          <>
            Everything above goes with it, including everything you approved. Exporting takes one tap
            and gives you a zip of every file and decision you can see.
          </>
        ) : (
          <>{formatRetentionCounts(counts)} go with it, including everything you approved.</>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <a className={buttonClass('client', 'lg')} href={hrefs.clientExport()}>
          Export everything
        </a>

        {/*
          A disclosure rather than a link: the answer is four sentences long and
          navigating away from a warning to read about the warning is how a
          person loses the button. `<details>` needs no JavaScript, which matters
          on a board that ships almost none.
        */}
        <details className="min-w-0">
          <summary className={cn('cursor-pointer text-14 underline underline-offset-2', muted)}>
            What happens to my files?
          </summary>
          <div className={cn('mt-2 flex max-w-prose flex-col gap-2 text-14', muted)}>
            <p>
              On {purgeOn ?? 'the date above'}, every file, comment and approval in this workspace is
              permanently destroyed — not hidden, not archived somewhere else. The link you used to
              get here stops working.
            </p>
            <p>
              Exporting gives you a zip of everything you can see: every file that was published to
              you, every note, and the record of every decision you made, with the file hashes those
              decisions were recorded against.
            </p>
            <p>
              You and {agencyName} both receive a signed certificate confirming what was destroyed
              and when. If you need this workspace to stay open, ask {agencyName} — they can keep it.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
