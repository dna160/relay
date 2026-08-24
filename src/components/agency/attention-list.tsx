/**
 * AttentionList — the portfolio home's answer to "what is blocked, and on whom?"
 *
 * Grouped by actionability and ranked by it: blocked on you, blocked on your
 * team, with the client, no movement in 7 days. Deadline proximity is one input
 * to the ordering *within* a group and never the grouping itself (PRD §5.5).
 * A list sorted by due date tells you what is nearest. This one tells you what
 * you can actually do something about.
 *
 * Colour still encodes possession. The only red on this screen is a round count
 * that has exceeded its contract.
 */

import Link from 'next/link';
import type { AttentionBucket, AttentionItem } from '@/lib/types';
import { formatDue, formatDuration, plural } from '@/lib/format';
import { BUCKET_ORDER, bucketLabel } from './vocabulary';
import {
  POSSESSION_TEXT,
  breach,
  cn,
  eyebrow,
  mono,
  muted,
} from '@/components/style-tokens';
import { EmptyState } from './empty-state';

/** Which side is holding a card in each bucket. Drives the row's hue. */
const BUCKET_POSSESSION: Record<AttentionBucket, 'agency' | 'client'> = {
  blocked_on_you: 'agency',
  blocked_on_your_team: 'agency',
  with_the_client: 'client',
  no_movement_7d: 'agency',
};

function byPressure(a: AttentionItem, b: AttentionItem): number {
  // Longest held first — the thing that has been sitting is the thing that is
  // rotting. Due date breaks ties rather than leading.
  if (b.possessionMs !== a.possessionMs) return b.possessionMs - a.possessionMs;
  const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  return ad - bd;
}

function Row({ item }: { item: AttentionItem }) {
  const due = formatDue(item.dueAt);
  const side = BUCKET_POSSESSION[item.bucket];
  return (
    <li className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-2 pl-3 last:border-b-0">
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-bar', side === 'agency' ? 'bg-agency' : 'bg-client')} />
      <Link
        href={`/w/${item.engagementId}/board?card=${item.cardId}`}
        className={cn('text-14 text-ink hover:underline')}
      >
        {item.cardTitle}
      </Link>
      <span className={cn('min-w-0 flex-1 truncate text-12', muted)}>{item.engagementTitle}</span>
      <span className={cn(mono, 'text-12', POSSESSION_TEXT[side])}>
        {formatDuration(item.possessionMs)}
      </span>
      {due && (
        <span className={cn(mono, 'text-12', muted, due.overdue && 'font-semibold text-ink')}>
          {due.countdown}
        </span>
      )}
      {item.roundsBreached && (
        <span className={cn(mono, 'text-12', breach)} title="Revision rounds exceeded the contract">
          ROUNDS EXCEEDED
        </span>
      )}
    </li>
  );
}

export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState instruction="Nothing is waiting on anyone. Publish a deliverable to move something forward." />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {BUCKET_ORDER.map((bucket) => {
        const group = items.filter((i) => i.bucket === bucket).sort(byPressure);
        if (group.length === 0) return null;
        return (
          <section key={bucket} aria-label={bucketLabel(bucket)}>
            <div className="flex items-baseline justify-between gap-2 border-b border-ink pb-1">
              <h3 className={eyebrow}>{bucketLabel(bucket)}</h3>
              <span className={cn(mono, 'text-12', muted)}>{plural(group.length, 'card', 'cards')}</span>
            </div>
            <ul>
              {group.map((item) => (
                <Row key={item.cardId} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
