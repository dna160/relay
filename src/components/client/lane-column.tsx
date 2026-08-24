/**
 * The client's lane column.
 *
 * `ClientLane` carries no `visibility` field, so the private badge that the
 * agency column renders cannot be written here even by accident: there is
 * nothing to read it from. A private lane never reaches this component because
 * it never leaves the query layer (INV-1).
 */

import type { ClientLane } from '@/lib/types';
import { cn, laneHeading, mono, muted } from '@/components/style-tokens';
import { CardTile } from './card-tile';
import { EmptyState } from './empty-state';

export function LaneColumn({ lane, cardHref }: { lane: ClientLane; cardHref: (cardId: string) => string }) {
  return (
    <section aria-label={lane.name} className="flex w-full shrink-0 flex-col sm:w-lane">
      <header className="flex items-center justify-between gap-2 border-b border-rule pb-2">
        <h2 className={cn(laneHeading, 'truncate')}>{lane.name}</h2>
        <span className={cn(mono, 'text-12', muted)}>{lane.cards.length}</span>
      </header>
      <div className="mt-2 flex flex-1 flex-col gap-2 pb-4">
        {lane.cards.length === 0 ? (
          <EmptyState instruction="Nothing here yet. Your agency will add deliverables to this lane." />
        ) : (
          lane.cards.map((card) => <CardTile key={card.id} card={card} href={cardHref(card.id)} />)
        )}
      </div>
    </section>
  );
}
