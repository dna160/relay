'use client';

/**
 * Adds a client contact and sends them the link. The contact is scoped to this
 * engagement and to no other (INV-6, ADR-005) — there is no account being
 * created here and nothing for the client to remember.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, input, mono, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';

export function InviteForm({ engagementId, disabled }: { engagementId: string; disabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const invite = useAction(agencyApi.invite);
  const ready = /.+@.+\..+/.test(email.trim());

  return (
    <form
      className="flex max-w-dialog flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        const r = await invite.run('Invited', engagementId, { email: email.trim() });
        if (r.ok) {
          setEmail('');
          router.refresh();
        }
      }}
    >
      <label htmlFor="invite-email" className="text-14 text-ink">
        Invite a client contact
      </label>
      <input
        id="invite-email"
        type="email"
        className={input}
        value={email}
        disabled={disabled}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@client.com"
      />
      {/*
        The reason is on the control, not only in the notice at the top of the
        page. A disabled field with no explanation reads as a bug, and the
        423 this predicts would otherwise arrive after someone typed an address.
      */}
      <p className={cn('text-12', muted)}>
        {disabled
          ? 'This engagement is archived and read-only, so no new contacts can be invited. The contacts who already have the link can still read everything and export it.'
          : 'They get a link to this workspace only. Their verified email is what an approval is recorded against.'}
      </p>
      <div>
        {/* `client`: the link is the handover. Once it is sent, the next move
            in this flow belongs to the person receiving it. */}
        <Button
          type="submit"
          tone="client"
          loading={invite.pending}
          loadingLabel="Sending"
          disabled={disabled || !ready}
        >
          Send the link
        </Button>
      </div>
      {invite.done && <p className={cn(mono, 'text-12', muted)}>{invite.done}</p>}
      {invite.failure && <ErrorPanel failure={invite.failure} />}
    </form>
  );
}
