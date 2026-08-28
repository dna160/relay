/**
 * What a role means, written for the person being offered it.
 *
 * A second rendering of the same vocabulary that `agency/vocabulary.ts` carries,
 * and deliberately not a shared one. Two reasons, and the first is the weaker:
 *
 * 1. **Bundle.** `agency/vocabulary.ts` contains `Send to internal review` and
 *    the rest of the backstage language, which is on the bundle audit's marker
 *    list. Importing it here would put the agency's private vocabulary into a
 *    chunk served to somebody who is not in the organisation and may never
 *    accept.
 *
 * 2. **Audience, which is the real reason.** The admin's copy answers *what am
 *    I handing this person*; this answers *what am I being handed*. "Can invite
 *    or remove teammates — give this to the people who would answer for who has
 *    access" is advice to a person making a decision about somebody else. The
 *    invitee needs the second person and the consequence to them. A shared
 *    string would have to be written for neither.
 *
 * `Record<…>` on both role unions, so a role added to
 * `src/domain/access/roles.ts` is a compile error here rather than a silent
 * fallback to a generic sentence.
 */

import type { OrgRole, ProjectRole } from '@/lib/types';

const ORG: Record<OrgRole, { label: string; grants: string }> = {
  owner: {
    label: 'Owner',
    grants:
      'You would own the organisation, its plan and its billing, on top of everything an admin can do.',
  },
  admin: {
    label: 'Admin',
    grants:
      'You will be able to open every workspace this organisation owns, and to invite or remove other teammates.',
  },
  member: {
    label: 'Member',
    grants:
      'You will be able to open every workspace this organisation owns — boards, files, internal notes, and publishing work to clients.',
  },
};

const PROJECT: Record<ProjectRole, { label: string; grants: string }> = {
  lead: {
    label: 'Lead',
    grants: 'You will run this workspace: its board, its files, and what gets published to the client.',
  },
  contributor: {
    label: 'Contributor',
    grants: 'You will be able to work on this board — take deliverables, upload versions, and publish them.',
  },
  reviewer: {
    label: 'Reviewer',
    grants:
      'You will see what has been published to you on this one workspace, and approve it or ask for changes. Nothing else in Relay, and no other workspace.',
  },
};

function isOrgRole(role: string): role is OrgRole {
  return role in ORG;
}

/**
 * The label and the sentence for whichever union this role came from.
 *
 * `InvitePreview.role` is `OrgRole | ProjectRole` and the two unions do not
 * overlap, so the target kind is not needed to disambiguate — but it is taken
 * anyway and asserted against, because a preview whose `target.kind` and `role`
 * disagree is a malformed response, and rendering a project sentence over an
 * org invite would tell somebody they were getting one workspace when they were
 * being handed all of them. Unknown pairings fall back to naming the role
 * without claiming what it grants.
 */
export function roleCopy(
  role: string,
  kind: 'org' | 'project',
): { label: string; grants: string | null } {
  if (kind === 'org' && isOrgRole(role)) return ORG[role];
  if (kind === 'project' && role in PROJECT) return PROJECT[role as ProjectRole];
  return { label: role, grants: null };
}
