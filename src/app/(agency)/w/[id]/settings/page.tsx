/**
 * Engagement settings — scaffolded with real structure; Phase 7 fills in
 * white-label, plan gates, and template capture.
 *
 * What is live here is what Phase 1 and 2 already own: the client contacts and
 * the invite, the lane visibility register, and the retention statement. The
 * lane register exists because lane visibility is the single most consequential
 * setting in the product — it is the one that decides what a client can see —
 * and it deserves a page that lists it plainly rather than a badge on a board
 * column somebody has to go looking for.
 */

import { agencyApi } from '@/lib/api-client';
import { formatDate, formatPurgeCountdown, plural } from '@/lib/format';
import { chip, cn, eyebrow, mono, muted, surface } from '@/components/style-tokens';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { InviteForm } from '@/components/agency/invite-form';
import { serverContext } from '../../../_lib/server-context';

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await serverContext();
  const [engagement, board] = await Promise.all([
    agencyApi.engagement(id, ctx),
    agencyApi.board(id, ctx),
  ]);

  if (!engagement.ok) return <ErrorPanel failure={engagement} />;
  const e = engagement.data.engagement;
  const clientLink = `/e/${engagement.data.clientLinkToken}`;
  const archived = e.status !== 'active';
  const purge = formatPurgeCountdown(e.daysToPurge);

  return (
    <div className="flex max-w-prose flex-col gap-10">
      <section aria-labelledby="settings-access">
        <h2 id="settings-access" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Client access
        </h2>
        <div className="mt-3 flex flex-col gap-4">
          <div className={cn(surface, 'px-3 py-2')}>
            <p className={cn('text-12', muted)}>The client&rsquo;s link</p>
            <p className={cn(mono, 'mt-1 break-all text-14 text-ink')}>{clientLink}</p>
            <p className={cn('mt-2 text-12', muted)}>
              One link, this engagement only. Anyone who opens it still has to verify their email
              before they can see anything.
            </p>
          </div>
          <InviteForm engagementId={e.id} disabled={archived} />
        </div>
      </section>

      <section aria-labelledby="settings-lanes">
        <h2 id="settings-lanes" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          What the client can see
        </h2>
        <p className={cn('mt-2 text-14', muted)}>
          Lanes are published by default. A private lane and every card in it are invisible to the
          client — not hidden in their interface, never sent to it.
        </p>
        <div className="mt-3">
          {!board.ok ? (
            <ErrorPanel failure={board} />
          ) : board.data.lanes.length === 0 ? (
            <EmptyState instruction="No lanes yet. Add the first one on the board." />
          ) : (
            <ul className={cn(surface, 'divide-y divide-rule')}>
              {board.data.lanes.map((lane) => (
                <li key={lane.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-14 text-ink">{lane.name}</span>
                  <span className={cn(mono, 'text-12', muted)}>
                    {plural(lane.cards.length, 'card', 'cards')}
                  </span>
                  <span className={chip}>
                    {lane.visibility === 'private' ? 'PRIVATE' : 'PUBLISHED'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="settings-retention">
        <h2 id="settings-retention" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Retention
        </h2>
        <dl className={cn(surface, 'mt-3 divide-y divide-rule')}>
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className={cn('text-14', muted)}>Status</dt>
            <dd className={cn(mono, 'text-14 text-ink')}>{e.status}</dd>
          </div>
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className={cn('text-14', muted)}>Last activity</dt>
            <dd className={cn(mono, 'text-14 text-ink')}>{formatDate(e.lastActivityAt)}</dd>
          </div>
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className={cn('text-14', muted)}>Purge</dt>
            <dd className={cn(mono, 'text-14 text-ink')}>{purge ?? 'not scheduled'}</dd>
          </div>
        </dl>
        <p className={cn('mt-2 max-w-prose text-14', muted)}>
          {purge
            ? 'Files and content are destroyed on that date and a deletion certificate is sent to both parties. Exporting or moving to a retaining plan is what prevents it.'
            : 'This plan retains the workspace indefinitely. Nothing here is scheduled for destruction.'}
        </p>
      </section>

      <section aria-labelledby="settings-later">
        <h2 id="settings-later" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Not yet
        </h2>
        <ul className={cn('mt-3 flex flex-col gap-1 text-14', muted)}>
          <li>White-label logo and brand colour — Phase 7.</li>
          <li>Save this engagement as a template — Phase 7.</li>
          <li>
            Default contracted rounds for new cards — currently{' '}
            <span className={mono}>{e.contractedRoundsDefault}</span>, editable in Phase 7.
          </li>
          <li>
            The list of who has been invited and who has verified — needs a contacts read endpoint.
          </li>
        </ul>
      </section>
    </div>
  );
}
