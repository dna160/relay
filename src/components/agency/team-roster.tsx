/**
 * Who is in the organisation.
 *
 * A server component with no state and no controls. Removing a teammate is a
 * consequential act that Phase 10's scope does not include — `invites` and
 * `signin_tokens` land there, revocation of a *membership* does not — and a
 * roster that grew a Remove button before the route existed would be a control
 * that silently fails. What this does is answer the question the product owner
 * actually asked, which was "how do I have a colleague", and the first half of
 * that answer is being able to see the ones you have.
 *
 * ## Typography, and the rule it applies
 *
 * A person's **name is prose** and their **address is prose**. Mono marks
 * records — a version number, a hash, a countdown, "anything that would be
 * cited in a dispute" (DESIGN-SYSTEM, Type). A colleague's name is not a
 * record; setting it in Martian Mono would make the roster read like a log
 * file, which is exactly the failure the rule exists to prevent in the other
 * direction.
 *
 * The one mono value here is the **join date**, which is a timestamp and is
 * therefore already covered by the rule everywhere else in the product. The
 * role is a `Badge` — a stamp on the document, in the display face, like
 * PRIVATE on a lane — because it is a classification and not a measurement.
 *
 * ## The one date, and why it is never a negative claim
 *
 * `users.last_seen_at` was written by nothing when this roster first shipped —
 * `verify-contact.ts` stamped the *reviewer's* column and the agency side had
 * no equivalent — so "never signed in" would have been printed beside every
 * member including the person reading the page. The roster showed the join date
 * instead and said nothing it could not back. Establishing a session now stamps
 * the column, so the value is real.
 *
 * It is still not used to make a **negative** statement, and that is the part
 * worth keeping. One path still bypasses the stamp: Auth.js's own magic-link
 * callback creates its session through the adapter rather than through
 * `establishAccountSession()`. It is the fallback route now that the code flow
 * is primary and there is no magic-link form left in the product — but it is
 * not nothing, and "never signed in" printed against somebody who signs in
 * weekly is worse than saying less.
 *
 * So the slot shows the *stronger true thing*: the last sign-in when there is
 * one, the join date when there is not. A null reads as "no sign-in recorded
 * here", which is what the column actually means, and never as a claim about
 * what the person did. One slot either way, so the row does not grow a fourth
 * item at the 360px floor.
 *
 * The question this roster no longer has to answer is "did the invitation
 * land?" — an unaccepted invitation is sitting in the list below, by name.
 *
 * ## No entrance animation, deliberately
 *
 * This list is server-rendered and re-rendered by `router.refresh()` after an
 * invite. A `seat` stagger would therefore appear in the first bytes, which
 * `tests/unit/first-paint.spec.ts` fails and MOTION.md §5 forbids. It would
 * also break R1: the event is *an invite was sent*, the motion belongs at the
 * control where that happened, and this list is not where the fact changed —
 * a person appears here days later, when they redeem.
 */

import { formatDate } from '@/lib/format';
import type { OrgMember } from '@/lib/api-client.agency';
import { Badge } from '@/components/primitives';
import { cn, mono, muted, surface } from '@/components/style-tokens';
import { orgRoleLabel } from './vocabulary';
import { EmptyState } from './empty-state';

export function TeamRoster({ members }: { members: readonly OrgMember[] }) {
  if (members.length === 0) {
    /*
     * Not reachable in practice — a session exists, so at least one member
     * does — and rendered anyway, because the alternative is a bare `<ul>` with
     * nothing in it if the read ever comes back empty. An empty list and a
     * broken read look identical, and this says which.
     */
    return <EmptyState instruction="Nobody is listed in this organisation yet." />;
  }

  return (
    <ul className={cn(surface, 'divide-y divide-rule')}>
      {members.map((m) => (
        <li key={m.accountId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
          {/*
            `basis-full sm:basis-auto`: at the 360px floor a person's name and
            address take a line of their own and the badge and date wrap beneath
            them. Without it the name breaks mid-way — "Ada / Okonjo" — with the
            address trailing after the fold, which is the one thing on this row
            a reader is scanning for.
          */}
          <span className="min-w-0 flex-1 basis-full text-14 text-ink sm:basis-auto">
            {m.name ?? m.email}
            {m.name && (
              <span className={cn('ml-2 text-12', muted)}>{m.email}</span>
            )}
          </span>
          {/*
            `neutral`, not the possession hues. Pine and indigo mean "the ball
            is with the agency / with the client" everywhere else in this
            product, and a role is not a possession — colouring an ADMIN badge
            pine would spend the one colour idea the interface has on a value
            that has nothing to do with whose move it is.
          */}
          <Badge tone="neutral" label={`Role: ${orgRoleLabel(m.role)}`}>
            {orgRoleLabel(m.role).toUpperCase()}
          </Badge>
          <span className={cn(mono, 'text-12', muted)}>
            {m.lastSeenAt === null
              ? `since ${formatDate(m.joinedAt)}`
              : `last in ${formatDate(m.lastSeenAt)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
