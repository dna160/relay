/**
 * How a client contact's one-time code and rate-limit counters are keyed in
 * `auth_verification_tokens`.
 *
 * These identifiers are shared by two modules that must never disagree about
 * them: `src/lib/auth.ts` writes and reads them, and the purge worker deletes
 * them. They live here, in the domain, because neither of those may import the
 * other — the worker has no business pulling in `next-auth` and `next/headers`,
 * and INV-9 keeps the domain clear of both.
 *
 * ## Why the purge cares
 *
 * The identifier contains the contact's **email address**. `client_contacts` —
 * the row that address otherwise lives in — is destroyed by a purge, and the
 * certificate says so in as many words: "every uploaded file, every version,
 * every approval, comment and note has been deleted". A row in
 * `auth_verification_tokens` holding `client:{engagementId}:{email}` after that
 * makes the certificate false in the most sensitive column available, and it is
 * not a short-lived accident: rows for one identifier are only swept when that
 * same identifier is used again, so an abandoned code outlives the engagement
 * indefinitely.
 */

export type ClientThrottleKind = 'verify' | 'request';

/** The outstanding one-time code for one contact on one engagement. */
export function clientCodeIdentifier(engagementId: string, email: string): string {
  return `client:${engagementId}:${email.toLowerCase()}`;
}

/** A rate-limit counter bucket. Namespaced so it can never collide with a code. */
export function clientThrottleIdentifier(
  kind: ClientThrottleKind,
  engagementId: string,
  email: string,
): string {
  return `client-throttle:${kind}:${engagementId}:${email.toLowerCase()}`;
}

/**
 * Every identifier prefix belonging to one engagement, for the purge's
 * `LIKE prefix || '%'` delete. An engagement id is a UUID, so it carries no
 * `LIKE` metacharacter of its own.
 */
export function clientTokenIdentifierPrefixes(engagementId: string): readonly string[] {
  return [
    `client:${engagementId}:`,
    `client-throttle:verify:${engagementId}:`,
    `client-throttle:request:${engagementId}:`,
  ];
}
