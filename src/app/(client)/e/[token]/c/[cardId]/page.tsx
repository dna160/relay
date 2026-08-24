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
import { clientApi } from '@/lib/api-client.client';
import { formatDue, formatRounds, roundsBreached } from '@/lib/format';
import { breach, cn, display, eyebrow, mono, muted } from '@/components/style-tokens';
import { StateChip } from '@/components/client/state-chip';
import { VersionStack } from '@/components/client/version-stack';
import { DecisionBar } from '@/components/client/decision-bar';
import { RevisionNotes, type VersionThread } from '@/components/client/revision-notes';
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

  // `versions` arrives newest-first from the client projection.
  const latest = card.versions[0] ?? null;
  const due = formatDue(card.dueAt);
  const breached = roundsBreached(card.roundsUsed, card.contractedRounds);

  /**
   * Read-only is now *predicted* from the header's `status`, not discovered on
   * a 423. Writing a note into a textarea and being told afterwards that the
   * workspace froze last Tuesday is the worst moment to learn it. The server is
   * still the authority — every write route checks `assertWritable` before it
   * touches a row — this only stops the surface offering a control that cannot
   * succeed.
   */
  const readOnly = board.data.engagement.status !== 'active';

  /**
   * One read per version, issued together. PRD §5.3's guarantee is that a note
   * stays on the version it was written against, so the thread is per-version
   * by construction and there is no card-level read that could return it.
   * A card carries a handful of published versions, and a waterfall of even a
   * handful is felt on 4G.
   */
  const threads: VersionThread[] = await Promise.all(
    card.versions.map(async (version) => {
      const notes = await clientApi.revisionNotes(version.id, ctx);
      return {
        versionId: version.id,
        versionNo: version.versionNo,
        // A failed read degrades to an empty thread rather than taking the page
        // down: the file and the decision are what this page is for.
        notes: notes.ok ? notes.data : [],
      };
    }),
  );

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
          <RevisionNotes
            threads={threads}
            latestVersionId={latest?.id ?? null}
            latestVersionNo={latest?.versionNo ?? null}
            readOnly={readOnly}
          />
        </div>
      </section>
    </article>
  );
}
