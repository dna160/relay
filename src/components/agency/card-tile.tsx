/**
 * CardTile — title, state chip, version pip, rounds, due date, possession.
 *
 * Presentational and hook-free, so a board that drags can wrap it in a
 * draggable element and a page that only reads can render it on the server.
 * It never receives a drag handler itself: reordering is the board's job and
 * a tile that knew how to move itself would be a tile that could be taught to
 * change state.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { AgencyCard } from '@/lib/types';
import { formatDue, formatRounds, roundsBreached, shortHash, versionPip } from '@/lib/format';
import { breach, chip, cn, crossfade, mono, muted } from '@/components/style-tokens';
import { PossessionEdge, PossessionLabel } from './possession-bar';
import { StateChip } from './state-chip';

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
  const latestSha = card.versions.find((v) => v.versionNo === latest)?.sha256 ?? null;
  const breached = roundsBreached(card.roundsUsed, card.contractedRounds);
  const isPrivate = card.visibilityOverride === 'private';

  const title = href ? (
    <Link href={href} className={cn('block hover:underline')}>
      {card.title}
    </Link>
  ) : (
    card.title
  );

  return (
    <article
      data-card-id={card.id}
      className={cn(
        'group relative bg-paper-2 border border-rule pl-3 pr-2 py-2',
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
        <StateChip state={card.state} />
        {latest !== null && (
          <span className={cn(mono, 'text-12', muted)} title={latestSha ?? undefined}>
            {versionPip(latest)}
            {latestSha ? ` · ${shortHash(latestSha)}` : ''}
          </span>
        )}
        <span
          className={cn(mono, 'text-12', breached ? breach : muted)}
          title={
            breached
              ? `Round ${card.roundsUsed} of a ${card.contractedRounds}-round agreement`
              : 'Revision rounds used against contracted'
          }
        >
          {formatRounds(card.roundsUsed, card.contractedRounds)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <PossessionLabel possession={card.possession} state={card.state} />
        {due && (
          <span
            className={cn(mono, 'text-12', muted, due.overdue && 'font-semibold text-ink')}
            title={`Due ${due.date}`}
          >
            {due.date} · {due.countdown}
          </span>
        )}
      </div>

      {controls && (
        /*
          `crossfade`, not a hand-rolled `transition-opacity` with a call-site
          `motion-reduce:transition-none`.

          Reduced motion is honoured **at the token** in this product:
          `duration-chip` resolves to `var(--dur-chip)`, and globals.css sets
          `--dur-chip: 0ms` under `prefers-reduced-motion`, so one assertion on
          one custom property covers every transition in the codebase. A
          call-site `motion-reduce:` is a second mechanism for the same rule —
          it happened to be correct here, and the next component to copy the
          pattern is the one that forgets it, with nothing failing to say so.
          The token cannot be forgotten.
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
