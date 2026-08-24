/**
 * An actor's display name, and nothing else about them.
 *
 * Extracted because both writers need it and both must resolve it the same way.
 * A client contact's email is deliberately **not** a fallback: the reads that
 * serve a client emit no addresses at all (INV-1), and a POST response that did
 * would be the one place the rule was not held — the response to the write is
 * the easiest place to forget, because it is the one row the author already
 * knows about.
 *
 * Resolved inside the caller's transaction so the row it names is the row that
 * was just written against.
 */

import { eq } from 'drizzle-orm';
import { clientContacts, users } from '@/db/schema';
import type { Tx } from '@/db/types';
import type { Actor } from './card/state-machine';

export async function authorNameFor(tx: Tx, actor: Actor): Promise<string | null> {
  if (actor.kind === 'agency') {
    const rows = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    return rows[0]?.name ?? null;
  }
  const rows = await tx
    .select({ name: clientContacts.name })
    .from(clientContacts)
    .where(eq(clientContacts.id, actor.contactId))
    .limit(1);
  return rows[0]?.name ?? null;
}
