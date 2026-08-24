/**
 * One card, backstage.
 *
 * The card is read out of the board rather than from a per-card endpoint,
 * because `docs/API-CONTRACT.md` does not define one and inventing a route for
 * a page to consume is how a contract stops being a contract. If a
 * `GET /api/cards/:id` lands later this page changes in one place.
 *
 * Everything the client never sees is here: the internal notes, the assignee,
 * the effort estimate, the versions that never passed the gate, and the
 * possession split.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { agencyApi } from '@/lib/api-client';
import { formatDue, formatRounds, roundsBreached } from '@/lib/format';
import { breach, chip, cn, display, eyebrow, mono, muted, surface } from '@/components/style-tokens';
import { ErrorPanel } from '@/components/agency/error-panel';
import { PossessionBar } from '@/components/agency/possession-bar';
import { StateChip } from '@/components/agency/state-chip';
import { TransitionControls } from '@/components/agency/transition-controls';
import { VersionStack } from '@/components/agency/version-stack';
import { serverContext } from '../../../../_lib/server-context';

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string; cardId: string }>;
}) {
  const { id, cardId } = await params;
  const ctx = await serverContext();
  const board = await agencyApi.board(id, ctx);

  if (!board.ok) return <ErrorPanel failure={board} />;

  const lane = board.data.lanes.find((l) => l.cards.some((c) => c.id === cardId));
  const card = lane?.cards.find((c) => c.id === cardId);
  if (!lane || !card) notFound();

  const due = formatDue(card.dueAt);
  const breached = roundsBreached(card.roundsUsed, card.contractedRounds);

  return (
    <article className="flex max-w-prose flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={`/w/${id}/board`} className={cn('text-12', muted, 'hover:text-ink')}>
          ← {lane.name}
        </Link>
        <h1 className={cn(display, 'text-28 text-ink')}>{card.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={card.state} />
          <PossessionBar possession={card.possession} />
          <span className={cn(mono, 'text-12', breached ? breach : muted)}>
            rounds {formatRounds(card.roundsUsed, card.contractedRounds)}
          </span>
          {due && (
            <span className={cn(mono, 'text-12', muted, due.overdue && 'font-semibold text-ink')}>
              {due.date} · {due.countdown}
            </span>
          )}
          {lane.visibility === 'private' && <span className={chip}>PRIVATE LANE</span>}
          {card.visibilityOverride === 'private' && <span className={chip}>PRIVATE CARD</span>}
          <span className={cn(mono, 'text-12', muted)}>{card.id}</span>
        </div>
      </header>

      {card.description && (
        <p className="whitespace-pre-wrap text-16 text-ink">{card.description}</p>
      )}

      <section aria-labelledby="card-move">
        <h2 id="card-move" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Move this on
        </h2>
        <div className="mt-3">
          <TransitionControls engagementId={id} cardId={card.id} state={card.state} />
        </div>
      </section>

      <section aria-labelledby="card-versions">
        <h2 id="card-versions" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Versions
        </h2>
        <div className="mt-3">
          <VersionStack versions={card.versions} />
        </div>
      </section>

      <section aria-labelledby="card-backstage">
        <h2 id="card-backstage" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Backstage
        </h2>
        <dl className={cn(surface, 'mt-3 divide-y divide-rule')}>
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className={cn('text-14', muted)}>Assignee</dt>
            <dd className="text-14 text-ink">{card.assignee?.name ?? 'Unassigned'}</dd>
          </div>
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className={cn('text-14', muted)}>Effort estimate</dt>
            <dd className={cn(mono, 'text-14 text-ink')}>
              {card.effortEstimate === null ? '—' : `${card.effortEstimate}h`}
            </dd>
          </div>
          <div className="px-3 py-2">
            <dt className={cn('text-14', muted)}>Internal notes</dt>
            <dd className="mt-1 whitespace-pre-wrap text-14 text-ink">
              {card.internalNotes ?? 'Nothing recorded. These notes never reach the client.'}
            </dd>
          </div>
        </dl>
      </section>
    </article>
  );
}
