/**
 * The one shape both halves of the template loop are rendered from.
 *
 * A template is only worth building if the loop closes: you save a board, you
 * stamp it, and the board you get back is the board you saved. The cheapest way
 * to make that legible — and the cheapest way to notice when it stops being
 * true — is for the *capture* preview and the *stamp* preview to be the same
 * renderer over the same view model, rather than two components that agree
 * today because someone kept them in step.
 *
 * So there are two adapters and one shape:
 *
 *   - `shapeFromDefinition()` — a saved `TemplateDefinition`, read back.
 *   - `shapeFromBoard()` — the live `AgencyLane[]` a capture is about to take.
 *
 * Nothing here formats, styles, or decides anything. It exists so the preview
 * component has a single input type.
 *
 * **This module deliberately does not derive a `TemplateDefinition` from a
 * board.** The definition is written by the server from the rows it owns
 * (`POST /api/templates` takes `fromEngagementId`), because a definition
 * assembled in the browser would let a form state a lane's visibility, and lane
 * visibility is the value INV-1 is about. What is built here is a *view* of
 * what will be captured, which is a different and much weaker claim.
 */

import type { AgencyLane, LaneVisibility, TemplateDefinition } from '@/lib/types';

export interface TemplateShapeLane {
  readonly name: string;
  readonly visibility: LaneVisibility;
  /** Titles in board order. The preview shows the first few and counts the rest. */
  readonly cardTitles: readonly string[];
}

export interface TemplateShape {
  readonly lanes: readonly TemplateShapeLane[];
  readonly shelfGroups: readonly string[];
  readonly contractedRoundsDefault: number | null;
}

/** Totals, computed once so a preview and a plate cannot disagree. */
export interface TemplateCounts {
  readonly laneCount: number;
  readonly cardCount: number;
  readonly privateLaneCount: number;
  readonly shelfGroupCount: number;
}

export function templateCounts(shape: TemplateShape): TemplateCounts {
  return {
    laneCount: shape.lanes.length,
    cardCount: shape.lanes.reduce((n, lane) => n + lane.cardTitles.length, 0),
    privateLaneCount: shape.lanes.filter((lane) => lane.visibility === 'private').length,
    shelfGroupCount: shape.shelfGroups.length,
  };
}

export function shapeFromDefinition(definition: TemplateDefinition): TemplateShape {
  return {
    lanes: definition.lanes.map((lane) => ({
      name: lane.name,
      visibility: lane.visibility,
      cardTitles: lane.cards.map((card) => card.title),
    })),
    shelfGroups: definition.shelfGroups,
    contractedRoundsDefault: definition.contractedRoundsDefault,
  };
}

/**
 * What a capture of this board would take.
 *
 * Every lane, including the private ones — a template that silently dropped
 * them would stamp a board missing exactly the lanes the agency keeps its own
 * work in, and the person doing the capture would not find out until the next
 * engagement. The preview states which lanes are private instead; that is a
 * fact about the docket, not a warning about it.
 *
 * Card *state* is not read and there is no field for it here, for the same
 * reason `TemplateCard` has none: a stamped card starts at the column default
 * and moves only through the machine (INV-2).
 */
export function shapeFromBoard(
  lanes: readonly AgencyLane[],
  shelfGroups: readonly string[],
  contractedRoundsDefault: number | null,
): TemplateShape {
  return {
    lanes: lanes.map((lane) => ({
      name: lane.name,
      visibility: lane.visibility,
      cardTitles: lane.cards.map((card) => card.title),
    })),
    shelfGroups,
    contractedRoundsDefault,
  };
}

/**
 * A definition whose `version` this build does not know how to read.
 *
 * `TemplateDefinition.version` is `1` in the type, so this can only ever be
 * true of a row written by a later build — which is precisely the case worth
 * handling, because the alternative is rendering the lanes a future shape
 * happens to still have and silently omitting whatever it added.
 */
export function isReadableDefinition(definition: TemplateDefinition): boolean {
  return definition.version === 1 && Array.isArray(definition.lanes);
}
