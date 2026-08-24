'use client';

/**
 * The card's state chip, and the only animation in the product: a 120ms
 * crossfade when the state changes underneath a board that is already on
 * screen. `prefers-reduced-motion` swaps the label instantly instead.
 *
 * The chip carries no hue. Hue encodes possession; a state chip that also
 * carried colour would put two meanings on one channel.
 */

import { useEffect, useRef, useState } from 'react';
import type { CardState } from '@/lib/types';
import { stateLabel } from './vocabulary';
import { chip, crossfade, cn } from '@/components/style-tokens';

const FADE_MS = 120;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function StateChip({ state, className }: { state: CardState; className?: string }) {
  const [shown, setShown] = useState<CardState>(state);
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state === shown) return;
    if (prefersReducedMotion()) {
      setShown(state);
      return;
    }
    setVisible(false);
    timer.current = setTimeout(() => {
      setShown(state);
      setVisible(true);
    }, FADE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, shown]);

  return (
    <span
      className={cn(chip, crossfade, visible ? 'opacity-100' : 'opacity-0', className)}
      data-state={shown}
    >
      {stateLabel(shown)}
    </span>
  );
}
