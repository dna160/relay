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
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientApi } from '@/lib/api-client.client';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, input, mono, muted } from '@/components/style-tokens';
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
        <label htmlFor="access-email" className="text-14 text-ink">
          Your email
        </label>
        <input
          id="access-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          className={input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <p className={cn('text-12', muted)}>
          We send a code to confirm it is you. Your email is what an approval is recorded against.
        </p>
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
      <label htmlFor="access-email-confirm" className="text-14 text-ink">
        Your email
      </label>
      <input
        id="access-email-confirm"
        type="email"
        autoComplete="email"
        className={input}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
      />

      <label htmlFor="access-code" className="text-14 text-ink">
        Code
      </label>
      <input
        id="access-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        className={cn(input, mono)}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="000000"
      />
      <p className={cn('text-12', muted)}>
        The code is in the email we just sent. It is good for one sign-in to this workspace.
      </p>

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
