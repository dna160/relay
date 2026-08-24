/**
 * The agency board — lanes, cards, and both projections' source of truth.
 *
 * Read on the server, moved on the client. The board component is where drag
 * and the keyboard move controls live; neither of them can reach the transition
 * route (ADR-003).
 */

import { agencyApi } from '@/lib/api-client';
import { Board } from '@/components/agency/board';
import { ErrorPanel } from '@/components/agency/error-panel';
import { serverContext } from '../../../_lib/server-context';

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await serverContext();
  const [board, engagement] = await Promise.all([
    agencyApi.board(id, ctx),
    agencyApi.engagement(id, ctx),
  ]);

  if (!board.ok) return <ErrorPanel failure={board} />;

  return (
    <Board
      engagementId={id}
      lanes={board.data.lanes}
      archived={engagement.ok && engagement.data.engagement.status !== 'active'}
    />
  );
}
