/**
 * The client's wrap slate.
 *
 * Both sides are warned (PRD §5.6). The client receives every notice the agency
 * receives, plus a one-click export of everything they can see — and the export
 * is never paywalled, because a silent purge of a client's deliverables
 * manufactures a contract breach for the agency.
 *
 * A server component: the countdown comes from the server, the export is an
 * anchor, and there is nothing here to hydrate. Non-dismissible, like its
 * agency twin — ephemerality is stated, never sprung.
 */

import { hrefs } from '@/lib/api-client';
import { formatPurgeCountdown, formatWrapAge } from '@/lib/format';
import { cn, mono } from '@/components/style-tokens';

const strip =
  'flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-rule bg-paper-2 px-3 py-1.5';

const item = 'text-12 uppercase tracking-lane';

export function WrapSlate({
  daysToPurge,
  wrappedAt = null,
  archived = false,
}: {
  /** Null on a retaining plan. */
  daysToPurge: number | null;
  /** Not yet carried by the client header — see the handover. */
  wrappedAt?: string | null;
  archived?: boolean;
}) {
  const wrapAge = formatWrapAge(wrappedAt);
  const purge = formatPurgeCountdown(daysToPurge);

  return (
    <div className={cn(strip, mono)} role="status">
      {wrapAge && (
        <>
          <span className={cn(item, 'text-ink')}>{wrapAge}</span>
          <span aria-hidden="true" className="text-muted">·</span>
        </>
      )}

      <span
        className={cn(item, 'text-ink')}
        title={
          purge
            ? 'Files and comments here are destroyed on this date. Export now to keep a copy.'
            : 'Your agency retains this workspace indefinitely.'
        }
      >
        {purge ?? 'NO PURGE SCHEDULED'}
      </span>

      <span aria-hidden="true" className="text-muted">·</span>

      <a className={cn(item, 'text-ink underline underline-offset-2')} href={hrefs.clientExport()}>
        EXPORT EVERYTHING
      </a>

      {archived && (
        <>
          <span aria-hidden="true" className="text-muted">·</span>
          <span className={cn(item, 'text-muted')}>READ-ONLY</span>
        </>
      )}
    </div>
  );
}
