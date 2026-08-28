/**
 * `/signin/confirm` — where the link in the sign-in email lands.
 *
 * ## The whole job of this page is to not consume the code
 *
 * `POST /api/auth/signin/confirm` is what spends a code, and this page does not
 * call it. It renders a button, and only a press calls it. That is the
 * mail-scanner defence: Outlook Safe Links, Proofpoint and every other
 * enterprise prescanner fetch each URL in an inbound message before a human
 * sees it, sometimes repeatedly. A page that consumed on render would burn
 * every code and every invitation before it arrived — and it would present as
 * the recipient's fault, because the message they finally open says the link
 * has already been used.
 *
 * The back-end owns the other half and has measured it: three scanner GETs left
 * the token at `attempts=0, still_valid=t`, and only the explicit POST consumed
 * it. Its route file exports no `GET` at all, so a GET there is a 405 from the
 * framework rather than a branch inside a handler. **This page must not undo
 * that from the other side**, which means: no effect that submits, no
 * auto-redirect into the POST, and no "the code is right there in the query
 * string, we may as well". `ConfirmSignIn` says the same thing where somebody
 * would be tempted to write the effect.
 *
 * ## What arrives in the URL, and what does not
 *
 * `email` and `code`, because the link is built as
 * `${AUTH_URL}/signin/confirm?email=…&code=…` by the route that sends it. The
 * address is in a query string here and that is a considered trade rather than
 * an oversight: this URL exists for one press and is not linked from anywhere,
 * the alternative is asking somebody to re-type an address they did not choose
 * to see, and the code beside it expires in minutes and is single-use. The
 * *client* verify page makes the opposite call — it takes the code from the URL
 * and asks for the address — because a client link is forwarded routinely and a
 * forwarded link must not sign in the person it was forwarded to. An account
 * sign-in code is not forwarded; it is requested.
 *
 * A malformed pair is not an error screen with a stack trace. It is the
 * sign-in page with an explanation, because the only useful next act is to ask
 * for a new code and that is where the field is.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { safeCallback } from '@/lib/links';
import { cn, display, muted } from '@/components/style-tokens';
import { ConfirmSignIn } from '@/components/agency/confirm-signin';

export const metadata: Metadata = { title: 'Confirm it is you · Relay' };

/** The shape the sending route builds. Anything else is not our link. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIX_DIGITS = /^\d{6}$/;

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; code?: string; callbackUrl?: string }>;
}) {
  const query = await searchParams;
  const email = (query.email ?? '').trim();
  const code = (query.code ?? '').trim();
  const callbackUrl = safeCallback(query.callbackUrl);

  /**
   * Already signed in, so there is nothing to confirm.
   *
   * A person who presses the button, lands somewhere, and then hits Back
   * arrives here with a spent code. Rendering the button again would let them
   * press it and be told their code is invalid — a failure message for having
   * succeeded. Sending them on is the honest answer, and it is a redirect
   * rather than a message because the destination is where they were going.
   */
  const session = await getSession();
  if (session?.kind === 'agency') redirect(callbackUrl);

  if (!LOOKS_LIKE_EMAIL.test(email) || !SIX_DIGITS.test(code)) {
    return (
      <div className="flex max-w-dialog flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className={cn(display, 'text-28 text-ink')}>That link is incomplete</h1>
          <p className={cn('max-w-prose text-14', muted)}>
            Email clients sometimes break long links across two lines, and half a link opens
            nothing. Nothing has gone wrong with your code — ask for a new one, or type the six
            digits from the same email straight into the sign-in page.
          </p>
        </div>
        <p className={cn('text-14', muted)}>
          <Link href="/signin" className="text-ink underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-dialog flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={cn(display, 'text-28 text-ink')}>Confirm it is you</h1>
        <p className={cn('max-w-prose text-14', muted)}>
          One press and you are in. Relay never asks for a password.
        </p>
      </div>
      <ConfirmSignIn email={email} code={code} callbackUrl={callbackUrl} />
    </div>
  );
}
