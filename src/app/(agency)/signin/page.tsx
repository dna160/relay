/**
 * `/signin` — the agency's front door.
 *
 * This route is named by `authConfig.pages.signIn` and, until now, did not
 * exist. A signed-out agency member therefore had no way into the product at
 * all: every agency route answers 401, Auth.js sends them here, and here was a
 * 404. That was raised as a challenge from the onboarding screen in round 2 and
 * upheld; this page is the answer, and `onboarding/page.tsx`'s sentence is now
 * a link rather than an apology.
 *
 * Email link only (ADR-005 for the client, the same principle for the agency:
 * ARCHITECTURE's stack table has an email provider and no credentials
 * provider). **There is no password surface in this product and this page does
 * not add one** — no password field, no "create an account", no "forgot
 * password", because there is nothing to forget.
 *
 * The three states this screen has to tell apart are the same three
 * `/onboarding` sorts out, and for the same reason (ADR-013): the Auth.js
 * adapter writes the user row before `users.org_id` exists, so "signed in" and
 * "has an agency" are different facts. Someone who already has both should
 * never be shown a sign-in form — a form whose only outcome is where they
 * already are is an insult and a dead end.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession, pendingOnboarding } from '@/lib/auth';
import { cn, display, muted } from '@/components/style-tokens';
import { SignInForm } from '@/components/agency/signin-form';
import { requestSignInLink } from './actions';

export const metadata: Metadata = { title: 'Sign in · Relay' };

/**
 * `authConfig.pages.error` now points here (ADR-017), so this page is where an
 * expired or already-used link lands — the most common failure of a magic-link
 * flow, and the moment a person most needs a "send me another" button rather
 * than the unstyled Auth.js page they used to get.
 *
 * The raw code is never rendered. `Configuration` means a server-side mistake
 * and its details are ours, not the reader's; anything unrecognised gets the
 * generic sentence rather than nothing at all, because a bounce that produces
 * an apparently blank form is indistinguishable from a form that silently did
 * nothing.
 */
const GENERIC_ERROR = 'That sign-in attempt did not complete. Ask for a new link below.';

const CALLBACK_ERRORS: Record<string, string> = {
  Verification: 'That link has already been used, or it expired. Ask for a new one below.',
  AccessDenied: 'That address cannot sign in to Relay.',
  EmailSignInError: 'We could not send that email. Try again in a moment.',
  MissingCSRF: 'That request could not be verified. Try again from this page.',
  Configuration: 'Sign-in is misconfigured on our side. Nothing you did.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const [session, pending, query] = await Promise.all([
    getSession(),
    pendingOnboarding(),
    searchParams,
  ]);

  if (session?.kind === 'agency') redirect('/portfolio');
  /**
   * Signed in with Auth.js and not yet in any org (ADR-013). `getSession()`
   * returns null for this person — correct, since a null org must only ever
   * deny — and only-null is indistinguishable from signed-out, which is what
   * would send them back here to sign in again and arrive in the same place.
   * `pendingOnboarding()` is the one question that tells the two apart
   * (ADR-017), and `/onboarding` is the only screen that can move them on.
   */
  if (pending) redirect('/onboarding');

  const callbackError = query.error ? (CALLBACK_ERRORS[query.error] ?? GENERIC_ERROR) : undefined;

  return (
    <div className="flex max-w-dialog flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={cn(display, 'text-28 text-ink')}>Sign in to Relay</h1>
        <p className={cn('max-w-prose text-14', muted)}>
          One contract, one workspace, one link. Put in the email your agency uses and we send you
          a link that opens it.
        </p>
      </div>

      {callbackError && (
        <p role="alert" className="max-w-prose text-14 font-semibold text-ink">
          {callbackError}
        </p>
      )}

      <SignInForm action={requestSignInLink} callbackUrl={query.callbackUrl} />
    </div>
  );
}
