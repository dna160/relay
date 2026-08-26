/**
 * Creating a template row.
 *
 * Two ways in, one insert:
 *
 *   1. an explicit `TemplateDefinition` — what a future editor posts, and what
 *      Phase 12 will hand over once a human has confirmed an extraction; and
 *   2. an engagement id — "save this board as a template", which is the one
 *      anybody actually uses.
 *
 * Both converge on a parsed definition before the insert, so a definition that
 * came from a document and a definition that came from a board are the same
 * kind of value by the time anything writes it. That convergence is the reason
 * `applyTemplate()` is not coupled to this table: the table is where a
 * definition may be kept, never where one has to come from (INV-13).
 */

import { templates } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { TemplateDefinition } from '@/lib/types';
import { validationFailed } from '../errors';
import { countTemplate, parseTemplateDefinition, TEMPLATE_LIMITS } from './definition';
import { deriveTemplateDefinition, type DeriveTemplateInput } from './derive';

export interface SaveTemplateInput {
  readonly orgId: string;
  readonly name: string;
  readonly definition: unknown;
}

export interface SavedTemplate {
  readonly id: string;
  readonly name: string;
  readonly definition: TemplateDefinition;
  readonly laneCount: number;
  readonly cardCount: number;
  readonly createdAt: Date;
}

export async function saveTemplate(
  exec: Executor,
  input: SaveTemplateInput,
  now: Date,
): Promise<SavedTemplate> {
  const name = input.name.trim();
  if (name.length === 0) throw validationFailed('A template needs a name');
  if (name.length > TEMPLATE_LIMITS.NAME_MAX) {
    throw validationFailed(`A template name is at most ${String(TEMPLATE_LIMITS.NAME_MAX)} characters`);
  }
  /**
   * Parsed on the way in as well as on the way out. The column is jsonb and
   * will store any shape it is handed; validating only on read would mean the
   * request that broke a definition succeeded and the agency found out weeks
   * later, from a picker that had quietly stopped listing it.
   */
  const definition = parseTemplateDefinition(input.definition, 'definition');

  const inserted = await exec
    .insert(templates)
    .values({ orgId: input.orgId, name, definition, createdAt: now })
    .returning({
      id: templates.id,
      name: templates.name,
      createdAt: templates.createdAt,
    });

  const row = inserted[0];
  if (!row) throw new Error('template insert returned no row');

  return { ...row, definition, ...countTemplate(definition) };
}

/**
 * "Save as template", given the rows of a live board.
 *
 * The derivation is pure and lives in `derive.ts`; this only chains it into the
 * save so that the thing being inserted has been through the same parse as an
 * explicitly posted definition. Deriving and then *not* re-parsing would make
 * the derivation the one path that could write a row the reader rejects.
 */
export async function saveTemplateFromBoard(
  exec: Executor,
  input: {
    readonly orgId: string;
    readonly name: string;
    readonly source: DeriveTemplateInput;
  },
  now: Date,
): Promise<SavedTemplate> {
  return saveTemplate(
    exec,
    { orgId: input.orgId, name: input.name, definition: deriveTemplateDefinition(input.source) },
    now,
  );
}
