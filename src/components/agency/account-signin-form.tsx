'use client';

/**
 * The agency's way in: an address, then six digits.
 *
 * ## Code-first, and the link is the secondary affordance
 *
 * PHASE-10 puts it plainly: "the six-digit field is primary and focused on
 * load, `autocomplete="one-time-code"`, paste-friendly; the emailed link is
 * secondary and lands on a page with a single confirm button". Both halves are
 * one decision. A person who is already looking at this tab wants to type six
 * digits and be done; a person who opened the mail on their phone wants the
 * link. Neither should be made to do the other's journey.
 *
 * The link lands on `/signin/confirm`, which renders a button and consumes
 * nothing on load. That is the mail-scanner defence and it is described at
 * length there.
 *
 * ## There is no password here and there is none anywhere in Relay
 *
 * No password field, no "create an account", no "forgot password" — there is
 * nothing to forget. Signing in *is* signing up: the account is created when
 * the address is proved, which is why this screen never says whether an address
 * is known to us. `POST /api/auth/signin/request` answers identically for a
 * known address, an unknown one, and one over its rate limit, and the copy here
 * must not undo that by being more specific than the route.
 *
 * ## Two steps in one component, and why the address stays on screen
 *
 * The code step keeps the address field visible rather than hiding it behind
 * "we sent a code to y•••@…". A person who mistyped their address discovers it
 * here, in the field, and fixes it — instead of waiting for a mail that was
 * never going to arrive. `Use a different address` is the same escape the
 * client's own access form offers, and for the same reason.
 *
 * Nothing animates: `Field` and `Button` are the primitives, the error lands in
 * the field's own message slot so the button does not move under the cursor,
 * and a sign-in screen is not an event worth marking.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button, Field } from '@/components/primitives';
import { cn, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';

/** Deliberately loose. The authority on whether an address exists is the inbox. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountSignInForm({
  callbackUrl,
  initialEmail = '',
}: {
  /**
   * Where to go once the address is proved. Already validated by the page —
   * this component does not validate it and must not be the only thing that
   * does, because it is an open-redirect parameter that arrives through the
   * browser.
   */
  callbackUrl: string;
  initialEmail?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const requestCode = useAction(agencyApi.requestSigninCode);
  const confirm = useAction(agencyApi.confirmSigninCode);

  const emailReady = LOOKS_LIKE_EMAIL.test(email.trim());
  const codeReady = /^\d{6}$/.test(code.trim());

  if (step === 'email') {
    return (
      <form
        className="flex max-w-dialog flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!emailReady) return;
          /*
           * `callbackUrl` goes with the request, not only into the next step's
           * closure. The route puts it into the emailed link, which is what
           * makes the *other* device work: somebody who started an invitation
           * on a laptop and opens the mail on their phone lands back on the
           * invitation rather than on `/onboarding` — the screen that offers to
           * create a second agency, shown to a person whose whole reason for
           * having no organisation is that they are one press from joining one.
           *
           * Unvalidated here by design. `safeCallback()` runs on the route,
           * once, before the value reaches an email; a second check in the
           * browser on a browser-supplied value would be a second
           * implementation of an open-redirect guard proving nothing.
           */
          const r = await requestCode.run('Code sent', {
            email: email.trim(),
            callbackUrl,
          });
          if (r.ok) setStep('code');
        }}
      >
        <Field
          label="Your email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@agency.com"
          hint="We send a six-digit code. There is no password to remember — signing in is also how an account gets made."
        />
        <div>
          {/* `agency`: signing in moves no work between the two sides, so the
              ball stays with the side whose surface this is. The client's own
              access form is the same sentence in indigo. */}
          <Button
            type="submit"
            tone="agency"
            size="lg"
            loading={requestCode.pending}
            loadingLabel="Sending"
            disabled={!emailReady}
          >
            Email me a code
          </Button>
        </div>
        {requestCode.failure && <ErrorPanel failure={requestCode.failure} />}
      </form>
    );
  }

  return (
    <form
      className="flex max-w-dialog flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!codeReady || !emailReady) return;
        const r = await confirm.run('Signed in', { email: email.trim(), code: code.trim() });
        if (r.ok) {
          /*
           * `needsOnboarding` decides nothing here, deliberately. An invited
           * colleague has no organisation and is *supposed* to land back on
           * their invitation rather than on the screen that would have them
           * create a second agency — so an explicit destination always wins,
           * and `/onboarding` is only the fallback. `/onboarding` itself sorts
           * out the person who has an org already and forwards them on.
           */
          router.push(callbackUrl);
          /*
           * The session was just established and the Router Cache does not know
           * it. Every layout in the destination tree was rendered — or would be
           * served — for a signed-out reader, and a client navigation reuses
           * that. Same call, same reason, as the client access form makes at
           * the one other point where a navigation crosses an authentication
           * boundary.
           */
          router.refresh();
        }
      }}
    >
      <Field
        label="Your email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@agency.com"
      />

      {/*
        `autoFocus` here and not on the address field. The address step is where
        a person arrives and needs to read the heading first; this step is one
        they were sent to with a single thing left to do, and the code is
        already in their clipboard. `inputMode="numeric"` brings up the digits
        keypad and `one-time-code` lets iOS and Android offer the code from the
        message itself.
      */}
      <Field
        label="Your code"
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="000000"
        hint="Six digits, from the email we just sent. It is good once and expires shortly."
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          tone="agency"
          size="lg"
          loading={confirm.pending}
          loadingLabel="Checking"
          disabled={!codeReady || !emailReady}
        >
          Sign in
        </Button>
        <Button
          tone="quiet"
          size="lg"
          onClick={() => {
            setCode('');
            confirm.reset();
            setStep('email');
          }}
        >
          Use a different address
        </Button>
      </div>
      {confirm.failure && <ErrorPanel failure={confirm.failure} />}
      <p className={cn('max-w-prose text-12', muted)}>
        Nothing arrived? Go back and ask for another — the old code stops working when a new one is
        sent.
      </p>
    </form>
  );
}
