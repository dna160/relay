/**
 * The agency board — lanes, cards, and both projections' source of truth.
 *
 * Read on the server, moved on the client. The board component is where drag
 * and the keyboard move controls live; neither of them can reach the transition
 * route (ADR-003).
 */

import { Board } from '@/components/agency/board';
import { ErrorPanel } from '@/components/agency/error-panel';
import { getBoard, getEngagement } from '../../../_lib/reads';

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `getEngagement` is the same call the workspace layout already made, and
  // `cache()` collapses the two into one round trip.
  const [board, engagement] = await Promise.all([getBoard(id), getEngagement(id)]);

  if (!board.ok) return <ErrorPanel failure={board} />;

  return (
    <Board
      engagementId={id}
      lanes={board.data.lanes}
      archived={engagement.ok && engagement.data.engagement.status !== 'active'}
    />
  );
}
