'use client';

/**
 * The client's way in: an email, then a code. No password, no profile, no
 * signup (ADR-005). It should feel like WeTransfer and still produce an audit
 * trail, because the verified email is what a decision is attributed to.
 *
 * The engagement token comes from the URL because at this point there is no
 * session. Once verified, the session names exactly one engagement and cannot
 * be widened (INV-6) — which is why nothing past this component ever sends an
 * engagement id.
 *
 * Both fields are the `Field` primitive and not the raw `input` class string
 * they used to be. That string computes to a 38px-tall control at 14px, which
 * on the one surface in this product that is *reached on a phone from an email*
 * broke two hard floors at once: below the 44px target minimum, and below the
 * 16px threshold under which iOS Safari zooms the viewport the moment the field
 * takes focus — so the first thing a new contact would see is the page jumping.
 * `Field` is `h-11` and `text-16`, and it wires label, hint and error together
 * so a validation message cannot be invisible to a screen reader. There is one
 * button vocabulary in Relay; this is the same argument for inputs.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientApi } from '@/lib/api-client.client';
import { useAction } from '@/lib/hooks/use-action';
import { Button, Field } from '@/components/primitives';
import { ErrorPanel } from './error-panel';

export function AccessForm({
  engagementToken,
  initialCode = '',
  startAtCode = false,
}: {
  engagementToken: string;
  /** Present when the reader followed the link from their email. */
  initialCode?: string;
  startAtCode?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>(startAtCode ? 'code' : 'email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(initialCode);
  const requestLink = useAction(clientApi.requestMagicLink);
  const verify = useAction(clientApi.verifyMagicLink);

  const emailReady = /.+@.+\..+/.test(email.trim());
  const codeReady = code.trim().length >= 4;

  if (step === 'email') {
    return (
      <form
        className="flex max-w-dialog flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!emailReady) return;
          const r = await requestLink.run('Link sent', {
            engagementToken,
            email: email.trim(),
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
          placeholder="you@company.com"
          hint="We send a code to confirm it is you. Your email is what an approval is recorded against."
        />
        <div>
          {/* `client`: signing in moves no work between the two sides, so the
              ball stays where it is — on this side of the workspace. */}
          <Button
            type="submit"
            tone="client"
            size="lg"
            loading={requestLink.pending}
            loadingLabel="Sending"
            disabled={!emailReady}
          >
            Send me a code
          </Button>
        </div>
        {requestLink.failure && <ErrorPanel failure={requestLink.failure} />}
      </form>
    );
  }

  return (
    <form
      className="flex max-w-dialog flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!codeReady || !emailReady) return;
        const r = await verify.run('Verified', {
          engagementToken,
          email: email.trim(),
          code: code.trim(),
        });
        if (r.ok) router.replace(`/e/${engagementToken}/board`);
      }}
    >
      <Field
        label="Your email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
      />

      {/*
        The code loses the mono face it had as a hand-rolled input. `Field` owns
        its control's typography — `font-sans text-16` — and widening it to take
        a face is the primitives owner's call, not this file's. The loss is
        small and the trade is not close: a six-digit one-time code is consumed
        and deleted, never cited, so it is not the kind of "record" mono marks,
        while the 16px floor it gains is the difference between typing a code
        and watching iOS Safari zoom the page out from under the field.
        `inputMode` and `autoComplete` carry the real affordances either way.
      */}
      <Field
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="000000"
        hint="The code is in the email we just sent. It is good for one sign-in to this workspace."
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          tone="client"
          size="lg"
          loading={verify.pending}
          loadingLabel="Checking"
          disabled={!codeReady || !emailReady}
        >
          Open the workspace
        </Button>
        <Button tone="quiet" size="lg" onClick={() => setStep('email')}>
          Use a different email
        </Button>
      </div>
      {verify.failure && <ErrorPanel failure={verify.failure} />}
    </form>
  );
}
