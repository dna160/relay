/**
 * Template fixtures, and the normalisation that PHASE-7's exit condition rests
 * on.
 *
 * > **EXIT:** stamping a template twice produces structurally identical graphs.
 *
 * "Structurally identical" means *identical modulo ids and timestamps*, and the
 * whole test lives or dies on that phrase being made precise. Normalise too
 * little and the assertion fails on freshly-minted uuids every run, so somebody
 * relaxes it. Normalise too hard and two genuinely different boards compare
 * equal, the suite goes green forever, and the exit condition has been retired
 * rather than proved — the same shape as every other escape this build has
 * found: the guard reads something narrower than the invariant claims.
 *
 * So what is stripped is stated here, enumerated mechanically by
 * {@link normaliseStamp}, and asserted against a literal list in
 * `tests/unit/template-determinism.spec.ts`. Adding a field to the strip list
 * is a diff a reviewer sees.
 *
 * ## What is stripped, and why each one has to be
 *
 * | Rule | Keys | Why it cannot be compared |
 * |---|---|---|
 * | **id** | `id`, `*Id`, `*_id` | Minted at stamp time. `TemplateDefinition` has no id field precisely so that this is the only thing that differs. |
 * | **timestamp** | `createdAt`, `updatedAt`, `created_at`, `updated_at` | Written from the clock at insert. |
 *
 * That is the entire list. Two lists.
 *
 * ## What is deliberately NOT stripped, and why
 *
 * - **`dueAt`.** It looks like a timestamp and it is not one of these: it is
 *   *derived* from `dueAfterDays` and the engagement's start, both of which are
 *   inputs. Stripping it would erase a result, and it would make the property
 *   the relative field exists for — the same template stamped into two
 *   engagements that started on different days yields different absolute dates
 *   — unassertable. The fixture-expiry bug in a different costume.
 * - **`position`**, **`name`**, **`title`**, **`description`**,
 *   **`visibility`**, **`state`**, **`contractedRounds`**, **`roundsUsed`**,
 *   and array order. These are the graph. If any of them ever joins the strip
 *   list, `template-determinism.spec.ts` fails on its kept-path ledger.
 *
 * ## Ids are interned, not blanked
 *
 * Replacing every id with a single placeholder would erase the graph's *wiring*
 * along with its values: a stamp that hung every card off the wrong lane would
 * normalise to exactly the same thing as one that hung them off the right one.
 *
 * So each distinct id string is replaced by an ordinal assigned on first
 * appearance in traversal order. Identical wiring produces identical ordinals;
 * a re-parented card, a dangling reference, or an id reused where it should not
 * be produces different ones. Interning is strictly *more* discriminating than
 * blanking, and it still compares equal across two runs that minted entirely
 * different uuids — which is the modulo the exit condition asks for.
 */

import { DAY, T0 } from './clock';
import type { TemplateCard, TemplateDefinition, TemplateLane } from '@/lib/types';

/* ------------------------------------------------------------- definitions */

function card(
  title: string,
  overrides: Partial<Omit<TemplateCard, 'title'>> = {},
): TemplateCard {
  return {
    title,
    description: overrides.description ?? null,
    contractedRounds: overrides.contractedRounds ?? null,
    dueAfterDays: overrides.dueAfterDays ?? null,
  };
}

/**
 * The template every determinism assertion is made against.
 *
 * Deliberately awkward in the four places a stamping implementation is most
 * likely to be sloppy:
 *
 * 1. **A private lane**, second in order. Lane visibility surviving the round
 *    trip is INV-1's premise — a template that silently published a private
 *    lane would put every downstream visibility guarantee on sand — and putting
 *    it in the middle means a `[0]`-only check does not accidentally pass.
 * 2. **An empty lane.** A stamp that filters lanes by "has cards" loses it, and
 *    loses it identically on both runs, so only a lane-count assertion sees it.
 * 3. **`dueAfterDays: 0`** alongside `null` and a large value. Zero is the
 *    value a `dueAfterDays ? ... : null` falsiness bug eats, and it means "due
 *    the day the engagement starts", not "no due date".
 * 4. **`contractedRounds` stated, absent, and zero**, against a non-null
 *    `contractedRoundsDefault`. Absent must inherit the default; zero must not.
 */
export const TEMPLATE_FIXTURE: TemplateDefinition = {
  version: 1,
  contractedRoundsDefault: 2,
  shelfGroups: ['Brand', 'Legal', 'Source files'],
  lanes: [
    {
      name: 'Discovery',
      visibility: 'published',
      cards: [
        card('Kickoff brief', { description: 'Agreed scope, one page.', dueAfterDays: 0 }),
        card('Audience research', { dueAfterDays: 7, contractedRounds: 1 }),
      ],
    },
    {
      name: 'Internal QA',
      visibility: 'private',
      cards: [card('Accessibility sweep', { contractedRounds: 0 })],
    },
    {
      name: 'Delivery',
      visibility: 'published',
      cards: [
        card('Final artwork', { dueAfterDays: 45 }),
        card('Handover pack', { description: null, dueAfterDays: null }),
      ],
    },
    { name: 'Parked', visibility: 'published', cards: [] },
  ],
};

/** The degenerate template. A normalisation loose enough to make this equal to
 *  {@link TEMPLATE_FIXTURE} has stopped testing anything. */
export const TEMPLATE_EMPTY: TemplateDefinition = {
  version: 1,
  contractedRoundsDefault: null,
  shelfGroups: [],
  lanes: [],
};

/**
 * Twins of {@link TEMPLATE_FIXTURE}, each differing in exactly one field.
 *
 * Stamping a twin must not produce a graph that normalises equal to a stamp of
 * the original. This is the exit condition's negative control at the level that
 * matters — the real function, not the harness — and it is what stops the
 * comparison being "two identical inputs produced two identical outputs", which
 * a normaliser that returned `null` would also satisfy.
 */
export const TEMPLATE_TWINS: ReadonlyArray<{
  readonly what: string;
  readonly def: TemplateDefinition;
}> = [
  {
    what: 'a lane renamed',
    def: withLanes((lanes) =>
      replaceAt(lanes, 0, { ...at(lanes, 0), name: 'Discovery & scoping' }),
    ),
  },
  {
    what: 'the private lane published',
    def: withLanes((lanes) => replaceAt(lanes, 1, { ...at(lanes, 1), visibility: 'published' })),
  },
  {
    what: 'two lanes swapped',
    def: withLanes((lanes) => [at(lanes, 2), at(lanes, 1), at(lanes, 0), at(lanes, 3)]),
  },
  {
    what: 'two cards swapped inside one lane',
    def: withLanes((lanes) =>
      replaceAt(lanes, 0, {
        ...at(lanes, 0),
        cards: [...at(lanes, 0).cards].reverse(),
      }),
    ),
  },
  {
    what: 'a card dropped',
    def: withLanes((lanes) =>
      replaceAt(lanes, 0, { ...at(lanes, 0), cards: at(lanes, 0).cards.slice(1) }),
    ),
  },
  {
    what: 'a card added',
    def: withLanes((lanes) =>
      replaceAt(lanes, 3, { ...at(lanes, 3), cards: [card('Something later')] }),
    ),
  },
  {
    what: 'the empty lane removed',
    def: withLanes((lanes) => lanes.slice(0, 3)),
  },
  {
    what: 'a due offset moved by one day',
    def: withLanes((lanes) =>
      replaceAt(lanes, 2, {
        ...at(lanes, 2),
        cards: [{ ...(at(lanes, 2).cards[0] as TemplateCard), dueAfterDays: 46 }, ...at(lanes, 2).cards.slice(1)],
      }),
    ),
  },
  {
    what: 'a due offset of 0 turned into no due date',
    def: withLanes((lanes) =>
      replaceAt(lanes, 0, {
        ...at(lanes, 0),
        cards: [{ ...(at(lanes, 0).cards[0] as TemplateCard), dueAfterDays: null }, ...at(lanes, 0).cards.slice(1)],
      }),
    ),
  },
  {
    what: "a card's contracted rounds changed",
    def: withLanes((lanes) =>
      replaceAt(lanes, 0, {
        ...at(lanes, 0),
        cards: [at(lanes, 0).cards[0] as TemplateCard, { ...(at(lanes, 0).cards[1] as TemplateCard), contractedRounds: 4 }],
      }),
    ),
  },
  {
    what: 'a description nulled',
    def: withLanes((lanes) =>
      replaceAt(lanes, 0, {
        ...at(lanes, 0),
        cards: [{ ...(at(lanes, 0).cards[0] as TemplateCard), description: null }, ...at(lanes, 0).cards.slice(1)],
      }),
    ),
  },
  {
    what: 'the contracted-rounds default changed',
    def: { ...TEMPLATE_FIXTURE, contractedRoundsDefault: 3 },
  },
  {
    what: 'a shelf group renamed',
    def: { ...TEMPLATE_FIXTURE, shelfGroups: ['Brand', 'Legal', 'Source Files'] },
  },
  {
    what: 'a shelf group added',
    def: { ...TEMPLATE_FIXTURE, shelfGroups: [...TEMPLATE_FIXTURE.shelfGroups, 'Fonts'] },
  },
  {
    what: 'shelf groups reordered',
    def: { ...TEMPLATE_FIXTURE, shelfGroups: ['Legal', 'Brand', 'Source files'] },
  },
];

function at(lanes: readonly TemplateLane[], i: number): TemplateLane {
  const lane = lanes[i];
  if (!lane) throw new Error(`TEMPLATE_FIXTURE has no lane ${String(i)}`);
  return lane;
}

function replaceAt(
  lanes: readonly TemplateLane[],
  i: number,
  lane: TemplateLane,
): readonly TemplateLane[] {
  return lanes.map((existing, index) => (index === i ? lane : existing));
}

function withLanes(
  fn: (lanes: readonly TemplateLane[]) => readonly TemplateLane[],
): TemplateDefinition {
  return { ...TEMPLATE_FIXTURE, lanes: fn(TEMPLATE_FIXTURE.lanes) };
}

/* ------------------------------------------------------------- two starts */

/**
 * Two engagement start instants, eleven days apart, for the `dueAfterDays`
 * property. Frozen — nothing here is ever compared against a live `now()`.
 */
export const START_A = T0;
export const START_B = new Date(T0.getTime() + 11 * DAY);

/** What `dueAfterDays: n` must resolve to against a given start. */
export function dueFrom(start: Date, dueAfterDays: number): string {
  return new Date(start.getTime() + dueAfterDays * DAY).toISOString();
}

/* --------------------------------------------------------- normalisation */

const ID_KEY = /^(id|.+Id|.+_id)$/;
const TIMESTAMP_KEY = /^(createdAt|updatedAt|created_at|updated_at)$/;

export const ID_PLACEHOLDER_PREFIX = '<id:';
export const TIMESTAMP_PLACEHOLDER = '<timestamp>';

export interface Normalised {
  /** The graph with ids interned and timestamps flattened. Compare with `toEqual`. */
  readonly shape: unknown;
  /** Leaf paths replaced, as `rule path`. Sorted and deduped. */
  readonly stripped: readonly string[];
  /** Leaf paths that survived untouched. Sorted and deduped. */
  readonly kept: readonly string[];
  /** How many distinct id strings the graph contained. */
  readonly distinctIds: number;
}

/**
 * Normalise one stamped graph for comparison against another.
 *
 * Shape-agnostic on purpose: it walks whatever `applyTemplate()` returns rather
 * than naming its fields, so the suite does not have to be rewritten when the
 * return type gains a key — and, more importantly, a *new* key is compared by
 * default rather than ignored by default. A guard that only looks at the fields
 * it was told about is the hole, not the guard.
 *
 * Array indices collapse to `[]` in the reported paths (`lanes[].cards[].id`),
 * because the ledger is about which *fields* are exempt, not which rows.
 */
export function normaliseStamp(graph: unknown): Normalised {
  const interned = new Map<string, number>();
  const stripped = new Set<string>();
  const kept = new Set<string>();

  const walk = (value: unknown, path: string, key: string | null): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, `${path}[]`, key));
    }
    if (value instanceof Date) {
      return leaf(value.toISOString(), path, key);
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      // Sorted so that a key-insertion-order difference between two runs — which
      // is not a structural difference — cannot fail the comparison, while a
      // key present in one graph and absent in the other still does.
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        out[k] = walk((value as Record<string, unknown>)[k], path === '' ? k : `${path}.${k}`, k);
      }
      return out;
    }
    return leaf(value, path, key);
  };

  const leaf = (value: unknown, path: string, key: string | null): unknown => {
    const where = path === '' ? '$' : path;
    if (key !== null && ID_KEY.test(key) && typeof value === 'string' && value !== '') {
      let ordinal = interned.get(value);
      if (ordinal === undefined) {
        ordinal = interned.size;
        interned.set(value, ordinal);
      }
      stripped.add(`id ${where}`);
      return `${ID_PLACEHOLDER_PREFIX}${String(ordinal)}>`;
    }
    if (key !== null && TIMESTAMP_KEY.test(key) && (typeof value === 'string' || value instanceof Date)) {
      stripped.add(`timestamp ${where}`);
      return TIMESTAMP_PLACEHOLDER;
    }
    // An id key holding `null` is kept: absent-vs-present is structural, and
    // `assigneeId: null` on a stamped card is a fact worth failing over.
    kept.add(where);
    return value;
  };

  const shape = walk(graph, '', null);
  return {
    shape,
    stripped: [...stripped].sort(),
    kept: [...kept].sort(),
    distinctIds: interned.size,
  };
}

/* --------------------------------------------- leftover-nondeterminism net */

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_SHAPED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Every path in a normalised shape still holding a uuid- or ISO-timestamp-shaped
 * string.
 *
 * The strip list is enumerated by *key name*, which is exactly the thing that
 * can be incomplete: a stamped graph gaining `laneUuid` or `stampedOn` would
 * carry a fresh value on every run, the determinism assertion would start
 * failing, and the cheapest way out would be to widen the strip list until it
 * stopped. This turns "did we enumerate every key?" into a mechanical question
 * with a sanctioned-survivors list, so the answer is visible in a diff rather
 * than discovered by a flake.
 */
export function volatileLooking(shape: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, `${path}[]`);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path === '' ? k : `${path}.${k}`);
      }
      return;
    }
    if (typeof value === 'string' && (UUID_SHAPED.test(value) || ISO_SHAPED.test(value))) {
      found.push(path === '' ? '$' : path);
    }
  };
  walk(shape, '');
  return [...new Set(found)].sort();
}
