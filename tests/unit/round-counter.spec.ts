/**
 * ADR-014 — the revision-round counter, asserted as behaviour.
 *
 * `rounds_used` is the number an agency puts in front of a client to say that
 * round four of a two-round agreement has begun. It is the number an invoice is
 * argued over. PHASE-3.md put the increment in `record-decision.ts`; ADR-014
 * moved it next to the persist, because the same edge is reachable through the
 * agency transition route and two increment sites eventually disagree.
 *
 * ADR-014 §Consequences names the trap directly: "a test that greps
 * `record-decision.ts` for the increment itself would not [pass]". So **nothing
 * here asserts where the counter lives.** The properties asserted are:
 *
 *   1. exactly one edge costs a round, and the state machine alone decides it;
 *   2. the answer does not depend on who took the edge;
 *   3. there is exactly one place in `src/` that applies it — whichever place
 *      that is — and it applies it in the same statement that writes the state.
 *
 * (3) is the one that would have caught the original arrangement, and it stays
 * true if the increment moves again.
 */

import { describe, expect, it } from 'vitest';
import { canTransition, transition, type Actor, type CardState } from '@/domain/card/state-machine';
import { linesMatching, sourceFiles, stripComments } from '../invariants/_source';

const AGENCY: Actor = { kind: 'agency', userId: 'user-1' };
const CLIENT: Actor = { kind: 'client', contactId: 'contact-1' };

const ALL_STATES: readonly CardState[] = [
  'draft',
  'assigned',
  'in_progress',
  'internal_review',
  'awaiting_client',
  'changes_requested',
  'approved',
  'signed_off',
];

/** Every legal edge, derived from the machine rather than restated. */
const LEGAL_EDGES: ReadonlyArray<[CardState, CardState]> = ALL_STATES.flatMap((from) =>
  ALL_STATES.filter((to) => canTransition(from, to)).map((to) => [from, to] as [CardState, CardState]),
);

describe('which edge costs a round', () => {
  it('has legal edges to enumerate, so an empty sweep is not a pass', () => {
    expect(LEGAL_EDGES.length).toBeGreaterThan(5);
  });

  it('charges a round on exactly one edge out of every legal edge in the machine', () => {
    const charging = LEGAL_EDGES.filter(([from, to]) => {
      // Ask as an agency member: the actor check only constrains clients, so
      // this reaches every legal edge.
      return transition(from, to, AGENCY).incrementsRound;
    });
    expect(charging).toEqual([['awaiting_client', 'changes_requested']]);
  });

  it('does not charge a round for reopening an approved deliverable', () => {
    // approved -> changes_requested is legal and deliberately free. Recorded
    // here as behaviour so that changing it is a decision, not a drift.
    expect(transition('approved', 'changes_requested', AGENCY).incrementsRound).toBe(false);
  });

  it('does not charge a round for the work that follows the request', () => {
    expect(transition('changes_requested', 'in_progress', AGENCY).incrementsRound).toBe(false);
  });
});

describe('the counter does not depend on who moved the card', () => {
  /**
   * This is the whole of ADR-014. An agency member can take
   * `awaiting_client -> changes_requested` through the transition route;
   * a client takes it through a recorded decision. If the two answers ever
   * differ, the number on the invoice depends on who happened to click.
   */
  it('charges the same round whether the agency or the client requests changes', () => {
    const byClient = transition('awaiting_client', 'changes_requested', CLIENT);
    const byAgency = transition('awaiting_client', 'changes_requested', AGENCY);
    expect(byClient.incrementsRound).toBe(true);
    expect(byAgency.incrementsRound).toBe(byClient.incrementsRound);
  });

  it('reports the same possession and destination for both actors on that edge', () => {
    const byClient = transition('awaiting_client', 'changes_requested', CLIENT);
    const byAgency = transition('awaiting_client', 'changes_requested', AGENCY);
    expect(byAgency).toEqual(byClient);
  });

  it('gives the same answer on every edge a client is allowed to take', () => {
    for (const [from, to] of [
      ['awaiting_client', 'approved'],
      ['awaiting_client', 'changes_requested'],
    ] as ReadonlyArray<[CardState, CardState]>) {
      expect(transition(from, to, CLIENT), `${from} -> ${to}`).toEqual(
        transition(from, to, AGENCY),
      );
    }
  });
});

describe('there is one place that applies the increment, wherever it is', () => {
  /**
   * Structural and deliberately location-blind. The test names no file; it
   * counts them. Two sites is the failure ADR-014 exists to prevent, and it
   * fails here whether the second site is a route, a worker, or a second
   * domain module.
   */
  const WRITE = /\.set\s*\(\s*\{[^}]*\broundsUsed\b/;
  const RAW_WRITE = /\brounds_used\s*=/;

  const writers = sourceFiles().filter(
    (file) => WRITE.test(file.text) || RAW_WRITE.test(file.text),
  );

  it('applies the increment in exactly one file', () => {
    expect(
      writers.map((f) => f.path),
      'two places write rounds_used. They will disagree, and the disagreement ' +
        'surfaces as a billing dispute rather than as a failing test (ADR-014).',
    ).toHaveLength(1);
  });

  it('writes rounds_used in the same statement that writes the state', () => {
    for (const file of writers) {
      const setCall = /\.set\s*\(\s*\{([^}]*)\}/.exec(file.text)?.[1] ?? '';
      expect(setCall, `${file.path}: rounds_used and state are written separately`).toMatch(
        /\bstate\s*:/,
      );
      expect(setCall).toMatch(/\broundsUsed\b/);
    }
  });

  it('never applies the increment from a route handler', () => {
    const offenders = writers.filter((f) => f.path.startsWith('src/app/'));
    expect(
      offenders.map((f) => f.path),
      'a route handler counting rounds is a second copy of a billing rule (INV-9)',
    ).toEqual([]);
  });

  it('takes the decision from the state machine rather than re-deciding it', () => {
    for (const file of writers) {
      expect(file.text, `${file.path} does not read incrementsRound`).toContain('incrementsRound');
      // Re-spelling the edge is how the second opinion gets in. The condition
      // belongs to the machine; the persister only applies its answer.
      const respells =
        /incrementsRound\s*[:=]\s*[^;\n]*awaiting_client/.test(file.text) ||
        linesMatching(file, /awaiting_client[\s\S]*changes_requested/).length > 0;
      expect(respells, `${file.path} re-derives which edge costs a round`).toBe(false);
    }
  });
});

describe('the edge condition is spelled once, in the state machine', () => {
  it('is not restated anywhere else in src/', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file.path === 'src/domain/card/state-machine.ts') continue;
      const text = stripComments(file.text);
      if (/incrementsRound\s*:\s*(?!input|result|outcome)/.test(text) && /awaiting_client/.test(text)) {
        offenders.push(file.path);
      }
    }
    expect(offenders, 'a second definition of which edge costs a round').toEqual([]);
  });
});
