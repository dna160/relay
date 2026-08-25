/**
 * The purge certificate: what it claims, and how it is signed.
 *
 * This is the compliance artifact an agency forwards to its client's legal
 * team. It is the thing that turns "we deleted your workspace" from an assertion
 * into evidence, and it is the reason the retention paywall is something an
 * agency is glad to have rather than something it resents.
 *
 * ## The wording is one constant, in one place
 *
 * **PRD §9's tombstone-vs-certified-destruction question is still open.**
 * Whether Relay may claim *certified destruction* — that no copy survives
 * anywhere, including backups — or only *tombstoned deletion* — that the
 * content is gone from the live system and an internal tombstone expires 30
 * days later (ADR-007) — changes what this document is legally worth.
 *
 * `CERTIFICATE_STATEMENT` below is the entire surface of that decision. When it
 * lands, one string changes and nothing else does. Certificates already issued
 * keep their own wording, because the emitted statement is stored on the row
 * rather than rendered from this constant at read time — a compliance artifact
 * that silently changes what it says after it has been forwarded is worse than
 * no artifact at all.
 *
 * The current wording deliberately claims the **weaker** of the two. Under-
 * claiming can be corrected by a later, stronger certificate. Over-claiming
 * cannot be corrected at all.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Bumped only when the *shape* of the signed payload changes. */
export const CERTIFICATE_SCHEME = 'v1' as const;

/**
 * The claim. One constant, one place — see the module comment.
 *
 * Reads as prose because it is quoted verbatim into an email and a PDF that a
 * lawyer, not a developer, will be the one reading.
 */
export const CERTIFICATE_STATEMENT =
  'All content belonging to this engagement — every uploaded file, every version, ' +
  'every approval, comment and note — has been deleted from Relay’s live systems ' +
  'and its object storage. The counts and hash below describe exactly what was ' +
  'destroyed. Relay retains an internal tombstone of the engagement record for 30 ' +
  'days from the date above, after which the record itself is removed; this ' +
  'certificate is not a claim about third-party backup media held by Relay’s ' +
  'infrastructure providers.';

/**
 * What the signature covers. Field order is the signature — this is a canonical
 * serialisation, not a convenience — so nothing here may be reordered, and a
 * new field means a new `CERTIFICATE_SCHEME`.
 */
export interface CertificatePayload {
  readonly engagementId: string;
  readonly orgId: string;
  readonly engagementTitle: string;
  readonly clientOrgName: string;
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly manifestSha256: string;
  readonly purgedAt: Date;
  readonly statement: string;
}

/**
 * Deterministic bytes for a payload. Explicit field-by-field rather than
 * `JSON.stringify`, whose key order follows insertion order and would make the
 * signature depend on how the object happened to be built.
 */
export function canonicalCertificate(payload: CertificatePayload): string {
  return [
    CERTIFICATE_SCHEME,
    payload.engagementId,
    payload.orgId,
    payload.engagementTitle,
    payload.clientOrgName,
    String(payload.objectCount),
    String(payload.totalBytes),
    payload.manifestSha256,
    payload.purgedAt.toISOString(),
    payload.statement,
  ].join('\n');
}

/**
 * `CERTIFICATE_SIGNING_KEY` must be stable across deploys: rotating it makes
 * every previously issued certificate unverifiable, and those certificates are
 * already in other people's inboxes (RUNBOOK §2).
 */
function signingKey(env: NodeJS.ProcessEnv): Buffer {
  const value = env.CERTIFICATE_SIGNING_KEY;
  if (!value || value.length === 0) {
    throw new Error(
      'CERTIFICATE_SIGNING_KEY is not set. A purge that cannot sign its certificate ' +
        'must not run: content gone with no verifiable certificate is the one ' +
        'unrecoverable outcome (RUNBOOK §6).',
    );
  }
  return Buffer.from(value, 'utf8');
}

export function signCertificate(payload: CertificatePayload, env: NodeJS.ProcessEnv): string {
  const mac = createHmac('sha256', signingKey(env))
    .update(canonicalCertificate(payload))
    .digest('base64url');
  return `${CERTIFICATE_SCHEME}.${mac}`;
}

/**
 * Verification is the half that matters operationally: the agency's client is
 * the one who wants to check, months later, that the document is genuine.
 */
export function verifyCertificate(
  payload: CertificatePayload,
  signature: string,
  env: NodeJS.ProcessEnv,
): boolean {
  let expected: string;
  try {
    expected = signCertificate(payload, env);
  } catch {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True when a signing key is present, so a caller can refuse early. */
export function canSignCertificates(env: NodeJS.ProcessEnv): boolean {
  return typeof env.CERTIFICATE_SIGNING_KEY === 'string' && env.CERTIFICATE_SIGNING_KEY.length > 0;
}

/**
 * The hash that ties a certificate to what it destroyed. Taken over the
 * canonical manifest text, so the certificate is falsifiable: keep the manifest
 * and you can prove the certificate describes it.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
