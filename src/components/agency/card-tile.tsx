'use client';

/**
 * CardTile — a deliverable, drawn as the thing it actually is: a label.
 *
 * ## The label treatment (LABEL-SYSTEM.md §3a, §5)
 *
 * `.dieline` puts the die's cut line 2px inside the trimmed edge the card
 * already had. One pseudo-element, and it is the highest-value mark in the
 * round: it turns a rectangle into an object that was cut out of something,
 * which is the whole perceptual difference between a UI card and a label. The
 * operable boundary is still the solid outer hairline, so WCAG 1.4.11 does not
 * move — the dieline is decoration drawn in `--rule` because it is decoration.
 *
 * The `Plate` is the batch/serial block: card id, version, sha prefix, rounds,
 * set at spec-label density on a recessed `--paper` ground. **Nothing on it is
 * new information.** It is a layout for four facts this tile already published
 * one at a time, moved to the place a reader looks for a serial number. No
 * `Barcode` here and there must not be one — an 8-character prefix is ~50
 * subpaths, cheap once per document and indefensible forty times on a board
 * (LABEL-SYSTEM.md §3b).
 *
 * ## The motion (MOTION.md §3, COMPONENTS.md §14)
 *
 * This file is `'use client'` for one reason: **rule R1 — one event, one
 * motion.** Knowing which fact changed needs memory of what the facts were,
 * and the server has none. `useOneEvent` watches the three that can change
 * under a reader and reports only the most consequential:
 *
 *   possession changed → the chip is struck and seated, the bar is redrawn in
 *                        the new hue, and **nothing else on the card moves**
 *   a version landed   → the version pip is stamped
 *   a round was spent  → the rounds counter is stamped
 *
 * A card that transitions *and* gains a version gets the attach, not both. That
 * is not a nicety: if a reader's eye has to choose where to look, the motion
 * has failed at the thing it was for.
 *
 * The chip and the bar arbitrate their own possession signal (see
 * `state-chip.tsx` and `possession-bar.tsx`); this file arbitrates the two
 * marks that must yield to them.
 *
 * Nothing fires on first render. The board's server-rendered first paint is
 * still, which is a line item in the restraint list and the reason this system
 * costs the FCP budget nothing.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { POSSESSION } from '@/domain/card/state-machine';
import type { AgencyCard } from '@/lib/types';
import { formatDue, formatRounds, roundsBreached, shortHash, versionPip } from '@/lib/format';
import { useOneEvent } from '@/lib/hooks/use-one-event';
import { Badge, Plate, type PlateRow } from '@/components/primitives';
import { chip, cn, crossfade, mono, muted } from '@/components/style-tokens';
import { PossessionEdge, PossessionLabel } from './possession-bar';
import { StateChip } from './state-chip';
import { personLabel } from './vocabulary';

export interface CardTileProps {
  card: AgencyCard;
  href?: string;
  /** Move controls, supplied by the board. Revealed on hover and on focus. */
  controls?: ReactNode;
  dragging?: boolean;
}

export function CardTile({ card, href, controls, dragging }: CardTileProps) {
  const due = formatDue(card.dueAt);
  const latest = card.versions.reduce<number | null>(
    (max, v) => (max === null || v.versionNo > max ? v.versionNo : max),
    null,
  );
  const latestVersion = card.versions.find((v) => v.versionNo === latest) ?? null;
  const latestSha = latestVersion?.sha256 ?? null;
  const breached = roundsBreached(card.roundsUsed, card.contractedRounds);
  const isPrivate = card.visibilityOverride === 'private';

  /**
   * R1, in priority order. Possession outranks everything, because it is the
   * event the whole product is about; a version outranks a round, because a
   * round is consumed *by* a decision on a version and the file is the artifact.
   */
  const event = useOneEvent([
    ['possession', POSSESSION[card.state]],
    ['version', latestVersion?.id ?? null],
    ['round', card.roundsUsed],
  ] as const);

  /**
   * **`--breach` appearing gets no motion.** MOTION.md §5, and it is one of the
   * two entries that prove the restraint list is real. The rounds counter
   * crossing the contract is the most consequential state on this card and it
   * is stated in colour and in the number, never dramatised — a stamped red
   * counter would read as an alarm, and consequence in this product is stated,
   * not sprung. So the stamp is suppressed for the whole time the counter is
   * red, not merely on the frame it turns red: a mark that landed on 4/2 and
   * not on 3/2 would be the same alarm one round later.
   */
  const stampRounds = event.kind === 'round' && !breached;

  const title = href ? (
    <Link href={href} className={cn('block hover:underline')}>
      {card.title}
    </Link>
  ) : (
    card.title
  );

  /**
   * The plate's rows. `title` carries the unabbreviated value behind every
   * truncation, which is what makes an abbreviated hash on a card citable
   * rather than decorative.
   */
  const rows: PlateRow[] = [
    { term: 'Card', value: shortHash(card.id, 8), title: card.id },
    {
      term: 'Version',
      value: (
        <span
          key={event.seq}
          className={cn(event.kind === 'version' && 'animate-stamp', 'inline-block')}
        >
          {latest === null ? '—' : versionPip(latest)}
        </span>
      ),
    },
    { term: 'Sha', value: latestSha ? shortHash(latestSha) : '—', title: latestSha ?? undefined },
    {
      term: 'Rounds',
      tone: breached ? 'breach' : 'ink',
      title: breached
        ? `Round ${card.roundsUsed} of a ${card.contractedRounds}-round agreement`
        : 'Revision rounds used against contracted',
      value: (
        <span key={event.seq} className={cn(stampRounds && 'animate-stamp', 'inline-block')}>
          {formatRounds(card.roundsUsed, card.contractedRounds)}
        </span>
      ),
    },
  ];

  return (
    <article
      data-card-id={card.id}
      className={cn(
        'dieline group relative bg-paper-2 border border-rule pl-3 pr-2 py-2',
        dragging && 'opacity-50',
      )}
    >
      {/* `state` is the fallback holder for a card that has not moved yet:
          the clock has opened no interval, but the board still knows whose
          move it is. See `possession-bar.tsx`. */}
      <PossessionEdge possession={card.possession} state={card.state} />

      <div className="flex items-start justify-between gap-2">
        <h3 className="text-14 leading-snug text-ink">{title}</h3>
        {isPrivate && (
          <span className={cn(chip, 'shrink-0')} title="Hidden from the client">
            PRIVATE
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {/*
          No ground override any more. This carried `bg-paper` because a quiet
          neutral `Chip` was painted `--paper-2`, which is a card's own ground,
          so the chip had no boundary at all and every call site on a card had
          to reach past the primitive to give it one. `--tint-neutral` closed
          that (UI/UX, this round): the chip now brings a ground that works on
          `--paper` and `--paper-2` alike, and the override would paint over the
          fix on the surface that has forty of these on it.
        */}
        <StateChip state={card.state} />
        {due && (
          <span
            className={cn(mono, 'text-12', muted, due.overdue && 'font-semibold text-ink')}
            title={`Due ${due.date}`}
          >
            {due.date} · {due.countdown}
          </span>
        )}
      </div>

      <Plate className="mt-2" label={`Record for ${card.title}`} rows={rows} />

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <PossessionLabel possession={card.possession} state={card.state} />
        {/*
          The weighting here is inverted from the usual, on purpose.

          On a board whose home screen buckets by *who is blocked*, the missing
          name is the more consequential fact — an unassigned card is the one
          that will rot into `NO MOVEMENT IN 7 DAYS` without ever reaching
          anybody's `BLOCKED ON YOU`. So the absence gets the stamp and the
          presence stays quiet: an assigned card is normal, and normal is not
          marked.

          A name is prose, so it is not `Mono` — and it is not an avatar either.
          This product has no images and no illustrations anywhere, and an
          avatar on a card tile would be the first one.

          `tone="neutral"`: no hue, and never `--breach`. An unassigned card is
          not a breached commitment — `--breach` stays exhaustively
          `roundsUsed > contractedRounds`. `PossessionBar` beside it is
          untouched for the same reason: possession is a *side*, assignment is a
          *person*, and they are different axes.
        */}
        {card.assignee ? (
          /*
            `personLabel`, not `card.assignee.name` directly. The projection
            already falls back from a null name to the address, and the value
            that arrives here is the empty string when it had neither — which is
            precisely the state of a colleague who was invited by address and
            has not yet set a name. Rendering it raw put a blank gap on the
            first card a new member was ever assigned. See `vocabulary.ts`.
          */
          <span
            className="min-w-0 truncate font-sans text-12 text-muted"
            title={personLabel(card.assignee)}
          >
            {personLabel(card.assignee)}
          </span>
        ) : (
          <Badge tone="neutral">UNASSIGNED</Badge>
        )}
      </div>

      {controls && (
        /*
          `crossfade`, not a hand-rolled `transition-opacity` with a call-site
          `motion-reduce:transition-none`.

          Reduced motion is honoured **at the token** in this product:
          `duration-chip` resolves to `var(--time-chip)`, which is two beats of
          `--dur-beat`, and globals.css sets `--dur-beat: 0ms` under
          `prefers-reduced-motion` — so one declaration silences every duration
          in the codebase, arithmetically. The `motion-reduce:` variant this
          used to carry was a second mechanism for the same rule. It happened to
          be correct here, and the next component to copy the pattern is the one
          that forgets it, with nothing failing to say so. The token cannot be
          forgotten, so the variant is gone.
        */
        <div
          className={cn(
            'mt-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            crossfade,
          )}
        >
          {controls}
        </div>
      )}
    </article>
  );
}
