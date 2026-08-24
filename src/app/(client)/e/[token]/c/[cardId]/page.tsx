/**
 * One deliverable, on the client's side.
 *
 * The card is read out of the published board rather than from a per-card
 * endpoint: `docs/API-CONTRACT.md` defines `GET /api/client/board` and no
 * per-card read, and a card that is not on that board is one the client cannot
 * see — so `notFound()` here is the same 404 the API would return, for the same
 * reason (INV-1).
 *
 * The decision binds to the latest published version and to no other
 * (ADR-004, INV-3), which is why `DecisionBar` is handed one version rather
 * than a card and a selector.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clientApi } from '@/lib/api-client';
import { formatDue, formatRounds, roundsBreached } from '@/lib/format';
import { breach, cn, display, eyebrow, mono, muted } from '@/components/style-tokens';
import { StateChip } from '@/components/client/state-chip';
import { VersionStack } from '@/components/client/version-stack';
import { DecisionBar } from '@/components/client/decision-bar';
import { CommentThread } from '@/components/client/comment-thread';
import { ErrorPanel } from '@/components/client/error-panel';
import { getClientBoard } from '../../../../_lib/reads';
import { serverContext } from '../../../../_lib/server-context';

export default async function ClientCardPage({
  params,
}: {
  params: Promise<{ token: string; cardId: string }>;
}) {
  const { token, cardId } = await params;
  const board = await getClientBoard();
  if (!board.ok) return <ErrorPanel failure={board} />;

  const lane = board.data.lanes.find((l) => l.cards.some((c) => c.id === cardId));
  const card = lane?.cards.find((c) => c.id === cardId);
  if (!lane || !card) notFound();

  const ctx = await serverContext();
  const comments = await clientApi.comments(card.id, ctx);

  // `versions` arrives newest-first from the client projection.
  const latest = card.versions[0] ?? null;
  const due = formatDue(card.dueAt);
  const breached = roundsBreached(card.roundsUsed, card.contractedRounds);
  // The client header does not carry engagement status yet, so read-only is
  // discovered rather than predicted: a mutation on an archived engagement
  // returns 423 and the panel says so in the client's words.
  const readOnly = false;

  return (
    <article className="flex max-w-prose flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={`/e/${token}/board`} className={cn('text-12', muted, 'hover:text-ink')}>
          ← {lane.name}
        </Link>
        <h1 className={cn(display, 'text-28 text-ink')}>{card.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={card.state} />
          <span className={cn(mono, 'text-12', breached ? breach : muted)}>
            round {formatRounds(card.roundsUsed, card.contractedRounds)}
          </span>
          {due && (
            <span className={cn(mono, 'text-12', muted, due.overdue && 'font-semibold text-ink')}>
              {due.date} · {due.countdown}
            </span>
          )}
        </div>
      </header>

      {card.description && (
        <p className="whitespace-pre-wrap text-16 text-ink">{card.description}</p>
      )}

      {card.awaitingYou && latest && !readOnly && (
        <DecisionBar
          version={latest}
          roundsUsed={card.roundsUsed}
          contractedRounds={card.contractedRounds}
        />
      )}

      <section aria-labelledby="client-versions">
        <h2 id="client-versions" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Files
        </h2>
        <div className="mt-3">
          <VersionStack versions={card.versions} selectedId={latest?.id} />
        </div>
      </section>

      <section aria-labelledby="client-notes">
        <h2 id="client-notes" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Notes
        </h2>
        <div className="mt-3">
          {/* There is no read endpoint for notes yet, so a failed read
              degrades to the empty state and the form still posts. */}
          <CommentThread
            cardId={card.id}
            comments={comments.ok ? comments.data : []}
            readOnly={readOnly}
          />
        </div>
      </section>
    </article>
  );
}
