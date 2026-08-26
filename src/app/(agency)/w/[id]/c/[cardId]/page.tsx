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
import { formatDue, formatPurgeDate, formatRounds, roundsBreached } from '@/lib/format';
import { breach, chip, cn, display, eyebrow, mono, muted, surface } from '@/components/style-tokens';
import { AssigneePicker } from '@/components/agency/assignee-picker';
import { RemoveCardControl } from '@/components/agency/remove-controls';
import { movedEver, onClientBoard } from '@/components/agency/removal-facts';
import { ErrorPanel } from '@/components/agency/error-panel';
import { PossessionBar } from '@/components/agency/possession-bar';
import { StateChip } from '@/components/agency/state-chip';
import { TransitionControls } from '@/components/agency/transition-controls';
import { VersionStack } from '@/components/agency/version-stack';
import { UploadPanel } from '@/components/agency/upload-panel';
import { RevisionNotes, type VersionThread } from '@/components/agency/revision-notes';
import { CommentThread } from '@/components/agency/comment-thread';
import { agencyApi } from '@/lib/api-client.agency';
import { serverContext } from '../../../../_lib/server-context';
import { getBoard, getEngagement } from '../../../../_lib/reads';

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string; cardId: string }>;
}) {
  const { id, cardId } = await params;
  const [board, engagement] = await Promise.all([getBoard(id), getEngagement(id)]);

  if (!board.ok) return <ErrorPanel failure={board} />;

  const lane = board.data.lanes.find((l) => l.cards.some((c) => c.id === cardId));
  const card = lane?.cards.find((c) => c.id === cardId);
  if (!lane || !card) notFound();

  const due = formatDue(card.dueAt);
  const breached = roundsBreached(card.roundsUsed, card.contractedRounds);
  // Predicted from `status`, not discovered on a 423 at submit.
  const archived = engagement.ok && engagement.data.engagement.status !== 'active';

  // One read per version, issued together. The thread is per-version because
  // the guarantee is per-version (PRD §5.3) — there is no card-level read that
  // could honour "never floats forward".
  const ctx = await serverContext();
  const latest = [...card.versions].sort((a, b) => b.versionNo - a.versionNo)[0] ?? null;
  // The card's discussion goes out with the note reads, not after them.
  const [threads, discussion] = await Promise.all([
    Promise.all(
      [...card.versions]
        .sort((a, b) => b.versionNo - a.versionNo)
        .map(async (version) => {
          const notes = await agencyApi.revisionNotes(version.id, ctx);
          return {
            versionId: version.id,
            versionNo: version.versionNo,
            notes: notes.ok ? notes.data : [],
          };
        }),
    ) as Promise<VersionThread[]>,
    agencyApi.comments(card.id, ctx),
  ]);

  return (
    <article className="flex max-w-prose flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={`/w/${id}/board`} className={cn('text-12', muted, 'hover:text-ink')}>
          ← {lane.name}
        </Link>
        <h1 className={cn(display, 'text-28 text-ink')}>{card.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={card.state} />
          {/* A brand-new card has no transitions, so the clock reports no
              holder. `state` supplies the one the board already shows. */}
          <PossessionBar possession={card.possession} state={card.state} />
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
          {/*
            In `draft`, the forward control *is* the picker.

            `draft → assigned` is the only edge out of `draft`
            (`domain/card/state-machine.ts`), so the generic control here was a
            button labelled "Assign" that assigned the card to nobody — it moved
            the state and left `assigneeId` null, which is the exact shape that
            fills `NO MOVEMENT IN 7 DAYS` while `BLOCKED ON YOU` stays empty.
            Choosing a person and moving the card is one act for the person;
            INV-2 makes it two requests underneath, which is the back-end's
            business and not theirs (COMPONENTS.md §17).
          */}
          {card.state === 'draft' && !archived ? (
            <AssigneePicker
              engagementId={id}
              cardId={card.id}
              assignee={card.assignee}
              variant="forward"
              isDraft
            />
          ) : (
            <TransitionControls
              engagementId={id}
              cardId={card.id}
              state={card.state}
              readOnly={archived}
            />
          )}
        </div>
      </section>

      <section aria-labelledby="card-versions">
        <h2 id="card-versions" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Versions
        </h2>
        <div className="mt-3 flex flex-col gap-4">
          {/*
            The upload sits above the stack, not below it. `asset_versions` is
            append-only (INV-4) and the stack is reverse-chronological, so the
            row this control is about to create appears directly beneath it.
          */}
          <UploadPanel
            target={{ kind: 'version', engagementId: id, cardId: card.id }}
            disabled={archived}
            disabledReason="This engagement is read-only. Every version is still here to read and to export."
          />
          <VersionStack versions={card.versions} />
        </div>
      </section>

      <section aria-labelledby="card-notes">
        <h2 id="card-notes" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Revision notes
        </h2>
        <div className="mt-3">
          <RevisionNotes
            engagementId={id}
            threads={threads}
            latestVersionId={latest?.id ?? null}
            latestVersionNo={latest?.versionNo ?? null}
            readOnly={archived}
          />
        </div>
      </section>

      {/*
        Card-level discussion, the other half of PRD §7. Above Backstage and
        below the revision notes: the notes are what an approval argument is
        made of, and this is the conversation around them. Internal rows are in
        this read and are never in the client's — the filter is in SQL, not in a
        serialiser.

        A failed read renders the empty state rather than an error panel; the
        transitions and versions above are what this page is for.
      */}
      <section aria-labelledby="card-discussion">
        <h2 id="card-discussion" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Discussion
        </h2>
        <p className={cn('mt-2 max-w-prose text-12', muted)}>
          About the card. A remark about one file belongs in a revision note, where it stays on
          that version.
        </p>
        <div className="mt-3">
          <CommentThread
            engagementId={id}
            cardId={card.id}
            comments={discussion.ok ? discussion.data : []}
            readOnly={archived}
          />
        </div>
      </section>

      <section aria-labelledby="card-backstage">
        <h2 id="card-backstage" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Backstage
        </h2>
        <dl className={cn(surface, 'mt-3 divide-y divide-rule')}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
            {/*
              The `<dt>` is the control's label — `AssigneePicker` renders the
              `Select` with `labelHidden` rather than printing "Assignee" a
              second time inside a row that already says it.
            */}
            <dt className={cn('text-14', muted)}>Assignee</dt>
            <dd className="flex min-w-0 justify-end text-14 text-ink">
              <AssigneePicker
                engagementId={id}
                cardId={card.id}
                assignee={card.assignee}
                variant="row"
                readOnly={archived}
                isDraft={card.state === 'draft'}
              />
            </dd>
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

      {/*
        Removal is last on the page and it is not in the Backstage list, because
        it is an act and that list is a set of records. `RemoveCardControl`
        decides for itself whether this is a discard or an archive and says so
        before the press — the counts it needs are already on this page, so it
        does not cost a read.
      */}
      <section aria-labelledby="card-remove">
        <h2 id="card-remove" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Remove
        </h2>
        <div className="mt-3">
          {archived ? (
            <p className={cn(mono, 'text-12', muted)}>
              read-only · archived, so nothing can be removed
            </p>
          ) : (
            <RemoveCardControl
              engagementId={id}
              cardId={card.id}
              cardTitle={card.title}
              laneName={lane.name}
              purgeOn={
                engagement.ok
                  ? formatPurgeDate(engagement.data.engagement.daysToPurge, Date.now())
                  : null
              }
              facts={{
                versions: card.versions.length,
                comments: discussion.ok ? discussion.data.length : 0,
                hasMoved: movedEver(card.possession),
                visibleToClient: onClientBoard({
                  state: card.state,
                  visibilityOverride: card.visibilityOverride,
                  laneVisibility: lane.visibility,
                }),
              }}
            />
          )}
        </div>
      </section>
    </article>
  );
}
