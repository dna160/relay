/**
 * The decision queue: every card where it is the client's move.
 *
 * This is the screen the product is for on this side. It answers one question —
 * what do you have to look at — and it is empty most of the time, which is the
 * correct resting state and is said as such rather than apologised for.
 */

import { cn, display, muted } from '@/components/style-tokens';
import { CardTile } from '@/components/client/card-tile';
import { EmptyState } from '@/components/client/empty-state';
import { ErrorPanel } from '@/components/client/error-panel';
import { getClientQueue } from '../../../_lib/reads';

export default async function ClientQueuePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const queue = await getClientQueue();

  if (!queue.ok) return <ErrorPanel failure={queue} />;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className={cn(display, 'text-20 text-ink')}>Waiting on you</h2>
        <p className={cn('mt-1 text-14', muted)}>
          Open one to see the file, leave a note, and approve or ask for changes.
        </p>
      </div>

      {queue.data.length === 0 ? (
        <EmptyState instruction="Nothing needs you right now. Anything that does will appear here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.data.map((card) => (
            <li key={card.id}>
              <CardTile card={card} href={`/e/${token}/c/${card.id}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
