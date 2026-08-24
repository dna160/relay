/**
 * Agency-side engagement reads. None of these is reachable by a client contact
 * — a client sees one engagement, through `client-board.ts`, and never a list.
 */

import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { cards, engagements, organizations, stateTransitions } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { EngagementSummary, Plan } from '@/lib/types';
import type { ActivityRow } from '@/domain/engagement/count-active';
import { possessionByCard, sumPossession, type TransitionRow } from '@/domain/card/possession';
import { daysToPurge } from '@/domain/retention/schedule';
import { notVisible } from '@/domain/errors';

/**
 * The rows the active count works from. Deliberately unfiltered by status:
 * `countActiveEngagements()` owns the definition of active (INV-8), and a
 * `WHERE status = 'active'` here would be a second one wearing a disguise.
 */
export async function loadActivityRows(exec: Executor, orgId: string): Promise<ActivityRow[]> {
  return exec
    .select({ status: engagements.status, lastActivityAt: engagements.lastActivityAt })
    .from(engagements)
    .where(and(eq(engagements.orgId, orgId), ne(engagements.status, 'purged')));
}

/** The portfolio screen: one row per engagement with its counts and clock. */
export async function loadPortfolio(
  exec: Executor,
  orgId: string,
  now: Date,
): Promise<EngagementSummary[]> {
  const rows = await exec
    .select()
    .from(engagements)
    .where(and(eq(engagements.orgId, orgId), ne(engagements.status, 'purged')));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const counts = await exec
    .select({ engagementId: cards.engagementId, state: cards.state, total: count() })
    .from(cards)
    .where(inArray(cards.engagementId, ids))
    .groupBy(cards.engagementId, cards.state);

  const transitions: TransitionRow[] = await exec
    .select({
      cardId: stateTransitions.cardId,
      toState: stateTransitions.toState,
      possession: stateTransitions.possession,
      occurredAt: stateTransitions.occurredAt,
    })
    .from(stateTransitions)
    .innerJoin(cards, eq(cards.id, stateTransitions.cardId))
    .where(inArray(cards.engagementId, ids));

  const cardToEngagement = new Map<string, string>();
  const cardRows = await exec
    .select({ id: cards.id, engagementId: cards.engagementId })
    .from(cards)
    .where(inArray(cards.engagementId, ids));
  for (const c of cardRows) cardToEngagement.set(c.id, c.engagementId);

  const splits = possessionByCard(transitions, now);

  return rows.map((row) => {
    const forThis = counts.filter((c) => c.engagementId === row.id);
    const total = forThis.reduce((sum, c) => sum + c.total, 0);
    const awaitingClient = forThis
      .filter((c) => c.state === 'awaiting_client')
      .reduce((sum, c) => sum + c.total, 0);
    const awaitingAgency = forThis
      .filter((c) => c.state !== 'awaiting_client' && c.state !== 'signed_off')
      .reduce((sum, c) => sum + c.total, 0);

    const mine = [...splits.entries()]
      .filter(([cardId]) => cardToEngagement.get(cardId) === row.id)
      .map(([, split]) => split);

    return {
      id: row.id,
      title: row.title,
      clientOrgName: row.clientOrgName,
      status: row.status,
      lastActivityAt: row.lastActivityAt.toISOString(),
      daysToPurge: daysToPurge(row.purgeAt, now),
      cardCounts: { total, awaitingClient, awaitingAgency },
      possession: sumPossession(mine),
    };
  });
}

export interface EngagementDetail {
  id: string;
  title: string;
  clientOrgName: string;
  status: EngagementSummary['status'];
  templateId: string | null;
  startedAt: string | null;
  wrappedAt: string | null;
  lastActivityAt: string;
  daysToPurge: number | null;
  contractedRoundsDefault: number;
  plan: Plan;
  /** The agency's own name, for the client-facing invite. */
  agencyName: string;
}

export async function loadEngagementDetail(
  exec: Executor,
  engagementId: string,
  orgId: string,
  now: Date,
): Promise<EngagementDetail> {
  const rows = await exec
    .select({ engagement: engagements, plan: organizations.plan, agencyName: organizations.name })
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(and(eq(engagements.id, engagementId), eq(engagements.orgId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw notVisible('Engagement not found');
  const e = row.engagement;

  return {
    id: e.id,
    title: e.title,
    clientOrgName: e.clientOrgName,
    status: e.status,
    templateId: e.templateId,
    startedAt: e.startedAt?.toISOString() ?? null,
    wrappedAt: e.wrappedAt?.toISOString() ?? null,
    lastActivityAt: e.lastActivityAt.toISOString(),
    daysToPurge: daysToPurge(e.purgeAt, now),
    contractedRoundsDefault: e.contractedRoundsDefault,
    plan: row.plan,
    agencyName: row.agencyName,
  };
}
