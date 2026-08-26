'use client';

/**
 * What has been removed from this board, and the way back.
 *
 * The undo lines on the board and on the card page are the *immediate* recovery
 * — the one you take three seconds after a mis-click, where the action happened.
 * This is the other one: the recovery you need on Thursday, when somebody asks
 * where a deliverable went and the person who archived it is not at their desk.
 * An undo that only exists in the session that produced it is not a safety net,
 * it is a grace period.
 *
 * It reads `GET /api/engagements/:id/archive`, which is a different read from
 * the board on purpose: the board is the *live* board and its shape is
 * `AgencyLane[]`, while an archived card whose lane was archived too has no lane
 * to sit in. Threading both populations through one projection would mean every
 * consumer of the board learning to skip half of it.
 *
 * `versionCount` is rendered on every card row because it is precisely the fact
 * that decided the card's fate: it is the reason archiving happened instead of
 * deletion, and the count of immutable rows a hard delete would have taken with
 * it (INV-4, ADR-004, ADR-026).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi, type ArchivedBoard } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, mono, muted, surface } from '@/components/style-tokens';
import { formatDate, plural } from '@/lib/format';
import { EmptyState } from './empty-state';
import { ErrorPanel } from './error-panel';

export function ArchiveRegister({
  engagementId,
  readOnly = false,
}: {
  engagementId: string;
  /** An archived engagement is read-only: the register still reads, nothing restores. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [archive, setArchive] = useState<ArchivedBoard | null>(null);
  const restoreCard = useAction(agencyApi.restoreCard);
  const restoreLane = useAction(agencyApi.restoreLane);

  const load = useCallback(async () => {
    const r = await agencyApi.archive(engagementId);
    if (r.ok) setArchive(r.data);
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (archive === null) {
    return (
      <p className={cn(mono, 'text-12', muted)} aria-busy="true">
        reading…
      </p>
    );
  }

  if (archive.lanes.length === 0 && archive.cards.length === 0) {
    return <EmptyState instruction="Nothing has been removed from this board." />;
  }

  const pending = restoreCard.pending || restoreLane.pending;
  const failure = restoreCard.failure ?? restoreLane.failure;

  return (
    <div className="flex flex-col gap-3">
      <ul className={cn(surface, 'divide-y divide-rule')}>
        {archive.lanes.map((lane) => (
          <li key={lane.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-14 text-ink">{lane.name}</span>
            <span className={cn(mono, 'text-12', muted)}>lane</span>
            <span className={cn(mono, 'text-12', muted)}>
              {plural(lane.cardsHidden, 'card', 'cards')}
            </span>
            <span className={cn('text-12', muted)}>
              {formatDate(lane.archivedAt)}
              {lane.archivedByName ? ` · ${lane.archivedByName}` : ''}
            </span>
            {!readOnly && (
              <Button
                tone="quiet"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  const r = await restoreLane.run('Restored', lane.id, { engagementId });
                  if (r.ok) {
                    await load();
                    router.refresh();
                  }
                }}
              >
                Put it back
              </Button>
            )}
          </li>
        ))}

        {archive.cards.map((card) => (
          <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-14 text-ink">{card.title}</span>
            <span className={cn(mono, 'text-12', muted)}>{card.laneName}</span>
            {/*
              The count that explains why this row still exists at all. A card
              carrying versions cannot be deleted without taking approvals with
              it, so it was archived — and this is that number.
            */}
            <span className={cn(mono, 'text-12', muted)}>
              {plural(card.versionCount, 'version', 'versions')}
            </span>
            <span className={cn('text-12', muted)}>
              {formatDate(card.archivedAt)}
              {card.archivedByName ? ` · ${card.archivedByName}` : ''}
            </span>
            {!readOnly && (
              <Button
                tone="quiet"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  const r = await restoreCard.run('Restored', card.id, { engagementId });
                  if (r.ok) {
                    await load();
                    router.refresh();
                  }
                }}
              >
                Put it back
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/*
        The one outcome a restore can have that looks like a failure and is not.
        A card can come back into a lane that is itself still archived, in which
        case the board still will not show it — reported rather than silently
        un-archiving the whole column, which would be a larger act than the one
        asked for.
      */}
      {restoreCard.data?.laneIsArchived === true && (
        <p role="status" className="text-14 text-ink">
          That deliverable is back, but the lane it stands in is still archived, so the board will
          not show it yet. Put the lane back too.
        </p>
      )}

      {failure && <ErrorPanel failure={failure} />}
    </div>
  );
}
