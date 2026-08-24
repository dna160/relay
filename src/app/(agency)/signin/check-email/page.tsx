/**
 * `/signin/check-email` — named by `authConfig.pages.verifyRequest`.
 *
 * Auth.js redirects here itself after an email provider accepts a sign-in
 * request, so this route has to exist whether or not our own action forwards to
 * it. It did not, which is the other half of the same 404.
 *
 * **Nothing about the reader is on this page and nothing is in its URL.** Not
 * the address they typed, not a token, not a status. An address in a query
 * string is the one thing in a browser that gets copied into a chat window,
 * written into an access log, and left in a shared history — and the reader
 * gains nothing from seeing it echoed back that they do not already know from
 * having typed it ten seconds ago. So this is a static page, which is also why
 * it says "the address you gave us" rather than naming one.
 *
 * An instructing empty state, in the DESIGN-SYSTEM sense: it says what to do
 * next, not that nothing happened.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, pendingOnboarding } from '@/lib/auth';
import { buttonClass, cn, display, muted } from '@/components/style-tokens';

export const metadata: Metadata = { title: 'Check your email · Relay' };

export default async function CheckEmailPage() {
  const [session, pending] = await Promise.all([getSession(), pendingOnboarding()]);
  // Arriving here with a session means the link already worked — most likely in
  // this tab, on a second visit. Do not tell someone to check their email for a
  // door they are already through.
  if (session?.kind === 'agency') redirect('/portfolio');
  if (pending) redirect('/onboarding');

  return (
    <div className="flex max-w-dialog flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={cn(display, 'text-28 text-ink')}>Check your email</h1>
        <p className={cn('max-w-prose text-14', muted)}>
          We sent a link to the address you gave us. Open it and you are signed in — there is no
          code to copy and no password to set.
        </p>
      </div>

      <div className="border border-dashed border-rule px-3 py-6">
        <ul className={cn('flex max-w-prose flex-col gap-2 text-14', muted)}>
          <li>It can take a minute to arrive. Look in spam if it does not.</li>
          <li>The link signs you in once, then stops working. Ask for another any time.</li>
          <li>Open it on this device if you can — it is quicker than a second link.</li>
        </ul>
      </div>

      <div>
        {/*
          A link, not a button element, so it is a real navigation — but wearing
          the one button vocabulary via `buttonClass`, which exists for exactly
          this case. `quiet`: going back to change the address moves nothing and
          is entirely reversible.
        */}
        <Link href="/signin" className={buttonClass('quiet', 'lg')}>
          Use a different address
        </Link>
      </div>
    </div>
  );
}
