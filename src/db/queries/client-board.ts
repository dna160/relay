/**
 * Every read a client contact can reach. All of it goes through `clientScope()`
 * (ADR-006) and is then serialised by `client-view.ts`, the only serialiser a
 * client contact ever touches (INV-1).
 *
 * Both layers do the filtering. That is not redundancy for its own sake: the
 * SQL predicate is what keeps a private lane out of the result set, and the
 * projection's return type is what makes leaking `internalNotes` a compile
 * error rather than a review question. Either one alone fails differently.
 *
 * Nothing here takes an engagement id as an argument. The scope carries it,
 * from the session (INV-6).
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  assetVersions,
  cards,
  clientContacts,
  engagements,
  lanes,
  organizations,
  referenceFiles,
} from '@/db/schema';
import type { Executor } from '@/db/types';
import {
  toClientBoard,
  type CardRow,
  type ClientCard,
  type ClientLane,
  type LaneRow,
  type VersionRow,
} from '@/domain/projection/client-view';
import { daysToPurge } from '@/domain/retention/schedule';
import { notVisible } from '@/domain/errors';
import type { ClientScope } from './client-scope';

async function visibleLanes(exec: Executor, scope: ClientScope): Promise<LaneRow[]> {
  return exec
    .select({
      id: lanes.id,
      name: lanes.name,
      position: lanes.position,
      visibility: lanes.visibility,
    })
    .from(lanes)
    .where(and(scope.onEngagement(lanes.engagementId), scope.publishedLanes));
}

async function visibleCards(exec: Executor, scope: ClientScope): Promise<CardRow[]> {
  const rows = await exec
    .select({
      id: cards.id,
      laneId: cards.laneId,
      title: cards.title,
      description: cards.description,
      state: cards.state,
      position: cards.position,
      dueAt: cards.dueAt,
      roundsUsed: cards.roundsUsed,
      contractedRounds: cards.contractedRounds,
      visibilityOverride: cards.visibilityOverride,
    })
    .from(cards)
    .innerJoin(lanes, eq(lanes.id, cards.laneId))
    .where(and(scope.visibleBoard, scope.publishedLanes));

  // The internal columns are not selected at all, so there is nothing for the
  // projection to drop. `CardRow` still names them; they are always null here.
  return rows.map((row) => ({
    ...row,
    assigneeId: null,
    internalNotes: null,
    effortEstimate: null,
  }));
}

async function publishedVersionsFor(
  exec: Executor,
  scope: ClientScope,
  cardIds: readonly string[],
): Promise<VersionRow[]> {
  if (cardIds.length === 0) return [];
  return exec
    .select({
      id: assetVersions.id,
      cardId: assetVersions.cardId,
      versionNo: assetVersions.versionNo,
      filename: assetVersions.filename,
      sizeBytes: assetVersions.sizeBytes,
      sha256: assetVersions.sha256,
      publishedToClientAt: assetVersions.publishedToClientAt,
    })
    .from(assetVersions)
    .where(and(inArray(assetVersions.cardId, [...cardIds]), scope.publishedVersions));
}

/** CLIENT-REACHABLE. `GET /api/client/board`. */
export async function loadClientBoard(exec: Executor, scope: ClientScope): Promise<ClientLane[]> {
  const laneRows = await visibleLanes(exec, scope);
  const cardRows = await visibleCards(exec, scope);
  const versionRows = await publishedVersionsFor(
    exec,
    scope,
    cardRows.map((c) => c.id),
  );
  return toClientBoard(laneRows, cardRows, versionRows);
}

/**
 * CLIENT-REACHABLE. `GET /api/client/queue` — cards where awaitingYou is true.
 *
 * Built by flattening the board rather than by calling `toClientCard()`
 * directly. `toClientCard()` is exported but applies no visibility check of its
 * own; only `toClientBoard()` runs the lane and card filters first. Going
 * through the board is what keeps the queue from becoming the second caller
 * that leaks.
 */
export async function loadClientQueue(exec: Executor, scope: ClientScope): Promise<ClientCard[]> {
  const board = await loadClientBoard(exec, scope);
  return board
    .flatMap((lane) => lane.cards)
    .filter((card) => card.awaitingYou)
    .sort((a, b) => a.position - b.position);
}

export interface ClientEngagementHeader {
  title: string;
  agencyName: string;
  brandPrimary: string | null;
  brandLogoKey: string | null;
  daysToPurge: number | null;
  contactEmail: string;
  contactName: string | null;
}

/** CLIENT-REACHABLE. The header the client board renders around. */
export async function loadClientEngagementHeader(
  exec: Executor,
  scope: ClientScope,
  now: Date,
): Promise<ClientEngagementHeader> {
  const rows = await exec
    .select({
      title: engagements.title,
      purgeAt: engagements.purgeAt,
      agencyName: organizations.name,
      brandPrimary: organizations.brandPrimary,
      brandLogoKey: organizations.brandLogoKey,
      contactEmail: clientContacts.email,
      contactName: clientContacts.name,
    })
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    // The contact is joined *through* the engagement, so a cookie naming a
    // contact from elsewhere returns no row rather than someone else's header.
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, scope.contactId),
        eq(clientContacts.engagementId, engagements.id),
      ),
    )
    .where(scope.onEngagement(engagements.id))
    .limit(1);

  const row = rows[0];
  if (!row) throw notVisible('Engagement not found');

  return {
    title: row.title,
    agencyName: row.agencyName,
    brandPrimary: row.brandPrimary,
    brandLogoKey: row.brandLogoKey,
    daysToPurge: daysToPurge(row.purgeAt, now),
    contactEmail: row.contactEmail,
    contactName: row.contactName,
  };
}

export interface DownloadTarget {
  versionId: string;
  storageKey: string;
  filename: string;
}

/**
 * CLIENT-REACHABLE. `GET /api/client/download/:versionId`.
 *
 * A version on a private lane, on a draft card, or simply not yet published is
 * `NOT_VISIBLE` — a 404, never a 403, because a 403 confirms it exists.
 */
export async function loadClientDownloadTarget(
  exec: Executor,
  scope: ClientScope,
  versionId: string,
): Promise<DownloadTarget> {
  const rows = await exec
    .select({
      versionId: assetVersions.id,
      storageKey: assetVersions.storageKey,
      filename: assetVersions.filename,
    })
    .from(assetVersions)
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .innerJoin(lanes, eq(lanes.id, cards.laneId))
    .where(
      and(
        eq(assetVersions.id, versionId),
        scope.publishedVersions,
        scope.visibleBoard,
        scope.publishedLanes,
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw notVisible('File not found');
  return row;
}

/**
 * CLIENT-REACHABLE. Used before a decision or a comment: is this card one the
 * contact can actually see?
 */
export async function loadClientVisibleCardId(
  exec: Executor,
  scope: ClientScope,
  cardId: string,
): Promise<string> {
  const rows = await exec
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(lanes, eq(lanes.id, cards.laneId))
    .where(and(eq(cards.id, cardId), scope.visibleBoard, scope.publishedLanes))
    .limit(1);
  const row = rows[0];
  if (!row) throw notVisible('Card not found');
  return row.id;
}

/**
 * CLIENT-REACHABLE. The version a decision is about, resolved through the same
 * visibility predicate as the board. `record-decision.ts` re-reads the row under
 * a lock; this read is what turns an invisible version into a 404 first.
 */
export async function loadClientDecidableVersion(
  exec: Executor,
  scope: ClientScope,
  versionId: string,
): Promise<{ versionId: string; cardId: string }> {
  const rows = await exec
    .select({ versionId: assetVersions.id, cardId: assetVersions.cardId })
    .from(assetVersions)
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .innerJoin(lanes, eq(lanes.id, cards.laneId))
    .where(
      and(
        eq(assetVersions.id, versionId),
        scope.publishedVersions,
        scope.visibleBoard,
        scope.publishedLanes,
      ),
    )
    .orderBy(desc(assetVersions.versionNo))
    .limit(1);

  const row = rows[0];
  if (!row) throw notVisible('Version not found');
  return row;
}

/** CLIENT-REACHABLE. The reference shelf, minus anything marked agency-only. */
export async function loadClientShelf(
  exec: Executor,
  scope: ClientScope,
): Promise<{ id: string; groupLabel: string | null; filename: string; sizeBytes: number }[]> {
  return exec
    .select({
      id: referenceFiles.id,
      groupLabel: referenceFiles.groupLabel,
      filename: referenceFiles.filename,
      sizeBytes: referenceFiles.sizeBytes,
    })
    .from(referenceFiles)
    .where(
      and(
        scope.onEngagement(referenceFiles.engagementId),
        eq(referenceFiles.clientVisible, true),
      ),
    );
}
