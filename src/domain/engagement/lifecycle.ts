/**
 * Engagement lifecycle: create, activate, wrap, archive, and the activity bump
 * that every other domain module calls.
 *
 * These functions take an `Executor` so they can join a caller's transaction.
 * `wrapEngagement` and `transitionCard` both bump activity; if each opened its
 * own transaction the two writes could interleave and the retention clock would
 * be computed from a timestamp that no longer holds.
 */

import { and, eq } from 'drizzle-orm';
import { engagements, clientContacts, auditLog, organizations } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { EngagementStatus, Plan } from '@/lib/types';
import { notVisible, engagementArchived, engagementPurged, validationFailed } from '../errors';
import { retentionWindow } from '../retention/schedule';

export interface EngagementRow {
  id: string;
  orgId: string;
  clientOrgName: string;
  title: string;
  status: EngagementStatus;
  templateId: string | null;
  startedAt: Date | null;
  wrappedAt: Date | null;
  lastActivityAt: Date;
  archiveAt: Date | null;
  purgeAt: Date | null;
  contractedRoundsDefault: number;
  createdAt: Date;
}

export interface CreateEngagementInput {
  orgId: string;
  plan: Plan;
  title: string;
  clientOrgName: string;
  templateId?: string | null;
  contractedRoundsDefault?: number;
}

/**
 * A new engagement starts `active`, not `draft`: it consumes a plan slot from
 * the moment it exists, so the gate the caller just passed is the truth. A
 * `draft` that quietly does not count is how an agency ends up with thirty
 * workspaces on a three-workspace plan.
 */
export async function createEngagement(
  exec: Executor,
  input: CreateEngagementInput,
  now: Date,
): Promise<EngagementRow> {
  const title = input.title.trim();
  const clientOrgName = input.clientOrgName.trim();
  if (title.length === 0) throw validationFailed('An engagement needs a title');
  if (clientOrgName.length === 0) throw validationFailed('An engagement needs a client name');

  const { archiveAt, purgeAt } = retentionWindow(input.plan, now);

  const inserted = await exec
    .insert(engagements)
    .values({
      orgId: input.orgId,
      title,
      clientOrgName,
      status: 'active',
      templateId: input.templateId ?? null,
      startedAt: now,
      lastActivityAt: now,
      archiveAt,
      purgeAt,
      contractedRoundsDefault: input.contractedRoundsDefault ?? 2,
      createdAt: now,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error('engagement insert returned no row');
  return row;
}

/**
 * The single activity bump (DATA-MODEL: `last_activity_at` is the only input to
 * both billing and expiry). Recomputing the retention window here is what keeps
 * an engagement due to archive tomorrow from being purged after someone worked
 * on it this morning.
 *
 * It reads the org's plan itself rather than taking it as an argument. Every
 * caller — a transition, an upload, a decision, a note — would otherwise have
 * to thread a `plan` through, and the one that forgot would silently write the
 * free-plan countdown onto a paying customer's workspace.
 */
export async function planForEngagement(exec: Executor, engagementId: string): Promise<Plan> {
  const rows = await exec
    .select({ plan: organizations.plan })
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(eq(engagements.id, engagementId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notVisible('Engagement not found');
  return row.plan;
}

export async function bumpActivity(
  exec: Executor,
  engagementId: string,
  now: Date,
): Promise<void> {
  const plan = await planForEngagement(exec, engagementId);
  const { archiveAt, purgeAt } = retentionWindow(plan, now);
  await exec
    .update(engagements)
    .set({ lastActivityAt: now, archiveAt, purgeAt })
    .where(eq(engagements.id, engagementId));
}

export interface WrapEngagementInput {
  engagementId: string;
  orgId: string;
}

/**
 * Wrap marks the work delivered and starts the retention countdown. It does not
 * archive: the engagement stays readable and writable until the sweep takes it,
 * because "we wrapped on Friday and the client asked for the files on Monday"
 * is the normal case, not the exception.
 */
export async function wrapEngagement(
  exec: Executor,
  input: WrapEngagementInput,
  now: Date,
): Promise<EngagementRow> {
  const current = await loadForOrg(exec, input.engagementId, input.orgId);
  assertWritable(current);

  const plan = await planForEngagement(exec, input.engagementId);
  const { archiveAt, purgeAt } = retentionWindow(plan, now);
  const updated = await exec
    .update(engagements)
    .set({ wrappedAt: now, lastActivityAt: now, archiveAt, purgeAt })
    .where(eq(engagements.id, input.engagementId))
    .returning();

  const row = updated[0];
  if (!row) throw notVisible('Engagement not found');

  await exec.insert(auditLog).values({
    orgId: input.orgId,
    engagementId: input.engagementId,
    actor: 'agency',
    action: 'engagement.wrapped',
    subjectType: 'engagement',
    subjectId: input.engagementId,
    occurredAt: now,
  });

  return row;
}

/** Read-only from here. The purge worker (Phase 6) is what follows. */
export async function archiveEngagement(
  exec: Executor,
  engagementId: string,
  now: Date,
): Promise<void> {
  await exec
    .update(engagements)
    .set({ status: 'archived' })
    .where(eq(engagements.id, engagementId));

  await exec.insert(auditLog).values({
    engagementId,
    actor: 'system',
    action: 'engagement.archived',
    subjectType: 'engagement',
    subjectId: engagementId,
    occurredAt: now,
  });
}

export interface InviteContactInput {
  engagementId: string;
  email: string;
  name?: string | null;
  invitedByUserId: string;
}

export interface ClientContactRow {
  id: string;
  engagementId: string;
  email: string;
  name: string | null;
  verifiedAt: Date | null;
  lastSeenAt: Date | null;
  invitedBy: string | null;
  createdAt: Date;
}

/**
 * Idempotent by design. Re-inviting someone re-sends the link rather than
 * creating a second contact; the UNIQUE (engagement_id, email) makes that a
 * database property, not a race the route has to win.
 */
export async function inviteContact(
  exec: Executor,
  input: InviteContactInput,
  now: Date,
): Promise<{ contact: ClientContactRow; created: boolean }> {
  const email = input.email.trim();
  if (!email.includes('@')) throw validationFailed('A contact needs an email address');

  const existing = await exec
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.engagementId, input.engagementId),
        eq(clientContacts.email, email),
      ),
    )
    .limit(1);

  const found = existing[0];
  if (found) return { contact: found, created: false };

  const inserted = await exec
    .insert(clientContacts)
    .values({
      engagementId: input.engagementId,
      email,
      name: input.name ?? null,
      invitedBy: input.invitedByUserId,
      createdAt: now,
    })
    .returning();

  const contact = inserted[0];
  if (!contact) throw new Error('client contact insert returned no row');

  await exec.insert(auditLog).values({
    engagementId: input.engagementId,
    actor: `user:${input.invitedByUserId}`,
    action: 'contact.invited',
    subjectType: 'client_contact',
    subjectId: contact.id,
    metadata: { email },
    occurredAt: now,
  });

  return { contact, created: true };
}

/* ------------------------------------------------------------------ guards */

/** Scoped load. A wrong-org id is `NOT_VISIBLE`, never a 403. */
export async function loadForOrg(
  exec: Executor,
  engagementId: string,
  orgId: string,
): Promise<EngagementRow> {
  const rows = await exec
    .select()
    .from(engagements)
    .where(and(eq(engagements.id, engagementId), eq(engagements.orgId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notVisible('Engagement not found');
  return row;
}

export async function loadById(exec: Executor, engagementId: string): Promise<EngagementRow> {
  const rows = await exec
    .select()
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notVisible('Engagement not found');
  return row;
}

/**
 * Every mutation calls this first. Archived is 423 and purged is 410 — the
 * distinction matters to the client, who is being told either "this is frozen"
 * or "this is gone and here is the certificate".
 */
export function assertWritable(row: Pick<EngagementRow, 'status'>): void {
  if (row.status === 'purged') throw engagementPurged();
  if (row.status === 'archived') throw engagementArchived();
}
