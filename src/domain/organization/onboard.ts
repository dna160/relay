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
      .returning({ id: users.id });

    if (!joined[0]) throw validationFailed('That account already belongs to an agency');

    return { orgId: org.id, slug: org.slug };
  });
}
