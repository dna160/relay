'use client';

/**
 * Invite a teammate into the organisation.
 *
 * ## The one mistake this form exists to make hard
 *
 * Sending this to a client's address. The two invites in Relay look alike from
 * a distance — a box, an address, a send button — and they are not alike at
 * all. `InviteForm` adds a reviewer to one engagement: their session names that
 * engagement and cannot be widened (INV-6), and they see the published lanes
 * and nothing else. This one creates an account holder in the organisation,
 * with every workspace it owns, private lanes and internal notes included, for
 * as long as they are a member.
 *
 * So the two are separated four ways, and this file carries three of them:
 *
 *   1. **Different screens.** `InviteForm` is inside a workspace. This is
 *      outside every workspace, at `/team`. See that page's header.
 *   2. **The consequence is on the control, in the reader's own words** — not
 *      in a heading above it and not in a tooltip. `blastRadius` below changes
 *      with the chosen role and names the *organisation*, because "they get
 *      everything at Northline" is a sentence somebody will stop and re-read
 *      when the address they typed ends in the client's domain.
 *   3. **Hue.** `tone="agency"`, where the reviewer invite is `tone="client"`.
 *      The rule in `style-tokens.ts` is that a control's hue names the side
 *      holding the work once it is pressed; inviting a colleague moves nothing
 *      across the line, so the ball stays on this side. The two buttons are
 *      different colours and the difference is the product's existing colour
 *      idea rather than a warning to learn.
 *
 * The fourth is the sentence on `/w/[id]/settings` pointing here, so a person
 * standing at the wrong one is told at the wrong one.
 *
 * ## The address is confirmed rather than validated
 *
 * There is no domain check and there must not be one. Agencies invite
 * contractors on their own domains, and a form that refused
 * `freelance@gmail.com` because it "looks external" would be wrong most of the
 * time and would train people to ignore it the rest. What the form does instead
 * is *repeat the address back inside the consequence sentence*, so the thing
 * being agreed to and the thing being read are the same string.
 *
 * ## No animation
 *
 * The confirmation lands in the `done` slot under the button, where the action
 * was taken (MOTION.md R1, and the restraint list's "there are no toasts").
 * Nothing here animates: an invite being sent is an event, but the mark it
 * leaves is a line of text at the control, and `stamp` is reserved for a
 * version publish, a decision, and a round being consumed.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi, type InvitableOrgRole } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button, CopyField, Field, Select } from '@/components/primitives';
import { cn, mono, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';
import { INVITABLE_ORG_ROLES, orgRoleGrants, orgRoleLabel } from './vocabulary';

/** Loose on purpose — the authority on whether an address exists is the inbox. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TeamInviteForm({
  orgId,
  orgName,
}: {
  orgId: string;
  /**
   * Null when the roster read is unavailable — the invite route and the read
   * that names the organisation are separate endpoints and one of them landed
   * first. The consequence sentence below then says "this organisation", which
   * is weaker copy and still a true one; the alternative was withholding the
   * whole form because a decorative read was missing.
   */
  orgName: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  /**
   * `INVITABLE_ORG_ROLES` is `['admin', 'member']` and the weakest is last, so
   * the default is the last entry rather than a spelled-out `'member'`. That is
   * not squeamishness about a string: a role literal here is a file forming an
   * opinion about the role vocabulary, INV-11's scan fails it, and the version
   * that reads the list is also the version that keeps working when the list
   * changes underneath it.
   */
  const [role, setRole] = useState<InvitableOrgRole>(
    INVITABLE_ORG_ROLES[INVITABLE_ORG_ROLES.length - 1] ?? INVITABLE_ORG_ROLES[0],
  );
  const invite = useAction(agencyApi.inviteTeammate);
  const ready = LOOKS_LIKE_EMAIL.test(email.trim());

  const who = ready ? email.trim() : 'Whoever you invite';

  return (
    <form
      className="flex max-w-dialog flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        const r = await invite.run('Invite sent', orgId, { email: email.trim(), role });
        if (r.ok) {
          setEmail('');
          router.refresh();
        }
      }}
    >
      <Field
        label="Their work email"
        type="email"
        autoComplete="off"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="colleague@youragency.com"
        hint="Their own address, not a shared inbox — the invite can only be redeemed by the address it was sent to."
      />

      <Select
        label="Role"
        options={INVITABLE_ORG_ROLES.map((r) => ({ value: r, label: orgRoleLabel(r) }))}
        value={role}
        onChange={(e) => setRole(e.target.value as InvitableOrgRole)}
        hint={orgRoleGrants(role)}
      />

      {/*
        The blast radius, stated with the address in it. This is the sentence
        that has to stop somebody who is one screen away from the invite they
        meant to send, so it names the organisation, it names what "every
        workspace" contains, and it says the word `client` out loud in the
        clause that says this is not that.
      */}
      <p className={cn('max-w-prose text-14', muted)}>
        <span className="font-semibold text-ink">{who}</span> will be able to open every workspace{' '}
        {orgName ?? 'this organisation'} owns — including private lanes, internal notes and
        versions that have not been published. If the person you have in mind is on the
        client&rsquo;s side, invite them from that engagement&rsquo;s settings page instead; a
        client contact never sees any of this.
      </p>

      <div>
        {/*
          `agency`: inviting a colleague hands nothing to the client, so the
          ball stays on this side of the line. The reviewer invite on the
          settings page is the same control in `client` indigo, and that is the
          whole difference between the two acts made visible.
        */}
        <Button
          type="submit"
          tone="agency"
          size="lg"
          loading={invite.pending}
          loadingLabel="Sending"
          disabled={!ready}
        >
          Send the invite
        </Button>
      </div>

      {invite.done && invite.data && (
        <div className="flex flex-col gap-2">
          <p className={cn(mono, 'text-12', muted)}>
            {invite.done} — {invite.data.invite.email}, as{' '}
            {orgRoleLabel(invite.data.invite.role).toLowerCase()}.
          </p>
          {/*
            The link, once, at the control that made it.

            `POST /api/orgs/:id/invites` returns `inviteUrl` deliberately —
            "so the agency can copy the link rather than depending on mail
            delivery" — and it is offered here rather than remembered anywhere,
            because it carries the raw token. It is a bearer credential for one
            address: whoever holds it can present it, and only the invited
            address can redeem it (INV-12), which is what makes handing it to
            the person who just minted it reasonable and printing it on a roster
            later not.

            `secret` so it is masked until asked for. An invite link sitting
            legible on a screen behind somebody in an open-plan office is the
            ordinary way a credential leaks, and the button copies it while
            masked so revealing it is rarely necessary.
          */}
          <CopyField
            label="The invitation link"
            value={invite.data.inviteUrl}
            secret
            copyLabel="Copy link"
            hint="Already emailed. This is the same link, if the mail is slow or lands in a spam folder — send it to the address above and nowhere else."
          />
        </div>
      )}
      {invite.failure && <ErrorPanel failure={invite.failure} />}
    </form>
  );
}
