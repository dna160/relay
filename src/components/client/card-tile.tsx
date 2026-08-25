/**
 * The client's card tile.
 *
 * Not the agency tile with a flag: a different component over a different type.
 * `ClientCard` has no `possession`, no `assignee`, no `internalNotes` and no
 * `effortEstimate` — the absence is structural (INV-1), so there is no leading
 * possession bar here and no way to add one without changing the contract.
 *
 * Rounds are shown because the client is a party to the contracted number and
 * has as much interest in round four of a two-round agreement as the agency
 * does. `--breach` still means only that: exceeded, not "due soon".
 *
 * ## Two marks, and deliberately nothing else
 *
 * LABEL-SYSTEM.md §5: the client board gets `.dieline` and `.colour-bar` and
 * **no plate, no barcode, and nothing that costs first paint.** This is the
 * acquisition surface with a 1.5s-on-4G budget, and both marks are one
 * pseudo-element of pure paint on a component that stays a server component —
 * they cost bytes in a stylesheet that was already being fetched and no
 * JavaScript at all.
 *
 * There is no label-attach here either, and that is a decision rather than an
 * omission. The attach fires on possession changing hands, and `possession` is
 * agency-only by construction (INV-1, PRD §9) — `ClientCard` cannot express it.
 * `awaitingYou` is the client-side shadow of the same fact, but animating it
 * would mean a `'use client'` boundary per card on the one surface in the
 * product with a paint budget, to dramatise a fact the hue and the `YOUR MOVE`
 * chip already state plainly. The budget wins; MOTION.md §8 claim 1 is what is
 * being protected.
 */

import Link from 'next/link';
import type { ClientCard } from '@/lib/types';
import { formatDue, formatRounds, roundsBreached, shortHash, versionPip } from '@/lib/format';
import { breach, chip, cn, mono, muted } from '@/components/style-tokens';
import { StateChip } from './state-chip';

export function CardTile({ card, href }: { card: ClientCard; href: string }) {
  const due = formatDue(card.dueAt);
  const latest = card.versions[0] ?? null;
  const breached = roundsBreached(card.roundsUsed, card.contractedRounds);

  return (
    <article
      data-card-id={card.id}
      className={cn(
        'dieline relative bg-paper-2 border border-hairline border-rule px-3 py-2',
        card.awaitingYou && 'border-rule-strong',
      )}
    >
      {/* The one place this surface uses the client hue: the card is your move. */}
      {card.awaitingYou && (
        <span
          aria-hidden="true"
          className="colour-bar absolute inset-y-0 left-0 w-bar bg-client"
        />
      )}

      <h3 className="text-14 leading-snug text-ink">
        <Link href={href} className="block hover:underline">
          {card.title}
        </Link>
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StateChip state={card.state} />
        {card.awaitingYou && <span className={cn(chip, 'border-client text-client')}>YOUR MOVE</span>}
        {latest && (
          <span className={cn(mono, 'text-12', muted)} title={latest.sha256}>
            {versionPip(latest.versionNo)} · {shortHash(latest.sha256)}
          </span>
        )}
        <span
          className={cn(mono, 'text-12', breached ? breach : muted)}
          title="Revision rounds used against contracted"
        >
          {formatRounds(card.roundsUsed, card.contractedRounds)}
        </span>
      </div>

      {due && (
        <p
          className={cn(mono, 'mt-2 text-12', muted, due.overdue && 'font-semibold text-ink')}
        >
          {due.date} · {due.countdown}
        </p>
      )}
    </article>
  );
}
