/**
 * PHASE-7 EXIT — **stamping a template twice produces structurally identical
 * graphs.**
 *
 * ## Why this suite is portable, and where its other half lives
 *
 * `applyTemplate()` is pure by contract: no database handle, no `new Date()`,
 * no `uuidv7()`. The clock and the id factory are parameters, which is exactly
 * what makes determinism assertable by *calling the function twice with
 * counters* rather than by inspecting a transaction. A version that read the
 * clock itself would make this test a race, and a race in a determinism test is
 * the worst possible combination: it fails one run in fifty and gets deleted.
 *
 * So determinism belongs here, in `npm run verify`, where it runs on every
 * commit on a machine with nothing installed. It is the same split INV-3 got
 * (VERIFICATION §1): the half that can be checked without infrastructure is
 * checked without infrastructure, because an invariant that can only be checked
 * where the infrastructure is is an invariant that goes unchecked on most
 * commits.
 *
 * The *stamping path* — the transaction that inserts the graph, the org
 * scoping, the plan gate on create — is a different claim about a different
 * subject and needs a real Postgres. That belongs in `npm run test:db` and is
 * **not written yet**: `POST /api/templates` and stamping-on-create do not
 * exist at the time of writing. Nothing here should be read as covering it.
 *
 * ## What the comparison strips, and how it is stopped from stripping more
 *
 * "Identical modulo ids and timestamps" is where a test like this quietly stops
 * testing anything, so the normalisation is not written inline. It is
 * `normaliseStamp()` in `tests/fixtures/template.ts`, it reports **every path
 * it touched and every path it did not**, and both ledgers are asserted against
 * literal lists below. Widening the strip list is therefore a diff a reviewer
 * sees rather than a green run nobody reads.
 *
 * Ids are **interned, not blanked** — see the fixture header. Blanking would
 * make a graph that hung every card off the wrong lane compare equal to one
 * that hung them off the right one, and `applyTemplate()` returns a *flat* card
 * list wired by `laneId`, which is precisely where that could hide.
 *
 * ## Proving it can fail
 *
 * Two batteries, both required:
 *
 * 1. **Twins** — fifteen templates each differing from the fixture in exactly
 *    one field, stamped by the real function. Each must produce a graph that
 *    does *not* normalise equal to a stamp of the original.
 * 2. **Mutations** — eleven surgical edits to a real stamped graph, including
 *    re-parenting one card. Each must be caught.
 *
 * And the inverse, which is what makes the first two mean something: re-minting
 * every id and moving every timestamp must *still* compare equal. Without that
 * pair, a normaliser returning `null` would pass battery 1 and 2 and nothing
 * else.
 *
 * Never edit this file to make a build pass. It is PHASE-7's exit condition.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  type ApplyTemplateContext,
  type StampedCard,
  type StampedGraph,
  type StampedLane,
} from '@/domain/template/apply';
import { parseTemplateDefinition } from '@/domain/template/definition';
import type { TemplateDefinition } from '@/lib/types';
import {
  DAY,
  START_A,
  START_B,
  T0,
  TEMPLATE_EMPTY,
  TEMPLATE_FIXTURE,
  TEMPLATE_TWINS,
  dueFrom,
  normaliseStamp,
  volatileLooking,
} from '@tests/fixtures';

/* ------------------------------------------------------------------ harness */

/**
 * One stamp, with every injected non-determinism pinned to `seed`.
 *
 * The id factory is a counter rather than `uuidv7()` on purpose: two stamps
 * seeded differently mint two entirely disjoint id sets, which is the condition
 * the normalisation has to survive. Using real v7 ids would also work and would
 * make a failure message unreadable.
 */
function stamp(
  definition: TemplateDefinition,
  seed: string,
  startedAt: Date = START_A,
): StampedGraph {
  let n = 0;
  const ctx: ApplyTemplateContext = {
    engagementId: `engagement-${seed}`,
    startedAt,
    // Derived from the seed, so two seeds give two genuinely different row
    // clocks. It was `seed.length` first, both seeds are two characters long,
    // and the premise assertion in the first test caught it — which is the
    // small proof that the premise assertion is not decoration.
    now: new Date(T0.getTime() + seedOffset(seed)),
    newId: () => `${seed}-${String(n++).padStart(3, '0')}`,
  };
  return applyTemplate(definition, ctx);
}

function seedOffset(seed: string): number {
  let total = 0;
  for (const ch of seed) total = total * 977 + ch.charCodeAt(0) * 1000;
  return total;
}

const shapeOf = (graph: StampedGraph): unknown => normaliseStamp(graph).shape;

/* ------------------------------------------------- the exit condition itself */

describe('PHASE-7 EXIT stamping a template twice produces structurally identical graphs', () => {
  it('two stamps of one definition are identical modulo ids and timestamps', () => {
    const first = stamp(TEMPLATE_FIXTURE, 'aa');
    const second = stamp(TEMPLATE_FIXTURE, 'bb');

    // The premise: nothing survived by accident. Not one id and not one
    // timestamp is shared between the two runs, so an equality that holds here
    // is holding *because* of the normalisation rather than in spite of it.
    const ids = (g: StampedGraph): string[] => [
      ...g.lanes.map((l) => l.id),
      ...g.cards.map((c) => c.id),
      ...g.cards.map((c) => c.laneId),
      ...g.lanes.map((l) => l.engagementId),
    ];
    expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([]);
    expect(first.lanes[0]?.createdAt.getTime()).not.toBe(second.lanes[0]?.createdAt.getTime());

    expect(shapeOf(first)).toEqual(shapeOf(second));
  });

  it('a third stamp agrees with the first two', () => {
    // Two stamps could agree because the second copied the first's arrays. A
    // third, from a definition parsed independently, could not.
    const parsed = parseTemplateDefinition(JSON.parse(JSON.stringify(TEMPLATE_FIXTURE)));
    expect(shapeOf(stamp(parsed, 'cc'))).toEqual(shapeOf(stamp(TEMPLATE_FIXTURE, 'aa')));
  });

  it('stamping does not mutate the definition it was handed', () => {
    const before = JSON.stringify(TEMPLATE_FIXTURE);
    stamp(TEMPLATE_FIXTURE, 'aa');
    stamp(TEMPLATE_FIXTURE, 'bb');
    expect(JSON.stringify(TEMPLATE_FIXTURE)).toBe(before);
  });

  it('the empty definition stamps an empty graph, and is not equal to a real one', () => {
    const empty = stamp(TEMPLATE_EMPTY, 'aa');
    expect(empty).toEqual({ lanes: [], cards: [], shelfGroups: [] });
    // The floor under every assertion in this file: if the normalisation were
    // loose enough to erase the board, this is the case that would notice.
    expect(shapeOf(empty)).not.toEqual(shapeOf(stamp(TEMPLATE_FIXTURE, 'bb')));
  });
});

/* ------------------------------------------- what determinism cannot see alone */

/**
 * Determinism is a comparison between two stamps, and a stamp that is wrong the
 * *same way twice* satisfies it perfectly.
 *
 * These five cases were written after running the suite against eleven planted
 * defects in `applyTemplate()` itself. Eight were caught. Three were not, and
 * all three were the same shape — consistently wrong:
 *
 *   - `card.contractedRounds || default` — a card's own `0` swallowed by the
 *     template default. Both stamps swallow it, so both agree.
 *   - every card re-parented onto `lanes[0]` — every id still real, every count
 *     unchanged, and one of the lanes it should not be under is *private*.
 *   - `createdAt: new Date()` — non-determinism reintroduced, invisible because
 *     the comparison correctly strips timestamps.
 *
 * So the exit condition needs a companion that reads the graph against the
 * definition rather than against another graph. The planted-defect run is
 * recorded in the QA report; the assertions it produced are here.
 */
describe('PHASE-7 the stamped graph is what the definition described', () => {
  it('every card lands in its own lane, in order, with its dates and rounds resolved', () => {
    const g = stamp(TEMPLATE_FIXTURE, 'aa');
    const laneName = new Map(g.lanes.map((l) => [l.id, l.name]));

    expect(
      g.cards.map((c) => ({
        title: c.title,
        lane: laneName.get(c.laneId) ?? `UNKNOWN LANE ${c.laneId}`,
        position: c.position,
        due: c.dueAt?.toISOString() ?? null,
        rounds: c.contractedRounds,
      })),
    ).toEqual([
      { title: 'Kickoff brief', lane: 'Discovery', position: 0, due: dueFrom(START_A, 0), rounds: 2 },
      { title: 'Audience research', lane: 'Discovery', position: 1, due: dueFrom(START_A, 7), rounds: 1 },
      // `rounds: 0`, not 2. A card that says zero contracted rounds has said
      // so; `card.contractedRounds || default` reads that as silence.
      { title: 'Accessibility sweep', lane: 'Internal QA', position: 0, due: null, rounds: 0 },
      { title: 'Final artwork', lane: 'Delivery', position: 0, due: dueFrom(START_A, 45), rounds: 2 },
      { title: 'Handover pack', lane: 'Delivery', position: 1, due: null, rounds: 2 },
    ]);
  });

  it('every laneId on a card is a lane in this graph', () => {
    const g = stamp(TEMPLATE_FIXTURE, 'aa');
    const laneIds = new Set(g.lanes.map((l) => l.id));
    expect(g.cards.filter((c) => !laneIds.has(c.laneId)).map((c) => c.title)).toEqual([]);
    expect(g.cards.filter((c) => c.engagementId !== 'engagement-aa')).toEqual([]);
    expect(g.lanes.filter((l) => l.engagementId !== 'engagement-aa')).toEqual([]);
  });

  it('lanes keep the definition order and are positioned 0..n-1', () => {
    const g = stamp(TEMPLATE_FIXTURE, 'aa');
    expect(g.lanes.map((l) => l.name)).toEqual(TEMPLATE_FIXTURE.lanes.map((l) => l.name));
    expect(g.lanes.map((l) => l.position)).toEqual([0, 1, 2, 3]);
  });

  it('reads the clock and the id factory from nowhere but the context', () => {
    // `impure-clock` — `createdAt: new Date()` — passes the determinism
    // comparison, because stripping timestamps is exactly the right thing for
    // that comparison to do. Purity therefore has to be asserted directly, and
    // it is what the exit condition's phrasing quietly depends on: a stamp that
    // read the clock itself would make "twice" a race rather than a repetition.
    const minted: string[] = [];
    const now = new Date('2031-03-04T05:06:07.008Z');
    const graph = applyTemplate(TEMPLATE_FIXTURE, {
      engagementId: 'E',
      startedAt: START_A,
      now,
      newId: () => {
        const id = `m-${String(minted.length).padStart(3, '0')}`;
        minted.push(id);
        return id;
      },
    });

    for (const lane of graph.lanes) expect(lane.createdAt.getTime(), lane.name).toBe(now.getTime());
    for (const card of graph.cards) {
      expect(card.createdAt.getTime(), card.title).toBe(now.getTime());
      expect(card.updatedAt.getTime(), card.title).toBe(now.getTime());
    }

    // Every id in the graph came out of the injected factory, exactly once, and
    // the factory was called exactly as many times as there are rows.
    const used = [...graph.lanes.map((l) => l.id), ...graph.cards.map((c) => c.id)];
    expect([...used].sort()).toEqual([...minted].sort());
    expect(minted).toHaveLength(graph.lanes.length + graph.cards.length);
    expect(new Set(minted).size).toBe(minted.length);
  });

  it('shelf groups arrive as labels, in order, and are copied rather than aliased', () => {
    const g = stamp(TEMPLATE_FIXTURE, 'aa');
    expect(g.shelfGroups).toEqual(['Brand', 'Legal', 'Source files']);
    expect(g.shelfGroups).not.toBe(TEMPLATE_FIXTURE.shelfGroups);
  });
});

/* --------------------------------------------------- what the comparison strips */

describe('PHASE-7 the normalisation, stated', () => {
  const { stripped, kept, distinctIds } = normaliseStamp(stamp(TEMPLATE_FIXTURE, 'aa'));

  it('strips exactly these paths, and only these', () => {
    // Two rules, and this is their entire reach over a real stamped graph.
    // A new id-shaped or clock-written field appearing in `StampedGraph` lands
    // in this list and has to be argued for in a diff.
    expect(stripped).toEqual([
      'id cards[].engagementId',
      'id cards[].id',
      'id cards[].laneId',
      'id lanes[].engagementId',
      'id lanes[].id',
      'timestamp cards[].createdAt',
      'timestamp cards[].updatedAt',
      'timestamp lanes[].createdAt',
    ]);
  });

  it('keeps every field the board is actually made of', () => {
    // The other half, and the more important one. If `title` or `visibility`
    // ever migrates into the strip list above, it disappears from here and this
    // fails — which is the failure mode "normalise until it goes green" takes.
    expect(kept).toEqual([
      'cards[].contractedRounds',
      'cards[].description',
      'cards[].dueAt',
      'cards[].position',
      'cards[].title',
      'lanes[].name',
      'lanes[].position',
      'lanes[].visibility',
      'shelfGroups[]',
    ]);
  });

  it('interns one ordinal per distinct id, not one per occurrence', () => {
    const graph = stamp(TEMPLATE_FIXTURE, 'aa');
    // 4 lanes + 5 cards + 1 engagement id. Every `laneId` on a card is a lane's
    // own id, so it contributes nothing new — which is the wiring the interning
    // preserves and a blanket placeholder would destroy.
    expect(distinctIds).toBe(graph.lanes.length + graph.cards.length + 1);
  });

  it('leaves no unaccounted-for volatile-looking value behind', () => {
    // The strip list is enumerated by key name, which is the thing that can be
    // incomplete. This asks the question by value shape instead: after
    // normalisation, the only uuid- or ISO-timestamp-shaped strings left must
    // be ones somebody sanctioned. `dueAt` is the whole list, and it is on it
    // because it is derived from two inputs rather than read from a clock.
    expect(volatileLooking(shapeOf(stamp(TEMPLATE_FIXTURE, 'aa')))).toEqual(['cards[].dueAt']);
  });
});

/* ----------------------------------------------- proving the test can fail (1) */

describe('PHASE-7 the comparison catches a template that differs by one field', () => {
  const baseline = shapeOf(stamp(TEMPLATE_FIXTURE, 'aa'));

  for (const twin of TEMPLATE_TWINS) {
    it(`catches ${twin.what}`, () => {
      // Stamped with the *same* seed as the baseline, so the only thing that
      // can differ is the definition. A twin that compared equal here would
      // mean the normalisation had erased the field the twin changed.
      expect(shapeOf(stamp(twin.def, 'aa'))).not.toEqual(baseline);
    });
  }

  it('covers every field of the definition', () => {
    // A battery is only as good as its coverage, and coverage of a hand-written
    // list decays silently. Every leaf key of `TemplateDefinition` except
    // `version` must be moved by at least one twin.
    const moved = new Set<string>();
    for (const twin of TEMPLATE_TWINS) {
      for (const key of ['lanes', 'shelfGroups', 'contractedRoundsDefault'] as const) {
        if (JSON.stringify(twin.def[key]) !== JSON.stringify(TEMPLATE_FIXTURE[key])) {
          moved.add(key);
        }
      }
    }
    expect([...moved].sort()).toEqual(['contractedRoundsDefault', 'lanes', 'shelfGroups']);
  });
});

/* ----------------------------------------------- proving the test can fail (2) */

describe('PHASE-7 the comparison catches a mutated graph', () => {
  const baseline = (): StampedGraph => stamp(TEMPLATE_FIXTURE, 'aa');

  const withLanes = (g: StampedGraph, lanes: readonly StampedLane[]): StampedGraph => ({
    ...g,
    lanes,
  });
  const withCards = (g: StampedGraph, cards: readonly StampedCard[]): StampedGraph => ({
    ...g,
    cards,
  });
  const editLane = (
    g: StampedGraph,
    i: number,
    patch: Partial<StampedLane>,
  ): StampedGraph =>
    withLanes(
      g,
      g.lanes.map((l, index) => (index === i ? { ...l, ...patch } : l)),
    );
  const editCard = (
    g: StampedGraph,
    i: number,
    patch: Partial<StampedCard>,
  ): StampedGraph =>
    withCards(
      g,
      g.cards.map((c, index) => (index === i ? { ...c, ...patch } : c)),
    );

  const MUTATIONS: ReadonlyArray<{ what: string; apply: (g: StampedGraph) => StampedGraph }> = [
    { what: 'a lane renamed', apply: (g) => editLane(g, 0, { name: 'Discovery II' }) },
    {
      what: 'the private lane published',
      apply: (g) => editLane(g, 1, { visibility: 'published' }),
    },
    { what: 'a lane position changed', apply: (g) => editLane(g, 2, { position: 9 }) },
    {
      what: 'two lanes reordered',
      apply: (g) => withLanes(g, [g.lanes[1], g.lanes[0], ...g.lanes.slice(2)] as StampedLane[]),
    },
    { what: 'a lane dropped', apply: (g) => withLanes(g, g.lanes.slice(1)) },
    { what: 'a card retitled', apply: (g) => editCard(g, 0, { title: 'Kickoff' }) },
    { what: 'a description nulled', apply: (g) => editCard(g, 0, { description: null }) },
    {
      what: 'a due date moved by one day',
      apply: (g) => editCard(g, 0, { dueAt: new Date((g.cards[0] as StampedCard).dueAt!.getTime() + DAY) }),
    },
    {
      what: 'a due date replaced by null',
      apply: (g) => editCard(g, 0, { dueAt: null }),
    },
    { what: 'contracted rounds changed', apply: (g) => editCard(g, 2, { contractedRounds: 7 }) },
    { what: 'a card position changed', apply: (g) => editCard(g, 1, { position: 5 }) },
    {
      what: 'two cards reordered',
      apply: (g) => withCards(g, [g.cards[1], g.cards[0], ...g.cards.slice(2)] as StampedCard[]),
    },
    { what: 'a card dropped', apply: (g) => withCards(g, g.cards.slice(1)) },
    {
      // The one that only interning can catch. Every id in the graph is still
      // an id that belongs in the graph, every count is unchanged, and the
      // board is wrong: a card from Discovery now hangs off Internal QA, which
      // is a *private* lane. A blanket `<id>` placeholder passes this.
      what: 'a card re-parented onto another lane',
      apply: (g) => editCard(g, 0, { laneId: (g.lanes[1] as StampedLane).id }),
    },
    {
      what: 'a shelf group renamed',
      apply: (g) => ({ ...g, shelfGroups: ['Brand', 'Legal', 'Source Files'] }),
    },
    {
      what: 'shelf groups reordered',
      apply: (g) => ({ ...g, shelfGroups: [...g.shelfGroups].reverse() }),
    },
    { what: 'a shelf group dropped', apply: (g) => ({ ...g, shelfGroups: g.shelfGroups.slice(1) }) },
  ];

  for (const mutation of MUTATIONS) {
    it(`catches ${mutation.what}`, () => {
      expect(shapeOf(mutation.apply(baseline()))).not.toEqual(shapeOf(baseline()));
    });
  }

  /* --- and the inverse: what the comparison must *not* catch --------------- */

  it('does not catch a fresh set of ids', () => {
    const g = baseline();
    const remap = new Map<string, string>();
    const fresh = (id: string): string => {
      const next = remap.get(id) ?? `zz-${String(remap.size).padStart(3, '0')}`;
      remap.set(id, next);
      return next;
    };
    const remapped: StampedGraph = {
      shelfGroups: g.shelfGroups,
      lanes: g.lanes.map((l) => ({ ...l, id: fresh(l.id), engagementId: fresh(l.engagementId) })),
      cards: g.cards.map((c) => ({
        ...c,
        id: fresh(c.id),
        laneId: fresh(c.laneId),
        engagementId: fresh(c.engagementId),
      })),
    };
    expect(remapped.lanes[0]?.id).not.toBe(g.lanes[0]?.id);
    expect(shapeOf(remapped)).toEqual(shapeOf(g));
  });

  it('does not catch every timestamp moving by a year', () => {
    const g = baseline();
    const shift = (d: Date): Date => new Date(d.getTime() + 365 * DAY);
    const moved: StampedGraph = {
      shelfGroups: g.shelfGroups,
      lanes: g.lanes.map((l) => ({ ...l, createdAt: shift(l.createdAt) })),
      cards: g.cards.map((c) => ({
        ...c,
        createdAt: shift(c.createdAt),
        updatedAt: shift(c.updatedAt),
      })),
    };
    expect(shapeOf(moved)).toEqual(shapeOf(g));
  });

  it('does not catch a difference in key insertion order', () => {
    const g = baseline();
    const reversedKeys: StampedGraph = {
      ...g,
      lanes: g.lanes.map((l) => Object.fromEntries(Object.entries(l).reverse()) as StampedLane),
    };
    expect(shapeOf(reversedKeys)).toEqual(shapeOf(g));
  });
});

/* ------------------------------------------------- the supplementary properties */

describe('PHASE-7 a template with a private lane stamps a private lane', () => {
  it('carries lane visibility across the stamp, both ways', () => {
    const { lanes } = stamp(TEMPLATE_FIXTURE, 'aa');
    expect(lanes.map((l) => [l.name, l.visibility])).toEqual([
      ['Discovery', 'published'],
      ['Internal QA', 'private'],
      ['Delivery', 'published'],
      ['Parked', 'published'],
    ]);
  });

  it('never defaults visibility — every stamped lane states it', () => {
    // ADR-006 puts the `published` default on the column, which answers "nobody
    // said". A template always said. If `applyTemplate` ever omitted the field
    // for published lanes, the column default would produce the right answer
    // for published lanes and the wrong one for a private lane whose author had
    // said so — and INV-1's premise is that lane visibility is what it says.
    for (const lane of stamp(TEMPLATE_FIXTURE, 'aa').lanes) {
      expect(Object.hasOwn(lane, 'visibility'), lane.name).toBe(true);
      expect(lane.visibility).not.toBeUndefined();
    }
  });

  it('a definition may not omit visibility in the first place', () => {
    const { lanes, ...rest } = TEMPLATE_FIXTURE;
    const laneless = lanes.map(({ visibility: _drop, ...lane }) => lane);
    expect(() => parseTemplateDefinition({ ...rest, lanes: laneless })).toThrow();
  });

  it('an all-private template stamps four private lanes and no published one', () => {
    const allPrivate: TemplateDefinition = {
      ...TEMPLATE_FIXTURE,
      lanes: TEMPLATE_FIXTURE.lanes.map((l) => ({ ...l, visibility: 'private' as const })),
    };
    const { lanes } = stamp(allPrivate, 'aa');
    expect(lanes.filter((l) => l.visibility === 'published')).toEqual([]);
    expect(lanes).toHaveLength(4);
  });
});

describe('PHASE-7 a stamped card takes the column default for state (INV-2)', () => {
  it('no stamped card carries a state at all', () => {
    for (const card of stamp(TEMPLATE_FIXTURE, 'aa').cards) {
      // Not `state === 'draft'`. A stamp that wrote `'draft'` explicitly would
      // be a second writer of `cards.state`, which is the thing INV-2 forbids,
      // and it would pass an equality check against the default. The property
      // has to be absent for the column to be the one that decides.
      expect(Object.hasOwn(card, 'state'), card.title).toBe(false);
    }
  });

  it('nor a possession, an assignee, or a rounds-used count', () => {
    for (const card of stamp(TEMPLATE_FIXTURE, 'aa').cards) {
      for (const forbidden of [
        'state',
        'assigneeId',
        'roundsUsed',
        'internalNotes',
        'effortEstimate',
        'visibilityOverride',
      ]) {
        expect(Object.hasOwn(card, forbidden), `${card.title}.${forbidden}`).toBe(false);
      }
    }
  });

  it('a definition carrying a state is refused rather than quietly stripped', () => {
    // zod's default is to strip unknown keys, which would turn "this template
    // sets state" into "this template silently does not" — and the author would
    // believe it worked. The parse is `.strict()` so it 400s instead.
    const withState = JSON.parse(JSON.stringify(TEMPLATE_FIXTURE)) as {
      lanes: { cards: Record<string, unknown>[] }[];
    };
    (withState.lanes[0] as { cards: Record<string, unknown>[] }).cards[0]!['state'] = 'approved';
    expect(() => parseTemplateDefinition(withState)).toThrow();
  });

  it('the stamped-card type has no state field to set', () => {
    // Structural, so it survives someone adding `state` to the runtime object
    // and matching the default. `satisfies` fails to compile if the key exists.
    const probe = { title: 'x' } satisfies Partial<Omit<StampedCard, never>>;
    expect(probe.title).toBe('x');
    const keys = Object.keys(stamp(TEMPLATE_FIXTURE, 'aa').cards[0] as StampedCard).sort();
    expect(keys).toEqual([
      'contractedRounds',
      'createdAt',
      'description',
      'dueAt',
      'engagementId',
      'id',
      'laneId',
      'position',
      'title',
      'updatedAt',
    ]);
  });
});

describe('PHASE-7 dueAfterDays resolves against the engagement start', () => {
  it('the same template stamped into two engagements gives different absolute dates', () => {
    const a = stamp(TEMPLATE_FIXTURE, 'aa', START_A);
    const b = stamp(TEMPLATE_FIXTURE, 'bb', START_B);

    // Structurally identical they are not — and must not be. This is the one
    // place the exit condition's own equality has to *fail*, because two
    // engagements that started eleven days apart have their work due eleven
    // days apart. A stamp that produced identical dates here would have baked a
    // calendar date into the template, which is the failure `dueAfterDays`
    // exists to prevent.
    expect(shapeOf(a)).not.toEqual(shapeOf(b));

    const dues = (g: StampedGraph): (string | null)[] =>
      g.cards.map((c) => c.dueAt?.toISOString() ?? null);
    expect(dues(a)).toEqual([
      dueFrom(START_A, 0),
      dueFrom(START_A, 7),
      null,
      dueFrom(START_A, 45),
      null,
    ]);
    expect(dues(b)).toEqual([
      dueFrom(START_B, 0),
      dueFrom(START_B, 7),
      null,
      dueFrom(START_B, 45),
      null,
    ]);
    for (const [i, due] of dues(a).entries()) {
      if (due === null) continue;
      expect(new Date(dues(b)[i] as string).getTime() - new Date(due).getTime()).toBe(11 * DAY);
    }
  });

  it('two engagements that started at the same instant do agree', () => {
    // The control for the case above. If dates differed here, the difference
    // would be coming from somewhere other than the start.
    expect(shapeOf(stamp(TEMPLATE_FIXTURE, 'aa', START_A))).toEqual(
      shapeOf(stamp(TEMPLATE_FIXTURE, 'bb', START_A)),
    );
  });

  it('day 0 is the start instant, not "no due date"', () => {
    // `dueAfterDays: 0` is the value a `dueAfterDays ? ... : null` falsiness bug
    // eats, and it eats it into exactly the value that means the opposite.
    const card = stamp(TEMPLATE_FIXTURE, 'aa').cards[0];
    expect(card?.title).toBe('Kickoff brief');
    expect(card?.dueAt?.toISOString()).toBe(START_A.toISOString());
  });

  it('the due date does not move with the row clock', () => {
    // `now` and `startedAt` are separate parameters. A stamp that measured from
    // `now` would be correct on the day the engagement was created and wrong
    // for every backdated import and every re-stamp — Phase 12's whole case.
    let n = 0;
    const graph = applyTemplate(TEMPLATE_FIXTURE, {
      engagementId: 'e',
      startedAt: START_A,
      now: new Date(START_A.getTime() + 500 * DAY),
      newId: () => `x-${String(n++)}`,
    });
    expect(graph.cards[0]?.dueAt?.toISOString()).toBe(START_A.toISOString());
  });

  it('no card carries a date the definition did not ask for', () => {
    const withNoDates: TemplateDefinition = {
      ...TEMPLATE_FIXTURE,
      lanes: TEMPLATE_FIXTURE.lanes.map((l) => ({
        ...l,
        cards: l.cards.map((c) => ({ ...c, dueAfterDays: null })),
      })),
    };
    expect(stamp(withNoDates, 'aa').cards.map((c) => c.dueAt)).toEqual([null, null, null, null, null]);
  });
});

describe('PHASE-7 a definition round-trips through jsonb unchanged', () => {
  it('survives JSON serialisation and the parse that reads it back', () => {
    // `templates.definition` is jsonb. The column will hand a row back years
    // after the code that wrote it, and `row.definition as TemplateDefinition`
    // is a cast rather than a check — so the read side parses, and the parse
    // must be a fixed point.
    const stored: unknown = JSON.parse(JSON.stringify(TEMPLATE_FIXTURE));
    const readBack = parseTemplateDefinition(stored);
    expect(readBack).toEqual(TEMPLATE_FIXTURE);
    expect(JSON.parse(JSON.stringify(readBack))).toEqual(stored);
  });

  it('stamps the same graph before and after the round trip', () => {
    const readBack = parseTemplateDefinition(JSON.parse(JSON.stringify(TEMPLATE_FIXTURE)));
    expect(shapeOf(stamp(readBack, 'aa'))).toEqual(shapeOf(stamp(TEMPLATE_FIXTURE, 'bb')));
  });

  it('is a fixed point under repeated round trips', () => {
    let def = TEMPLATE_FIXTURE;
    for (let i = 0; i < 3; i += 1) {
      def = parseTemplateDefinition(JSON.parse(JSON.stringify(def)));
    }
    expect(def).toEqual(TEMPLATE_FIXTURE);
    expect(shapeOf(stamp(def, 'aa'))).toEqual(shapeOf(stamp(TEMPLATE_FIXTURE, 'aa')));
  });

  it('a stored row from a future version fails loudly rather than being read by v1 rules', () => {
    const future = { ...JSON.parse(JSON.stringify(TEMPLATE_FIXTURE)), version: 2 };
    expect(() => parseTemplateDefinition(future, 'stored definition')).toThrow();
  });

  it('every twin also round-trips, so the battery is not testing an unstorable shape', () => {
    for (const twin of TEMPLATE_TWINS) {
      const readBack = parseTemplateDefinition(JSON.parse(JSON.stringify(twin.def)));
      expect(readBack, twin.what).toEqual(twin.def);
    }
  });
});
