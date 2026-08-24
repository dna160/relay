/**
 * INV-2 — `cards.state` changes only via `domain/card/state-machine.ts`.
 *
 * Structural, and live from Phase 0. Enforced by reading the source tree: no
 * route handler, query file, worker, or seed script may name `state` in a
 * write position against the cards table. A board that anything can move by
 * hand becomes a board that lies, and every metric built on it becomes fiction.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { except, linesMatching, sourceFiles } from './_source';

/** The one file permitted to decide a card's next state. */
const SOLE_WRITER = 'src/domain/card/state-machine.ts';

/**
 * The one file permitted to *persist* what the state machine decided. Phase 2
 * creates it; until then the set is empty and the invariant still holds.
 */
const SOLE_PERSISTER = 'src/domain/card/transition-card.ts';

describe('INV-2 the state machine is the sole writer of cards.state', () => {
  it('no file outside the state machine performs a drizzle update of cards.state', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles(), SOLE_WRITER, SOLE_PERSISTER)) {
      // `.set({ ... state ... })` — a drizzle update touching the state column.
      const hits = linesMatching(file, /\.set\s*\(\s*\{[^}]*\bstate\s*:/);
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'cards.state written outside the state machine').toEqual([]);
  });

  it('no raw SQL outside the state machine updates the state column', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles(), SOLE_WRITER, SOLE_PERSISTER)) {
      const hits = linesMatching(file, /update\s+cards\b[\s\S]*set\b|set\s+state\s*=/i);
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'raw SQL state write found').toEqual([]);
  });

  it('the API rejects state on the card patch route (API-CONTRACT: state is rejected there)', () => {
    const patch = sourceFiles('app').find((f) => /api\/cards\/\[id\]\/route\.tsx?$/.test(f.path));
    if (!patch) return; // Phase 2 creates it.
    expect(patch.text, 'PATCH /api/cards/:id must not accept a state field').not.toMatch(
      /state\s*:\s*z\.(enum|string|nativeEnum)/,
    );
  });
});
