/**
 * The invite-redemption half of the API seam. A third leaf, and it is a leaf
 * for the same reason `api-client.core.ts` is one.
 *
 * **Nothing here may import `api-client.agency.ts` or `api-client.client.ts`,
 * and neither of them may import this.** `/invite/[token]` is read by a person
 * who is in neither tree: they hold no agency session, they are not a reviewer
 * on any engagement, and — this is the part that matters — the page renders
 * *before* they have proved who they are. A single import from the agency half
 * would put `/api/lanes`, `/api/cards/:id/transition` and the rest of the
 * agency route map into a chunk served to a stranger holding a link. That is
 * the same argument Phase 4's exit condition makes about the client bundle,
 * applied to the one surface that sits outside both trees.
 *
 * The same rule is why this module carries no vocabulary import. Agency copy
 * lives in `src/components/agency/vocabulary.ts`, which contains
 * `Send to internal review` — an entry on the bundle audit's marker list, and
 * backstage language a person who has not yet joined the organisation has no
 * business being able to read out of their own JavaScript.
 *
 * ## The shapes are re-exported, never redeclared
 *
 * `InvitePreview` and `InviteRedemption` are defined once, beside the functions
 * that produce them, and re-exported through `src/lib/types.ts` — which is
 * where DELIVERY-PLAN §VI says the shapes both sides share belong. They are
 * pulled from there and restated nowhere, for the reason `api-client.agency.ts`
 * records at the top of its own re-export block: that file carried its own
 * `TemplateSummary` for a phase, with two fields the route does not send, and
 * the surface rendered `Invalid Date` while typechecking perfectly.
 *
 * They were briefly imported straight from `@/domain/auth/invite` while the
 * back-end was still landing them. That worked and left the seam in two places;
 * the back-end has since re-exported them and this file names `@/lib/types`
 * like everything else.
 */

import type {
  InvitePreview,
  InviteRedemption,
  InviteState,
  InviteTargetKind,
  RefusalReason,
} from '@/lib/types';
import { pick, request, type RequestContext } from './api-client.core';

export type { InvitePreview, InviteRedemption, InviteState, InviteTargetKind, RefusalReason };

/**
 * Why a redemption was refused, read out of a failure.
 *
 * There are two spellings in flight and this reads both, on purpose.
 *
 *   - `ERROR_CODES` now carries `INVITE_ADDRESS_MISMATCH`, `INVITE_EXPIRED` and
 *     `INVITE_CONSUMED`, which is the destination: a named code is a fact the
 *     contract states, and `failureCopy` can switch on it.
 *   - `POST /api/invites/:token/redeem` still answers a refusal as a 400
 *     `VALIDATION_FAILED` carrying `details: { reason }` — the route's own
 *     words: "`reason` travels in `details` so the front-end can render four
 *     different sentences without parsing prose." That is what ships today.
 *
 * Reading only the codes would leave every refusal on the current build
 * rendering the generic sentence, which is the ambiguous failure this screen
 * exists to avoid; reading only `details` would rot the day the route moves. So
 * `inviteFailureCopy` checks the code first and falls back to this.
 *
 * Defensive because `details` is typed `unknown` in the contract and is written
 * by code this module has never seen run. A shape it does not recognise
 * produces `null`, and the surface degrades to a general sentence rather than
 * throwing on the one screen where a stack trace would be the last thing a
 * person joining a company ever saw of it.
 *
 * The strings are compared rather than narrowed with a cast, because checking
 * membership *is* how an unknown value gets rejected — a cast would assert
 * exactly the thing that needs testing.
 */
const REFUSAL_REASONS: readonly string[] = [
  'unknown_token',
  'expired',
  'not_redeemable',
  'address_mismatch',
  'target_gone',
];

export function refusalReasonFrom(details: unknown): RefusalReason | null {
  if (typeof details !== 'object' || details === null) return null;
  const reason = (details as { reason?: unknown }).reason;
  if (typeof reason !== 'string') return null;
  return REFUSAL_REASONS.includes(reason) ? (reason as RefusalReason) : null;
}

/* ---------------------------------------------------------------- invite api */

export const inviteApi = {
  /**
   * GET /api/invites/:token — the preview.
   *
   * No session is required and the route reads none. It "reveals the target and
   * the inviter and grants nothing", and — the property that makes the whole
   * sequence possible — it **writes nothing at all**, so a corporate mail
   * scanner fetching this URL twice before the recipient does leaves the
   * invitation exactly as it found it.
   *
   * That is why the preview comes before anything is asked for. There is no
   * cost to showing it and a real cost to hiding it behind a sign-in form: a
   * stranger asked for their address before being told what for.
   */
  preview(token: string, ctx?: RequestContext) {
    return request<{ invite: InvitePreview }>(`/api/invites/${encodeURIComponent(token)}`, {
      ctx,
    }).then((r) => pick(r, (p) => p.invite));
  },

  /**
   * POST /api/invites/:token/redeem — requires a verified session (INV-12).
   *
   * There is no body. The account is the one the session already verified, and
   * a body naming an address would be a second, browser-supplied answer to the
   * question the whole invariant exists to make the server answer alone —
   * `redeemInvite` re-reads the account's verified addresses out of `identities`
   * and would refuse it regardless.
   */
  redeem(token: string, ctx?: RequestContext) {
    return request<{ redemption: InviteRedemption }>(
      `/api/invites/${encodeURIComponent(token)}/redeem`,
      { method: 'POST', ctx },
    ).then((r) => pick(r, (p) => p.redemption));
  },
};
