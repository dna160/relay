'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * The state chip. When a card transitions, the outgoing label fades out while
 * the incoming label fades in over `--time-chip` — two beats, still 120ms,
 * byte-for-byte the animation that shipped in round 1. Under
 * `prefers-reduced-motion: reduce` the beat is 0ms, so the swap is instant —
 * the motion is removed by the token, not by a second code path.
 *
 * `attach` promotes that crossfade to the signature moment. When the label
 * changing IS possession changing hands, the incoming label is struck and
 * seated instead of faded: it arrives from `--dist-strike` off its seat,
 * over-scaled and off-square, overshoots `--dist-seat` and settles back
 * against the stop. Five beats. It is the product's central event and it is
 * the one place in the interface that behaves like something being applied.
 *
 * Use `attach` for a possession change and for nothing else. A state chip
 * whose label changes without the ball moving — a version pip, a private
 * marker — takes the crossfade. The full argument is docs/design/MOTION.md §4.
 *
 * Tone is the possession hue, not an urgency colour. `breach` is only ever
 * passed for a breached commitment.
 *
 * The quiet variant carries the hue in its tint and its 2px leading rule, and
 * sets the label in `--ink` (13.3:1 light, 11.3:1 dark). The solid variant
 * fills with the hue and sets the label in `--on-hue`. Neither asks a reader to
 * resolve coloured text against a coloured ground.
 *
 * NEUTRAL HAS A TINT OF ITS OWN, and that is the fix for a real defect: it
 * used to be painted `--paper-2`, which IS a card's ground, so a neutral chip
 * on a card had no boundary at all and `CardTile` had to override the
 * primitive with `bg-paper` to get one back. `--tint-neutral` is the same 12%
 * construction as the other three, mixed from `--ink`, so the chip keeps a
 * ground on `--paper` and on `--paper-2` alike and no call site has to know
 * which one it is standing on. A `ground` prop was the obvious alternative and
 * was rejected: it is a call-site opt-in, the same shape as a `motion-reduce:`
 * variant, and the next call site forgets it.
 *
 * NOTHING HERE ANIMATES ON FIRST MOUNT. `animate-chip-in` used to sit on the
 * current label unconditionally, so every state chip on a server-rendered
 * board faded in during the initial paint — which MOTION.md §5 forbids by name
 * and §8 Claim 1 rests the FCP argument on. There is no prop to suppress it,
 * because a prop would be the same call-site opt-in and the same forgetting.
 * Instead the entrance is *earned*: a label animates when it is replacing
 * another label, and on first mount there is nothing to replace.
 *
 * The mechanism is a state adjustment during render rather than an effect, and
 * that detail is load-bearing. An effect runs after the commit, so the new
 * label would paint once at rest and only then jump back to opacity 0 — a
 * visible flash. Adjusting state during render makes React re-run this
 * component before the browser paints, so the incoming label mounts already
 * carrying its animation class.
 */
/** A label and the identity that decides whether it replaced another one. */
interface Label {
  key: string;
  node: ReactNode;
}

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
  /**
   * Possession is changing hands. Promotes the incoming label's crossfade to
   * the label-attach. Never true for a change that is not a possession change.
   */
  attach?: boolean;
  className?: string;
}

const QUIET: Record<ChipTone, string> = {
  agency: 'bg-tint-agency text-ink border-l-agency',
  client: 'bg-tint-client text-ink border-l-client',
  breach: 'bg-tint-breach text-ink border-l-breach',
  neutral: 'bg-tint-neutral text-ink border-l-rule-strong',
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
  attach = false,
  className,
}: ChipProps): React.JSX.Element {
  const key = transitionKey ?? String(children);

  /**
   * `replacing` is false for the label this chip was born with and true for
   * every label that arrives afterwards. It is the entrance gate, and it is
   * state rather than a ref so that it survives the re-render the adjustment
   * below triggers.
   */
  const [shown, setShown] = useState<{ key: string; replacing: boolean }>({
    key,
    replacing: false,
  });
  const [outgoing, setOutgoing] = useState<Label | null>(null);
  /** The label as of the last commit — what a new label would be replacing. */
  const previous = useRef<Label>({ key, node: children });

  if (shown.key !== key) {
    // Adjusting state during render. React discards this pass and re-runs the
    // component immediately, before the browser paints, so the incoming label
    // mounts with its animation class already on it. Doing this in an effect
    // would be one frame late and the label would flash at rest first.
    setOutgoing(previous.current);
    setShown({ key, replacing: true });
  }

  useEffect(() => {
    previous.current = { key, node: children };
  });

  useEffect(() => {
    if (outgoing === null) return;
    // Longer than the longest incoming animation (five beats = 300ms) so the
    // outgoing label is never removed while the incoming one is still moving.
    // A constant rather than a token read: this is a cleanup deadline, not a
    // duration a reader perceives, and it is correct at every beat value.
    const t = window.setTimeout(() => setOutgoing(null), 400);
    return () => window.clearTimeout(t);
  }, [outgoing]);

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
      <span
        key={key}
        className={cn(
          'col-start-1 row-start-1',
          // No entrance on first mount: a label animates only when it is
          // replacing one. MOTION.md §5, "the initial board render".
          shown.replacing && (attach ? 'animate-label-attach' : 'animate-chip-in'),
        )}
      >
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
