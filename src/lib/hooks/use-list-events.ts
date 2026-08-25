'use client';

/**
 * PER-ROW CHANGE DETECTION FOR A LIST — MOTION.md §3 rule R2.
 *
 * Two questions a list has to answer before it may animate anything, and
 * neither is answerable from the server: which rows are **new**, and which
 * already-present rows had a **fact change on them**. `useOneEvent` answers the
 * same question for a single element; these answer it for a collection.
 */

import { useState } from 'react';

/** A watched fact on a row. Compared by identity, so keep it a primitive. */
export type RowSignal = string | number | boolean | null;

/**
 * Which rows a list **gained** in this update — MOTION.md §3 rule R2.
 *
 * "Stagger is for lists, not for events." A single event never staggers; a list
 * that gains items at once does, by half a beat per item and capped at six so a
 * long lane finishes in 180ms of stagger rather than 1.2 seconds of wave.
 *
 * The distinction this hook exists to draw is the one the spec is emphatic
 * about: **rows gained by an update, not rows merely present.** A list that
 * seated every row it rendered would be an entrance animation on first paint,
 * which is a line item in the restraint list and the one thing in this system
 * that would actually cost the 1.5s FCP budget. So everything present at mount
 * is already known, and known rows never animate again.
 *
 * State is adjusted during render rather than in an effect, for the same reason
 * `useOneEvent` does it: an effect would let the new row paint in its resting
 * position for a frame before being told to arrive.
 */

export interface GainedRows {
  /** True for a row that was not in the list a moment ago. */
  has: (id: string) => boolean;
  /**
   * The row's position **among the rows gained in this update**, 0-based — the
   * value for `--stagger-index`. Counted among the newcomers, not among all
   * rows: three new versions in a forty-row stack stagger 0, 1, 2.
   */
  indexOf: (id: string) => number;
}

const NONE: GainedRows = { has: () => false, indexOf: () => 0 };

/**
 * @param ids The list's row identities, in render order.
 */
export function useGainedRows(ids: readonly string[]): GainedRows {
  const [seen, setSeen] = useState<{ known: ReadonlySet<string>; gained: readonly string[] }>(
    () => ({ known: new Set(ids), gained: [] }),
  );

  const arrived = ids.filter((id) => !seen.known.has(id));
  if (arrived.length > 0) {
    const known = new Set(seen.known);
    for (const id of ids) known.add(id);
    setSeen({ known, gained: arrived });
  }

  if (seen.gained.length === 0) return NONE;
  const gained = seen.gained;
  return {
    has: (id) => gained.includes(id),
    indexOf: (id) => Math.max(gained.indexOf(id), 0),
  };
}

/**
 * Which already-present rows had a watched fact **change** on them.
 *
 * A row seen here for the first time is deliberately not reported: it is a
 * *gained* row, and gaining is `useGainedRows`'s event. Reporting both would
 * put two animations on one row for one fact, which is the failure rule R1
 * exists to prevent.
 *
 * The agency version stack is the case this was written for. A version is
 * uploaded — the stack gains a row, and the row seats. Some time later that
 * same version is published to the client, and nothing about the list changes
 * except one timestamp on a row that has been sitting there. That is a
 * different event on a different day and it gets the two-beat stamp.
 *
 * @param entries `[rowId, watchedValue]`, in any order.
 */
export function useChangedRows(
  entries: readonly (readonly [string, RowSignal])[],
): ReadonlySet<string> {
  const [seen, setSeen] = useState<{
    values: ReadonlyMap<string, RowSignal>;
    changed: ReadonlySet<string>;
  }>(() => ({ values: new Map(entries), changed: new Set() }));

  const changed = entries
    .filter(([id, value]) => seen.values.has(id) && seen.values.get(id) !== value)
    .map(([id]) => id);

  const added = entries.filter(([id]) => !seen.values.has(id));
  if (changed.length > 0 || added.length > 0) {
    setSeen({ values: new Map([...seen.values, ...entries]), changed: new Set(changed) });
  }

  return seen.changed;
}
