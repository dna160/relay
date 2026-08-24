/**
 * The published board.
 *
 * A server component end to end: nothing on this page hydrates, because nothing
 * on it is interactive. Only the decision surfaces ship JavaScript. That is how
 * the 1.5s first-paint budget on 4G is met — not by optimising a bundle, by not
 * having one here.
 *
 * Private lanes and private cards are absent rather than filtered: they never
 * left the query layer (INV-1).
 */

import { cn, muted } from '@/components/style-tokens';
import { LaneColumn } from '@/components/client/lane-column';
import { EmptyState } from '@/components/client/empty-state';
import { ErrorPanel } from '@/components/client/error-panel';
import { getClientBoard } from '../../../_lib/reads';

export default async function ClientBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const board = await getClientBoard();

  if (!board.ok) return <ErrorPanel failure={board} />;

  const { lanes } = board.data;
  if (lanes.length === 0) {
    return <EmptyState instruction="Nothing has been shared yet. Your agency will publish work here." />;
  }

  const awaiting = lanes.reduce((n, l) => n + l.cards.filter((c) => c.awaitingYou).length, 0);

  return (
    <div className="flex flex-col gap-3">
      {awaiting > 0 && (
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
