'use client';

/**
 * Invitations that have been sent and not yet accepted, and the undo for them.
 *
 * ## Why the token is not here
 *
 * A list that printed the invitation link would let anybody who can read this
 * page redeem one, which is the thing the verification step exists to prevent
 * (INV-12). `PendingInvite` carries an invite **id** and no token, and it
 * cannot carry one — only the token's sha256 is stored, so there is nothing to
 * serve back even by accident. The link is offered once, at the control that
 * minted it, to the person who by definition already holds it (see
 * `team-invite-form.tsx`).
 *
 * ## Why withdrawing is the control that had to exist
 *
 * The expensive mistake on the team screen is sending an *organisation*
 * invitation to a client's address. Nothing in an interface can make that
 * impossible, so the next best thing is that it stays fixable: an invitation is
 * live until it expires, and "wait a week" is a poor answer when the wrong
 * address would open every private lane the agency has. Withdrawing is one
 * press and it is on the row.
 *
 * It cannot touch a *consumed* invitation — that is the domain's rule, and it
 * is the right one. An accepted invitation is a membership now, and removing a
 * colleague is a different act that deserves its own confirmation rather than
 * being reachable by pressing Withdraw on a stale list.
 *
 * ## Typography
 *
 * The address **is** mono here, where the same address in the roster is not,
 * and the difference is the rule rather than an inconsistency. In the roster it
 * is contact information beside a person's name. On this row it is the value
 * the invitation is *bound to* — redemption succeeds only for an account that
 * has independently proved this exact string — and it is what an argument about
 * who was let in would cite. The expiry is mono for the ordinary reason: it is
 * a countdown.
 *
 * ## The section heading lives here, not on the page, and that is a bug fix
 *
 * It was on the page, inside `invites.length > 0`, which is the obvious place
 * for it and was wrong. Withdrawing the **last** outstanding invitation makes
 * the list empty, the page's condition false, and this whole component
 * unmount — taking the "Withdrew the invitation to …" confirmation with it. The
 * row vanished and nothing said why, which is the one moment a person most
 * needs telling: they have just cancelled somebody's access and the only
 * evidence is an absence.
 *
 * So the condition moved inside. This renders nothing on a first visit, which
 * is what an empty "Invited, not here yet" heading deserves; and it keeps
 * rendering — heading, confirmation, no list — through the withdrawal that
 * emptied it. DESIGN-SYSTEM's rule is that a result is shown where the action
 * was taken, and that requires the place the action was taken to still exist.
 *
 * Nothing animates. A row leaving this list is an event, and the mark it leaves
 * is the row's absence plus the confirmation under the control that was pressed
 * (MOTION.md R1). The list is server-rendered and re-rendered by
 * `router.refresh()`, so an entrance here would land in the first bytes and
 * fail `tests/unit/first-paint.spec.ts` besides.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import type { PendingInvite } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { Badge, Button } from '@/components/primitives';
import { cn, eyebrow, mono, muted, surface } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';
import { orgRoleLabel } from './vocabulary';

export function PendingInvites({
  orgId,
  invites,
  readOnly,
}: {
  orgId: string;
  invites: readonly PendingInvite[];
  /** A member can see who has been asked; only an admin can withdraw. */
  readOnly: boolean;
}) {
  const router = useRouter();
  const revoke = useAction(agencyApi.revokeTeammateInvite);
  /**
   * Which row is in flight. `useAction` holds one call's state, which is the
   * right shape for a form and the wrong shape for a list — this is the small
   * amount of bookkeeping that difference costs, and it is what stops a press
   * on one row spinning the button on every other one.
   */
  const [pendingId, setPendingId] = useState<string | null>(null);

  /*
   * Nothing outstanding and nothing withdrawn in this session: there is no
   * section. A heading over an empty list describes a queue nobody has a queue
   * in, and the roster above already answers "who is here".
   */
  if (invites.length === 0 && !revoke.done && !revoke.failure) return null;

  return (
    <section aria-labelledby="team-pending" className="flex flex-col gap-3">
      <h2 id="team-pending" className={cn(eyebrow, 'border-b border-ink pb-1')}>
        Invited, not here yet
      </h2>
      <ul className={cn(surface, 'divide-y divide-rule')}>
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
            {/* `basis-full sm:basis-auto` for the same reason as the roster:
                at 360px the address gets its own line rather than being
                truncated to make room for a badge and a button. */}
            <span
              className={cn(mono, 'min-w-0 flex-1 basis-full truncate text-12 text-ink sm:basis-auto')}
              title={i.email}
            >
              {i.email}
            </span>
            <Badge tone="neutral" label={`Invited as ${orgRoleLabel(i.role)}`}>
              {orgRoleLabel(i.role).toUpperCase()}
            </Badge>
            <span className={cn(mono, 'text-12', muted)}>expires {formatDate(i.expiresAt)}</span>
            {!readOnly && (
              /*
                `quiet`, never a red tone. `--breach` means exhaustively one
                thing — a commitment missed, rounds over contract — and it is
                the only red the palette has. Withdrawing an invitation is a
                correction, not a breach, and spending that colour here would
                cost it its meaning everywhere else.

                Inside a plain button rather than a `Dialog`, because the
                consequence is small and reversible in the direction that
                matters: the invitation stops working, and sending another is
                one press. The destructive-action-needs-a-dialog rule is for
                acts that destroy something.
              */
              <Button
                tone="quiet"
                size="sm"
                loading={revoke.pending && pendingId === i.id}
                loadingLabel="Withdrawing"
                disabled={revoke.pending}
                onClick={async () => {
                  setPendingId(i.id);
                  const r = await revoke.run(`Withdrew the invitation to ${i.email}`, orgId, i.id);
                  setPendingId(null);
                  if (r.ok) router.refresh();
                }}
              >
                Withdraw
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* Explains the list, so it goes when the list does. */}
      {invites.length > 0 && (
        <p className={cn('max-w-prose text-12', muted)}>
          An invitation can only be accepted by the address it was sent to, and only after that
          person has proved the address is theirs. Forwarding it does not pass it on. Sending a
          new one to the same address replaces the old one rather than adding a second.
        </p>
      )}

      {revoke.done && <p className={cn(mono, 'text-12', muted)}>{revoke.done}</p>}
      {revoke.failure && <ErrorPanel failure={revoke.failure} />}
    </section>
  );
}
