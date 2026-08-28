/**
 * What each failure says to somebody holding an invite link.
 *
 * A third copy file beside `agency/failure-copy.ts` and `client/failure-copy.ts`
 * rather than a shared one, for the reason those two already state: vocabulary
 * is a surface concern, and a shared strings module is how "Send to internal
 * review" ended up in a bundle it had no business being in. The person reading
 * this screen is in neither tree — not an agency member yet, and not a reviewer
 * on anything — so the agency's words for a 404 are not merely the wrong tone
 * here, they describe a relationship this reader does not have.
 *
 * ## Never fail ambiguously
 *
 * The delivery plan names the requirement: *"If the verified address differs
 * from the invited one, the screen says so plainly and offers to request a new
 * invite, rather than failing ambiguously."* The back-end made that possible
 * rather than aspirational — `redeemInvite` throws `InviteRefused` with an
 * enumerated `reason`, and the route puts it in `details` precisely so this
 * file can render five sentences without parsing prose. Every branch below
 * names which of the five happened.
 *
 * ## What the refusals leave behind, which is why the copy can promise things
 *
 * Every refusal except `not_redeemable` leaves the invitation **unconsumed**.
 * That is a deliberate property of `redeemInvite` — burning an invite on a
 * mismatch would turn a forwarded email into a denial of service against the
 * person it was actually for — and it is what lets `address_mismatch` say
 * "sign in as that address and this still works". Without it that sentence
 * would be a lie, so this file and that function have to stay in step.
 *
 * `retryable` follows `agency/failure-copy.ts`: the only failure whose copy
 * says try again is one where trying again is a *different act*. None of the
 * refusals are — pressing accept twice with the wrong address signed in
 * produces the same answer forever — except the transport case, which never
 * reached a server at all.
 */

import type { ApiFailure } from '@/lib/api-client.core';
import { refusalReasonFrom } from '@/lib/api-client.invite';
import type { RefusalReason } from '@/lib/types';

export interface InviteFailureCopy {
  title: string;
  body: string;
  /** True only when pressing the same control again is a different act. */
  retryable: boolean;
  /** Whether the screen should point at the person who sent the invite. */
  askAgain: boolean;
  /** True for the one refusal whose remedy is a different session. */
  mismatch: boolean;
}

/**
 * The two spellings of a refusal, collapsed to one value.
 *
 * `POST /api/invites/:token/redeem` now answers each refusal with its own code
 * — `INVITE_ADDRESS_MISMATCH` (409), `INVITE_EXPIRED` (410), `INVITE_CONSUMED`
 * (409) — **and** keeps `details: { reason }` beside it, both from one `switch`
 * so they cannot drift. The code is the contract; the reason is what makes a
 * log line say `address_mismatch` rather than `409`.
 *
 * The code is read first and the reason is the fallback. That ordering is now
 * belt to braces rather than load-bearing, and it is kept for one reason: a
 * front-end and a back-end do not deploy in the same instant, and a build of
 * this page running against a server that predates the codes would otherwise
 * render the generic sentence for every refusal — the ambiguous failure this
 * file exists to prevent, appearing exactly during a rollout.
 *
 * `ApiFailure.code` is compared as a widened string rather than switched on:
 * `ErrorCode` is a union this module resolves from `@/lib/types`, and writing a
 * `case` for a literal is only safe while the two agree. Same move
 * `agency/failure-copy.ts`'s storage block makes, and the same reasoning.
 *
 * **`unknown_token` and `target_gone` are 404 with no details, deliberately.**
 * Both mean "there is nothing here", and a caller must not be able to tell a
 * token that never existed from one whose organisation was deleted. They fall
 * through to the 404 branch below, which says the link opens nothing — which is
 * true of both and distinguishes neither.
 *
 * `INVITE_CONSUMED` maps to `not_redeemable` rather than to a fourth branch:
 * the domain uses one refusal for consumed and revoked because both mean the
 * same thing to the reader — the link is spent — and splitting them here would
 * make the copy claim a distinction the server did not send.
 */
function refusalOf(failure: ApiFailure): RefusalReason | null {
  const code: string = failure.code;
  if (code === 'INVITE_ADDRESS_MISMATCH') return 'address_mismatch';
  if (code === 'INVITE_EXPIRED') return 'expired';
  if (code === 'INVITE_CONSUMED') return 'not_redeemable';
  return refusalReasonFrom(failure.details);
}

export function inviteFailureCopy(failure: ApiFailure): InviteFailureCopy {
  const reason = refusalOf(failure);

  if (reason === 'address_mismatch') {
    return {
      title: 'That invitation was sent to a different address',
      body: 'You are signed in, and the address you have proved is not the one this invitation names. An invitation only works for the address it was sent to — that is what stops a forwarded link letting somebody else in. Nothing has been changed, nobody has been given access, and the invitation is still unused: sign in as the address it names and it will still be here.',
      retryable: false,
      askAgain: true,
      mismatch: true,
    };
  }

  if (reason === 'expired') {
    return {
      title: 'That invitation has expired',
      body: 'Invitations do not last forever and this one has run out. It cannot be revived — a new one has to be sent, which is one press for whoever sent this.',
      retryable: false,
      askAgain: true,
      mismatch: false,
    };
  }

  if (reason === 'not_redeemable') {
    return {
      title: 'That invitation has already been used',
      body: 'It has been accepted, or it was withdrawn. Either way the link is spent. If it was you who accepted it, you are already in — sign in and it will be there.',
      retryable: false,
      askAgain: true,
      mismatch: false,
    };
  }

  if (reason === 'unknown_token') {
    return {
      title: 'Relay does not recognise this invitation',
      body: 'The link does not match anything. Links get broken by email clients that wrap long lines, so it is worth checking whether this one was cut in half — and if it was not, it was never valid or it has since been cleaned up.',
      retryable: false,
      askAgain: true,
      mismatch: false,
    };
  }

  if (reason === 'target_gone') {
    return {
      title: 'There is nothing left to join',
      body: 'The workspace this invitation pointed at no longer exists. Nothing has gone wrong on your side and there is nothing here to retry.',
      retryable: false,
      askAgain: true,
      mismatch: false,
    };
  }

  if (failure.code === 'UNAUTHENTICATED') {
    return {
      title: 'Confirm your email first',
      body: 'An invitation on its own does not sign anybody in — that is deliberate, and it is why this step exists. Prove the address it was sent to and the invitation can then be accepted.',
      retryable: false,
      askAgain: false,
      mismatch: false,
    };
  }

  if (failure.code === 'RATE_LIMITED') {
    return {
      title: 'Too many attempts',
      body: 'This has been tried too many times in a short window and is paused. Give it a few minutes.',
      retryable: false,
      askAgain: false,
      mismatch: false,
    };
  }

  if (failure.status === 0) {
    return {
      title: 'That did not reach us',
      body: 'The request never arrived — a dropped connection rather than anything about this invitation. This one is worth trying again.',
      retryable: true,
      askAgain: false,
      mismatch: false,
    };
  }

  if (failure.status === 404 || failure.code === 'NOT_VISIBLE' || failure.code === 'MALFORMED') {
    /*
     * 404 and "malformed" are one screen on purpose. An unrouted path answers
     * with HTML, which `request()` reports as MALFORMED with a 404 — and to the
     * person holding the link, "this is not an invitation" and "this is not
     * anything" are the same fact. Splitting them would make the reader
     * diagnose our routing.
     */
    return {
      title: 'This link does not open anything',
      body: 'Relay does not recognise it. Email clients sometimes break long links across lines, so it is worth checking whether this one was cut in half — and if it was not, it was never valid or it has already been cleaned up.',
      retryable: false,
      askAgain: true,
      mismatch: false,
    };
  }

  return {
    title: 'That did not work',
    body: 'Something went wrong opening this invitation, and it was on our side rather than yours. Nothing has been changed.',
    retryable: false,
    askAgain: true,
    mismatch: false,
  };
}
