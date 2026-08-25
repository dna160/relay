/**
 * The agency board — lanes, cards, and both projections' source of truth.
 *
 * Read on the server, moved on the client. The board component is where drag
 * and the keyboard move controls live; neither of them can reach the transition
 * route (ADR-003).
 *
 * Two retention surfaces sit above the lanes, and both are stated here rather
 * than inside `Board` because both are server-rendered facts and `Board` is a
 * `'use client'` component. Putting them inside it would drag the warning copy,
 * the count arithmetic and the retention formatters into the board's chunk for
 * no reason at all.
 */

import { Board } from '@/components/agency/board';
import { ErrorPanel } from '@/components/agency/error-panel';
import { PurgeWarning } from '@/components/agency/purge-warning';
import { ReadOnlyNotice } from '@/components/agency/read-only-notice';
import { retentionCountsFromLanes } from '@/components/agency/retention';
import { getBoard, getEngagement } from '../../../_lib/reads';

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `getEngagement` is the same call the workspace layout already made, and
  // `cache()` collapses the two into one round trip.
  const [board, engagement] = await Promise.all([getBoard(id), getEngagement(id)]);

  if (!board.ok) return <ErrorPanel failure={board} />;

  const e = engagement.ok ? engagement.data.engagement : null;
  const archived = e !== null && e.status !== 'active';
  const nowMs = Date.now();
  const counts = retentionCountsFromLanes(board.data.lanes);

  return (
    <div className="flex flex-col gap-4">
      {/*
        The read-only notice first, then the countdown: "this is frozen" is the
        fact that explains why the controls below have gone, and "this is
        deleted on the 12th" is the one that says what to do about it. An
        archived engagement is always inside the retention window, so the two
        appear together and the order is the order they are read in.
      */}
      {archived && e && (
        <ReadOnlyNotice engagementId={e.id} daysToPurge={e.daysToPurge} nowMs={nowMs} />
      )}

      {e && (
        <PurgeWarning
          engagementId={e.id}
          engagementTitle={e.title}
          daysToPurge={e.daysToPurge}
          lastActivityAt={e.lastActivityAt}
          counts={counts}
          nowMs={nowMs}
        />
      )}

      <Board engagementId={id} lanes={board.data.lanes} archived={archived} />
    </div>
  );
}
