/**
 * Phase 10 — the two token tables (ADR-021 §5, DELIVERY-PLAN §IV).
 *
 * Three token types, never conflated: an **invite** identifies an offer of
 * membership, a **sign-in** token proves control of an email address, and a
 * **session** is established only after one of the second kind. The first two
 * live here. The third is `auth_sessions`, which Auth.js owns and this phase
 * does not change the shape of.
 *
 * ## Only the hash is stored
 *
 * `token_hash` is `sha256` of the value that went out in the email, and the raw
 * value exists in that email and nowhere else. A database dump is therefore not
 * a set of live invitations, which is the same property `auth_verification_
 * tokens` already has for the client code (`src/lib/auth.ts`).
 *
 * ## Why the invite carries a role and the sign-in token carries nothing
 *
 * INV-12: an invite token never establishes a session, and a sign-in token
 * never grants membership. Keeping them in two tables with two disjoint sets of
 * columns is what makes the separation structural rather than a rule someone
 * remembers — there is no column on `signin_tokens` that could grow a role, and
 * no column on `invites` that a session could be minted from.
 */

import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, primaryId, tstz, tstzNow } from './_shared';
import { INVITE_TARGET_KINDS } from './enums';
import { accounts } from './access';
import { organizations } from './tenancy';

/**
 * An offer of membership. It authenticates nobody (ADR-021 §5).
 *
 * `target_id` is polymorphic — an `organizations.id` when `target_kind` is
 * `'org'`, an `engagements.id` when it is `'project'` — so it deliberately
 * carries no foreign key. The alternative is two nullable columns with a CHECK
 * keeping exactly one of them populated, which is the same invariant written
 * twice; `org_id` below is the column that actually needs referential integrity
 * and it has it.
 *
 * `org_id` is the organization the invite ultimately concerns, for both kinds.
 * It is what "list this agency's pending invites" reads, and it is the cascade
 * that stops an invite outliving the organization that issued it.
 */
export const invites = pgTable(
  'invites',
  {
    id: primaryId(),
    /** `sha256(raw)`. The raw token is in the email and nowhere else. */
    tokenHash: text('token_hash').notNull(),
    targetKind: text('target_kind', { enum: INVITE_TARGET_KINDS }).notNull(),
    /** `organizations.id` or `engagements.id`. No FK — see the header. */
    targetId: uuid('target_id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * The address the offer is *for*. `citext`, so that a person who signs in
     * as `Ana@Studio.com` can redeem an invite addressed to `ana@studio.com` —
     * and, much more importantly, so that case is not a way to slip past the
     * address match in `redeemInvite()`.
     */
    email: citext('email').notNull(),
    /** An `ORG_ROLES` value for an org invite, a `PROJECT_ROLES` value for a project one. */
    role: text('role').notNull(),
    invitedByAccountId: uuid('invited_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expiresAt: tstz('expires_at').notNull(),
    /** Set by the single atomic UPDATE in `redeemInvite()`. Single use. */
    consumedAt: tstz('consumed_at'),
    /**
     * Who redeemed it — always an account that had already been verified in the
     * session that redeemed. Recorded because "an invite for ana@ was redeemed
     * by account X" is the one question an account-takeover report asks.
     */
    consumedByAccountId: uuid('consumed_by_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    revokedAt: tstz('revoked_at'),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    /**
     * Unique rather than a plain index. Two invites cannot share a hash unless
     * sha256 has collided, and if the generator is ever weakened the database
     * refuses the second row rather than making redemption ambiguous.
     */
    byTokenHash: uniqueIndex('invites_token_hash_key').on(t.tokenHash),
    /** The pending-invite list, and the "already invited" idempotency check. */
    byOrgEmail: index('invites_org_email_idx').on(t.orgId, t.email),
    /** The purge walk: every invite naming a project that is being destroyed. */
    byTarget: index('invites_target_idx').on(t.targetKind, t.targetId),
  }),
);

/**
 * Proof of control of an email address, and nothing else.
 *
 * One live row per address, enforced by `issueSignin()` deleting every prior
 * row for the address before inserting — the same reasoning `storeClientCode()`
 * gives: a six-digit code is only as strong as the number of them that would be
 * accepted at once, and letting a thousand requested-but-unused codes stay live
 * turns a 1-in-10^6 guess into 1-in-10^3.
 *
 * `attempts` is on the row rather than in a counter table because the guess
 * that must be counted is the one that *does not match* — a wrong code cannot
 * be looked up by its own hash, so the counter has to hang off the address.
 */
export const signinTokens = pgTable(
  'signin_tokens',
  {
    id: primaryId(),
    /** `sha256('signin:' || email || ':' || code)`. */
    tokenHash: text('token_hash').notNull(),
    email: citext('email').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    consumedAt: tstz('consumed_at'),
    /** Incremented by every attempt against this address, matching or not. */
    attempts: integer('attempts').notNull().default(0),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    byTokenHash: uniqueIndex('signin_tokens_token_hash_key').on(t.tokenHash),
    /** `consumeSignin()` drives from the address, not from the hash. */
    byEmail: index('signin_tokens_email_idx').on(t.email),
  }),
);

export const invitesRelations = relations(invites, ({ one }) => ({
  organization: one(organizations, {
    fields: [invites.orgId],
    references: [organizations.id],
  }),
  invitedBy: one(accounts, {
    fields: [invites.invitedByAccountId],
    references: [accounts.id],
  }),
}));
