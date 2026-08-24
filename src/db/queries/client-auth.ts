/**
 * The two reads the client magic link needs, before any session exists.
 *
 * These are the only client-facing reads that do not go through
 * `clientScope()` — by necessity, since the scope is built *from* the session
 * this flow is about to issue. Everything they return is deliberately thin:
 * an id, a title, a status. Nothing about lanes, cards, or files can be reached
 * from here.
 */

import { and, eq } from 'drizzle-orm';
import { clientContacts, engagements } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { EngagementStatus } from '@/lib/types';

export interface LinkableEngagement {
  id: string;
  title: string;
  status: EngagementStatus;
}

export async function loadLinkableEngagement(
  exec: Executor,
  engagementId: string,
): Promise<LinkableEngagement | null> {
  const rows = await exec
    .select({ id: engagements.id, title: engagements.title, status: engagements.status })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  return rows[0] ?? null;
}

/** Scoped to one engagement, so the same email elsewhere is a different row. */
export async function findContact(
  exec: Executor,
  engagementId: string,
  email: string,
): Promise<{ id: string; verifiedAt: Date | null } | null> {
  const rows = await exec
    .select({ id: clientContacts.id, verifiedAt: clientContacts.verifiedAt })
    .from(clientContacts)
    .where(and(eq(clientContacts.engagementId, engagementId), eq(clientContacts.email, email)))
    .limit(1);
  return rows[0] ?? null;
}
