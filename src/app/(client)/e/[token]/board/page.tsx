/**
 * The published board.
 *
 * A server component end to end: nothing on this page hydrates, because nothing
 * on it is interactive. Only the decision surfaces ship JavaScript. That is how
 * the 1.5s first-paint budget on 4G is met — not by optimising a bundle, by not
 * having one here. The retention surfaces added in Phase 6 keep that property:
 * the strip is a server component and its export is an anchor, so the board's
 * route JavaScript does not move.
 *
 * Private lanes and private cards are absent rather than filtered: they never
 * left the query layer (INV-1).
 */

import { cn, muted } from '@/components/style-tokens';
import { LaneColumn } from '@/components/client/lane-column';
import { EmptyState } from '@/components/client/empty-state';
import { ErrorPanel } from '@/components/client/error-panel';
import { PurgedReceipt } from '@/components/client/purged-receipt';
import { PurgeWarning } from '@/components/client/purge-warning';
import { ReadOnlyNotice } from '@/components/client/read-only-notice';
import { retentionCountsFromLanes } from '@/components/client/retention';
import { getClientBoard } from '../../../_lib/reads';

export default async function ClientBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const board = await getClientBoard();

  if (!board.ok) {
    if (board.code === 'ENGAGEMENT_PURGED') return <PurgedReceipt failure={board} />;
    return <ErrorPanel failure={board} />;
  }

  const { engagement, lanes } = board.data;
  const nowMs = Date.now();
  const archived = engagement.status !== 'active';

  const retention = (
    <>
      {archived && (
        <ReadOnlyNotice
          daysToPurge={engagement.daysToPurge}
          agencyName={engagement.agencyName}
          nowMs={nowMs}
        />
      )}
      {/*
        Above the lanes, from fourteen days out (FLOWS.md §3). The three facts —
        the date, the count, and the one action — and the one action here is
        always the export. Never an upgrade: a client cannot change their
        agency's plan, and showing them a price for it would be absurd.
      */}
      <PurgeWarning
        daysToPurge={engagement.daysToPurge}
        counts={retentionCountsFromLanes(lanes)}
        agencyName={engagement.agencyName}
        nowMs={nowMs}
      />
    </>
  );

  if (lanes.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {retention}
        <EmptyState instruction="Nothing has been shared yet. Your agency will publish work here." />
      </div>
    );
  }

  const awaiting = lanes.reduce((n, l) => n + l.cards.filter((c) => c.awaitingYou).length, 0);

  return (
    <div className="flex flex-col gap-4">
      {retention}

      {awaiting > 0 && !archived && (
        <p className={cn('text-14', muted)}>
          {awaiting === 1 ? 'One deliverable is' : `${awaiting} deliverables are`} waiting on you.
        </p>
      )}

      <div className="flex flex-col gap-6 sm:flex-row sm:gap-4 sm:overflow-x-auto sm:pb-2">
        {lanes.map((lane) => (
          <LaneColumn key={lane.id} lane={lane} cardHref={(cardId) => `/e/${token}/c/${cardId}`} />
        ))}
      </div>
    </div>
  );
}
