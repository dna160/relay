/**
 * The magic-link landing.
 *
 * A reader who already has a session for this engagement is sent straight to
 * the board — the whole point of the link is that it opens something. A reader
 * who does not gets one field.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cn, display, muted } from '@/components/style-tokens';
import { AccessForm } from '@/components/client/access-form';
import { getClientBoard } from '../../_lib/reads';

export const metadata: Metadata = { title: 'Your workspace · Relay' };

export default async function ClientLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const board = await getClientBoard();
  if (board.ok) redirect(`/e/${token}/board`);

  return (
    <div className="flex max-w-dialog flex-col gap-4">
      <div>
        <h1 className={cn(display, 'text-28 text-ink')}>Open your workspace</h1>
        <p className={cn('mt-1 text-14', muted)}>
          Everything for this project — files, versions, and approvals — is in here. No account, no
          password.
        </p>
      </div>
      <AccessForm engagementToken={token} />
    </div>
  );
}
