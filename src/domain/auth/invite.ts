/**
 * `issueInvite` / `resolveInvite` / `redeemInvite` — INV-12, in one file.
 *
 * > **INV-12** An invite token never establishes a session. Membership is
 * > written only after independent verification of the invited address.
 *
 * ## Where the boundary is, exactly
 *
 * At `redeemInvite`'s second parameter. It is `verifiedAccountId: string`, and
 * there is no overload, no options object, and no default that lets a caller
 * omit it. A caller holding a token and nothing else cannot call this function
 * at all — the boundary is a type error, not a runtime check.
 *
 * That alone would still be a promise about call sites, so the function does not
 * trust the argument either. It re-reads the account's *verified* addresses out
 * of `identities` (`email_verified IS NOT NULL`) and requires the invited
 * address to be among them. An account id passed in error, or in bad faith,
 * produces membership only if that account has genuinely proved control of the
 * exact address the invite names. Two independent gates, and the second one is
 * a database read rather than an assertion about the first.
 *
 * ## What each function is allowed to do
 *
 * | | reads | writes | grants |
 * |---|---|---|---|
 * | `issueInvite` | the org | one `invites` row | nothing |
 * | `resolveInvite` | one `invites` row | **nothing** | nothing |
 * | `redeemInvite` | the invite, the account's verified addresses | consumes the invite | membership |
 *
 * `resolveInvite` is the one a stranger can reach. It writes nothing at all —
 * not a consumption, not an attempt counter, not a "seen at" timestamp — which
 * is what makes `GET /api/invites/:token` safe to be prefetched by a mail
 * scanner. Nothing on the GET path can be spent, because nothing on the GET
 * path is written.
 *
 * ## A forwarded invite
 *
 * Ana is invited; Ana forwards the mail to Bob; Bob opens the link, signs in as
 * himself, and presses redeem. `resolveInvite` shows Bob who the invitation is
 * for and what it offers, with the address masked because the preview is
 * unauthenticated. `redeemInvite` then fails `address_mismatch`, having written
 * nothing: the invite is **not** consumed, so Ana's own redemption still works
 * afterwards. Refusing and burning would turn a forwarded mail into a denial of
 * service against the intended recipient.
 */

import { and, eq, gt, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { accounts, engagements, invites, organizations } from '@/db/schema';
import type { Executor } from '@/db/types';
import { joinOrganization, joinProject, type JoinResult } from '../access/join';
import { verifiedEmailsForAccount } from '../access/provision-account';
import { isOrgRole, isProjectRole, type OrgRole, type ProjectRole } from '../access/roles';
import { notVisible, validationFailed } from '../errors';
import { INVITE_TTL_DAYS, inviteTokenHash, maskEmail, newInviteToken } from './tokens';

export type InviteTargetKind = 'org' | 'project';

/** Why an invite is not redeemable, or `open` when it is. */
export type InviteState = 'open' | 'expired' | 'consumed' | 'revoked';

/**
 * What `GET /api/invites/:token` returns. It grants nothing.
 *
 * Everything here is a display value. There is no id in it that a caller could
 * turn into a request: not the organization's, not the project's, not the
 * inviter's account id. A person deciding whether to accept needs to know who
 * is asking and into what, and needs none of those.
 */
export interface InvitePreview {
  readonly targetKind: InviteTargetKind;
  /** The organization's or project's name. Never its id. */
  readonly targetName: string;
  /** The organization the invitation ultimately concerns, by name. */
  readonly orgName: string;
  /** An `OrgRole` for an org invite, a `ProjectRole` for a project one. */
  readonly role: OrgRole | ProjectRole;
  /** The inviter's name, or their address when they have not set one. */
  readonly invitedBy: string;
  /**
   * `a•••@studio.com`. Masked because this response is unauthenticated: anyone
   * holding a forwarded link can read it. Enough for the intended recipient to
   * recognise their own address, not enough for anybody else to harvest it —
   * and enough for the screen to say *this invitation is for a•••@studio.com,
   * and you are signed in as somebody else*, which is the sentence that makes a
   * mismatch legible before anyone presses anything.
   */
  readonly invitedEmailMasked: string;
  readonly expiresAt: string;
  /** `open`, or why not. Distinguishes expired from consumed from revoked. */
  readonly state: InviteState;
}

/** What `POST /api/invites/:token/redeem` returns once membership exists. */
export interface InviteRedemption {
  readonly targetKind: InviteTargetKind;
  readonly targetName: string;
  readonly orgName: string;
  readonly role: OrgRole | ProjectRole;
  /** False when the account already held this membership. */
  readonly granted: boolean;
}

/**
 * The complete set of conditions under which `redeemInvite` refuses.
 *
 * Enumerated as a type so the list is checkable rather than remembered, and so
 * the handover can name them. Every one of them leaves the invite unconsumed
 * except `not_redeemable`, which is what a *second* redemption of an already
 * consumed invite sees.
 */
export type RefusalReason =
  /** No invite has that token hash. Also what an expired-and-swept one looks like. */
  | 'unknown_token'
  /** Past `expires_at`. Seven days (ADR-021 §5). */
  | 'expired'
  /** Already consumed, or revoked by the organization. */
  | 'not_redeemable'
  /**
   * The verified session is for a different address than the invite names. The
   * forwarded-invite case, and the reason INV-12 exists.
   */
  | 'address_mismatch'
  /** The target organization or project no longer exists. */
  | 'target_gone';

export class InviteRefused extends Error {
  readonly reason: RefusalReason;
  constructor(reason: RefusalReason, message: string) {
    super(message);
    this.name = 'InviteRefused';
    this.reason = reason;
  }
}

/* --------------------------------------------------------------- issuing */

export interface IssueInviteInput {
  readonly targetKind: InviteTargetKind;
  readonly targetId: string;
  readonly orgId: string;
  readonly email: string;
  readonly role: OrgRole | ProjectRole;
  readonly invitedByAccountId: string;
}

export interface IssuedInvite {
  readonly inviteId: string;
  /** The raw token. Returned once, to be put in an email. Never stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Mint an offer of membership.
 *
 * Re-inviting an address that already has a live invite to the same target
 * **replaces** it rather than adding a second. Two live invites for one person
 * means one of them is a spare key nobody is tracking, and "we sent you a new
 * invitation" should mean the old one stopped working.
 *
 * ## `target_kind: 'project'` is reachable here and from no route
 *
 * The column has two legal values because DELIVERY-PLAN §IV's table shape has
 * two, and `redeemInvite` handles both because a column with an unhandled value
 * is a branch that consumes an invite and grants nothing. But the only issuing
 * surface this phase ships is the organization one, and that is a decision:
 * a direct project grant to an account with no org membership is access the
 * *graph* has and the shipped v1 check does not, so every request that person
 * makes would land in the shadow ledger as `visible_set_differs` — a real
 * disagreement, caused by a feature, during the window whose whole purpose is
 * to reach zero of them. Project invites belong after ADR-021's step 4.
 */
export async function issueInvite(
  exec: Executor,
  input: IssueInviteInput,
  now: Date,
): Promise<IssuedInvite> {
  const token = newInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);

  await exec
    .delete(invites)
    .where(
      and(
        eq(invites.orgId, input.orgId),
        eq(invites.email, input.email),
        eq(invites.targetKind, input.targetKind),
        eq(invites.targetId, input.targetId),
        isNull(invites.consumedAt),
      ),
    );

  const inserted = await exec
    .insert(invites)
    .values({
      id: uuidv7(),
      tokenHash: inviteTokenHash(token),
      targetKind: input.targetKind,
      targetId: input.targetId,
      orgId: input.orgId,
      email: input.email,
      role: input.role,
      invitedByAccountId: input.invitedByAccountId,
      expiresAt,
      createdAt: now,
    })
    .returning({ id: invites.id });

  const row = inserted[0];
  if (!row) throw new Error('issueInvite: insert returned no row');
  return { inviteId: row.id, token, expiresAt };
}

/* -------------------------------------------------------------- resolving */

interface InviteRow {
  readonly id: string;
  readonly targetKind: InviteTargetKind;
  readonly targetId: string;
  readonly orgId: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly inviterName: string | null;
  readonly inviterEmail: string;
  readonly orgName: string;
}

async function loadByToken(exec: Executor, token: string): Promise<InviteRow | null> {
  const rows = await exec
    .select({
      id: invites.id,
      targetKind: invites.targetKind,
      targetId: invites.targetId,
      orgId: invites.orgId,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      consumedAt: invites.consumedAt,
      revokedAt: invites.revokedAt,
      inviterName: accounts.name,
      inviterEmail: accounts.primaryEmail,
      orgName: organizations.name,
    })
    .from(invites)
    .innerJoin(accounts, eq(accounts.id, invites.invitedByAccountId))
    .innerJoin(organizations, eq(organizations.id, invites.orgId))
    .where(eq(invites.tokenHash, inviteTokenHash(token)))
    .limit(1);
  return rows[0] ?? null;
}

function stateOf(row: InviteRow, now: Date): InviteState {
  if (row.revokedAt) return 'revoked';
  if (row.consumedAt) return 'consumed';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'open';
}

/**
 * What the token identifies, and nothing more.
 *
 * Reveals the target and the inviter. Grants nothing, writes nothing, and
 * establishes nothing — a session least of all. This is the function a mail
 * scanner reaches, twice, before the recipient has done anything, and it must
 * leave the invite exactly as it found it.
 *
 * @throws NOT_VISIBLE when no invite has that token. 404, never 403: which
 *   tokens are real is not a fact an anonymous caller is entitled to.
 */
export async function resolveInvite(
  exec: Executor,
  token: string,
  now: Date,
): Promise<InvitePreview> {
  const row = await loadByToken(exec, token);
  if (!row) throw notVisible('Not found');

  return {
    targetKind: row.targetKind,
    targetName: await targetName(exec, row),
    orgName: row.orgName,
    role: readRole(row),
    invitedBy: row.inviterName ?? row.inviterEmail,
    invitedEmailMasked: maskEmail(row.email),
    expiresAt: row.expiresAt.toISOString(),
    state: stateOf(row, now),
  };
}

/** The organization's name for an org invite, the project's for a project one. */
async function targetName(exec: Executor, row: InviteRow): Promise<string> {
  if (row.targetKind === 'org') return row.orgName;
  return projectName(exec, row.targetId, row.orgName);
}

async function projectName(exec: Executor, projectId: string, fallback: string): Promise<string> {
  const rows = await exec
    .select({ title: engagements.title })
    .from(engagements)
    .where(eq(engagements.id, projectId))
    .limit(1);
  return rows[0]?.title ?? fallback;
}

/**
 * `invites.role` is a constrained `text` column, not a SQL enum — the house
 * pattern for anything that moves with a product decision. Reading it back
 * therefore has to narrow, and a value that narrows to neither is a corrupted
 * row rather than a role to guess at.
 */
function readRole(row: InviteRow): OrgRole | ProjectRole {
  if (row.targetKind === 'org') {
    if (!isOrgRole(row.role)) throw new Error(`invite ${row.id}: not an org role`);
    return row.role;
  }
  if (!isProjectRole(row.role)) throw new Error(`invite ${row.id}: not a project role`);
  return row.role;
}

/* -------------------------------------------------------------- redeeming */

/**
 * Turn an offer into membership, for an account that has **already** proved
 * control of the invited address in this session.
 *
 * @param verifiedAccountId an account whose address was verified by
 *   `consumeSignin()` (or by Auth.js's own magic link) *in this session*. The
 *   caller is `requireVerifiedAccount()` in `src/app/api/_guards.ts`, which is
 *   the only thing in the codebase that produces one. This function does not
 *   take that on trust — see the address check below.
 *
 * @throws InviteRefused with the exact `reason`. Every refusal except
 *   `not_redeemable` leaves the invite unconsumed and redeemable by the person
 *   it was actually for.
 */
export async function redeemInvite(
  exec: Executor,
  token: string,
  verifiedAccountId: string,
  now: Date,
): Promise<InviteRedemption> {
  const row = await loadByToken(exec, token);
  if (!row) throw new InviteRefused('unknown_token', 'That invitation could not be found');

  const state = stateOf(row, now);
  if (state === 'expired') {
    throw new InviteRefused('expired', 'That invitation has expired');
  }
  if (state !== 'open') {
    throw new InviteRefused('not_redeemable', 'That invitation is no longer valid');
  }

  /**
   * **The gate.** The invited address must be one this account has proved.
   *
   * Read from `identities` where `email_verified IS NOT NULL`, not from
   * `accounts.primary_email` — a primary email is a display field that nothing
   * verified, and matching against it would make "create an account claiming
   * ana@studio.com" the whole attack.
   *
   * Case is handled twice over: the column is `citext`, and the comparison is
   * lowercased. `citext` covers the SQL, and this covers the JavaScript, which
   * `citext` cannot.
   */
  const verified = await verifiedEmailsForAccount(exec, verifiedAccountId);
  const invited = row.email.toLowerCase();
  if (!verified.some((e) => e.toLowerCase() === invited)) {
    throw new InviteRefused(
      'address_mismatch',
      'This invitation was sent to a different email address. Sign in as that address to accept it.',
    );
  }

  /**
   * Consume first, atomically, and only then grant.
   *
   * `consumed_at IS NULL` is in the UPDATE's own WHERE, so two requests racing
   * with the same token produce exactly one grant. Consuming *before* granting
   * rather than after is the safer order for a single-use token: a failure
   * between the two leaves an invite that cannot be redeemed twice, whereas the
   * other order leaves one that can.
   *
   * Both statements run inside the caller's transaction, so a refused grant
   * rolls the consumption back with it. The ordering matters for the concurrent
   * case, not the failing one.
   */
  const consumed = await exec
    .update(invites)
    .set({ consumedAt: now, consumedByAccountId: verifiedAccountId })
    .where(and(eq(invites.id, row.id), isNull(invites.consumedAt)))
    .returning({ id: invites.id });

  if (!consumed[0]) {
    throw new InviteRefused('not_redeemable', 'That invitation is no longer valid');
  }

  const role = readRole(row);
  const grant = await grantFor(exec, row, verifiedAccountId, role, now);

  return {
    targetKind: row.targetKind,
    targetName: await targetName(exec, row),
    orgName: row.orgName,
    role,
    granted: grant.granted,
  };
}

/**
 * The only branch on `target_kind`, and the only place this file reaches the
 * permission graph — which it does through `src/domain/access/`, because INV-11
 * says a file outside that directory may not name a membership table and this
 * file is outside it.
 */
async function grantFor(
  exec: Executor,
  row: InviteRow,
  accountId: string,
  role: OrgRole | ProjectRole,
  now: Date,
): Promise<JoinResult> {
  if (row.targetKind === 'org') {
    if (!isOrgRole(role)) throw new Error(`invite ${row.id}: not an org role`);
    const legacyUserId = await legacyUserFor(exec, accountId);
    return joinOrganization(
      exec,
      { accountId, legacyUserId, orgId: row.targetId, role },
      now,
    );
  }

  if (!isProjectRole(role)) throw new Error(`invite ${row.id}: not a project role`);
  const exists = await exec
    .select({ id: engagements.id })
    .from(engagements)
    .where(eq(engagements.id, row.targetId))
    .limit(1);
  if (!exists[0]) throw new InviteRefused('target_gone', 'That project no longer exists');

  return joinProject(exec, { accountId, projectId: row.targetId, role: role });
}

/**
 * The v1 row this account maps to.
 *
 * Not optional during the shadow window: `joinOrganization()` writes both
 * halves or neither, and an account with no legacy row is a person the running
 * product cannot see. Every path that reaches here has been through
 * `ensureAccountForVerifiedEmail()`, which creates one, so a missing row is a
 * broken invariant rather than a case to handle.
 */
async function legacyUserFor(exec: Executor, accountId: string): Promise<string> {
  const rows = await exec
    .select({ legacyUserId: accounts.legacyUserId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  const legacyUserId = rows[0]?.legacyUserId;
  if (!legacyUserId) {
    throw validationFailed('That account is not yet provisioned for sign-in', {
      reason: 'no_legacy_user',
    });
  }
  return legacyUserId;
}

/* ------------------------------------------------------ listing and revoking */

/** One outstanding invitation, as the agency's roster shows it. */
export interface PendingInvite {
  readonly id: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly invitedByName: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * The org's live invitations.
 *
 * **The token is not in the return type and cannot be**: only its sha256 is
 * stored, so there is nothing here to serve back even by accident. That is not
 * a happy accident of the storage choice, it is the reason for it — an invite
 * token is a bearer credential for one address, and a roster that printed it
 * would let anyone who can read the page redeem it, which is the single thing
 * INV-12 spends a verification step preventing.
 *
 * Expired rows are excluded rather than shown greyed out. An invitation that
 * cannot be redeemed is not outstanding, and "resend" is the action for it.
 */
export async function listPendingInvites(
  exec: Executor,
  orgId: string,
  now: Date,
): Promise<PendingInvite[]> {
  const rows = await exec
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      inviterName: accounts.name,
      inviterEmail: accounts.primaryEmail,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .innerJoin(accounts, eq(accounts.id, invites.invitedByAccountId))
    .where(
      and(
        eq(invites.orgId, orgId),
        eq(invites.targetKind, 'org'),
        isNull(invites.consumedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, now),
      ),
    )
    .orderBy(invites.createdAt);

  const out: PendingInvite[] = [];
  for (const row of rows) {
    // A row whose role does not narrow is a corrupted row, not a role to guess
    // at. Skipping it keeps the roster honest without failing the whole read.
    if (!isOrgRole(row.role)) continue;
    out.push({
      id: row.id,
      email: row.email,
      role: row.role,
      invitedByName: row.inviterName ?? row.inviterEmail,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }
  return out;
}

/**
 * Withdraw an unredeemed invitation.
 *
 * The undo for the expensive mistake: an invitation sent to the wrong address
 * is live for seven days, and "wait a week" is not a remedy when the wrong
 * address belongs to the client whose boards it would have opened.
 *
 * `consumed_at IS NULL` in the predicate, so revoking cannot un-write a
 * membership that already exists — a revocation and a redemption racing produce
 * one or the other, never a consumed invitation marked revoked. Removing
 * somebody who has already joined is a different operation on a different
 * table, and Phase 11's.
 *
 * Scoped by `org_id` as well as by id: an invite id from another agency is a
 * 404 rather than a successful revocation of somebody else's invitation.
 */
export async function revokeInvite(
  exec: Executor,
  orgId: string,
  inviteId: string,
  now: Date,
): Promise<{ id: string }> {
  const revoked = await exec
    .update(invites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.orgId, orgId),
        isNull(invites.consumedAt),
        isNull(invites.revokedAt),
      ),
    )
    .returning({ id: invites.id });

  const row = revoked[0];
  if (!row) throw notVisible('Not found');
  return { id: row.id };
}
