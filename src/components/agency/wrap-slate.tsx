'use client';

/**
 * WrapSlate — the persistent mono strip in the workspace header:
 * `WRAP +12d · PURGE IN 48d · EXPORT`
 *
 * Ephemerality is stated, never sprung. There is no dismiss control on this
 * component and adding one would be a product regression, not a UX improvement:
 * the strip is the only place the agency is told, continuously, that this
 * workspace has an end date.
 *
 * It is also the conversion surface. On a retaining plan the countdown is null
 * and the strip says so rather than disappearing — an agency that upgrades
 * should see what it bought.
 */

import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import { formatPurgeCountdown, formatWrapAge } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn, mono } from '@/components/style-tokens';

export interface WrapSlateProps {
  engagementId: string;
  wrappedAt: string | null;
  /** Null on a retaining plan — paid plans null out the countdown entirely. */
  daysToPurge: number | null;
  archived: boolean;
}

const strip =
  'flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-rule bg-paper-2 px-3 py-1.5';

const item = 'text-12 uppercase tracking-lane';

export function WrapSlate({ engagementId, wrappedAt, daysToPurge, archived }: WrapSlateProps) {
  const router = useRouter();
  const wrap = useAction(agencyApi.wrap);
  const exportJob = useAction(agencyApi.requestExport);

  const wrapAge = formatWrapAge(wrappedAt);
  const purge = formatPurgeCountdown(daysToPurge);

  return (
    <div className={cn(strip, mono)} role="status" aria-live="polite">
      {wrapAge ? (
        <span className={cn(item, 'text-ink')}>{wrapAge}</span>
      ) : (
        <button
          type="button"
          disabled={wrap.pending || archived}
          onClick={async () => {
            const r = await wrap.run('Wrapped', engagementId);
            if (r.ok) router.refresh();
          }}
          className={cn(item, 'underline underline-offset-2 disabled:no-underline disabled:opacity-40')}
          title="Mark delivered and start the retention countdown"
        >
          {wrap.pending ? 'WRAPPING…' : wrap.done ? 'WRAPPED' : 'WRAP'}
        </button>
      )}

      <span aria-hidden="true" className="text-muted">·</span>

      <span
        className={cn(item, 'text-ink')}
        title={
          purge
            ? 'Content is destroyed on this schedule. Export or move to a retaining plan to keep it.'
            : 'This plan retains content indefinitely.'
        }
      >
        {purge ?? 'NO PURGE SCHEDULED'}
      </span>

      <span aria-hidden="true" className="text-muted">·</span>

      <button
        type="button"
        disabled={exportJob.pending}
        onClick={() => exportJob.run('Export queued', engagementId)}
        className={cn(item, 'underline underline-offset-2 disabled:no-underline disabled:opacity-40')}
        title="Queue a zip of everything in this engagement"
      >
        {exportJob.pending ? 'QUEUEING…' : exportJob.done ? 'EXPORT QUEUED' : 'EXPORT'}
      </button>

      {archived && (
        <>
          <span aria-hidden="true" className="text-muted">·</span>
          <span className={cn(item, 'text-muted')}>READ-ONLY</span>
        </>
      )}

      {(wrap.failure ?? exportJob.failure) && (
        <span className={cn(item, 'text-muted')}>
          {(wrap.failure ?? exportJob.failure)?.code}
        </span>
      )}
    </div>
  );
}
