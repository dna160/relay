'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';

/**
 * THE PRINTED COLOUR BAR — the possession bar as a mark, and the two layers
 * that make "printed over" literal.
 *
 * ## The defect this exists to fix
 *
 * `animate-bar-draw` runs `scale3d(1, 0, 1) -> scale3d(1, 1, 1)` after a
 * two-beat delay, with `both` fill. `both` includes `backwards`, so for those
 * two beats the element is held at the *from* state — `scaleY(0)`, which is no
 * bar at all. MOTION.md §4c then told the front-end to change the element's
 * `key` so React remounts it, which destroys the outgoing bar in the same
 * frame. Net effect on the product's signature element, during the product's
 * signature event: the leading edge of the card was blank for 120ms.
 *
 * MOTION.md §4b is explicit that this is not what happens — "the new bar is
 * being *printed down over* the old one, top to bottom, like a second pass of
 * ink"; "a fade says 'this value was replaced', a wipe says 'this mark was
 * applied'". A wipe over nothing is neither. It is a blink, and a blink on the
 * one element that says who is holding the work reads as the answer being
 * momentarily unknown.
 *
 * ## The fix
 *
 * Two layers. The under-layer keeps the OUTGOING hue and does not move; the
 * over-layer carries the incoming hue and draws down over it. During the strike
 * the card still shows the old possession — which is true, because possession
 * has not landed yet — and on the beat the label seats, the new ink starts
 * covering it. That is the physical action the spec describes, and it is why
 * the animation is a `scaleY` rather than an `opacity` in the first place.
 *
 * The outgoing hue has to be remembered by something, and CSS cannot remember.
 * That is the whole reason this is a primitive rather than two class names: the
 * memory belongs with the mark, not at every call site that draws one.
 *
 * ## What it does NOT do
 *
 * It does not animate on first mount. A board that server-renders forty cards
 * has forty bars that were always there; there is no outgoing hue, so there is
 * no under-layer and no animation class in the markup at all. MOTION.md §5
 * ("the initial board render") and §8 Claim 1 — and, unlike the prose, this is
 * visible in the bytes the server sends.
 *
 * It adds no keyframe. `bar-draw` is the same sanctioned animation on the same
 * element role; the under-layer is static paint.
 *
 * Under `prefers-reduced-motion: reduce` the beat is 0ms, the over-layer is
 * full height immediately, and the under-layer is covered before it is ever
 * seen. The reduced-motion answer is unchanged: the mark is already applied.
 */
export interface ColourBarProps {
  /**
   * The fill utility for the current possession — `bg-agency`, `bg-client`, or
   * the closed/unheld fill. A class rather than a tone because the possession
   * vocabulary and its closed case live in `style-tokens.ts`, above this layer;
   * the primitive's job is the two layers and the memory, not the palette.
   */
  fill: string;
  /**
   * Geometry, from the call site: `absolute inset-y-0 left-0 w-bar` on a card,
   * `block h-4 w-bar` in a row. The bar has no size of its own.
   */
  className?: string;
}

/**
 * Longer than the longest animation this can run (three beats plus a two-beat
 * delay = 300ms), so the covered layer is never removed while ink is still
 * being laid over it. A constant rather than a token read: it is a cleanup
 * deadline, not a duration anyone perceives, and it is correct at every beat
 * value including zero.
 */
const COVERED_MS = 400;

interface Printed {
  /** The hue currently being laid down. */
  fill: string;
  /** The hue underneath it, or null when nothing is being covered. */
  under: string | null;
  /** Changes on every pass of ink, so React remounts the over-layer. */
  seq: number;
}

export function ColourBar({ fill, className }: ColourBarProps): React.JSX.Element {
  const [printed, setPrinted] = useState<Printed>({ fill, under: null, seq: 0 });
  const previous = useRef(fill);

  if (printed.fill !== fill) {
    // Adjusted during render, not in an effect: React re-runs this component
    // before the browser paints, so the new layer mounts already carrying its
    // animation class. An effect would paint the finished bar for one frame
    // and only then collapse it to draw.
    setPrinted({ fill, under: previous.current, seq: printed.seq + 1 });
  }

  useEffect(() => {
    previous.current = fill;
  }, [fill]);

  const { under, seq } = printed;

  useEffect(() => {
    if (under === null) return;
    const t = window.setTimeout(
      () => setPrinted((p) => (p.seq === seq ? { ...p, under: null } : p)),
      COVERED_MS,
    );
    return () => window.clearTimeout(t);
  }, [under, seq]);

  return (
    <span
      // The bar is a hue. `PossessionLabel` beside it carries the meaning in
      // words, which is why colour is never the only channel here.
      aria-hidden="true"
      // `.colour-bar` sits on the wrapper so its knockout notch is painted over
      // both layers rather than under the one being drawn.
      className={cn('colour-bar relative block', className)}
    >
      {under === null ? null : (
        <span className={cn('absolute inset-0', under)} />
      )}
      <span
        key={seq}
        className={cn(
          'absolute inset-0',
          fill,
          under !== null && 'animate-bar-draw origin-head',
        )}
      />
    </span>
  );
}
