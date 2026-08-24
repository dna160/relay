/**
 * Stable identifiers.
 *
 * Real ids are uuid v7 (DATA-MODEL.md). Generating them in a fixture would make
 * every fixture non-deterministic and every failure message unreadable, so these
 * are hand-written uuids in the v7 shape: a fixed timestamp prefix, version
 * nibble `7`, variant nibble `8`, and a readable tail. They sort in creation
 * order the way real v7 ids do, which matters for any test that asserts
 * ordering by id.
 *
 * The second group encodes kind and sequence, so a failure message reading
 * `0193a5f0-f603-...` is card 3 and nobody has to grep for it.
 */

function id(kind: string, n: number): string {
  const seq = n.toString(16).padStart(2, '0');
  return `0193a5f0-${kind}${seq}-7000-8000-${kind.repeat(4)}${seq.repeat(2)}`;
}

export const ORG = {
  free: id('a1', 1),
  pro: id('a1', 2),
  studio: id('a1', 3),
} as const;

export const USER = {
  freeAdmin: id('b2', 1),
  proAdmin: id('b2', 2),
  proMember: id('b2', 3),
  studioAdmin: id('b2', 4),
} as const;

export const ENGAGEMENT = {
  draft: id('c3', 1),
  active: id('c3', 2),
  wrapped: id('c3', 3),
  archived: id('c3', 4),
  purged: id('c3', 5),
  /** Second active engagement on the free org — together these fill the plan. */
  activeSecond: id('c3', 6),
  /** status = 'active' but idle for 39 days. Status alone would miscount it. */
  stale: id('c3', 7),
  /** The one engagement on the Pro (retaining) org. */
  retained: id('c3', 8),
} as const;

export const CONTACT = {
  /** Verified contact on the active engagement. */
  active: id('d4', 1),
  /** Same email address, different engagement. Proves INV-6 has no shared identity. */
  activeSecond: id('d4', 2),
  /** Invited but never verified. */
  unverified: id('d4', 3),
} as const;

export const LANE = {
  published: id('e5', 1),
  publishedSecond: id('e5', 2),
  private: id('e5', 3),
} as const;

export const CARD = {
  awaitingClient: id('f6', 1),
  draft: id('f6', 2),
  internalReview: id('f6', 3),
  privateOverride: id('f6', 4),
  inPrivateLane: id('f6', 5),
  signedOff: id('f6', 6),
  changesRequested: id('f6', 7),
  /** Lives in a published lane, published state, but has no versions at all. */
  empty: id('f6', 8),
} as const;

/** The three versions on `CARD.awaitingClient`, plus the one that was signed off. */
export const VERSION = {
  v1: id('a7', 1),
  v2: id('a7', 2),
  /** Uploaded, hashed, and deliberately never published to the client. */
  v3: id('a7', 3),
  signed: id('a7', 4),
} as const;

export const APPROVAL = {
  /** `changes_requested` on v1 — the round that produced v2. Carries a note. */
  changesOnV1: id('b8', 1),
  /** `approved` on the signed-off card's version. Carries that version's hash. */
  approvedOnSigned: id('b8', 2),
} as const;

/**
 * Deterministic, obviously-fake sha256 values. Sixty-four hex characters, the
 * width of the `char(64)` column, so a length assertion is meaningful.
 */
export function sha(seed: string): string {
  const body = seed.replace(/[^0-9a-f]/gi, '').toLowerCase() || '0';
  return body.repeat(Math.ceil(64 / body.length)).slice(0, 64);
}

export const SHA = {
  v1: sha('a1'),
  v2: sha('b2'),
  v3: sha('c3'),
  signed: sha('d4'),
  /** What a tampered re-read would produce. Never stored by a passing test. */
  tampered: sha('dead'),
} as const;
