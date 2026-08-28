/**
 * `/signin` — the agency's front door.
 *
 * Named by `authConfig.pages.signIn`, and now the entry point of the account
 * token flow (ADR-027) rather than of Auth.js's own email provider. The visible
 * change is that the primary control is a six-digit code and not a link: that
 * is PHASE-10's wording — "the six-digit field is primary and focused on load
 * … the emailed link is secondary and lands on a page with a single confirm
 * button" — and both halves are one decision. A person already looking at this
 * tab wants to type six digits; a person who opened the mail on their phone
 * wants the link. `/signin/confirm` is that link's landing, and it consumes
 * nothing until pressed.
 *
 * **There is no password surface in this product and this page does not add
 * one** — no password field, no "create an account", no "forgot password",
 * because there is nothing to forget. Signing in is also signing up: the
 * account is created when the address is *proved*, which is why nothing here
 * says whether an address is known to us. `POST /api/auth/signin/request`
 * answers identically for a known address, an unknown one, and one over its
 * rate limit, and copy that were more specific than the route would hand an
 * anonymous caller an account-enumeration oracle the route was careful not to.
 *
 * The three states this screen has to tell apart are the same three
 * `/onboarding` sorts out, and for the same reason (ADR-013): the adapter
 * writes the user row before `users.org_id` exists, so "signed in" and "has an
 * agency" are different facts. Someone who already has both should never be
 * shown a sign-in form — a form whose only outcome is where they already are is
 * an insult and a dead end.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession, pendingOnboarding } from '@/lib/auth';
import { cn, display, muted } from '@/components/style-tokens';
import { AccountSignInForm } from '@/components/agency/account-signin-form';
import { safeCallback } from './safe-callback';

export const metadata: Metadata = { title: 'Sign in · Relay' };

/**
 * `authConfig.pages.error` points here (ADR-017), so this page is still where a
 * bounced Auth.js callback lands. The raw code is never rendered:
 * `Configuration` means a server-side mistake and its details are ours, not the
 * reader's; anything unrecognised gets the generic sentence rather than
 * nothing, because a bounce that produces an apparently blank form is
 * indistinguishable from a form that silently did nothing.
 */
const GENERIC_ERROR = 'That sign-in attempt did not complete. Ask for a new code below.';

const CALLBACK_ERRORS: Record<string, string> = {
  Verification: 'That link has already been used, or it expired. Ask for a new code below.',
  AccessDenied: 'That address cannot sign in to Relay.',
  EmailSignInError: 'We could not send that email. Try again in a moment.',
  MissingCSRF: 'That request could not be verified. Try again from this page.',
  Configuration: 'Sign-in is misconfigured on our side. Nothing you did.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; email?: string }>;
}) {
  const [session, pending, query] = await Promise.all([
    getSession(),
    pendingOnboarding(),
    searchParams,
  ]);

  const callbackUrl = safeCallback(query.callbackUrl);

  if (session?.kind === 'agency') redirect(callbackUrl);
  /**
   * Signed in with Auth.js and not yet in any org (ADR-013). `getSession()`
   * returns null for this person — correct, since a null org must only ever
   * deny — and only-null is indistinguishable from signed-out, which is what
   * would send them back here to sign in again and arrive in the same place.
   * `pendingOnboarding()` is the one question that tells the two apart.
   *
   * It honours `callbackUrl` rather than always sending them to `/onboarding`,
   * and that is the invitation case: a colleague who has just proved their
   * address has no organisation *by construction* — the invitation is what
   * gives them one — so pushing them at the screen that creates a second agency
   * would be exactly the wrong door.
   */
  if (pending) redirect(callbackUrl);

  const callbackError = query.error ? (CALLBACK_ERRORS[query.error] ?? GENERIC_ERROR) : undefined;

  return (
    <div className="flex max-w-dialog flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={cn(display, 'text-28 text-ink')}>Sign in to Relay</h1>
        <p className={cn('max-w-prose text-14', muted)}>
          One contract, one workspace, one link. Put in the email your agency uses and we send you
          a code that opens it.
        </p>
      </div>

      {callbackError && (
        <p role="alert" className="max-w-prose text-14 font-semibold text-ink">
          {callbackError}
        </p>
      )}

      <AccountSignInForm callbackUrl={callbackUrl} initialEmail={query.email ?? ''} />

      <p className={cn('max-w-prose text-12', muted)}>
        Relay never asks for a password. If you do not have an agency yet, the code still works —
        it takes you to the one screen that sets one up. If a colleague invited you, sign in with
        the address they sent it to and their invitation will be waiting.
      </p>
    </div>
  );
}
