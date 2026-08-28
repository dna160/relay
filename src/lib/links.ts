/**
 * Absolute links, for the places a link leaves the app.
 *
 * An email is the only surface where a relative path is useless, and the
 * retention warnings are almost entirely made of links: the client's free
 * export and the agency's way back into the workspace. Both are built here so
 * that neither is spelled out twice with a different origin.
 *
 * `NEXT_PUBLIC_APP_URL` must match `AUTH_URL` (RUNBOOK §2). Absent, links point
 * at localhost and a purge warning arrives with a dead button on it — which is
 * indistinguishable, to the person receiving it, from no warning at all.
 */

import { engagementToken } from '@/lib/auth';

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/** The link printed in client emails. `/e/{token}` and never `/w/{id}` (A4). */
export function clientWorkspaceUrl(engagementId: string): string {
  return `${appUrl()}/e/${engagementToken(engagementId)}`;
}

/**
 * The client's free, never-paywalled export.
 *
 * It goes through the client workspace rather than straight at
 * `/api/client/export`, because the API takes the engagement from the session
 * (INV-6) and a contact arriving from an email may not have one yet. The
 * `?export=1` is the client surface's cue to start the download as soon as the
 * contact is verified — one click from the email, which is the promise.
 */
export function clientExportUrl(engagementId: string): string {
  return `${clientWorkspaceUrl(engagementId)}?export=1`;
}

/** Where an agency member lands to reopen or retain an engagement (A4). */
export function agencyWorkspaceUrl(engagementId: string): string {
  return `${appUrl()}/w/${engagementId}/settings`;
}

/* --------------------------------------------------- where a sign-in may land */

/**
 * The default destination for a sign-in that names none.
 *
 * `/onboarding` and not `/portfolio`, because a first-ever sign-in has proved
 * an address and belongs to no organisation yet (ADR-013). `/onboarding` tells
 * the three states apart and forwards to `/portfolio` when there is nothing
 * left to do, so it is correct for the first sign-in and the thousandth.
 */
export const DEFAULT_CALLBACK = '/onboarding';

/**
 * Where a sign-in is allowed to land, validated rather than trusted.
 *
 * `callbackUrl` arrives through a browser and is an open-redirect parameter, so
 * the rule is a single leading slash and nothing else. `//evil.example` is
 * protocol-relative and would leave the origin; `/\evil` is treated as
 * protocol-relative by some browsers; anything carrying a scheme is not ours. A
 * value that fails is not an error worth a message — it is discarded and the
 * default is used.
 *
 * ## Why it lives here
 *
 * Because the *email* needs it too, and the email is built server-side.
 * `POST /api/auth/signin/request` puts the destination into the emailed link so
 * that somebody who started an invitation in one tab and opens the mail on
 * their phone lands back on the invitation rather than on `/onboarding` — which
 * is precisely the wrong door for an invitee who has no organisation and is
 * about to be given one.
 *
 * `src/app/(agency)/signin/safe-callback.ts` briefly stated the same rule for
 * the two pages that read the parameter, and its own header gave the reason
 * this belongs in one place: "a second copy is a second place for the `//` case
 * to be forgotten". That file is gone and `/signin` and `/signin/confirm`
 * import this one — deleted rather than left as a re-export, because a
 * pass-through module removes the second implementation and keeps a second
 * name.
 *
 * **This is the only definition. There must not be a second one**, in a page,
 * in a route, or in a test helper. An open-redirect guard that exists twice is
 * one patch away from existing in two versions.
 */
export function safeCallback(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return DEFAULT_CALLBACK;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_CALLBACK;
  return raw;
}
