/**
 * A contact's first verified sign-in.
 *
 * `verified_at` is set once. It is the attribution an approval leans on — "this
 * email address proved control of itself at this moment" is the whole audit
 * story for a client who never created an account (ADR-005). Moving it later
 * would make every earlier decision harder to defend, not easier.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { clientContacts } from '@/db/schema';
import type { Executor } from '@/db/types';

export async function markContactVerified(
  exec: Executor,
  contactId: string,
  now: Date,
): Promise<void> {
  await exec
    .update(clientContacts)
    .set({ verifiedAt: now })
    .where(and(eq(clientContacts.id, contactId), isNull(clientContacts.verifiedAt)));

  await exec
    .update(clientContacts)
    .set({ lastSeenAt: now })
    .where(eq(clientContacts.id, contactId));
}
