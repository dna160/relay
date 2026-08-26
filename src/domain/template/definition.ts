/**
 * The trust boundary for a `TemplateDefinition`.
 *
 * A definition arrives from three places and exactly one of them is a request
 * body: a POST, a `templates.definition` jsonb column read back years after the
 * code that wrote it, and — from Phase 12 — a document a human confirmed
 * (INV-13). All three are untrusted. jsonb is not a type: the column will
 * happily hand back a row written by a build that had different rules, and
 * `row.definition as TemplateDefinition` is a cast, not a check.
 *
 * So there is one parse, it runs on **read as well as write**, and it rejects
 * rather than coerces. Coercion is the failure mode that matters here: a
 * definition silently repaired on read stamps a board nobody described, and the
 * repair is invisible because the stamp succeeds.
 *
 * ## What `.strict()` is doing
 *
 * Rejecting unknown keys, not tidying them away. The key this exists to refuse
 * is `state`. `TemplateDefinition` has no `state` field on purpose (INV-2 —
 * `cards.state` has exactly one writer, and a template that could set it would
 * be a second one). zod's default is to *strip* unknown keys, which would turn
 * a definition that tries to set state into one that silently does not — the
 * author would believe it worked. `.strict()` turns it into a 400 that names
 * the field.
 *
 * ## Versioning
 *
 * `version` is a `z.literal(1)`, not a `z.number()`. A stored row from a future
 * shape must fail loudly here rather than be parsed by v1 rules and stamped
 * into a board that is wrong in ways no test covers. When a v2 shape exists,
 * this becomes a discriminated union on `version` and old rows keep parsing —
 * which is the whole reason the field is in the persisted shape at all.
 */

import { z, ZodError } from 'zod';
import type { TemplateCard, TemplateDefinition, TemplateLane } from '@/lib/types';
import { validationFailed } from '../errors';

/**
 * Caps, not opinions. Stamping is one transaction (a half-stamped board is
 * worse than a failed create), so the size of a definition is the size of that
 * transaction, and a definition is user-supplied. These are an order of
 * magnitude above any real agency's board and two below anything that would
 * hold a write lock long enough to notice.
 *
 * `LANE_NAME_MAX` and `CARD_TITLE_MAX` match the `POST /api/lanes` and
 * `POST /api/cards` schemas exactly. A template must not be a way to write a
 * lane name the lane route would have rejected.
 */
export const TEMPLATE_LIMITS = {
  LANES_MAX: 50,
  CARDS_MAX: 500,
  SHELF_GROUPS_MAX: 50,
  NAME_MAX: 120,
  LANE_NAME_MAX: 120,
  CARD_TITLE_MAX: 200,
  CARD_DESCRIPTION_MAX: 5000,
  SHELF_GROUP_LABEL_MAX: 120,
  CONTRACTED_ROUNDS_MAX: 99,
  /** Ten years. A due date further out than the retention window is a typo. */
  DUE_AFTER_DAYS_MAX: 3650,
} as const;

const contractedRounds = z
  .number()
  .int()
  .min(0)
  .max(TEMPLATE_LIMITS.CONTRACTED_ROUNDS_MAX)
  .nullable();

const templateCardSchema = z
  .object({
    title: z.string().trim().min(1).max(TEMPLATE_LIMITS.CARD_TITLE_MAX),
    description: z.string().max(TEMPLATE_LIMITS.CARD_DESCRIPTION_MAX).nullable(),
    contractedRounds,
    /**
     * Never a calendar date, and never negative. "Three days before the
     * engagement starts" is not a thing a stamp can mean — the start is the
     * origin — so the type's silence is made explicit here rather than
     * clamped later.
     */
    dueAfterDays: z
      .number()
      .int()
      .min(0)
      .max(TEMPLATE_LIMITS.DUE_AFTER_DAYS_MAX)
      .nullable(),
  })
  .strict();

const templateLaneSchema = z
  .object({
    name: z.string().trim().min(1).max(TEMPLATE_LIMITS.LANE_NAME_MAX),
    /**
     * Required, not optional-defaulting-to-published. The column carries the
     * product default (ADR-006) for a lane nobody described; a *template* is a
     * description, and a template that forgot to say is a template whose author
     * did not decide. Making it explicit here is what stops a private lane from
     * becoming published on a round trip through the picker.
     */
    visibility: z.enum(['published', 'private']),
    cards: z.array(templateCardSchema).max(TEMPLATE_LIMITS.CARDS_MAX),
  })
  .strict();

const templateDefinitionSchema = z
  .object({
    version: z.literal(1),
    lanes: z.array(templateLaneSchema).max(TEMPLATE_LIMITS.LANES_MAX),
    shelfGroups: z
      .array(z.string().trim().min(1).max(TEMPLATE_LIMITS.SHELF_GROUP_LABEL_MAX))
      .max(TEMPLATE_LIMITS.SHELF_GROUPS_MAX),
    contractedRoundsDefault: contractedRounds,
  })
  .strict()
  .superRefine((def, ctx) => {
    const total = def.lanes.reduce((sum, lane) => sum + lane.cards.length, 0);
    if (total > TEMPLATE_LIMITS.CARDS_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: TEMPLATE_LIMITS.CARDS_MAX,
        type: 'array',
        inclusive: true,
        path: ['lanes'],
        message: `A template may stamp at most ${String(TEMPLATE_LIMITS.CARDS_MAX)} cards; this one has ${String(total)}.`,
      });
    }
    const seen = new Set<string>();
    for (const [i, label] of def.shelfGroups.entries()) {
      if (seen.has(label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shelfGroups', i],
          // A shelf group is a label, so two identical labels are one group.
          // Stamping both would write a duplicate that no rename can separate.
          message: `Duplicate shelf group ${JSON.stringify(label)}.`,
        });
      }
      seen.add(label);
    }
  });

/** The zod shape, exported so a route can compose it into a request schema. */
export const templateDefinitionShape = templateDefinitionSchema;

/**
 * The only way to obtain a `TemplateDefinition` in this codebase.
 *
 * Throws `VALIDATION_FAILED` (400). `where` names the side of the boundary the
 * value came from so a corrupt stored row does not read like a bad request in
 * the logs.
 */
export function parseTemplateDefinition(raw: unknown, where = 'definition'): TemplateDefinition {
  try {
    const parsed = templateDefinitionSchema.parse(raw);
    return freezeDefinition(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      throw validationFailed(`That ${where} is not a valid template definition`, error.flatten());
    }
    throw error;
  }
}

/**
 * The read-side form: `null` instead of a throw.
 *
 * The list endpoint needs it. One unparseable row must not take the whole
 * picker down with it, and there is no honest count to show for a definition
 * nobody can read — `laneCount: 0` would be a coercion wearing a number. The
 * caller logs the id and leaves the row out; stamping it by id still throws,
 * because at that point the caller asked for that specific template and a
 * silent substitute would be the worst answer available.
 */
export function tryParseTemplateDefinition(raw: unknown): TemplateDefinition | null {
  const result = templateDefinitionSchema.safeParse(raw);
  return result.success ? freezeDefinition(result.data) : null;
}

/**
 * `TemplateDefinition` is `readonly` all the way down in the type system and
 * nowhere at runtime. Freezing makes the type true, which matters more than
 * usual here: `applyTemplate()` is pure, the exit condition is that stamping
 * twice is structurally identical, and the cheapest way to break both at once
 * is for something downstream to sort a lane array in place.
 */
function freezeDefinition(def: {
  version: 1;
  lanes: { name: string; visibility: 'published' | 'private'; cards: TemplateCard[] }[];
  shelfGroups: string[];
  contractedRoundsDefault: number | null;
}): TemplateDefinition {
  const lanes: readonly TemplateLane[] = Object.freeze(
    def.lanes.map((lane) =>
      Object.freeze({
        name: lane.name,
        visibility: lane.visibility,
        cards: Object.freeze(lane.cards.map((card) => Object.freeze({ ...card }))),
      }),
    ),
  );
  return Object.freeze({
    version: 1,
    lanes,
    shelfGroups: Object.freeze([...def.shelfGroups]),
    contractedRoundsDefault: def.contractedRoundsDefault,
  });
}

/** For the picker, without handing the whole definition to the list endpoint. */
export function countTemplate(def: TemplateDefinition): { laneCount: number; cardCount: number } {
  return {
    laneCount: def.lanes.length,
    cardCount: def.lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
  };
}

/** An empty template. The shape a blank workspace stamps, and a test fixture. */
export const EMPTY_TEMPLATE_DEFINITION: TemplateDefinition = Object.freeze({
  version: 1,
  lanes: Object.freeze([]),
  shelfGroups: Object.freeze([]),
  contractedRoundsDefault: null,
});
