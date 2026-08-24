/**
 * The gap between "verified email" and "has an agency".
 *
 * `getSession()` only returns an agency session once `users.org_id` is set, and
 * the Auth.js adapter necessarily creates the user row before that (ADR-013).
 * A freshly magic-linked person therefore has a valid Auth.js session and no
 * agency session at all, and every agency route answers 401 to them. Reaching
 * that state with no screen to move out of it is a dead end at the first minute
 * of the product's life.
 *
 * The two reads below tell the three states apart, which a 401 on its own
 * cannot:
 *
 * - no Auth.js session — not signed in. Send them to sign in.
 * - an Auth.js session, no agency session — signed in, not onboarded. This page.
 * - an agency session — already done. A second submit would be refused by the
 *   route anyway (`org_id IS NULL` in its predicate), so redirect rather than
 *   render a form that cannot work.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, pendingOnboarding } from '@/lib/auth';
import { buttonClass, cn, display, muted } from '@/components/style-tokens';
import { OnboardingForm } from '@/components/agency/onboarding-form';

export const metadata: Metadata = { title: 'Set up your agency · Relay' };

export default async function OnboardingPage() {
  const [session, pending] = await Promise.all([getSession(), pendingOnboarding()]);

  if (session?.kind === 'agency') redirect('/portfolio');

  /**
   * `pendingOnboarding()` rather than a raw `auth()` check (ADR-017). It answers
   * the one question this page turns on — signed in, and in no org yet — and it
   * returns no org, no role, and nothing an agency route would accept. Null
   * here therefore means genuinely signed out, which is the branch below.
   */
  if (!pending) {
    return (
      <div className="flex max-w-prose flex-col gap-3">
        <h1 className={cn(display, 'text-28 text-ink')}>Sign in to continue</h1>
        <p className={cn('text-14', muted)}>
          Relay sends a link to your email rather than asking for a password. Open the most recent
          one — it signs you in and brings you straight back here.
        </p>
        {/*
          Round 2 left this as a sentence with no control, because
          `authConfig.pages.signIn` named `/signin` and that route did not
          exist: a button would have been a link to a 404, which is worse than
          an honest paragraph. The challenge was upheld and the route now
          exists, so this is the link it was always meant to be — and nothing
          else on the page changed, exactly as predicted.
        */}
        <div>
          <Link href="/signin" className={buttonClass('agency')}>
            Send me a link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-prose flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className={cn(display, 'text-28 text-ink')}>Name your agency</h1>
        <p className={cn('max-w-prose text-14', muted)}>
          One more step. Everything in Relay hangs off an agency — engagements, plans, the people on
          your team — so there is nothing to show you until this exists.
        </p>
      </div>
      <OnboardingForm />
    </div>
  );
}
