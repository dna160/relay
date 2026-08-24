'use client';

/**
 * The agency's way in: one field.
 *
 * Relay has no password surface anywhere — not here, not in settings, not for
 * the client (ARCHITECTURE, stack table; ADR-005). There is therefore no
 * "forgot password", no "create an account", and no second field to tab into.
 * The screen is an email and a sentence saying what happens next.
 *
 * The action arrives as a prop rather than by import so that nothing under
 * `src/components/` reaches into a route segment — and so that this component
 * has no way to know or care whether the link is requested through Auth.js's
 * catch-all or through a bespoke route later.
 *
 * Progressive enhancement is not decorative here. This is the screen a person
 * lands on when something has already gone wrong for them — a session expired
 * mid-week, a link from a laptop opened on a phone — so it submits as a plain
 * form when JavaScript has not arrived. `useActionState` adds the pending state
 * and the error slot on top of markup that already works without it, which is
 * why there is no `disabled={!ready}` gate: the server validates, and the
 * answer comes back into the field.
 */

import { useActionState } from 'react';
import { Button, Field } from '@/components/primitives';
import { cn, muted } from '@/components/style-tokens';

export interface SignInFormState {
  error: string | null;
}

const INITIAL: SignInFormState = { error: null };

export function SignInForm({
  action,
  callbackUrl,
}: {
  action: (state: SignInFormState, formData: FormData) => Promise<SignInFormState>;
  /**
   * Where Auth.js was trying to send this person before it found them signed
   * out. Travels as a hidden field rather than a closure so the form still
   * carries it when it submits without JavaScript. The action validates it —
   * this component does not, and must not be the only thing that does.
   */
  callbackUrl?: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  return (
    <form action={submit} className="flex flex-col gap-3">
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      <Field
        label="Your email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder="you@agency.com"
        /* The hint and the error share one slot in `Field`, so the button
           below does not move when validation fires. No `autoFocus`: it would
           skip the heading that says what this screen is, and this is a screen
           people reach when something has already surprised them. */
        hint="We send a link. Open it and you are in — there is no password to remember."
        error={state.error ?? undefined}
      />
      <div>
        {/*
          `agency`, per the tone rule in style-tokens: signing in moves no work
          between the two sides, so the ball stays with the side whose surface
          this is. The client's own access form is the same sentence in indigo.
        */}
        <Button
          type="submit"
          tone="agency"
          size="lg"
          loading={pending}
          loadingLabel="Sending"
        >
          Email me a link
        </Button>
      </div>
      <p className={cn('max-w-prose text-12', muted)}>
        Relay never asks for a password. If you do not have an agency yet, the link still works —
        it takes you to the one screen that sets one up.
      </p>
    </form>
  );
}
