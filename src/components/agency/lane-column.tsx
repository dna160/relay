/**
 * LaneColumn — a board column.
 *
 * The header carries a private badge when `visibility === 'private'`. That
 * badge exists only in this file, which only the agency bundle imports: a
 * client contact is never told that a private lane exists, because the query
 * layer never serialises one (INV-1). The badge is the agency's reminder, not
 * the client's redaction notice.
 */

import type { ReactNode } from 'react';
import type { AgencyLane } from '@/lib/types';
import { chip, cn, laneHeading, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';

export function LaneColumn({
  lane,
  children,
  header,
  onDragOver,
  onDrop,
  isDropTarget,
}: {
  lane: AgencyLane;
  children?: ReactNode;
  /** Lane-level actions, supplied by the board. */
  header?: ReactNode;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  isDropTarget?: boolean;
}) {
  const isPrivate = lane.visibility === 'private';
  return (
    <section
      aria-label={lane.name}
      className="flex w-card shrink-0 flex-col sm:w-lane"
      data-lane-id={lane.id}
    >
      <header className="flex items-center justify-between gap-2 border-b border-rule pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className={cn(laneHeading, 'truncate')}>{lane.name}</h2>
          {isPrivate && (
            <span className={cn(chip, 'shrink-0')} title="Not published to the client">
              PRIVATE
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn(mono, 'text-12', muted)}>{lane.cards.length}</span>
          {header}
        </div>
      </header>

      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn(
          'mt-2 flex flex-1 flex-col gap-2 pb-4',
          isDropTarget && 'outline-dashed outline-1 outline-offset-2 outline-rule-strong',
        )}
      >
        {lane.cards.length === 0 ? (
          <EmptyState instruction="Nothing here yet. Add the first deliverable." />
        ) : (
          children
        )}
      </div>
    </section>
  );
}
