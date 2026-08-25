/**
 * The workspace chrome the client sees: whose work this is, what is happening
 * to it, and the export.
 *
 * When the read fails — which is what an unverified reader gets — the children
 * are rendered bare. That is the landing and verify path, and wrapping it in a
 * countdown for a workspace they have not proved they can see would be both
 * confusing and a small leak.
 *
 * The one failure that is *not* rendered bare is 410 `ENGAGEMENT_PURGED`. There
 * is no workspace left to sign into, so the sign-in form would be a dead end
 * with a form on it. The receipt replaces the page instead — it is the last
 * thing this contact ever sees of the workspace, and it is doing reputational
 * work for the agency: a client who lands on a 404 concludes their files were
 * lost, and a client who lands on a certificate concludes their agency runs a
 * process.
 *
 * `nowMs` is read once here and passed down, so every retention formatter on the
 * page agrees on what "now" is and the one client component in this tree
 * reproduces the server's text exactly.
 */

import type { ReactNode } from 'react';
import { cn, display, muted } from '@/components/style-tokens';
import { formatPurgeDate, purgeBand, purgeDateISO } from '@/lib/format';
import { PurgedReceipt } from '@/components/client/purged-receipt';
import { PurgeTodayDialog } from '@/components/client/purge-today-dialog';
import { retentionCountsFromLanes } from '@/components/client/retention';
import { WrapSlate } from '@/components/client/wrap-slate';
import { ClientTabs } from '@/components/client/tabs';
import { LiveRefresh } from '@/components/client/live-refresh';
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

  if (!board.ok) {
    if (board.code === 'ENGAGEMENT_PURGED') return <PurgedReceipt failure={board} />;
    return <>{children}</>;
  }

  const { engagement, lanes } = board.data;
  const awaiting = lanes.reduce(
    (n, lane) => n + lane.cards.filter((c) => c.awaitingYou).length,
    0,
  );

  const nowMs = Date.now();
  const purgeOn = formatPurgeDate(engagement.daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(engagement.daysToPurge, nowMs);
  const purgesToday = purgeBand(engagement.daysToPurge) === 'today';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className={cn(display, 'text-28 text-ink')}>{engagement.title}</h1>
        <p className={cn('text-14', muted)}>from {engagement.agencyName}</p>
      </div>

      {/* The header still carries no wrap date, so the slate states the
          countdown, which is the part the client is owed. */}
      <WrapSlate
        daysToPurge={engagement.daysToPurge}
        archived={engagement.status !== 'active'}
        nowMs={nowMs}
      />

      {/*
        The only interruption in the entire product, on the one day it is
        warranted, and dismissible. It sits in the layout rather than on the
        board because a contact who lands straight on a card from an email is
        the person most likely to miss the strip — and it costs nothing to
        close, since the slate above and the strip on the board carry every
        fact it states.
      */}
      {purgesToday && purgeOn && purgeOnISO && (
        <PurgeTodayDialog
          counts={retentionCountsFromLanes(lanes)}
          purgeOn={purgeOn}
          purgeOnISO={purgeOnISO}
        />
      )}

      {/* Mounted here rather than on the board so a contact sitting on the
          queue or on a card gets the same updates. An archived workspace has
          nothing left to stream, so the stream is not opened for one. */}
      <LiveRefresh enabled={engagement.status === 'active'} />

      <ClientTabs token={token} awaitingCount={awaiting} />

      <div>{children}</div>
    </div>
  );
}
