/**
 * Who invited you, to what, and in what role — the whole of the preview, and
 * the first thing on the page.
 *
 * ## Why it comes before anything is asked
 *
 * Because the token grants nothing and the read writes nothing.
 * `resolveInvite()` "reveals the target and the inviter and grants nothing", and
 * it is a `SELECT` and a `SELECT` — no consumption, no attempt counter, not even
 * a seen-at stamp. So showing this first costs exactly nothing, and hiding it
 * behind a sign-in form costs a great deal: a stranger asked for their address
 * before being told what it is for. Half will not, and the half who do have
 * agreed to nothing in particular.
 *
 * The order also makes the failures legible. A person who can see *who* invited
 * them *to what* can tell an expired link from a link to the wrong company from
 * a link they were never meant to have. Behind a sign-in form all three are one
 * shrug.
 *
 * ## The masked address is the whole design, not a redaction
 *
 * `invitedEmailMasked` is `a•••@studio.com`, and the reason is that this
 * response is unauthenticated: anybody holding a forwarded link can read it.
 * Enough for the intended recipient to recognise their own address, not enough
 * for anyone else to harvest it. The consequence for this surface is that the
 * screen **cannot** pre-empt a mismatch — it does not know the reader's address
 * and does not know the invited one — so the mismatch is stated after the
 * attempt, by `RedeemPanel`, from the refusal the server names. That is the
 * right trade and it is not a compromise: the alternative is publishing an
 * address to whoever holds a link.
 *
 * ## Typography
 *
 * The inviter's **name** is prose and the organisation's name is display —
 * people and places, not records. The **masked address** and the **expiry** are
 * mono, because they are the two values this invitation is bound to: it can be
 * redeemed only by that address, only before that moment. If there were ever an
 * argument about who was let into an agency's backstage, those are the two
 * values it would cite, which is the mono rule as DESIGN-SYSTEM writes it.
 *
 * Nothing here animates. The page is server-rendered and the reader has
 * interacted with nothing — MOTION.md §5, and `tests/unit/first-paint.spec.ts`
 * would fail a build that forgot.
 */

import type { InvitePreview } from '@/lib/api-client.invite';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/primitives';
import { cn, display, mono, muted } from '@/components/style-tokens';
import { roleCopy } from './role-copy';

export function InviteFacts({ invite }: { invite: InvitePreview }) {
  const role = roleCopy(invite.role, invite.targetKind);
  const isOrg = invite.targetKind === 'org';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className={cn(display, 'text-28 text-ink')}>
          {isOrg ? <>Join {invite.targetName} on Relay</> : <>Join the {invite.targetName} board</>}
        </h1>
        <p className={cn('max-w-prose text-14', muted)}>
          <span className="font-semibold text-ink">{invite.invitedBy}</span> invited you
          {!isOrg && <> to {invite.orgName}&rsquo;s workspace</>} as a{' '}
          {role.label.toLowerCase()}.
        </p>
      </div>

      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone="neutral" label={`Role offered: ${role.label}`}>
          {role.label.toUpperCase()}
        </Badge>
        {role.grants && <span className={cn('max-w-prose text-14', muted)}>{role.grants}</span>}
      </div>

      <p className={cn('max-w-prose text-12', muted)}>
        Sent to <span className={cn(mono, 'text-ink')}>{invite.invitedEmailMasked}</span>, good
        until <span className={mono}>{formatDate(invite.expiresAt)}</span>. Only that address can
        accept it, so forwarding the link does not pass it on.
      </p>
    </div>
  );
}
