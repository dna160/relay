'use client';

/**
 * Adds a client contact and sends them the link. The contact is scoped to this
 * engagement and to no other (INV-6, ADR-005) — there is no account being
 * created here and nothing for the client to remember.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client';
import { useAction } from '@/lib/hooks/use-action';
import { buttonPrimary, cn, input, mono, muted } from '@/components/style-tokens';
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
      <p className={cn('text-12', muted)}>
        They get a link to this workspace only. Their verified email is what an approval is recorded
        against.
      </p>
      <div>
        <button type="submit" className={buttonPrimary} disabled={disabled || !ready || invite.pending}>
          {invite.pending ? 'Sending…' : 'Send the link'}
        </button>
      </div>
      {invite.done && <p className={cn(mono, 'text-12', muted)}>{invite.done}</p>}
      {invite.failure && <ErrorPanel failure={invite.failure} />}
    </form>
  );
}
