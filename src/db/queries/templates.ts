/**
 * Template reads. Agency sessions only — nothing in this file is reachable from
 * a client entry point, and nothing in it takes a `ClientScope`, because a
 * reviewer has no relationship to a template at all. A reviewer's session is
 * scoped to one engagement (INV-6); a template belongs to the organisation and
 * describes engagements that do not exist yet.
 *
 * Every function here takes `orgId` and filters on it. Not "the caller already
 * checked" — the filter is in the `WHERE`, so another organisation's template
 * comes back as "no row", which the caller turns into a 404 and never a 403.
 * A 403 on a template id is a probe that confirms the id is real.
 */

import { and, desc, eq } from 'drizzle-orm';
import { cards, engagements, lanes, referenceFiles, templates } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { TemplateDefinition, TemplateSummary } from '@/lib/types';
import { countTemplate, parseTemplateDefinition, tryParseTemplateDefinition } from '@/domain/template/definition';
import type { DeriveTemplateInput } from '@/domain/template/derive';
import { notVisible } from '@/domain/errors';

/**
 * A row whose `definition` will not parse is **left out**, with its id logged.
 *
 * It is the least-bad of three answers. Failing the whole request makes one
 * corrupt row hide every good one. Returning it with `laneCount: 0` is a
 * coercion wearing a number — the picker would offer a template that stamps
 * nothing. Leaving it out means the only thing the agency cannot do is pick a
 * template that could not have been stamped anyway, and the log names the id so
 * an operator can look.
 */
export async function listTemplates(exec: Executor, orgId: string): Promise<TemplateSummary[]> {
  const rows = await exec
    .select({
      id: templates.id,
      name: templates.name,
      definition: templates.definition,
      createdAt: templates.createdAt,
    })
    .from(templates)
    .where(eq(templates.orgId, orgId))
    .orderBy(desc(templates.createdAt));

  const items: TemplateSummary[] = [];
  for (const row of rows) {
    const definition = tryParseTemplateDefinition(row.definition);
    if (!definition) {
      console.warn(
        `[templates] ${row.id} holds a definition this build cannot parse; omitted from the ` +
          'picker. It was written by a different shape, or by hand. Stamping it by id still 400s.',
      );
      continue;
    }
    const { laneCount, cardCount } = countTemplate(definition);
    items.push({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      laneCount,
      cardCount,
    });
  }
  return items;
}

export interface LoadedTemplate {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly definition: TemplateDefinition;
}

/**
 * One template, org-scoped, parsed. **`null` when there is no such row for this
 * organisation** — absent, never forbidden.
 *
 * Two different failures, two different shapes, and the difference matters:
 *
 *   - A template belonging to another organisation is `null`, which every
 *     caller turns into a 404. Not a thrown 403 and not a thrown 404 either —
 *     "no row" is a fact about a query, and the query layer says it by
 *     returning nothing. Which template ids exist is not something this caller
 *     is entitled to learn, and a 403 would tell them.
 *   - A row that belongs to *this* organisation and will not parse **throws**
 *     `VALIDATION_FAILED` (400, from the parser). Collapsing that into `null`
 *     would tell an agency its own template had vanished, and it would make the
 *     picker's silent omission indistinguishable from a deletion.
 */
export async function loadTemplate(
  exec: Executor,
  templateId: string,
  orgId: string,
): Promise<LoadedTemplate | null> {
  const rows = await exec
    .select({
      id: templates.id,
      name: templates.name,
      definition: templates.definition,
      createdAt: templates.createdAt,
    })
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.orgId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    definition: parseTemplateDefinition(row.definition, `stored definition for template ${row.id}`),
  };
}

/**
 * Everything `deriveTemplateDefinition()` needs from a live board, and nothing
 * else.
 *
 * Deliberately not `loadAgencyBoard()`. That read pulls versions, transitions,
 * and assignees to compute possession and a projection, none of which a
 * template can contain — saving a board as a template would load the whole
 * approval history to throw it away. The narrow read is also the honest one:
 * the columns this selects are, field for field, the columns a definition can
 * hold.
 */
export async function loadTemplateSource(
  exec: Executor,
  engagementId: string,
): Promise<DeriveTemplateInput> {
  const engagementRows = await exec
    .select({
      startedAt: engagements.startedAt,
      createdAt: engagements.createdAt,
      contractedRoundsDefault: engagements.contractedRoundsDefault,
      shelfGroupLabels: engagements.shelfGroupLabels,
    })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);

  const engagement = engagementRows[0];
  if (!engagement) throw notVisible('Engagement not found');

  const [laneRows, cardRows, shelfRows] = await Promise.all([
    exec
      .select({
        id: lanes.id,
        name: lanes.name,
        position: lanes.position,
        visibility: lanes.visibility,
      })
      .from(lanes)
      .where(eq(lanes.engagementId, engagementId)),
    exec
      .select({
        laneId: cards.laneId,
        title: cards.title,
        description: cards.description,
        position: cards.position,
        dueAt: cards.dueAt,
        contractedRounds: cards.contractedRounds,
      })
      .from(cards)
      .where(eq(cards.engagementId, engagementId)),
    exec
      .selectDistinct({ groupLabel: referenceFiles.groupLabel })
      .from(referenceFiles)
      .where(eq(referenceFiles.engagementId, engagementId)),
  ]);

  /**
   * Stamped labels first, in the order the template named them, then any label
   * that only exists because somebody uploaded a file under a new one. That
   * ordering is what makes save-then-stamp-then-save stable: the round trip
   * cannot reshuffle the groups it started with.
   */
  const fileLabels = shelfRows
    .map((row) => row.groupLabel)
    .filter((label): label is string => label !== null && label.length > 0);

  return {
    // `started_at` is set by `createEngagement()`, but it is a nullable column
    // and a row restored from a backup or written by an older path may not have
    // one. `created_at` is NOT NULL and is the only other honest origin.
    startedAt: engagement.startedAt ?? engagement.createdAt,
    lanes: laneRows,
    cards: cardRows,
    shelfGroups: [...engagement.shelfGroupLabels, ...fileLabels],
    contractedRoundsDefault: engagement.contractedRoundsDefault,
  };
}
