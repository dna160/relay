'use client';

/**
 * ONE EVENT, ONE MOTION — rule R1 from `docs/design/MOTION.md` §3, as a hook.
 *
 * Every animation in Relay is triggered by a *change*, and the front-end's
 * whole job (MOTION.md §4c) is to make the right element **new** at the moment
 * the change lands so the CSS animation runs from zero. That needs exactly one
 * thing the server cannot supply: memory of what the value was a moment ago.
 *
 * Two rules fall straight out of that and are why this is a hook rather than a
 * `key` written at a call site:
 *
 * 1. **Nothing animates on first render.** `seq` starts at 0 and `kind` starts
 *    at `null`, on the server and on the client alike, so the server-rendered
 *    board and its hydration agree and no entrance animation exists. That is a
 *    line item in the restraint list (MOTION.md §5) and the reason the motion
 *    system costs the 1.5s FCP budget nothing at all.
 * 2. **When two facts change in the same update, only the most consequential
 *    one animates.** A card that transitions *and* gains a version gets the
 *    attach, not both. The caller states the priority order once, here, rather
 *    than each element deciding for itself and the reader's eye having to pick.
 *
 * The state is adjusted during render — the React-sanctioned "derive state from
 * props" pattern — rather than in an effect. In an effect the element would
 * paint once in its new resting position and only then be remounted to animate
 * from the start, which is a visible flash of the finished mark followed by the
 * mark being applied. During render there is no such frame: React discards the
 * output and re-renders before anything reaches the DOM.
 */

import { useState } from 'react';

/** A watched fact. Compared by identity, so keep it a primitive. */
export type Signal = string | number | boolean | null;

export interface OneEvent<K extends string> {
  /**
   * The single most consequential signal that changed in the last update, or
   * `null` if nothing has changed since this component mounted.
   */
  kind: K | null;
  /**
   * Increments once per observed event. Put it in a React `key` on the element
   * that carries the animation: a changed key remounts it, and a remount is
   * what makes a CSS animation run again.
   */
  seq: number;
}

/**
 * Watches an ordered list of `[name, value]` signals, **most consequential
 * first**, and reports the one that changed.
 *
 * ```tsx
 * const event = useOneEvent([
 *   ['possession', POSSESSION[card.state]],
 *   ['version', latestVersionId],
 *   ['round', card.roundsUsed],
 * ] as const);
 *
 * <span key={event.seq} className={event.kind === 'version' ? 'animate-stamp' : undefined}>
 * ```
 *
 * Note what the example does *not* do: it does not gate the key on the kind.
 * Every watched element is re-keyed by every event, and the ones that are not
 * the event's own element simply remount without an animation class. That is
 * R1 expressed as markup — the suppressed element is provably still, rather
 * than relying on a second condition somewhere else to hold it still.
 */
export function useOneEvent<K extends string>(
  signals: readonly (readonly [K, Signal])[],
): OneEvent<K> {
  const values = signals.map(([, value]) => value);

  const [seen, setSeen] = useState<{
    values: readonly Signal[];
    kind: K | null;
    seq: number;
  }>({ values, kind: null, seq: 0 });

  const changed = signals.find(([, value], i) => value !== seen.values[i]);
  if (changed) {
    setSeen({ values, kind: changed[0], seq: seen.seq + 1 });
  }

  return { kind: seen.kind, seq: seen.seq };
}
