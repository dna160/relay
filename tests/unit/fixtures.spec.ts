/**
 * The fixtures are load-bearing, so they get tested too.
 *
 * Every suite in this repo — unit, invariant, and e2e — asserts against
 * `tests/fixtures`. A fixture that describes a state the system cannot actually
 * reach, or an expected total computed wrong by hand, produces confident green
 * tests that prove nothing. Worse, Phase 5's tolerance test asserts a real
 * implementation against numbers written in a JSON file; if those numbers are
 * wrong, the correct implementation fails and someone "fixes" it.
 *
 * So: this file replays every card's transition script through the *real* state
 * machine, and independently recomputes every possession total straight from
 * the rule in DATA-MODEL.md. The recomputation here is a checksum on the
 * fixture, deliberately local to this file and deliberately not exported —
 * `domain/card/possession.ts` is Phase 5's job and must not be able to import
 * its own expected answers.
 */

import { describe, expect, it } from 'vitest';
import {
  POSSESSION,
  canTransition,
  transition,
  type Actor,
  type CardState,
  type Possession,
} from '@/domain/card/state-machine';
import {
  ACTIVE_WINDOW_DAYS,
  EVAL_NOW,
  EXPECTED_ACTIVE_AT_EVAL_NOW,
  EXPECTED_DUE_FOR_ARCHIVE,
  EXPECTED_DUE_FOR_PURGE,
  ORG,
  PLAN_LIMITS,
  POSSESSION_TOLERANCE_MS,
  RETENTION,
  T0,
  approvals,
  cards,
  clientContacts,
  days,
  engagements,
  lanes,
  orgs,
  possessionCases,
  transitionScripts,
  versions,
  warningsFor,
  type PossessionCase,
} from '@tests/fixtures';

const AGENCY: Actor = { kind: 'agency', userId: 'fixture-user' };
const CLIENT: Actor = { kind: 'client', contactId: 'fixture-contact' };

describe('every fixture card state is reachable by legal moves', () => {
  it('has a transition script for every card', () => {
    const missing = cards.filter((c) => !(c.id in transitionScripts)).map((c) => c.title);
    expect(missing, 'a card with no script cannot be seeded without writing state directly').toEqual([]);
  });

  it.each(cards.map((c) => [c.title, c] as const))(
    'replays %s to its declared state and round count',
    (_title, card) => {
      const script = transitionScripts[card.id] ?? [];
      let state: CardState = 'draft';
      let rounds = 0;

      for (const move of script) {
        expect(move.from, 'script is out of order').toBe(state);
        const result = transition(move.from, move.to, move.actor === 'client' ? CLIENT : AGENCY);
        if (result.incrementsRound) rounds += 1;
        state = result.to;
      }

      expect(state, `${card.title} declares ${card.state}`).toBe(card.state);
      expect(rounds, `${card.title} declares ${card.roundsUsed} rounds used`).toBe(card.roundsUsed);
    },
  );

  it('exercises a card that has overrun its contracted rounds', () => {
    const breached = cards.filter((c) => c.contractedRounds !== null && c.roundsUsed > c.contractedRounds);
    expect(breached.length, 'no --breach case in the fixture').toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- possession */

/**
 * The rule, straight from DATA-MODEL.md, implemented here and only here:
 * possession duration for a card is the sum over transitions of
 * `next.occurred_at - this.occurred_at`, grouped by possession, with the last
 * row running to `now`. A row whose possession is null stops the clock.
 *
 * This exists to check the hand-written numbers in `possession.json`, not to
 * serve as an implementation.
 */
function recompute(c: PossessionCase): {
  agencyMs: number;
  clientMs: number;
  current: Possession | null;
  currentMs: number;
} {
  const now = Date.parse(c.now);
  const rows = [...c.transitions].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  let agencyMs = 0;
  let clientMs = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const next = rows[i + 1];
    const end = next ? Date.parse(next.occurredAt) : now;
    const ms = end - Date.parse(row.occurredAt);
    if (row.possession === 'agency') agencyMs += ms;
    if (row.possession === 'client') clientMs += ms;
  }

  const last = rows[rows.length - 1];
  const current = last?.possession ?? null;
  return {
    agencyMs,
    clientMs,
    current,
    currentMs: current === null || last === undefined ? 0 : now - Date.parse(last.occurredAt),
  };
}

describe('the possession fixture', () => {
  it('holds the tolerance PHASE-5 EXIT names', () => {
    expect(POSSESSION_TOLERANCE_MS).toBe(1_000);
  });

  it('covers the cases a possession clock gets wrong', () => {
    const names = possessionCases.map((c) => c.name);
    expect(names).toContain('no transitions at all');
    expect(names).toContain('unordered rows sum to the same totals');
    expect(names).toContain('sub-second segments');
    expect(names).toContain('full lifecycle through one revision round to sign-off');
  });

  it.each(possessionCases.map((c) => [c.name, c] as const))(
    'case "%s" declares totals that match the rule',
    (_name, c) => {
      expect(recompute(c)).toEqual(c.expected);
    },
  );

  it.each(possessionCases.map((c) => [c.name, c] as const))(
    'case "%s" is a legal walk of the state machine',
    (_name, c) => {
      let state: CardState = 'draft';
      const ordered = [...c.transitions].sort(
        (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
      );
      for (const row of ordered) {
        expect(row.from, 'transition rows must chain once sorted by occurred_at').toBe(state);
        expect(canTransition(row.from, row.to), `${row.from} -> ${row.to}`).toBe(true);
        expect(row.possession, `possession recorded on ${row.to}`).toBe(POSSESSION[row.to]);
        state = row.to;
      }
    },
  );

  it.each(possessionCases.map((c) => [c.name, c] as const))(
    'case "%s" declares a round count consistent with its transitions',
    (_name, c) => {
      const rounds = c.transitions.filter(
        (t) => t.from === 'awaiting_client' && t.to === 'changes_requested',
      ).length;
      expect(rounds).toBe(c.roundsUsed);
    },
  );

  it('has at least one case where the segments are smaller than the tolerance', () => {
    // Otherwise "within 1s" is satisfied by an implementation that returns
    // roughly the right shape and the tolerance is doing the work.
    const subSecond = possessionCases.filter((c) =>
      c.transitions.some((t, i, all) => {
        const next = all[i + 1];
        return next !== undefined && Date.parse(next.occurredAt) - Date.parse(t.occurredAt) < 1_000;
      }),
    );
    expect(subSecond.length).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------- lifecycle */

describe('the engagement fixture', () => {
  it('holds one engagement at every lifecycle stage', () => {
    const statuses = new Set(engagements.map((e) => e.status));
    expect([...statuses].sort()).toEqual(['active', 'archived', 'draft', 'purged']);
  });

  it('holds a row where status and activity disagree, so status alone miscounts', () => {
    const idle = engagements.filter(
      (e) =>
        e.status === 'active' &&
        EVAL_NOW.getTime() - Date.parse(e.lastActivityAt) > days(ACTIVE_WINDOW_DAYS),
    );
    expect(idle.length, 'no stale-but-active row: the fixture cannot catch a naive counter').toBe(1);
  });

  it('counts active engagements per org exactly as declared (INV-8)', () => {
    // The two-clause definition from PRD §5.6, applied here to check the
    // fixture. `countActiveEngagements()` is Phase 1's job and must agree.
    for (const org of orgs) {
      const count = engagements.filter(
        (e) =>
          e.orgId === org.id &&
          e.status === 'active' &&
          EVAL_NOW.getTime() - Date.parse(e.lastActivityAt) < days(ACTIVE_WINDOW_DAYS),
      ).length;
      expect(count, `${org.name}`).toBe(EXPECTED_ACTIVE_AT_EVAL_NOW[org.id]);
    }
  });

  it('puts the free org exactly at its plan limit, so the next create is a 402', () => {
    expect(EXPECTED_ACTIVE_AT_EVAL_NOW[ORG.free]).toBe(PLAN_LIMITS.free.activeEngagements);
  });

  it('leaves the pro org room, so a 402 there would be a false positive', () => {
    const limit = PLAN_LIMITS.pro.activeEngagements;
    expect(limit).not.toBeNull();
    expect(EXPECTED_ACTIVE_AT_EVAL_NOW[ORG.pro]!).toBeLessThan(limit!);
  });

  it('agrees with the sweep about which engagements are overdue', () => {
    const dueArchive = engagements
      .filter((e) => e.status === 'active' && e.archiveAt !== null && Date.parse(e.archiveAt) <= EVAL_NOW.getTime())
      .map((e) => e.id);
    expect(dueArchive).toEqual([...EXPECTED_DUE_FOR_ARCHIVE]);

    const duePurge = engagements
      .filter((e) => e.status === 'archived' && e.purgeAt !== null && Date.parse(e.purgeAt) <= EVAL_NOW.getTime())
      .map((e) => e.id);
    expect(duePurge).toEqual([...EXPECTED_DUE_FOR_PURGE]);
  });

  it('gives every engagement on a retaining plan a null countdown, not a distant one', () => {
    for (const e of engagements) {
      const plan = orgs.find((o) => o.id === e.orgId)!.plan;
      if (PLAN_LIMITS[plan].retentionDays === null) {
        expect(e.archiveAt, `${e.title}`).toBeNull();
        expect(e.purgeAt, `${e.title}`).toBeNull();
      } else {
        expect(e.archiveAt, `${e.title}`).not.toBeNull();
        expect(e.purgeAt, `${e.title}`).not.toBeNull();
      }
    }
  });

  it('computes archive and purge dates by the documented arithmetic', () => {
    for (const e of engagements) {
      if (e.archiveAt === null || e.purgeAt === null) continue;
      const last = Date.parse(e.lastActivityAt);
      expect(Date.parse(e.archiveAt) - last, `${e.title} archive_at`).toBe(days(RETENTION.archiveDays));
      expect(Date.parse(e.purgeAt) - last, `${e.title} purge_at`).toBe(days(RETENTION.purgeDays));
    }
  });

  it('schedules four warnings, strictly increasing, the last one before the purge', () => {
    for (const e of engagements) {
      if (e.purgeAt === null) continue;
      const warnings = warningsFor(Date.parse(e.lastActivityAt) - T0.getTime()).map(Date.parse);
      expect(warnings).toHaveLength(4);
      expect(warnings[0], 'the first warning fires at archive').toBe(Date.parse(e.archiveAt!));
      for (let i = 1; i < warnings.length; i++) {
        expect(warnings[i]!).toBeGreaterThan(warnings[i - 1]!);
      }
      expect(warnings[3]!).toBeLessThan(Date.parse(e.purgeAt));
    }
  });

  it('scopes client contacts to one engagement each, sharing an email across two (INV-6)', () => {
    const rowan = clientContacts.filter((c) => c.email === 'rowan@bellweather.test');
    expect(rowan).toHaveLength(2);
    expect(new Set(rowan.map((c) => c.engagementId)).size).toBe(2);
    expect(new Set(rowan.map((c) => c.id)).size, 'the same email must not share a contact row').toBe(2);
  });
});

/* -------------------------------------------------------------- the board */

describe('the board fixture', () => {
  it('has exactly one private lane and one private-override card', () => {
    expect(lanes.filter((l) => l.visibility === 'private')).toHaveLength(1);
    expect(cards.filter((c) => c.visibilityOverride === 'private')).toHaveLength(1);
  });

  it('puts the private-override card in a published lane, where it is dangerous', () => {
    const overridden = cards.find((c) => c.visibilityOverride === 'private')!;
    const lane = lanes.find((l) => l.id === overridden.laneId)!;
    expect(lane.visibility).toBe('published');
  });

  it('has a card with three versions of which exactly two are published', () => {
    const byCard = new Map<string, typeof versions>();
    for (const v of versions) {
      byCard.set(v.cardId, [...(byCard.get(v.cardId) ?? []), v]);
    }
    const three = [...byCard.values()].find((vs) => vs.length === 3);
    expect(three, 'no three-version card').toBeDefined();
    expect(three!.filter((v) => v.publishedToClientAt !== null)).toHaveLength(2);
  });

  it('numbers versions from 1 without gaps or repeats within a card', () => {
    const byCard = new Map<string, number[]>();
    for (const v of versions) {
      byCard.set(v.cardId, [...(byCard.get(v.cardId) ?? []), v.versionNo]);
    }
    for (const [cardId, nos] of byCard) {
      const sorted = [...nos].sort((a, b) => a - b);
      expect(sorted, `card ${cardId}`).toEqual(sorted.map((_, i) => i + 1));
    }
  });

  it('gives every approval a 64-character hash copied from its version (INV-3)', () => {
    for (const a of approvals) {
      const version = versions.find((v) => v.id === a.assetVersionId);
      expect(version, `approval ${a.id} references a version that is not in the fixture`).toBeDefined();
      expect(a.versionSha256).toHaveLength(64);
      expect(a.versionSha256).toBe(version!.sha256);
    }
  });

  it('gives every changes_requested approval a note, as the CHECK constraint demands', () => {
    for (const a of approvals) {
      if (a.decision === 'changes_requested') expect(a.note, `approval ${a.id}`).toBeTruthy();
    }
  });

  it('attributes every approval to exactly one actor, as the CHECK constraint demands', () => {
    for (const a of approvals) {
      const actors = [a.decidedByContactId, a.decidedByUserId].filter((x) => x !== null);
      expect(actors, `approval ${a.id}`).toHaveLength(1);
    }
  });
});
