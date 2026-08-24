'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * The state chip. When a card transitions, the outgoing label fades out while
 * the incoming label fades in over `--dur-chip` (120ms). Under
 * `prefers-reduced-motion: reduce` the token is 0ms, so the swap is instant —
 * the motion is removed by the token, not by a second code path.
 *
 * Tone is the possession hue, not an urgency colour. `breach` is only ever
 * passed for a breached commitment.
 *
 * The quiet variant carries the hue in its tint and its 2px leading rule, and
 * sets the label in `--ink` (13.3:1 light, 11.3:1 dark). The solid variant
 * fills with the hue and sets the label in `--on-hue`. Neither asks a reader to
 * resolve coloured text against a coloured ground.
 */
export type ChipTone = 'agency' | 'client' | 'breach' | 'neutral';
export type ChipVariant = 'quiet' | 'solid';

export interface ChipProps {
  tone?: ChipTone;
  variant?: ChipVariant;
  /**
   * The label. Changing it triggers the crossfade, so pass the rendered state
   * name rather than a wrapper element that changes identity every render.
   */
  children: ReactNode;
  /**
   * Stable identity for the current label. Defaults to `String(children)`.
   * Pass the card state when the visible label is translated or abbreviated.
   */
  transitionKey?: string;
  /** Prefix read by assistive tech, e.g. "State". */
  label?: string;
  className?: string;
}

const QUIET: Record<ChipTone, string> = {
  agency: 'bg-tint-agency text-ink border-l-agency',
  client: 'bg-tint-client text-ink border-l-client',
  breach: 'bg-tint-breach text-ink border-l-breach',
  neutral: 'bg-paper-2 text-ink border-l-rule-strong',
};

const SOLID: Record<ChipTone, string> = {
  agency: 'bg-agency text-on-hue border-l-agency',
  client: 'bg-client text-on-hue border-l-client',
  breach: 'bg-breach text-on-hue border-l-breach',
  neutral: 'bg-ink text-paper border-l-ink',
};

export function Chip({
  tone = 'neutral',
  variant = 'quiet',
  children,
  transitionKey,
  label,
  className,
}: ChipProps): React.JSX.Element {
  const key = transitionKey ?? String(children);
  const [outgoing, setOutgoing] = useState<{
    key: string;
    node: ReactNode;
  } | null>(null);
  const previous = useRef<{ key: string; node: ReactNode }>({
    key,
    node: children,
  });

  useEffect(() => {
    if (previous.current.key === key) {
      previous.current = { key, node: children };
      return;
    }
    const leaving = previous.current;
    previous.current = { key, node: children };
    setOutgoing(leaving);
    const t = window.setTimeout(() => setOutgoing(null), 160);
    return () => window.clearTimeout(t);
  }, [key, children]);

  return (
    <span
      // `status` announces the new value when the card transitions under the
      // reader without stealing focus. Cards render many chips, so it is polite.
      role="status"
      className={cn(
        'relative inline-grid place-items-center align-middle',
        'h-5 px-1.5 border-l-bar rounded-sm',
        'font-sans text-12 font-medium leading-none whitespace-nowrap',
        variant === 'solid' ? SOLID[tone] : QUIET[tone],
        className,
      )}
    >
      {label ? <span className="sr-only">{label}: </span> : null}
      <span key={key} className="col-start-1 row-start-1 animate-chip-in">
        {children}
      </span>
      {outgoing ? (
        <span
          key={outgoing.key}
          aria-hidden="true"
          className="col-start-1 row-start-1 animate-chip-out"
        >
          {outgoing.node}
        </span>
      ) : null}
    </span>
  );
}
