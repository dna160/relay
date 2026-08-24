'use client';

/**
 * The agency board: lanes, cards, and the two ways to move a card.
 *
 * Pointer users drag. Keyboard users press the move controls that appear inside
 * a focused card. Both paths call the same `move()` and both write `position`
 * and `laneId` only. Native HTML5 drag-and-drop is used deliberately — no drag
 * library has been added, because a dependency needs an ADR and because the
 * keyboard path has to exist regardless and is the one that decides the
 * accessibility floor.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgencyLane } from '@/lib/types';
import { agencyApi } from '@/lib/api-client';
import { useCardReorder } from '@/lib/hooks/use-card-reorder';
import { useServerEvents } from '@/lib/hooks/use-server-events';
import { useAction } from '@/lib/hooks/use-action';
import { buttonGhost, chip, cn, mono, muted } from '@/components/style-tokens';
import { CardTile } from './card-tile';
import { LaneColumn } from './lane-column';
import { TransitionControls } from './transition-controls';
import { AddCardForm, AddLaneForm } from './board-add';
import { ErrorPanel } from './error-panel';

const moveButton = 'h-6 px-1.5 text-12';

function LaneVisibilityToggle({ engagementId, lane }: { engagementId: string; lane: AgencyLane }) {
  const router = useRouter();
  const update = useAction(agencyApi.updateLane);
  const nextVisibility = lane.visibility === 'private' ? 'published' : 'private';
  return (
    <button
      type="button"
      disabled={update.pending}
      className={cn(buttonGhost, moveButton)}
      title={
        nextVisibility === 'private'
          ? 'Hide this lane and its cards from the client'
          : 'Publish this lane to the client'
      }
      onClick={async () => {
        const r = await update.run('Updated', lane.id, { engagementId, visibility: nextVisibility });
        if (r.ok) router.refresh();
      }}
    >
      {nextVisibility === 'private' ? 'Make private' : 'Publish lane'}
    </button>
  );
}

export interface BoardProps {
  engagementId: string;
  lanes: AgencyLane[];
  /** An archived engagement is read-only; every mutation returns 423. */
  archived: boolean;
}

export function Board({ engagementId, lanes: serverLanes, archived }: BoardProps) {
  useServerEvents(engagementId, !archived);
  const { lanes, failure, announcement, move } = useCardReorder(engagementId, serverLanes);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ laneId: string; beforeCardId: string | null } | null>(null);

  const clearDrag = () => {
    setDragCardId(null);
    setDropAt(null);
  };

  if (lanes.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className={cn('text-14', muted)}>
          No lanes yet. Add the first one to start the board.
        </p>
        <AddLaneForm engagementId={engagementId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {failure && <ErrorPanel failure={failure} />}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {lanes.map((lane, laneIndex) => {
          const prevLane = lanes[laneIndex - 1];
          const nextLane = lanes[laneIndex + 1];

          return (
            <LaneColumn
              key={lane.id}
              lane={lane}
              header={archived ? null : <LaneVisibilityToggle engagementId={engagementId} lane={lane} />}
              isDropTarget={dropAt?.laneId === lane.id}
              onDragOver={(e) => {
                if (!dragCardId || archived) return;
                e.preventDefault();
                setDropAt({ laneId: lane.id, beforeCardId: null });
              }}
              onDrop={(e) => {
                if (!dragCardId || archived) return;
                e.preventDefault();
                void move(dragCardId, lane.id, dropAt?.beforeCardId ?? null);
                clearDrag();
              }}
            >
              {lane.cards.map((card, i) => {
                const prev = lane.cards[i - 1];
                const next = lane.cards[i + 1];
                const afterNext = lane.cards[i + 2];
                const isEdge = dropAt?.laneId === lane.id && dropAt.beforeCardId === card.id;

                return (
                  <div
                    key={card.id}
                    draggable={!archived}
                    onDragStart={(e) => {
                      setDragCardId(card.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', card.id);
                    }}
                    onDragEnd={clearDrag}
                    onDragOver={(e) => {
                      if (!dragCardId || archived) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const box = e.currentTarget.getBoundingClientRect();
                      const above = e.clientY < box.top + box.height / 2;
                      setDropAt({
                        laneId: lane.id,
                        beforeCardId: above ? card.id : (next?.id ?? null),
                      });
                    }}
                    onDrop={(e) => {
                      if (!dragCardId || archived) return;
                      e.preventDefault();
                      e.stopPropagation();
                      void move(dragCardId, lane.id, dropAt?.beforeCardId ?? null);
                      clearDrag();
                    }}
                    className={cn(isEdge && 'border-t-2 border-ink')}
                  >
                    <CardTile
                      card={card}
                      href={`/w/${engagementId}/c/${card.id}`}
                      dragging={dragCardId === card.id}
                      controls={
                        archived ? null : (
                          <div className="flex flex-col gap-2">
                            <div
                              className="flex flex-wrap items-center gap-1"
                              role="group"
                              aria-label={`Move ${card.title}`}
                            >
                              <span className={cn(mono, 'text-12', muted)}>move</span>
                              <button
                                type="button"
                                className={cn(buttonGhost, moveButton)}
                                disabled={!prev}
                                onClick={() => void move(card.id, lane.id, prev?.id ?? null)}
                                aria-label={`Move ${card.title} up`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className={cn(buttonGhost, moveButton)}
                                disabled={!next}
                                onClick={() => void move(card.id, lane.id, afterNext?.id ?? null)}
                                aria-label={`Move ${card.title} down`}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className={cn(buttonGhost, moveButton)}
                                disabled={!prevLane}
                                onClick={() => prevLane && void move(card.id, prevLane.id, null)}
                                aria-label={`Move ${card.title} to ${prevLane?.name ?? 'the previous lane'}`}
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                className={cn(buttonGhost, moveButton)}
                                disabled={!nextLane}
                                onClick={() => nextLane && void move(card.id, nextLane.id, null)}
                                aria-label={`Move ${card.title} to ${nextLane?.name ?? 'the next lane'}`}
                              >
                                →
                              </button>
                            </div>
                            <TransitionControls
                              engagementId={engagementId}
                              cardId={card.id}
                              state={card.state}
                              compact
                            />
                          </div>
                        )
                      }
                    />
                  </div>
                );
              })}

              {!archived && <AddCardForm engagementId={engagementId} laneId={lane.id} />}
            </LaneColumn>
          );
        })}

        {!archived && <AddLaneForm engagementId={engagementId} />}
      </div>

      {archived && (
        <p className={cn(chip, mono)}>READ-ONLY · ARCHIVED</p>
      )}
    </div>
  );
}
