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
 *
 * ## The path token, checked exactly once
 *
 * The client surface takes its engagement from the **cookie** and never from
 * the path (INV-6) — which is what makes a client session unwidenable, and is
 * also why the path segment ended up never being looked at at all. Both
 * `/e/{someone-elses-token}/board` and `/e/garbage/board` used to render *this*
 * contact's own workspace, with a 200. No other engagement's data was ever
 * served, so that was not an INV-6 breach, but two things were still wrong with
 * it: a contact forwarded the wrong link saw a workspace and had nothing on the
 * page to tell them it was not the one they were sent, and a pre-validated-
 * *looking* value sat in the path for the next person to read the engagement
 * out of the URL instead of the session.
 *
 * `checkClientPathToken` closes both, and this layout is the one place it is
 * called — it wraps all six routes under `/e/[token]`, so a per-page check
 * would be five more places to forget.
 *
 * **A mismatch is not a 404, and that is the load-bearing part.** The obvious
 * rule — the path token must equal the session's engagement or else 404 — is
 * wrong in a way that only shows up in front of a customer. The same person is
 * routinely a contact on two engagements: two `client_contacts` rows, and
 * verifying the second link deliberately *replaces* the cookie rather than
 * merging it. Under that rule, a contact signed in to engagement A who clicks
 * their perfectly valid link for engagement B is told the workspace they were
 * invited to does not exist. So a mismatch means "this cookie is not for this
 * workspace", and the honest response is the verify path for the engagement the
 * **link** names — not the session's own workspace under someone else's URL.
 *
 * Only a token that does not parse is a 404, and it is a 404 with no session
 * too: the landing page is where a stranger arrives, and "this is not a link"
 * is the true answer. 404 and never 403, as everywhere else — which engagement
 * tokens are real is not a fact an anonymous caller is entitled to.
 */

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { checkClientPathToken } from '@/lib/auth';
import { cn, display, muted } from '@/components/style-tokens';
import { AccessForm } from '@/components/client/access-form';
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

  const verdict = await checkClientPathToken(token);
  if (verdict.state === 'malformed') notFound();

  if (verdict.state === 'other_engagement') {
    /*
      Signed in, but to a different workspace. The session's board is emphatically
      not what belongs under this URL, so `children` is not rendered at all — the
      page beneath would read the engagement out of the cookie and put engagement
      A's work on engagement B's address, which is the confusion this whole check
      exists to end.

      What is rendered instead is the sign-in path for the engagement **this
      link** names, and a sentence saying so. Nothing here reveals whether that
      engagement exists or who else is on it: the same form, and the same
      response, as any other unverified visit.
    */
    return (
      <div className="flex max-w-dialog flex-col gap-4">
        <div>
          <h1 className={cn(display, 'text-28 text-ink')}>Open this workspace</h1>
          <p className={cn('mt-1 text-14', muted)}>
            You are signed in to a different workspace. This link is for another one — confirm your
            email to open it. Signing in here replaces the workspace you have open now; the other
            link still works.
          </p>
        </div>
        <AccessForm engagementToken={token} />
      </div>
    );
  }

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
