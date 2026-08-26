'use client';

/**
 * Removing a deliverable, and removing a lane.
 *
 * ## The fact that determines the whole pattern
 *
 * **Relay destroys bytes in exactly one place, and it is not a button.**
 *
 * `lanes → cards → asset_versions → approvals` are all `ON DELETE CASCADE`, so
 * a literal delete would destroy the approvals ADR-004 says must survive a
 * dispute six months later, the versions INV-4 says are append-only, and the
 * possession ledger INV-5 says is the sole source of the clock. INV-7 gives one
 * path that may destroy an engagement's content and it ends in a
 * `purge_certificate`.
 *
 * So `removeCard()` / `removeLane()` (ADR-026) take the **least destructive
 * mechanism that satisfies the request** and report which one they used:
 * *discard* — a real delete, permitted only when the cascade has nothing to
 * cascade to — or *archive*, which is everything else and leaves every version,
 * approval, transition and comment exactly where it was.
 *
 * ## What that obliges the interface to do
 *
 * The caller does not choose the mechanism. **The interface must still say
 * which one is about to happen, before the press.** "Nothing is destroyed" and
 * "this row is deleted" are different promises and only one of them is true of
 * any given card. A single confirmation hedging across both would be false half
 * the time — and false in the direction that matters, because the half it
 * comforts wrongly is the half carrying approvals.
 *
 * Every rule below is a rejection of a habit (COMPONENTS.md §18):
 *
 * - **Lead with what survives.** A normal delete confirmation leads with what
 *   is destroyed; here the answer is usually "nothing", so leading with the
 *   destruction would be leading with a falsehood. The sentence "This cannot be
 *   undone" never appears on an act that can be.
 * - **The survivor list is a `Plate`, not prose.** Counts are records, this
 *   product sets records in mono, and it is the object that makes the decision.
 * - **Say whether the client can see it.** A card silently vanishing from a
 *   client's board is worse than the removal, and it is the thing the agency
 *   cannot see. Stated in the present — *is on their board* — because that is
 *   what the data supports; see `onClientBoard()` for why the past-tense version
 *   of this sentence was false.
 * - **No `--breach` and no red button.** `Button` has no `breach` tone and must
 *   not grow one — red means a contracted round was exceeded and spending it on
 *   a Delete would spend it everywhere. Confirm is `quiet`, cancel is `ghost`.
 * - **No hazard rule.** `Rule weight="hazard"` has one referent in this product
 *   — the purge boundary — and a removal dialog is not it.
 * - **`dismissible`.** A dialog you cannot escape is for an act that cannot be
 *   undone.
 * - **No typed confirmation.** Making somebody type DELETE to archive a card
 *   inflates the act and trains the reflex that will one day type through the
 *   one that matters.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { agencyApi, type CardRemoval, type LaneRemoval } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button, Dialog, Plate, type PlateRow } from '@/components/primitives';
import { cn, mono, muted } from '@/components/style-tokens';
import { plural } from '@/lib/format';
import { ErrorPanel } from './error-panel';
import type { CardRemovalFacts } from './removal-facts';

/* ------------------------------------------------------------------- a card */

export function RemoveCardControl({
  engagementId,
  cardId,
  cardTitle,
  laneName,
  facts,
  disabled = false,
  purgeOn,
}: {
  engagementId: string;
  cardId: string;
  cardTitle: string;
  laneName: string;
  facts: CardRemovalFacts;
  disabled?: boolean;
  /** The engagement's purge date, for the guarantee sentence. */
  purgeOn?: string | null;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<CardRemoval | null>(null);
  const remove = useAction(agencyApi.removeCard);
  const restore = useAction(agencyApi.restoreCard);

  const carriesNothing = facts.versions === 0 && facts.comments === 0 && !facts.hasMoved;

  async function run(): Promise<void> {
    const r = await remove.run('Removed', cardId, engagementId);
    setAsking(false);
    if (r.ok) setOutcome(r.data);
  }

  /* ------------------------------------------------------- after the fact */

  if (outcome) {
    /*
     * The result stays on this page rather than bouncing to the board, and the
     * reason is the undo. This page reads its card out of the live board, which
     * now excludes it — a `router.refresh()` here would replace the undo with a
     * 404. So the page says what happened, offers the way back, and links on.
     */
    const archived = outcome.kind === 'archived';
    return (
      <div role="status" className="flex flex-col gap-2">
        <p className="text-14 text-ink">
          {archived
            ? `“${cardTitle}” is archived. It is off both boards, and every version, approval and comment on it is exactly where it was.`
            : `“${cardTitle}” is deleted. It carried no versions, no history and no comments, so there was nothing to keep.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            `Put it back` is offered for an archive and never for a discard.
            The route reports which happened precisely so this decision is made
            on a fact — an Undo on a row that no longer exists is the worst
            affordance in this whole feature.
          */}
          {archived && (
            <Button
              tone="quiet"
              size="sm"
              loading={restore.pending}
              loadingLabel="Putting it back"
              onClick={async () => {
                const r = await restore.run('Restored', cardId, { engagementId });
                if (r.ok) {
                  if (r.data.laneIsArchived) {
                    // Reported rather than silently fixed: un-archiving a whole
                    // column because one card in it came back is a larger act
                    // than the one asked for. Saying so beats a restore that
                    // claims success while the board still shows nothing.
                    setOutcome(null);
                    router.push(`/w/${engagementId}/settings#settings-archive`);
                    return;
                  }
                  router.push(`/w/${engagementId}/c/${cardId}`);
                  router.refresh();
                }
              }}
            >
              Put it back
            </Button>
          )}
          <Link href={`/w/${engagementId}/board`} className={cn('text-12 underline', muted)}>
            Back to the board
          </Link>
        </div>
        {restore.failure && <ErrorPanel failure={restore.failure} />}
      </div>
    );
  }

  /* ------------------------------------------------ carries nothing: no dialog */

  if (carriesNothing) {
    /*
     * No dialog. Nothing is being destroyed that anybody will miss — this is a
     * typo or a mis-drag — and a modal here trains people to click through
     * modals, which is the habit that eventually carries them through one that
     * mattered.
     */
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          tone="ghost"
          size="sm"
          disabled={disabled}
          loading={remove.pending}
          loadingLabel="Removing"
          onClick={() => void run()}
        >
          Remove this deliverable
        </Button>
        <p className={cn('text-12', muted)}>
          Nothing has been uploaded to it, it has never moved, and nobody has commented. Removing it
          deletes it.
        </p>
        {remove.failure && <ErrorPanel failure={remove.failure} />}
      </div>
    );
  }

  /* ------------------------------------------------------- carries something */

  const rows: PlateRow[] = [
    { term: 'Versions', value: String(facts.versions) },
    { term: 'Comments', value: String(facts.comments) },
    { term: 'History', value: facts.hasMoved ? 'KEPT' : 'NONE' },
  ];

  return (
    <div className="flex flex-col gap-1">
      <Button tone="quiet" size="sm" disabled={disabled} onClick={() => setAsking(true)}>
        Remove this deliverable
      </Button>

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Archive this deliverable?"
        dismissible
        footer={
          <>
            <Button tone="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              tone="quiet"
              loading={remove.pending}
              loadingLabel="Archiving"
              onClick={() => void run()}
            >
              Archive it
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-14 text-ink">
            “{cardTitle}” leaves the {laneName} lane and both boards. Nothing on it is deleted.
          </p>

          {/* Lead with what survives. The counts are records, so they are a
              plate and not a sentence. */}
          <Plate layout="stack" label="What is kept" rows={rows} />

          {/*
            A card silently vanishing from a client's board is a worse outcome
            than the removal itself, and it is the one thing the agency cannot
            see from here.

            The claim is about the present — "is on their board" — and not about
            the past. This read "The client has seen this" and inferred it from
            the card having transitions, which made it announce a client sighting
            for a card that had done nothing but move `draft → assigned` inside
            the agency. `onClientBoard()` asks the three facts that actually
            decide client visibility instead.
          */}
          <p className={cn('text-14', muted)}>
            {facts.visibleToClient
              ? 'This is on the client’s board right now. It disappears from there too.'
              : 'This has never been on the client’s board, so nothing changes for them.'}
          </p>

          <p className={cn('text-14', muted)}>
            You can put it back at any time from this engagement&rsquo;s settings.{' '}
            {purgeOn
              ? `Everything here is destroyed on ${purgeOn} whether it is archived or not — archiving does not bring that date forward, and it does not push it back.`
              : 'This plan retains the workspace, so nothing here is scheduled for destruction.'}
          </p>
        </div>
      </Dialog>

      {remove.failure && <ErrorPanel failure={remove.failure} />}
    </div>
  );
}

/* ------------------------------------------------------------------- a lane */

export function RemoveLaneControl({
  engagementId,
  laneId,
  laneName,
  cardCount,
  disabled = false,
  onRemoved,
}: {
  engagementId: string;
  laneId: string;
  laneName: string;
  cardCount: number;
  disabled?: boolean;
  /** The board reports the outcome at its head, where the undo belongs. */
  onRemoved: (removal: LaneRemoval, laneName: string) => void;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const remove = useAction(agencyApi.removeLane);

  async function run(): Promise<void> {
    const r = await remove.run('Removed', laneId, engagementId);
    setAsking(false);
    if (r.ok) {
      onRemoved(r.data, laneName);
      router.refresh();
    }
  }

  const empty = cardCount === 0;

  return (
    <>
      <Button
        tone="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setAsking(true)}
        title={`Remove the ${laneName} lane`}
      >
        Remove
      </Button>

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={empty ? 'Delete this lane?' : 'Archive this lane?'}
        dismissible
        footer={
          <>
            <Button tone="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              tone="quiet"
              loading={remove.pending}
              loadingLabel={empty ? 'Deleting' : 'Archiving'}
              onClick={() => void run()}
            >
              {empty ? 'Delete it' : 'Archive it'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {empty ? (
            <p className="text-14 text-ink">
              “{laneName}” holds nothing, so there is nothing to keep and it is deleted outright.
            </p>
          ) : (
            <>
              {/*
                The card count is the headline, because hiding twelve
                deliverables with one press is the largest blast radius
                available to anybody in this product.
              */}
              <p className="text-14 text-ink">
                “{laneName}” and the{' '}
                <span className={cn(mono, 'font-semibold')}>
                  {plural(cardCount, 'deliverable', 'deliverables')}
                </span>{' '}
                standing in it leave both boards. Nothing is deleted.
              </p>
              <Plate
                layout="stack"
                label="What is kept"
                rows={[
                  { term: 'Deliverables', value: String(cardCount) },
                  { term: 'Versions', value: 'KEPT' },
                  { term: 'Approvals', value: 'KEPT' },
                ]}
              />
              <p className={cn('text-14', muted)}>
                Every version, approval and comment on those deliverables stays exactly where it is.
                Putting the lane back brings them all with it.
              </p>
            </>
          )}
        </div>
      </Dialog>

      {remove.failure && <ErrorPanel failure={remove.failure} />}
    </>
  );
}
