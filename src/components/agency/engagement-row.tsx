/**
 * One engagement on the portfolio. A dense row rather than a card grid: an
 * agency with fifteen live engagements wants to read them like a docket, not
 * scroll a wall of tiles.
 *
 * The purge countdown is present on every row, not only the ones close to it.
 * Ephemerality is stated, never sprung.
 */

import Link from 'next/link';
import type { EngagementSummary } from '@/lib/types';
import { formatDate, formatPurgeCountdown, plural } from '@/lib/format';
import { chip, cn, display, mono, muted } from '@/components/style-tokens';
import { PossessionBar } from './possession-bar';

export function EngagementRow({ engagement }: { engagement: EngagementSummary }) {
  const purge = formatPurgeCountdown(engagement.daysToPurge);
  const { awaitingClient, awaitingAgency, total } = engagement.cardCounts;

  return (
    <li className="border-b border-rule py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className={cn(display, 'text-20 text-ink')}>
          <Link href={`/w/${engagement.id}/board`} className="hover:underline">
            {engagement.title}
          </Link>
        </h3>
        <span className={cn('text-14', muted)}>{engagement.clientOrgName}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <PossessionBar possession={engagement.possession} />
        <span className={cn(mono, 'text-12', muted)}>
          {plural(total, 'card', 'cards')} · {awaitingAgency} on us · {awaitingClient} on them
        </span>
        <span className={cn(mono, 'text-12', muted)}>
          last moved {formatDate(engagement.lastActivityAt)}
        </span>
        {purge && <span className={cn(chip)}>{purge}</span>}
        {engagement.status !== 'active' && (
          <span className={cn(chip)}>{engagement.status.toUpperCase()}</span>
        )}
      </div>
    </li>
  );
}
