/**
 * PossessionBar — the signature element (DESIGN-SYSTEM.md).
 *
 * A 3px bar along a card's leading edge, filled in `--agency` or `--client`,
 * with a mono label giving elapsed time in that possession. At board level the
 * bars form a column of who is holding the work.
 *
 * Agency surface only. Possession is internal-only in v1 (PRD §9) and this file
 * lives under `components/agency/` so that importing it into the client bundle
 * is a visible mistake rather than an invisible one.
 */

import type { PossessionSplit } from '@/lib/types';
import { formatDuration, formatPossession } from '@/lib/format';
import {
  POSSESSION_CLOSED_FILL,
  POSSESSION_CLOSED_TEXT,
  POSSESSION_FILL,
  POSSESSION_TEXT,
  cn,
  mono,
} from '@/components/style-tokens';

/** The leading edge itself. Decorative: the label below carries the meaning. */
export function PossessionEdge({ possession }: { possession: PossessionSplit }) {
  const fill = possession.current ? POSSESSION_FILL[possession.current] : POSSESSION_CLOSED_FILL;
  return <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-bar', fill)} />;
}

/** `client · 6d`. Mono, because it is a record of who held the work. */
export function PossessionLabel({
  possession,
  className,
}: {
  possession: PossessionSplit;
  className?: string;
}) {
  const tone = possession.current
    ? POSSESSION_TEXT[possession.current]
    : POSSESSION_CLOSED_TEXT;
  const text = possession.current
    ? formatPossession(possession.current, possession.currentMs)
    : 'closed';
  return (
    <span className={cn(mono, 'text-12', tone, className)}>
      {text}
    </span>
  );
}

/**
 * Edge plus label as one block, for rows that are not cards — a portfolio row,
 * an engagement header. The split is spelled out in the title attribute rather
 * than on screen; the glance is the hue, the detail is on demand.
 */
export function PossessionBar({ possession }: { possession: PossessionSplit }) {
  const fill = possession.current ? POSSESSION_FILL[possession.current] : POSSESSION_CLOSED_FILL;
  const split = `agency ${formatDuration(possession.agencyMs)} · client ${formatDuration(
    possession.clientMs,
  )}`;
  return (
    <span className="inline-flex items-center gap-2" title={split}>
      <span aria-hidden="true" className={cn('block h-4 w-bar', fill)} />
      <PossessionLabel possession={possession} />
    </span>
  );
}
