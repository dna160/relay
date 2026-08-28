/**
 * Database writes for the test-only endpoints under `src/app/api/test/`.
 *
 * It lives here rather than inside those route files for one reason: INV-9
 * ("route handlers parse input, call a domain function, and serialise output")
 * is enforced structurally by `tests/invariants/inv-09-domain-purity.spec.ts`,
 * which fails on any `db.insert(...)` inside a `route.ts`. A test-only route is
 * not an exception to that — the invariant does not have exceptions, and the
 * seed is exactly the kind of code that grows business rules by accident.
 *
 * It is **not** under `src/db/queries/`: nothing here is a query, nothing here
 * takes a `ClientScope`, and it must not be mistaken for part of the
 * client-reachable read surface that `visibility.spec.ts` enumerates.
 *
 * Nothing in this module checks the gate. `requireTestGate()` is the gate, it
 * runs as the first statement of every handler that reaches this file, and
 * duplicating it here would create a second place for the two conditions to
 * drift apart. The functions below are unreachable without it.
 */

import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { runBackfill } from './backfill/identity-graph';
import {
  approvals as approvalsTable,
  assetVersions,
  authSessions,
  cards as cardsTable,
  clientContacts as clientContactsTable,
  engagements as engagementsTable,
  lanes as lanesTable,
  organizations,
  revisionNotes,
  users as usersTable,
} from '@/db/schema';
import type { Database, Tx } from '@/db/types';
import { transitionCard } from '@/domain/card/transition-card';
import type { Actor } from '@/domain/card/state-machine';
import { notVisible } from '@/domain/errors';
import {
  approvals,
  BOARD_ENGAGEMENT_ID,
  CARD,
  CONTACT,
  ENGAGEMENT,
  LANE,
  USER,
  VERSION,
  cards as cardFixtures,
  clientContacts,
  engagements,
  lanes as laneFixtures,
  orgs,
  transitionScripts,
  users,
  versions as versionFixtures,
} from '@tests/fixtures';

/**
 * The archived engagement carries no card in `tests/fixtures` — the board
 * fixture lives entirely on `ENGAGEMENT.active`. The e2e suite needs one for
 * the 423 case (`SeedResult.archivedCardId`), so two ids are minted here in the
 * same uuid-v7 shape the fixtures use. They live here rather than in
 * `tests/fixtures` because only the seed *result* exposes them; no assertion
 * names them.
 */
export const ARCHIVED_LANE_ID = '0193a5f0-e599-7000-8000-e5e5e5e59999';
export const ARCHIVED_CARD_ID = '0193a5f0-f699-7000-8000-f6f6f6f69999';

/**
 * Every content table, truncated in one statement. `CASCADE` would reach most
 * of them through the foreign keys, but naming them is what makes a table added
 * later and forgotten here show up as rows surviving a reset — visibly — rather
 * than as an intermittent test.
 */
const TRUNCATE = sql`
  TRUNCATE TABLE
    approvals,
    revision_notes,
    comments,
    asset_versions,
    state_transitions,
    cards,
    lanes,
    reference_files,
    client_contacts,
    audit_log,
    engagements,
    templates,
    auth_accounts,
    auth_sessions,
    auth_verification_tokens,
    users,
    -- Phase 9's permission graph. Truncating organizations would cascade into
    -- most of these, but they are listed explicitly for the same reason the
    -- purge worker spells out its deletes: what a reset clears should be
    -- readable here, not inferred from foreign keys. The shadow ledger is
    -- cleared too -- a seeded suite that inherits yesterday's disagreements
    -- reports a clean streak that is not real.
    access_shadow_disagreements,
    project_memberships,
    org_memberships,
    team_members,
    teams,
    identities,
    accounts,
    organizations
  RESTART IDENTITY CASCADE
`;

export interface SeedResult {
  engagementId: string;
  /** A second engagement carrying the same contact email, for the INV-6 test. */
  otherEngagementId: string;
  archivedEngagementId: string;
  purgedEngagementId: string;
  cardId: string;
  archivedCardId: string;
  versionId: string;
  laneId: string;
}

/** Storage keys are not in the fixture; the shelf and download paths need one. */
function storageKeyFor(versionId: string, filename: string): string {
  return `engagements/${BOARD_ENGAGEMENT_ID}/versions/${versionId}/${filename}`;
}

function actorFor(kind: 'agency' | 'client'): Actor {
  return kind === 'agency'
    ? { kind: 'agency', userId: USER.freeAdmin }
    : { kind: 'client', contactId: CONTACT.active };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * `tests/fixtures/seed.ts` states the rule: a seed may insert rows, it may not
 * set `cards.state` (INV-2). Each card is inserted in `draft` — the column
 * default — and driven to its fixture state by replaying its transition script
 * through the state machine. That is what produces the `state_transitions` rows
 * the possession clock is derived from (INV-5) and the `rounds_used` counter
 * the breach styling needs, correctly and for free. A card written straight
 * into `awaiting_client` would be in a state no legal sequence of moves can
 * reach, and every test written against it would prove nothing.
 */
async function replay(tx: Tx, cardId: string, now: Date): Promise<void> {
  const script = transitionScripts[cardId] ?? [];
  // Spaced backwards from an hour ago, so the possession clock sees intervals
  // rather than a column of identical instants.
  const start = now.getTime() - (script.length + 1) * HOUR_MS;
  for (const [index, move] of script.entries()) {
    await transitionCard(
      tx,
      { cardId, to: move.to, actor: actorFor(move.actor) },
      new Date(start + index * HOUR_MS),
    );
  }
}

export async function resetToFixtures(db: Database, now: Date): Promise<SeedResult> {
  await db.transaction(async (tx) => {
    await tx.execute(TRUNCATE);

    await tx.insert(organizations).values(
      orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        plan: o.plan,
        brandLogoKey: o.brandLogoKey,
        brandPrimary: o.brandPrimary,
        brandDomain: o.brandDomain,
        createdAt: new Date(o.createdAt),
      })),
    );

    await tx.insert(usersTable).values(
      users.map((u) => ({
        id: u.id,
        orgId: u.orgId,
        email: u.email,
        name: u.name,
        role: u.role,
        /**
         * Phase 10. A seeded agency member is one whose address the fixture
         * takes as already proved — they are standing in for somebody who
         * followed a magic link, which is what stamps this column in the real
         * flow. Without it `requireVerifiedAccount()` refuses every seeded user,
         * and the invite-redemption e2e path is unreachable from a seed.
         *
         * It is set here rather than in `tests/fixtures/orgs.ts` because the
         * fixture describes v1's `users` shape and this is the seeder's own
         * knowledge of what a signed-in person looks like.
         */
        emailVerified: new Date(u.createdAt),
        createdAt: new Date(u.createdAt),
        lastSeenAt: u.lastSeenAt === null ? null : new Date(u.lastSeenAt),
      })),
    );

    await tx.insert(engagementsTable).values(
      engagements.map((e) => ({
        id: e.id,
        orgId: e.orgId,
        clientOrgName: e.clientOrgName,
        title: e.title,
        status: e.status,
        templateId: e.templateId,
        startedAt: e.startedAt === null ? null : new Date(e.startedAt),
        wrappedAt: e.wrappedAt === null ? null : new Date(e.wrappedAt),
        lastActivityAt: new Date(e.lastActivityAt),
        archiveAt: e.archiveAt === null ? null : new Date(e.archiveAt),
        purgeAt: e.purgeAt === null ? null : new Date(e.purgeAt),
        contractedRoundsDefault: e.contractedRoundsDefault,
        createdAt: new Date(e.createdAt),
      })),
    );

    await tx.insert(clientContactsTable).values(
      clientContacts.map((c) => ({
        id: c.id,
        engagementId: c.engagementId,
        email: c.email,
        name: c.name,
        verifiedAt: c.verifiedAt === null ? null : new Date(c.verifiedAt),
        lastSeenAt: c.lastSeenAt === null ? null : new Date(c.lastSeenAt),
        invitedBy: c.invitedBy,
        createdAt: new Date(c.createdAt),
      })),
    );

    await tx.insert(lanesTable).values([
      ...laneFixtures.map((l) => ({
        id: l.id,
        engagementId: BOARD_ENGAGEMENT_ID,
        name: l.name,
        position: l.position,
        visibility: l.visibility,
        createdAt: now,
      })),
      {
        id: ARCHIVED_LANE_ID,
        engagementId: ENGAGEMENT.archived,
        name: 'Deliverables',
        position: 0,
        visibility: 'published' as const,
        createdAt: now,
      },
    ]);

    // Nothing below names `state`. The default is `draft`; `replay()` moves it.
    await tx.insert(cardsTable).values([
      ...cardFixtures.map((c) => ({
        id: c.id,
        engagementId: BOARD_ENGAGEMENT_ID,
        laneId: c.laneId,
        title: c.title,
        description: c.description,
        position: c.position,
        assigneeId: c.assigneeId,
        dueAt: c.dueAt,
        contractedRounds: c.contractedRounds,
        internalNotes: c.internalNotes,
        effortEstimate: c.effortEstimate,
        visibilityOverride: c.visibilityOverride,
        createdAt: now,
        updatedAt: now,
      })),
      {
        id: ARCHIVED_CARD_ID,
        engagementId: ENGAGEMENT.archived,
        laneId: ARCHIVED_LANE_ID,
        title: 'Annual report cover',
        description: null,
        position: 0,
        assigneeId: USER.freeAdmin,
        dueAt: null,
        contractedRounds: 2,
        internalNotes: null,
        effortEstimate: null,
        visibilityOverride: 'inherit' as const,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await tx.insert(assetVersions).values(
      versionFixtures.map((v) => ({
        id: v.id,
        cardId: v.cardId,
        versionNo: v.versionNo,
        storageKey: storageKeyFor(v.id, v.filename),
        filename: v.filename,
        mime: v.filename.endsWith('.pdf') ? 'application/pdf' : 'image/png',
        sizeBytes: v.sizeBytes,
        sha256: v.sha256,
        uploadedByUserId: USER.freeAdmin,
        uploadedAt: now,
        publishedToClientAt: v.publishedToClientAt,
        supersededBy: null,
      })),
    );

    await tx.insert(approvalsTable).values(
      approvals.map((a) => ({
        id: a.id,
        assetVersionId: a.assetVersionId,
        decision: a.decision,
        decidedByContactId: a.decidedByContactId,
        decidedByUserId: a.decidedByUserId,
        // Derived rather than added to the fixture shape: the fixtures already
        // carry exactly one decider, so the side is not a new fact about them.
        // The stated side, not one re-derived from which FK happens to be
        // set. Migration 0004 exists precisely to stop that derivation being
        // load-bearing: after an erasure both FKs are null and the side is the
        // only thing left saying who decided. Deriving it here would be correct
        // only for as long as no fixture approval is anonymous.
        decidedBySide: a.decidedBySide,
        versionSha256: a.versionSha256,
        note: a.note,
        ip: a.ip,
        userAgent: a.userAgent,
        decidedAt: a.decidedAt,
      })),
    );

    /**
     * The revision thread `record-decision.ts` would have written alongside a
     * `changes_requested` approval. Threaded to the version it was decided
     * against and never floating forward (PRD §5.3) — the behaviour the notes
     * routes now make visible.
     */
    for (const approval of approvals) {
      if (approval.note === null) continue;
      await tx.insert(revisionNotes).values({
        assetVersionId: approval.assetVersionId,
        authorContactId: approval.decidedByContactId,
        authorUserId: approval.decidedByUserId,
        body: approval.note,
        internal: false,
        createdAt: approval.decidedAt,
      });
    }

    for (const card of cardFixtures) {
      await replay(tx, card.id, now);
    }

    /**
     * Replay bumped `last_activity_at` on every engagement it touched, and the
     * retention window derived from it. Write the fixture's own arithmetic
     * back: the 39-day-idle engagement exists precisely so that a
     * `countActiveEngagements()` counting `status` alone fails (INV-8), and a
     * seed that reset it to `now` would make that fixture pass for the wrong
     * reason.
     */
    for (const e of engagements) {
      await tx
        .update(engagementsTable)
        .set({
          lastActivityAt: new Date(e.lastActivityAt),
          archiveAt: e.archiveAt === null ? null : new Date(e.archiveAt),
          purgeAt: e.purgeAt === null ? null : new Date(e.purgeAt),
        })
        .where(eq(engagementsTable.id, e.id));
    }

    /**
     * Phase 9. The fixtures describe a v1 world — `users`, `organizations`,
     * `engagements` — and the shadow harness compares that world against the
     * v1.1 graph on every request. Without this, every seeded run would record
     * `account_not_backfilled` against every endpoint it touched, and the
     * disagreement dashboard would be measuring the seed rather than the
     * migration.
     *
     * Runs inside the same transaction as the seed, so there is no window in
     * which the fixtures exist and the graph does not.
     */
    await runBackfill(tx, now);
  });

  return {
    engagementId: ENGAGEMENT.active,
    otherEngagementId: ENGAGEMENT.activeSecond,
    archivedEngagementId: ENGAGEMENT.archived,
    purgedEngagementId: ENGAGEMENT.purged,
    cardId: CARD.awaitingClient,
    archivedCardId: ARCHIVED_CARD_ID,
    versionId: VERSION.v1,
    laneId: LANE.published,
  };
}

/**
 * Auth.js is configured for database sessions, so a session *is* a row in
 * `auth_sessions` plus a cookie naming its token. This writes the row and hands
 * the token back for the route to set.
 *
 * It signs in an **existing** user only. A helper that created accounts on
 * demand would be a helper that provisions an admin.
 */
export const TEST_SESSION_TTL_MS = 60 * 60 * 1000;

export async function createTestSession(
  db: Database,
  email: string,
  now: Date,
): Promise<{ sessionToken: string; userId: string; expires: Date }> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  const user = rows[0];
  if (!user) throw notVisible('No such user; seed first');

  const sessionToken = randomBytes(32).toString('hex');
  const expires = new Date(now.getTime() + TEST_SESSION_TTL_MS);
  await db.insert(authSessions).values({ sessionToken, userId: user.id, expires });
  return { sessionToken, userId: user.id, expires };
}
