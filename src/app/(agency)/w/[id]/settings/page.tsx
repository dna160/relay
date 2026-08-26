/**
 * Engagement settings — scaffolded with real structure; Phase 7 fills in
 * white-label and plan gates. Template capture landed here.
 *
 * Capture sits directly under the lane register on purpose. The register is
 * already a plain statement of the board's structure and its visibility, which
 * is exactly what a template takes — so the control reads as "keep this",
 * immediately below the thing it would keep, rather than as a separate authoring
 * task somewhere else in the product.
 *
 * What is live here is what Phase 1 and 2 already own: the client contacts and
 * the invite, the lane visibility register, and the retention statement. The
 * lane register exists because lane visibility is the single most consequential
 * setting in the product — it is the one that decides what a client can see —
 * and it deserves a page that lists it plainly rather than a badge on a board
 * column somebody has to go looking for.
 */

import { agencyApi } from '@/lib/api-client.agency';
import { formatDate, formatPurgeCountdown, formatPurgeDate, purgeDateISO, plural } from '@/lib/format';
import { chip, cn, eyebrow, mono, muted, surface } from '@/components/style-tokens';
import { appUrl } from '@/lib/links';
import { ArchiveRegister } from '@/components/agency/archive-register';
import { ClientLink } from '@/components/agency/client-link';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { ExportControl } from '@/components/agency/export-control';
import { InviteForm } from '@/components/agency/invite-form';
import { SaveAsTemplate } from '@/components/agency/save-as-template';
import { shapeFromBoard } from '@/components/agency/template-shape';
import { serverContext } from '../../../_lib/server-context';

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await serverContext();
  // The shelf read is here for the capture preview: shelf groups are part of
  // what a template stamps (PHASE-7), so a preview that omitted them would
  // describe a smaller docket than the one being saved.
  const [engagement, board, shelf] = await Promise.all([
    agencyApi.engagement(id, ctx),
    agencyApi.board(id, ctx),
    agencyApi.shelf(id, ctx),
  ]);

  if (!engagement.ok) return <ErrorPanel failure={engagement} />;
  const e = engagement.data.engagement;
  /*
   * Absolute, and built from the same `appUrl()` that `clientWorkspaceUrl()`
   * uses for the invite email. A relative `/e/{token}` is dead the moment it
   * leaves the page, and this string exists only to leave the page. If the two
   * were composed separately, an agency could paste a link that differs from
   * the one their client was emailed and neither would know which is real.
   */
  const clientLink = `${appUrl()}/e/${engagement.data.clientLinkToken}`;
  const archived = e.status !== 'active';
  const nowMs = Date.now();
  const purge = formatPurgeCountdown(e.daysToPurge);
  const purgeOn = formatPurgeDate(e.daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(e.daysToPurge, nowMs);

  return (
    <div className="flex max-w-prose flex-col gap-10">
      <section aria-labelledby="settings-access">
        <h2 id="settings-access" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Client access
        </h2>
        {/*
          The invite comes first, and the order is the argument.

          Copying a link does not finish the job — a link sent to someone who is
          not on the contact list is a dead end, and its failure is silent on the
          agency's side and lands entirely on the client. Inviting is the act
          that completes; copying is what you do afterwards, or instead, when the
          person is already invited and has lost the email. Leading with the copy
          control put the incomplete half of the flow first.
        */}
        <div className="mt-3 flex flex-col gap-4">
          <InviteForm engagementId={e.id} disabled={archived} />
          {/*
            Where "Not yet" used to promise a contacts roster. Deleting a
            roadmap and leaving a provoked question unanswered are two different
            acts: an agency that invites three people and then sees no list
            anywhere will conclude the invites failed. One sentence, no heading,
            no phase number, no date.
          */}
          <p className={cn('text-12', muted)}>
            Relay doesn&rsquo;t list this engagement&rsquo;s contacts here yet. Each invite is
            confirmed above as it sends.
          </p>
          <ClientLink url={clientLink} />
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

      {/*
        The durable half of the undo. The board and the card page each offer an
        immediate "Put it back" where the action happened; this is the one that
        is still here on Thursday, when somebody asks where a deliverable went
        and the person who removed it is not at their desk.

        Directly under the lane register, because the two answer the same
        question one after the other: what is on this board, and what used to be.
      */}
      <section aria-labelledby="settings-archive">
        <h2 id="settings-archive" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Removed from this board
        </h2>
        <p className={cn('mt-2 text-14', muted)}>
          Removing a lane or a deliverable that carries anything archives it rather than deleting
          it — every version, approval, comment and transition stays exactly where it was. Only
          something that carried nothing at all is deleted outright, and that is not listed here
          because there is nothing left of it.
        </p>
        <div className="mt-3">
          <ArchiveRegister engagementId={e.id} readOnly={archived} />
        </div>
      </section>

      {/*
        This section replaces a line that used to sit under a heading reading
        "Not yet", next to the words "editable in Phase 7". Two separate
        problems: the phase number is internal vocabulary that means nothing to
        the person paying for this, and a settings page whose last section is a
        list of things the product cannot do reads as unfinished software.

        The number itself is worth keeping, because it is the input to the one
        thing the board paints red. It is stated here as a fact about how this
        engagement is set up, which is what it is — `contractedRoundsDefault` is
        accepted at `POST /api/engagements` and there is no PATCH for it, so
        "set when the engagement is created" is the honest description rather
        than a deferral. The white-label line and the invited-contacts roster
        went with the section; neither exists, and a customer does not need a
        roadmap on a settings page.
      */}
      <section aria-labelledby="settings-rounds">
        <h2 id="settings-rounds" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Rounds
        </h2>
        <p className={cn('mt-2 text-14', muted)}>
          {e.contractedRoundsDefault === null ? (
            <>
              Deliverables on this engagement are created without a round limit, so nothing here is
              ever flagged as over contract. A deliverable can still be given its own limit when you
              add it.
            </>
          ) : (
            <>
              New deliverables here start with{' '}
              <span className={cn(mono, 'text-ink')}>
                {plural(e.contractedRoundsDefault, 'round', 'rounds')}
              </span>{' '}
              of revisions. Past that, the board marks the deliverable as over contract — that
              marking is the only thing in Relay that turns red, and it means exactly one thing.
              This number is fixed when the engagement is created, and each deliverable can carry
              its own instead.
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="settings-template">
        <h2 id="settings-template" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Reuse this shape
        </h2>
        <p className={cn('mt-2 text-14', muted)}>
          Save this board as a template and the next engagement of this kind starts stamped rather
          than empty. Structure only — the lanes above, their visibility, the deliverables in them,
          the contracted round default and the shelf groups. No files, no versions, no approvals, no
          client contacts.
        </p>
        <div className="mt-3">
          {!board.ok ? (
            <ErrorPanel failure={board} />
          ) : (
            <SaveAsTemplate
              engagementId={e.id}
              engagementTitle={e.title}
              shape={shapeFromBoard(
                board.data.lanes,
                shelf.ok ? shelf.data.map((g) => g.label) : [],
                e.contractedRoundsDefault,
              )}
            />
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
          {purgeOn && (
            <div className="flex justify-between gap-3 px-3 py-2">
              <dt className={cn('text-14', muted)}>Destroyed on</dt>
              <dd className={cn(mono, 'text-14 text-ink')}>
                <time dateTime={purgeOnISO ?? undefined}>{purgeOn}</time>
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className={cn('text-14', muted)}>Plan</dt>
            <dd className={cn(mono, 'text-14 text-ink')}>{e.plan}</dd>
          </div>
        </dl>

        {/*
          The two actions, and the difference between them stated in one
          sentence. Conflating them is the most expensive copy mistake available
          on this page: an export takes a copy, only a retaining plan stops the
          destruction, and an agency that believes it has retained something by
          exporting it will discover otherwise on the day the certificate
          arrives.
        */}
        <p className={cn('mt-2 max-w-prose text-14', muted)}>
          {purgeOn
            ? `Every file, card, version and approval in this engagement is destroyed on ${purgeOn}, and a signed deletion certificate goes to your organisation and to the client contact. Exporting takes a copy; it does not stop the destruction. A retaining plan does — it clears the date entirely rather than pushing it out.`
            : 'This plan retains the workspace indefinitely. There is no purge date on this engagement, and nothing in it is scheduled for destruction. Moving down to a plan that does not retain recomputes the dates and warns immediately — a downgrade never purges silently.'}
        </p>

        <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
          {purgeOn && (
            /*
             * The agency's one action, and it has no endpoint yet: plan changes
             * are Phase 7 and the reactivation paywall is behind an unresolved
             * product decision (PRD §9). So the control states what it will do
             * and what it does not do yet, rather than being a button that
             * silently fails or a promise the product cannot keep. This is the
             * destination the purge-warning strip's "Keep this workspace" links
             * to, which is why it lives under a stable anchor.
             */
            <p className={cn('max-w-prose text-14', muted)}>
              <span className="font-semibold text-ink">To keep this workspace:</span> move this
              organisation to a retaining plan. Billing is not wired up in this build, so the change
              is made by contacting us — the retention dates clear as soon as it lands, and the
              engagement stops counting down the same day.
            </p>
          )}
          <ExportControl engagementId={e.id} tone="quiet" size="md" label="Export everything" />
        </div>
      </section>

    </div>
  );
}
