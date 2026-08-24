'use server';

/**
 * Requesting an agency sign-in link.
 *
 * **This invents no endpoint.** `src/app/api/auth/` contains exactly three
 * things: the Auth.js v5 catch-all, and the two static `auth/client/*` routes
 * that belong to the client magic link and have nothing to do with an agency
 * member. So the way in is the catch-all, and the supported way to reach it
 * from a server component is `signIn()` — already exported from `@/lib/auth`,
 * already bound to `authConfig`, already the thing `pages.signIn` was pointing
 * at a missing page *for*. If a bespoke `POST /api/auth/agency/request` lands
 * later, this file changes and the page does not.
 *
 * `redirect: false` is the whole reason this is an action and not a bare
 * `<form action={signIn}>`. Auth.js's redirecting mode sends failures to its
 * own error page, which is a screen nobody in this product designed; asking for
 * the URL instead lets the failure come back into the field's own error slot,
 * where it does not move the control (`Field`, primitives). The email is still
 * sent by the same code path either way — `signIn` runs the real Auth handler
 * and only the disposal of its Location header differs.
 *
 * There is no password here and there is no password anywhere in Relay
 * (ARCHITECTURE, stack table). Nothing in this file accepts one.
 */

import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { signIn } from '@/lib/auth';

/**
 * Exported as a *type* deliberately. A `'use server'` module may export async
 * functions and nothing else — an exported object literal here (this file had
 * a `SIGN_IN_INITIAL` constant) fails the build with
 * `invalid-use-server-value`, and it fails at page-data collection rather than
 * at typecheck or lint, so `npm run verify` is green while the build is not.
 * A type is erased before that check ever runs. The form owns its own initial
 * state, which is where a rendering concern belongs anyway.
 */
export interface SignInState {
  /** Shown in the field's error slot. Null on a first render. */
  error: string | null;
}

/**
 * Where the emailed link lands when the request carries no destination of its
 * own. `/onboarding` and not `/portfolio`, because the Auth.js adapter creates
 * the user row before `users.org_id` exists (ADR-013) and a first-ever sign-in
 * therefore has no agency session yet. `/onboarding` already tells the three
 * states apart and forwards to `/portfolio` when there is nothing left to do,
 * so this one destination is correct for the first sign-in and the thousandth.
 */
const DEFAULT_CALLBACK = '/onboarding';

/**
 * Auth.js appends `?callbackUrl=` when it bounces someone here mid-navigation,
 * and honouring it is the difference between landing back on the board you were
 * reading and landing on a portfolio you then have to navigate out of again.
 *
 * It is also an open-redirect parameter, and it arrives through the browser, so
 * it is validated rather than trusted: a single leading slash and nothing else.
 * `//evil.example` is protocol-relative and would leave the origin, `/\evil` is
 * treated as protocol-relative by some browsers, and anything with a scheme is
 * not ours. A value that fails any of these is not an error worth a message —
 * it is discarded and the default is used.
 */
function safeCallback(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return DEFAULT_CALLBACK;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_CALLBACK;
  return raw;
}

/** Deliberately loose. The authority on whether an address exists is the inbox. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Auth.js's error codes, in this product's words.
 *
 * Nothing here says whether the address is known to us. An agency sign-in form
 * that answers "no such account" is an account-enumeration oracle, and the
 * honest sentence — we sent it if it exists — is also the safe one.
 */
function copyFor(code: string): string {
  switch (code) {
    case 'EmailSignInError':
      return 'We could not send that email just now. Try again in a moment.';
    case 'Configuration':
      return 'Sign-in is misconfigured on our side. Nothing you did. Tell us and we will fix it.';
    case 'AccessDenied':
      return 'That address cannot sign in to Relay.';
    case 'Verification':
      return 'That link has already been used or has expired. Ask for a new one.';
    case 'MissingCSRF':
      return 'That request could not be verified. Try again from this page.';
    default:
      return 'Something went wrong sending the link. Try again.';
  }
}

export async function requestSignInLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!LOOKS_LIKE_EMAIL.test(email)) {
    return { error: 'That does not look like an email address.' };
  }

  const redirectTo = safeCallback(
    typeof formData.get('callbackUrl') === 'string' ? String(formData.get('callbackUrl')) : null,
  );

  let outcome: unknown;
  try {
    outcome = await signIn('resend', { email, redirect: false, redirectTo });
  } catch (cause) {
    if (cause instanceof AuthError) return { error: copyFor(cause.type) };
    throw cause;
  }

  /**
   * In `raw` mode Auth.js reports failure as a Location carrying `?error=`
   * rather than by throwing, so the string has to be read rather than trusted.
   * A base is supplied because the value may be a path, and `relay.invalid` is
   * a reserved TLD that cannot resolve — it is a parser argument, never a
   * request.
   */
  if (typeof outcome === 'string') {
    let code: string | null = null;
    try {
      code = new URL(outcome, 'http://relay.invalid').searchParams.get('error');
    } catch {
      code = null;
    }
    if (code) return { error: copyFor(code) };
  }

  // Mirrors `authConfig.pages.verifyRequest`. Nothing is appended: the address
  // the reader just typed is theirs, and a URL is the one place in a browser
  // it would be copied, logged, and shared by accident.
  redirect('/signin/check-email');
}
