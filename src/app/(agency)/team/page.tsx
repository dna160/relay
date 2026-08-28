/**
 * `/team` — who is in the organisation, and how a second person gets here.
 *
 * ## Why this screen exists at all
 *
 * The product owner tried to assign work to a colleague and found there was no
 * way to have one. `POST /api/engagements/:id/invite` invites a *client
 * contact*; nothing invited a teammate, so an agency organisation could only
 * ever hold the person who created it. That is also why `AssigneePicker`
 * collapses to a single "Assign to me" button — a correct rendering of a
 * one-member org, on an org with no way to grow.
 *
 * ## Why it is here and not on an engagement's settings page
 *
 * **Because the two invites have different blast radii, and the cheapest
 * protection against confusing them is that they are never on the same
 * screen.**
 *
 * Inviting a reviewer adds one person to one workspace. Their session names
 * exactly that engagement and cannot be widened (INV-6); they see the published
 * lanes and nothing else, ever. It is a per-engagement act and it lives on the
 * engagement — `/w/[id]/settings`, under "Client access", where it has been
 * since Phase 1.
 *
 * Inviting a teammate creates an account holder in the *organisation*. They get
 * every workspace it owns, private lanes included, backstage notes included,
 * unpublished versions included — and they keep it after this engagement is
 * wrapped, because the person outlasts the project (DELIVERY-PLAN §IV). There
 * is no engagement in scope when you do it, so the screen sits above every
 * engagement, in the top-level navigation beside Portfolio and Templates.
 *
 * Four things keep the two apart, and no single one of them is trusted alone:
 *
 *   1. **Different places.** One is inside a workspace; one is outside every
 *      workspace. Reaching either requires having navigated somewhere that
 *      already answered "who is this for".
 *   2. **Different words.** "Invite a client contact … they get a link to this
 *      workspace only" against "Invite a teammate … they get every workspace
 *      this organisation owns". Neither sentence is true of the other act.
 *   3. **Different hue.** The tone rule in `style-tokens.ts` says the hue names
 *      the side holding the work once the control is pressed. A reviewer invite
 *      hands the next move to the client, so it is `client` — indigo. A
 *      teammate invite moves nothing across the line, so it is `agency` —
 *      pine. The two buttons are literally different colours and the colour
 *      means the right thing rather than being a code to learn.
 *   4. **Each screen names the other.** One sentence, in both directions, with
 *      a link. A person who is on the wrong screen finds out there, rather than
 *      after sending.
 *
 * ## Phase 11
 *
 * DELIVERY-PLAN §III routes this as `o/[orgSlug]/team`, under an org switcher
 * that does not exist yet — Phase 11, "Multi-org navigation and teams". A
 * session names exactly one org today, so the slug segment would be a constant,
 * and a route parameter that can only take one value is a route parameter that
 * has never been tested. It moves when the switcher lands and the surface
 * underneath does not change.
 *
 * Teams-within-an-org (`teams`, `team_members`) are Phase 11 too and are
 * deliberately absent here. This screen is the organisation's roster.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import { getSession } from '@/lib/auth';
import { cn, display, eyebrow, muted } from '@/components/style-tokens';
import { ErrorPanel } from '@/components/agency/error-panel';
import { TeamInviteForm } from '@/components/agency/team-invite-form';
import { TeamRoster } from '@/components/agency/team-roster';
import { PendingInvites } from '@/components/agency/pending-invites';
import { serverContext } from '../_lib/server-context';

export const metadata: Metadata = { title: 'Team · Relay' };

export default async function TeamPage() {
  const session = await getSession();
  /**
   * `/signin` and not a 401 panel. Every other agency page is reached through a
   * layout that has already established a session; this one reads the org id
   * itself, so it is the one place in the tree that can be the first thing a
   * signed-out person hits.
   */
  if (session?.kind !== 'agency') redirect('/signin?callbackUrl=%2Fteam');

  const ctx = await serverContext();
  const team = await agencyApi.team(session.orgId, ctx);

  /**
   * A 404 on *your own organisation* is not a missing organisation.
   *
   * `session.orgId` came from the session this request is authenticated with,
   * so the caller provably belongs to it and NOT_VISIBLE cannot mean what it
   * means everywhere else in the product. On this build it means one thing:
   * `GET /api/orgs/:id/team` has not landed yet (Phase 10, in flight). The
   * generic panel would say "not found" on a screen whose subject is the
   * reader's colleagues, and that sentence reads as *they are gone*.
   *
   * A body that did not parse is the same conclusion by a different route —
   * Next answers an unrouted path with an HTML 404, which `request()` reports
   * as MALFORMED. Both are "no such route", and neither is worth two different
   * screens.
   */
  const routeMissing =
    !team.ok && team.status === 404 && (team.code === 'NOT_VISIBLE' || team.code === 'MALFORMED');

  /**
   * The roster read and the invite are independent, and keeping them so is the
   * point of this arrangement.
   *
   * `POST /api/orgs/:id/invites` has landed; the read that lists who is already
   * here has not. If the form were nested inside the successful branch of the
   * read, the one thing the product owner actually went looking for would be
   * unreachable because a *different*, purely informational endpoint is
   * missing. So the read decorates this page and does not gate it.
   *
   * `canInvite` is optimistic when the read is unavailable — the route resolves
   * the real answer and 403s anybody it should, and drawing the form is a
   * better guess than hiding the feature from an admin. When the read lands it
   * carries `viewerCanInvite`, which is a capability the resolver decided
   * rather than a role this page ranked for itself: INV-11 forbids the second
   * thing, because a component that knows one role outranks another is a second
   * place that can be wrong about it, and the two would not fail together.
   */
  const canInvite = team.ok ? team.data.viewerCanInvite : true;
  const orgName = team.ok ? team.data.organization.name : null;

  return (
    <div className="flex max-w-prose flex-col gap-10">
      <div className="flex flex-col gap-1">
        <h1 className={cn(display, 'text-28 text-ink')}>Team</h1>
        <p className={cn('text-14', muted)}>
          Everyone here works on every workspace this organisation owns — boards, files, internal
          notes and all.{' '}
          <strong className="font-semibold text-ink">
            This is not how a client gets access.
          </strong>{' '}
          A client contact is invited on their own engagement, under Client access on its settings
          page, and sees that one workspace and nothing else.
        </p>
      </div>

      <section aria-labelledby="team-people">
        <h2 id="team-people" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          {orgName ?? 'Who is here'}
        </h2>
        <div className="mt-3">
          {team.ok ? (
            <TeamRoster members={team.data.members} />
          ) : routeMissing ? (
            /*
             * Stated as a fact about this deployment rather than as a failure
             * of the request — the same distinction `STORAGE_NOT_CONFIGURED`
             * draws against `STORAGE_UNREACHABLE`, and for the same reason: one
             * of them is worth pressing again and one will answer identically
             * forever. It is scoped to this section so it says what is missing
             * — the list — rather than implying the page is broken.
             */
            <p role="status" className={cn('text-14', muted)}>
              Relay cannot list this organisation&rsquo;s people on this build yet. Nothing is
              wrong with your organisation and nobody has lost access — the roster read has not
              shipped here. Inviting a teammate below works normally.
            </p>
          ) : (
            <ErrorPanel failure={team} />
          )}
        </div>
      </section>

      <section aria-labelledby="team-invite">
        <h2 id="team-invite" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Invite a teammate
        </h2>
        <div className="mt-3">
          {canInvite ? (
            <TeamInviteForm orgId={session.orgId} orgName={orgName} />
          ) : (
            <p className={cn('text-14', muted)}>
              {/*
                "the people marked ADMIN" was wrong on the first org it met: a
                one-person agency's founder is the OWNER, so the sentence
                pointed at a badge that was not on the page. Naming both is not
                hedging — the roster above prints exactly these two words, so
                the reader has something to look for.
              */}
              Inviting teammates is for admins and the owner. Ask somebody marked ADMIN or OWNER
              above and it is one press for them.
            </p>
          )}
        </div>
      </section>

      {/*
        Mounted whenever the read succeeded, empty list included, and the
        component decides whether there is a section at all.

        The condition used to be here — `invites.length > 0` — which read
        naturally and quietly broke the one interaction that matters:
        withdrawing the **last** outstanding invitation empties the list, the
        condition goes false, and the component unmounts with the confirmation
        of the very action that emptied it. The row disappeared and nothing said
        why. A result is shown where the action was taken, which requires that
        place to still be there afterwards.
      */}
      {team.ok && (
        <PendingInvites
          orgId={session.orgId}
          invites={team.data.invites}
          readOnly={!team.data.viewerCanInvite}
        />
      )}
    </div>
  );
}
