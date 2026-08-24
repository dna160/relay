/**
 * The workspace chrome the client sees: whose work this is, what is happening
 * to it, and the export.
 *
 * When the read fails — which is what an unverified reader gets — the children
 * are rendered bare. That is the landing and verify path, and wrapping it in a
 * countdown for a workspace they have not proved they can see would be both
 * confusing and a small leak.
 */

import type { ReactNode } from 'react';
import { cn, display, muted } from '@/components/style-tokens';
import { WrapSlate } from '@/components/client/wrap-slate';
import { ClientTabs } from '@/components/client/tabs';
import { getClientBoard } from '../../_lib/reads';

export default async function ClientWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const board = await getClientBoard();

  if (!board.ok) return <>{children}</>;

  const { engagement, lanes } = board.data;
  const awaiting = lanes.reduce(
    (n, lane) => n + lane.cards.filter((c) => c.awaitingYou).length,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className={cn(display, 'text-28 text-ink')}>{engagement.title}</h1>
        <p className={cn('text-14', muted)}>from {engagement.agencyName}</p>
      </div>

      {/* The client header carries no status and no wrap date — see the
          handover. Until it does, the slate states the countdown, which is the
          part the client is owed. */}
      <WrapSlate daysToPurge={engagement.daysToPurge} />

      <ClientTabs token={token} awaitingCount={awaiting} />

      <div>{children}</div>
    </div>
  );
}
