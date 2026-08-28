'use client';

/**
 * The second half of the invite screen: accepting it.
 *
 * `InviteFacts` above has already said who invited you, to what, and in what
 * role. Everything here happens *after* that, which is the sequence the
 * delivery plan specifies and the reason this is two components rather than
 * one.
 *
 * ## What this can and cannot do
 *
 * It cannot establish a session. INV-12: "an invite token never establishes a
 * session; membership is written only after independent verification of the
 * invited address." So the unverified case here is not a form — there is no
 * field on it — it is a link to the ordinary sign-in carrying this page as its
 * destination. The token is not sent to the sign-in and does not need to be: it
 * is still in the URL when the person comes back, and `resolveInvite` wrote
 * nothing on the way past, so the invitation is exactly as they left it.
 *
 * `redeem()` sends no body for the same reason. The account is the one the
 * session already verified; a body naming an address would be a second,
 * browser-supplied answer to the question INV-12 exists to make the server
 * answer alone.
 *
 * ## The mismatch is stated after the attempt, and that is not a compromise
 *
 * The preview masks the invited address, because anybody holding a forwarded
 * link can read it. This screen therefore does not know the reader's address,
 * does not know the invited one, and cannot compare them — so it does not
 * pretend to. It asks, and the server answers `address_mismatch`, and the
 * invitation is **left unconsumed** by that refusal, which is what lets the
 * copy promise that signing in as the right address still works. A screen that
 * guessed at the comparison locally would sometimes contradict the server,
 * which is worse than asking.
 *
 * When it happens there are two doors and both of them are real:
 *
 *   - **Sign out and come back as the invited address.** The common case: a
 *     personal account already signed in, an invitation sent to a work one.
 *   - **Ask for a new invitation.** The other common case — the address they
 *     have is the address they want — and the only one a bare "try again" would
 *     leave stranded. The screen names the person who sent it. It does not
 *     offer to reissue, because nothing on this page can, and a button posting
 *     to nothing is precisely the ambiguous failure this was built to avoid.
 *
 * ## Why redeeming is a server action and not a `fetch`
 *
 * A successful redemption ends at the portfolio, because the person is an
 * agency member now. Written here that is `router.push('/portfolio')` — and
 * `"/portfolio"` is on the bundle audit's agency route list, which found it in
 * exactly this chunk: the one served to somebody holding an emailed link who is
 * in neither audience. That is Phase 4's leak shape, one surface further out
 * than the rule was written for.
 *
 * So the destination is not the browser's to know. `redeemInviteAction` runs on
 * the server, redirects on the server, and this component receives only the
 * failure. Nothing about where an agency member belongs reaches a person who
 * has not yet become one. `useActionState` supplies the pending state and the
 * failure slot that `useAction` was supplying before, and a success simply
 * never returns.
 *
 * ## No animation
 *
 * Redeeming is an event, and the mark it leaves is a redirect into the
 * workspace — the fact appears somewhere else entirely. Nothing here moves
 * (MOTION.md R1: one event, one motion, in the place the fact changed), and
 * nothing is server-rendered with an `animate-` utility, which
 * `tests/unit/first-paint.spec.ts` checks.
 */

import { useActionState } from 'react';
import Link from 'next/link';
import type { InvitePreview } from '@/lib/api-client.invite';
import type { ApiFailure } from '@/lib/api-client.core';
import { Button } from '@/components/primitives';
import { buttonClass, cn, mono, muted } from '@/components/style-tokens';
import { inviteFailureCopy } from './failure-copy';
import { InviteNotice } from './notice';
import { roleCopy } from './role-copy';

/**
 * What Relay knows about the reader, and nothing more.
 *
 * Two states, not three. An earlier draft carried a "verified as this exact
 * address" state so the screen could pre-empt a mismatch; the preview masks the
 * address precisely so that nobody holding a forwarded link can read it, which
 * makes that comparison impossible and the state a fiction. What is left is the
 * only question this page can answer without the server: has this person proved
 * *an* address in this session.
 *
 * Even that is rendering only. `requireVerifiedAccount()` re-derives it on the
 * POST and is the sole authority (DELIVERY-PLAN §III, INV-11); this decides
 * which of two screens is drawn first.
 */
export type Reader = { state: 'anonymous' } | { state: 'verified' };

export function RedeemPanel({
  invite,
  reader,
  redeem,
  signOut,
  signInHref,
}: {
  invite: InvitePreview;
  reader: Reader;
  /**
   * The redemption, as a server action already bound to this token. A prop and
   * not an import, for the same reason `signOut` is one: this component has no
   * business knowing the route, and the route string is precisely what must not
   * be in its chunk.
   */
  redeem: (previous: ApiFailure | null, formData: FormData) => Promise<ApiFailure | null>;
  /**
   * "Use a different address", as a server action bound to this token.
   *
   * A prop and not an import, so this component never learns how the session is
   * held — the same arrangement `SignInForm` uses for its action, and the same
   * reason. It is a `<form>` rather than a link because signing out is a
   * mutation: Auth.js requires a POST with its CSRF token, and a GET that
   * dropped a session would be followable by any image tag on any page.
   */
  signOut: () => Promise<void>;
  /**
   * Where "confirm my email" goes, built by the page. Same argument again: the
   * sign-in route and this invitation's own path would otherwise be two more
   * agency-side strings assembled inside a chunk a stranger downloads.
   */
  signInHref: string;
}) {
  const [refusal, submitRedeem, redeeming] = useActionState(redeem, null);
  const role = roleCopy(invite.role, invite.targetKind);
  const failure = refusal ? inviteFailureCopy(refusal) : null;

  /* ------------------------------------------- verification not done yet */

  if (reader.state === 'anonymous') {
    return (
      <div className="flex flex-col gap-3">
        <p className={cn('max-w-prose text-14', muted)}>
          One step before you are in: prove that{' '}
          <span className={cn(mono, 'text-ink')}>{invite.invitedEmailMasked}</span> is yours. Relay
          emails you a link — there is no password to choose and nothing else to fill in. This
          invitation is not what signs you in; confirming the address is, and that is deliberate.
        </p>
        <div>
          {/*
            A link and not a button, so it takes `buttonClass` rather than the
            `Button` primitive — the case that vocabulary exists for. Tone
            `agency`, because confirming an address hands nothing to anybody and
            the ball stays with the side of the product this person is joining.
          */}
          <Link href={signInHref} className={buttonClass('agency', 'lg')}>
            Confirm my email
          </Link>
        </div>
        <p className={cn('max-w-prose text-12', muted)}>
          You come straight back here afterwards. Nothing about this invitation is spent by looking
          at it, so it will still be waiting.
        </p>
      </div>
    );
  }

  /* ---------------------------------------------------- the mismatch */

  if (failure?.mismatch) {
    return (
      <InviteNotice title={failure.title} body={failure.body}>
        <p className={cn('max-w-prose text-14', muted)}>
          If <span className={cn(mono, 'text-ink')}>{invite.invitedEmailMasked}</span> is also
          yours, sign out and open this link again as that address. If the address you are already
          using is the one you want, this invitation has to be reissued — and only{' '}
          <span className="font-semibold text-ink">{invite.invitedBy}</span> can do that.
        </p>
        <div className="flex flex-wrap gap-2">
          <form action={signOut}>
            <Button type="submit" tone="agency" size="lg">
              Sign out and use the invited address
            </Button>
          </form>
        </div>
      </InviteNotice>
    );
  }

  /* ------------------------------------------------------------ accept */

  return (
    <div className="flex flex-col gap-3">
      <p className={cn('max-w-prose text-14', muted)}>
        You are signed in. Accepting checks that the address you proved is the one this invitation
        names — if it is not, nothing is changed, the invitation is not spent, and this page will
        say so.
      </p>

      {/*
        A real `<form>` with a server action, so the join still works with no
        JavaScript — the one screen in this product a person reaches from an
        email on a device they did not choose. `useActionState` adds the pending
        state and the failure slot on top of markup that already works.
      */}
      <form action={submitRedeem}>
        <Button type="submit" tone="agency" size="lg" loading={redeeming} loadingLabel="Joining">
          Join {invite.targetName} as a {role.label.toLowerCase()}
        </Button>
      </form>

      {failure && (
        <InviteNotice
          title={failure.title}
          body={failure.body}
          code={refusal ? `${refusal.code}${refusal.status ? ` · ${refusal.status}` : ''}` : undefined}
        >
          {failure.askAgain && (
            <p className={cn('max-w-prose text-14', muted)}>
              <span className="font-semibold text-ink">{invite.invitedBy}</span> sent this
              invitation and can send another. Nothing here can reissue it.
            </p>
          )}
        </InviteNotice>
      )}
    </div>
  );
}
