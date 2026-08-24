import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * A static marker on a thing, not a state of a thing. `PRIVATE` on a lane
 * header, `TEMPLATE` on an engagement, `RETAINED` on a plan row.
 *
 * A Badge never animates and never changes under the reader — that is what
 * `Chip` is for. If the value can transition, it is a Chip.
 *
 * Set in the display face, uppercase, tracking +0.08em: the same treatment as
 * a lane header one step down, so a badge reads as a stamp on the document
 * rather than as a piece of UI chrome.
 */
export type BadgeTone = 'neutral' | 'agency' | 'client' | 'breach';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Screen-reader expansion, e.g. "Private lane, not visible to the client". */
  label?: string;
  className?: string;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'text-muted border-rule-strong bg-transparent',
  agency: 'text-ink border-agency bg-tint-agency',
  client: 'text-ink border-client bg-tint-client',
  breach: 'text-ink border-breach bg-tint-breach',
};

export function Badge({
  children,
  tone = 'neutral',
  label,
  className,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center h-4 px-1 rounded-sm border-hairline',
        'font-display text-eyebrow uppercase whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      <span aria-hidden={label ? true : undefined}>{children}</span>
    </span>
  );
}
