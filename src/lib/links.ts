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
