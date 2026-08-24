/**
 * The state machine is the spine of the board (ADR-003). These are behavioural
 * tests, not invariant tests — INV-2 lives in tests/invariants and asserts that
 * nothing else writes state. This file asserts the machine itself is right.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENCY_ONLY_STATES,
  CLIENT_STATE_ALIAS,
  InvalidTransitionError,
  POSSESSION,
  canTransition,
  isAwaitingClient,
  transition,
  type CardState,
} from '@/domain/card/state-machine';

const AGENCY = { kind: 'agency', userId: 'u1' } as const;
const CLIENT = { kind: 'client', contactId: 'c1' } as const;

const ALL_STATES: CardState[] = [
  'draft', 'assigned', 'in_progress', 'internal_review',
  'awaiting_client', 'changes_requested', 'approved', 'signed_off',
];

describe('the happy path from PRD §6', () => {
  it('walks draft -> signed_off through every intended state', () => {
    const path: CardState[] = [
      'draft', 'assigned', 'in_progress', 'internal_review',
      'awaiting_client', 'approved', 'signed_off',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it('loops changes_requested back into the work, not into review', () => {
    expect(canTransition('awaiting_client', 'changes_requested')).toBe(true);
    expect(canTransition('changes_requested', 'in_progress')).toBe(true);
    expect(canTransition('changes_requested', 'awaiting_client')).toBe(false);
  });

  it('lets an approved deliverable be reopened but never un-signs a sign-off', () => {
    expect(canTransition('approved', 'changes_requested')).toBe(true);
    expect(ALL_STATES.filter((s) => canTransition('signed_off', s))).toEqual([]);
  });

  it('rejects skipping the internal review gate', () => {
    // Nothing reaches the client until an agency member promotes it (PRD §5.2).
    expect(canTransition('in_progress', 'awaiting_client')).toBe(false);
    expect(() => transition('in_progress', 'awaiting_client', AGENCY)).toThrow(InvalidTransitionError);
  });
});

describe('possession', () => {
  it('assigns every state to a side, except sign-off which ends the clock', () => {
    for (const s of ALL_STATES) expect(s in POSSESSION).toBe(true);
    expect(POSSESSION.awaiting_client).toBe('client');
    expect(POSSESSION.signed_off).toBeNull();
  });

  it('reports the possession of the destination state, not the origin', () => {
    expect(transition('internal_review', 'awaiting_client', AGENCY).possession).toBe('client');
    expect(transition('awaiting_client', 'changes_requested', CLIENT).possession).toBe('agency');
  });

  it('flags only awaiting_client as the client’s move', () => {
    expect(ALL_STATES.filter(isAwaitingClient)).toEqual(['awaiting_client']);
  });
});

describe('round counting', () => {
  it('consumes a round only on the awaiting_client -> changes_requested cycle', () => {
    expect(transition('awaiting_client', 'changes_requested', CLIENT).incrementsRound).toBe(true);
    expect(transition('approved', 'changes_requested', AGENCY).incrementsRound).toBe(false);
    expect(transition('changes_requested', 'in_progress', AGENCY).incrementsRound).toBe(false);
  });
});

describe('client authority', () => {
  it('permits exactly the two decisions a client is allowed to make', () => {
    expect(() => transition('awaiting_client', 'approved', CLIENT)).not.toThrow();
    expect(() => transition('awaiting_client', 'changes_requested', CLIENT)).not.toThrow();
  });

  it('refuses every other legal edge when the actor is a client', () => {
    const clientReachable: Array<[CardState, CardState]> = [
      ['draft', 'assigned'],
      ['assigned', 'in_progress'],
      ['in_progress', 'internal_review'],
      ['internal_review', 'awaiting_client'],
      ['changes_requested', 'in_progress'],
      ['approved', 'signed_off'],
    ];
    for (const [from, to] of clientReachable) {
      expect(() => transition(from, to, CLIENT), `${from} -> ${to}`).toThrow(InvalidTransitionError);
    }
  });

  it('gives a client the same error for forbidden and illegal, so moves cannot be enumerated', () => {
    // A distinct "you lack permission" message tells a client which moves exist.
    const forbidden = (() => { try { transition('assigned', 'in_progress', CLIENT); } catch (e) { return (e as Error).message; } })();
    const illegal = (() => { try { transition('assigned', 'signed_off', CLIENT); } catch (e) { return (e as Error).message; } })();
    expect(forbidden).toContain('not a legal edge');
    expect(illegal).toContain('not a legal edge');
  });
});

describe('the client projection contract', () => {
  it('hides draft and nothing else', () => {
    expect([...AGENCY_ONLY_STATES]).toEqual(['draft']);
  });

  it('collapses internal_review to in_progress and aliases nothing else', () => {
    expect(CLIENT_STATE_ALIAS.internal_review).toBe('in_progress');
    expect(Object.keys(CLIENT_STATE_ALIAS)).toEqual(['internal_review']);
  });

  it('leaves no client-visible state that the client projection cannot represent', () => {
    // Every state must either be agency-only, aliased, or directly representable.
    const unrepresentable = ALL_STATES.filter(
      (s) => !AGENCY_ONLY_STATES.has(s) && !CLIENT_STATE_ALIAS[s] && s === 'internal_review',
    );
    expect(unrepresentable).toEqual([]);
  });
});

describe('error shape', () => {
  it('carries the INVALID_TRANSITION code the API contract promises', () => {
    try {
      transition('draft', 'signed_off', AGENCY);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as InvalidTransitionError).code).toBe('INVALID_TRANSITION');
    }
  });
});
