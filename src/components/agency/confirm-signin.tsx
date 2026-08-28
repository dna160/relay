'use client';

/**
 * The emailed link's landing: one button, and it POSTs only when pressed.
 *
 * ## This component exists to *not* do something
 *
 * `POST /api/auth/signin/confirm` consumes the code. This page is what a
 * corporate link prescanner reaches — Outlook Safe Links, Proofpoint and their
 * kind fetch every URL in an inbound message before a human ever sees it, often
 * several times. If this page consumed on load, every sign-in code and every
 * invitation would be spent before it arrived, and it would look like the
 * recipient's fault: *"the link says it has already been used"*, from somebody
 * who has not touched it.
 *
 * So there is no `useEffect` here, no auto-submit, no "the code is already in
 * the query string so we may as well". **The only thing that consumes is a
 * person pressing the button.** The back-end already measured its half — three
 * scanner GETs left the token at `attempts=0, still_valid=t` — and this is the
 * half that could quietly undo it.
 *
 * That is also why the route exports no `GET`: Next mounts exactly the methods
 * a route file exports, so a GET on the API path is a 405 from the framework
 * rather than a branch somebody could later relax. This file is the same
 * property one layer up, and it is a property of what is *absent*, which is the
 * kind of thing a future edit removes without noticing. Hence the length of
 * this comment.
 *
 * ## Why the button rather than a redirect to the code field
 *
 * A person who followed the link has already demonstrated control of the inbox;
 * making them re-type six digits they did not ask to see is a worse journey for
 * no security gained. One press is the smallest deliberate act that a scanner
 * cannot perform.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, mono, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';

export function ConfirmSignIn({
  email,
  code,
  callbackUrl,
}: {
  email: string;
  code: string;
  /** Validated by the page. Never taken raw from the query string here. */
  callbackUrl: string;
}) {
  const router = useRouter();
  const confirm = useAction(agencyApi.confirmSigninCode);
  /**
   * Latched so a second press cannot fire a second POST while the first is in
   * flight and the router is still moving. The code is single-use: the second
   * request would fail, and the failure panel would appear over a page that is
   * already navigating away — a person watching would see the sign-in they just
   * completed report that their code is invalid.
   */
  const [spent, setSpent] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <p className={cn('max-w-prose text-14', muted)}>
        Signing in as <span className={cn(mono, 'text-ink')}>{email}</span>. Nothing has happened
        yet — opening this page does not sign anybody in, which is why the button is here.
      </p>
      <div>
        <Button
          tone="agency"
          size="lg"
          loading={confirm.pending}
          loadingLabel="Signing in"
          disabled={spent}
          onClick={async () => {
            setSpent(true);
            const r = await confirm.run('Signed in', { email, code });
            if (r.ok) {
              router.push(callbackUrl);
              // The session is new and the Router Cache holds a tree rendered
              // for a signed-out reader. Same call, same reason, as the client
              // access form makes at the one other authentication boundary.
              router.refresh();
              return;
            }
            // Freed only on failure, so the button is pressable again for a
            // typo'd address; a success leaves it latched while we navigate.
            setSpent(false);
          }}
        >
          Sign me in
        </Button>
      </div>
      {confirm.failure && <ErrorPanel failure={confirm.failure} />}
      <p className={cn('max-w-prose text-12', muted)}>
        The code in this link is good once and expires shortly. If it has run out, ask for a new
        one from the sign-in page — the six digits in the same email work there too.
      </p>
    </div>
  );
}
