import type { ElementType, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Marks a value as a *record*.
 *
 * The rule from DESIGN-SYSTEM.md, restated so it is not lost: if a value could
 * be cited in a dispute, it is set in mono. Version numbers, sha256 prefixes,
 * file sizes, decision timestamps, possession durations, purge countdowns, card
 * ids. Prose is never mono. A button label is never mono.
 *
 * `title` should carry the unabbreviated value whenever the visible text is
 * truncated — the full hash behind `3a91f2…`, the full ISO timestamp behind
 * `14:22`. `label` gives assistive tech a name for the number.
 */
export interface MonoProps {
  children: ReactNode;
  /** Defaults to `<span>`. Use `<time>` for timestamps, `<data>` for hashes. */
  as?: ElementType;
  /** Full value behind a truncated one. Rendered as a tooltip and a title attr. */
  title?: string;
  /** Screen-reader prefix, e.g. "Version" or "Time remaining". */
  label?: string;
  /** `breach` only for a breached commitment. Never for "soon". */
  tone?: 'ink' | 'muted' | 'agency' | 'client' | 'breach';
  /** Bumps to 14px. Default is 12px, the scale's utility step. */
  size?: '12' | '14';
  className?: string;
  dateTime?: string;
  value?: string;
}

const TONE = {
  ink: 'text-ink',
  muted: 'text-muted',
  agency: 'text-agency',
  client: 'text-client',
  breach: 'text-breach',
} as const;

export function Mono({
  children,
  as,
  title,
  label,
  tone = 'ink',
  size = '12',
  className,
  ...rest
}: MonoProps): React.JSX.Element {
  const Tag: ElementType = as ?? 'span';
  return (
    <Tag
      data-record="true"
      title={title}
      className={cn(
        'font-mono tracking-mono tabular-nums',
        size === '14' ? 'text-14' : 'text-12',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {label ? <span className="sr-only">{label}: </span> : null}
      {children}
    </Tag>
  );
}
