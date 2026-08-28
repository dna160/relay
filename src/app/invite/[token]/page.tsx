/**
 * `/invite/[token]` — redeeming an invitation.
 *
 * ## The sequence, and why it is in this order
 *
 * **Preview first, then verification, then the invitation is accepted.** Not
 * sign-in first. The delivery plan states it and the back-end made it free:
 * `resolveInvite()` "reveals the target and the inviter and grants nothing",
 * and it writes nothing at all — not a consumption, not an attempt counter, not
 * a seen-at stamp. So showing the preview costs exactly nothing, and hiding it
 * behind a sign-in form costs a great deal: a stranger asked for their address
 * before being told what for.
 *
 * The order also makes the failures legible. A person who can see *who* invited
 * them *to what* can tell an expired link from a link to the wrong company from
 * a link they were never meant to have. Behind a sign-in form all three are one
 * shrug.
 *
 * ## Where it lives, and why it is in neither tree
 *
 * At the root, hanging off `src/app/layout.tsx` alone. The reader is in neither
 * audience: not an agency member — that is what the invitation would make them
 * — and not a reviewer on any engagement. Inside `(agency)` it would wear the
 * agency shell, whose navigation links to a portfolio this person cannot open,
 * and would have a natural path to `api-client.agency.ts` and the whole agency
 * route map. Inside `(client)` it would be worse still. So it is its own
 * surface, with its own API leaf (`api-client.invite.ts`) and its own
 * vocabulary (`src/components/invite/`), and the bundle audit's negative
 * control is what makes that separation checked rather than intended.
 *
 * ## What this page never does
 *
 * Establish a session (INV-12). There is no code field here, no password, no
 * "create an account" — the token is not a credential and this page has no way
 * to treat it as one. Verification is the ordinary sign-in, reached by a link
 * that carries this page as its destination, and redemption is a POST that
 * sends no body because the account is the one the session already verified.
 *
 * ## Why the reader question is only "signed in or not"
 *
 * The preview masks the invited address (`a•••@studio.com`) because the
 * response is unauthenticated and anybody holding a forwarded link can read it.
 * So this page cannot compare addresses and does not try: it asks whether an
 * address has been proved *at all*, and the mismatch — if there is one — is
 * named by the server's refusal, which leaves the invitation unconsumed for the
 * person it was actually for.
 *
 * `pendingOnboarding()` is checked before `getSession()`, and the order is
 * load-bearing. Somebody who has just followed an invitation and signed in has
 * an Auth.js session and no organisation, which is exactly the state the
 * invitation is about to fix; `getSession()` returns null for that person by
 * design (ADR-013), so asking it first would report them as anonymous and send
 * them back to a sign-in they had already completed. That loop is the whole
 * reason `pendingOnboarding()` exists.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { inviteApi } from '@/lib/api-client.invite';
import { getSession, pendingOnboarding } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { buttonClass, cn, display, muted } from '@/components/style-tokens';
import { InviteFacts } from '@/components/invite/invite-facts';
import { InviteNotice } from '@/components/invite/notice';
import { RedeemPanel, type Reader } from '@/components/invite/redeem-panel';
import { inviteFailureCopy } from '@/components/invite/failure-copy';
import { serverContext } from '../_lib/server-context';
import { redeemInviteAction, signOutAndReturn } from './actions';

/**
 * The title names no organisation.
 *
 * It is rendered before the preview is fetched, and it ends up in browser
 * history, in a tab strip somebody may be screen-sharing, and in whatever the
 * operating system does with page titles. An invitation is not secret, but
 * which agency invited whom is not a fact to leak into chrome nobody chose.
 */
export const metadata: Metadata = { title: 'An invitation · Relay' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await serverContext();
  const preview = await inviteApi.preview(token, ctx);

  /* -------------------------------------------------- the link does not work */

  if (!preview.ok) {
    const copy = inviteFailureCopy(preview);
    return (
      <Shell>
        <div className="flex flex-col gap-1">
          <h1 className={cn(display, 'text-28 text-ink')}>This invitation</h1>
          <p className={cn('max-w-prose text-14', muted)}>
            Relay could not open it, and the reason is below.
          </p>
        </div>
        {/*
          The code is printed here and nowhere else on this surface. This is the
          one state where the reader may end up forwarding a screenshot to
          whoever sent the link, and a code in the corner is the difference
          between "it says it does not work" and something anybody can act on.
          It is not a breach and it is not painted like one.
        */}
        <InviteNotice
          title={copy.title}
          body={copy.body}
          code={`${preview.code}${preview.status ? ` · ${preview.status}` : ''}`}
        >
          <p className={cn('max-w-prose text-14', muted)}>
            Ask whoever invited you to send a new one. Nothing about this link can be repaired from
            here — a fresh invitation is the only way in, and it costs them one press.
          </p>
          <div>
            <Link href="/signin" className={buttonClass('quiet', 'lg')}>
              I already have a Relay account
            </Link>
          </div>
        </InviteNotice>
      </Shell>
    );
  }

  const invite = preview.data;

  /* --------------------------------------- resolvable, and not redeemable */

  /**
   * Three of the four `InviteState`s are dead ends, and they are told apart
   * rather than collapsed into "this link does not work".
   *
   * The preview resolves for all of them, which means this screen can still say
   * *who* invited *whom* to *what* — and that is the difference between a
   * person knowing which colleague to go and ask, and a person staring at a
   * generic failure. The facts render above the notice for exactly that reason.
   *
   * `revoked` is deliberately not softened into "expired". Somebody withdrew
   * it, and a reader who is told it merely ran out will ask for a replacement
   * that may not be coming.
   */
  if (invite.state !== 'open') {
    return (
      <Shell>
        <InviteFacts invite={invite} />
        <hr className="border-t border-rule" />
        <InviteNotice title={DEAD[invite.state].title} body={DEAD[invite.state].body(invite.expiresAt)}>
          <div className="flex flex-wrap gap-2">
            <Link href="/signin" className={buttonClass('quiet', 'lg')}>
              Sign in to Relay
            </Link>
          </div>
        </InviteNotice>
      </Shell>
    );
  }

  const reader = await localReader();

  return (
    <Shell>
      <InviteFacts invite={invite} />
      <hr className="border-t border-rule" />
      {/*
        Both destinations are built here, in a server component, and handed down
        — the sign-in path and (inside the action) the portfolio. The bundle
        audit found `"/portfolio"` in this route's client chunk when the
        redemption was a browser `fetch`, which is Phase 4's leak shape on the
        one surface that is downloaded by somebody in neither audience. Nothing
        about the agency's routes belongs in a chunk served to a stranger
        holding an emailed link.
      */}
      <RedeemPanel
        invite={invite}
        reader={reader}
        redeem={redeemInviteAction.bind(null, token)}
        signOut={signOutAndReturn.bind(null, token)}
        signInHref={`/signin?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
      />
    </Shell>
  );
}

/**
 * The three states an invitation can be in and still be readable.
 *
 * A `Record` over the union minus `open`, so a fifth `InviteState` added to
 * `src/domain/auth/invite.ts` is a compile error here rather than a silent fall
 * through to the accept path — which would render a Join button on an
 * invitation the server will certainly refuse.
 */
const DEAD: Record<'expired' | 'consumed' | 'revoked', { title: string; body: (expiresAt: string) => string }> =
  {
    expired: {
      title: 'This invitation has expired',
      body: (expiresAt) =>
        `It ran out on ${formatDate(expiresAt)} and cannot be revived. Ask whoever invited you for a new one — it is one press for them, and the new link works the same way.`,
    },
    consumed: {
      title: 'This invitation has already been used',
      body: () =>
        'Somebody has accepted it, so the link is spent. If that was you, you are already in — sign in and it will be there. If it was not you, say so to whoever sent it.',
    },
    revoked: {
      title: 'This invitation was withdrawn',
      body: () =>
        'It was cancelled before it was used, so it no longer opens anything. That is somebody making a correction rather than anything going wrong, and only they can send a replacement.',
    },
  };

/**
 * Has this reader proved an address in this session — and nothing finer.
 *
 * A *client* session is deliberately not treated as verification. A reviewer is
 * a `client_contacts` row with no account (ADR-021), scoped to one engagement
 * and to no other; it is not an identity that can hold an organisation
 * membership, and accepting it here would be an invitation widening a session,
 * which is the one thing Phase 10 exists to prevent. `requireVerifiedAccount()`
 * would refuse it on the POST regardless — this only decides which screen is
 * drawn first, and drawing the accept button for somebody the server will
 * certainly turn away is a worse guess than drawing the sign-in link.
 */
async function localReader(): Promise<Reader> {
  if (await pendingOnboarding()) return { state: 'verified' };
  const session = await getSession();
  return session?.kind === 'agency' ? { state: 'verified' } : { state: 'anonymous' };
}

/**
 * The page ground.
 *
 * The root layout gives the document, the token layer and `data-relay-root`,
 * and deliberately nothing else — no navigation, no session read, no chrome
 * (`src/app/layout.tsx`). That is exactly right here, and this surface adds
 * none of its own: every link in the agency header goes somewhere this reader
 * cannot open yet, and offering them is an invitation to collect a 401 on the
 * way to accepting an invitation.
 *
 * One column at `max-w-prose`, so the 360px floor holds by construction rather
 * than by a breakpoint — nothing is laid out side by side except buttons that
 * wrap.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-prose flex-col gap-6 px-4 py-10">
      {children}
    </main>
  );
}
