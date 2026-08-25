/**
 * The first five seconds of an agency's life.
 *
 * Auth.js creates a `users` row on first magic-link verification, before the
 * person belongs to any organisation — `users.org_id` is nullable for exactly
 * that window. Until this runs, `getSession()` refuses to build an agency
 * session, so an org-less user can reach nothing.
 *
 * Not in API-CONTRACT.md. Flagged in the handover: without it the agency half
 * of the product has no first step.
 */

import { eq, isNull, and } from 'drizzle-orm';
import { organizations, users } from '@/db/schema';
import type { Database } from '@/db/types';
import { provisionAccountForUser } from '../access/provision-account';
import { validationFailed } from '../errors';

export interface OnboardOrgInput {
  userId: string;
  name: string;
  slug: string;
}

export interface OnboardOrgResult {
  orgId: string;
  slug: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function onboardOrganization(
  db: Database,
  input: OnboardOrgInput,
  now: Date,
): Promise<OnboardOrgResult> {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (name.length === 0) throw validationFailed('An agency needs a name');
  if (!SLUG.test(slug)) throw validationFailed('A slug is lowercase letters, digits and hyphens');

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(organizations)
      .values({ name, slug, createdAt: now })
      .returning({ id: organizations.id, slug: organizations.slug });

    const org = inserted[0];
    if (!org) throw new Error('organization insert returned no row');

    /**
     * `org_id IS NULL` in the predicate is what makes this joinable exactly
     * once. A second call from the same user creates nothing and updates
     * nothing, rather than silently moving them between agencies.
     */
    const joined = await tx
      .update(users)
      .set({ orgId: org.id, role: 'admin' })
      .where(and(eq(users.id, input.userId), isNull(users.orgId)))
      .returning({ id: users.id, email: users.email, name: users.name });

    const person = joined[0];
    if (!person) throw validationFailed('That account already belongs to an agency');

    /**
     * Phase 9. Give the founder their rows in the v1.1 permission graph, in the
     * same transaction that creates the agency.
     *
     * Without this, a person who signs up after the migration has a `users` row
     * and no `accounts` row, and the shadow harness records
     * `account_not_backfilled` on every request they make — a dirty streak
     * caused by a coverage gap rather than by a resolver bug, which is the most
     * expensive kind of false signal to have during a migration window.
     *
     * `owner`, not `admin`: they created the organization. Under ADR-022's D3
     * the two derive the same project access, and the distinction is what
     * Phase 11 will hang "the last owner cannot be removed" on.
     *
     * A stopgap with an owner. Phase 10 moves account creation to signup, where
     * it belongs, and this call leaves with the rest of the v1 identity path.
     */
    await provisionAccountForUser(
      tx,
      {
        legacyUserId: person.id,
        email: person.email,
        name: person.name,
        orgId: org.id,
        orgRole: 'owner',
      },
      now,
    );

    return { orgId: org.id, slug: org.slug };
  });
}
