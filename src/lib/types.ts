/**
 * The contract. Front-end and back-end both import from this file and neither
 * redeclares any of it (API-CONTRACT.md). Where an implementation diverges from
 * this file, this file wins and both sides change.
 *
 * Owned by the architecture layer. A sub-agent that needs a shape changed
 * proposes the change here rather than widening a local type.
 */

import type { CardState, Possession } from '@/domain/card/state-machine';
import type { AccessResult, AccessVia, OrgRole, ProjectRole } from '@/domain/access/roles';

export type { CardState, Possession };

/**
 * The permission graph's vocabulary (ADR-021), re-exported so both sides import
 * it from one place and neither redeclares it.
 *
 * `Session` deliberately does **not** gain ADR-021 §4's `'account'` and
 * `'reviewer'` variants yet. They belong to Phase 10, when auth can actually
 * produce one: adding them now would force every existing `switch` to handle
 * kinds nothing can construct, and the Phase 9 shadow window needs the old
 * session shape unchanged so the two permission paths stay comparable. A union
 * that grows before its constructors is a union everyone widens a default for.
 */
export type { AccessResult, AccessVia, OrgRole, ProjectRole };

/**
 * Invitations (ADR-027, INV-12). Re-exported rather than redeclared so the
 * contract lives in one place — the front-end was importing these straight
 * from the domain, which works and leaves the seam in two.
 */
export type {
  InvitePreview,
  InviteRedemption,
  InviteState,
  InviteTargetKind,
  RefusalReason,
  PendingInvite,
} from '@/domain/auth/invite';
export type { InvitableOrgRole } from '@/domain/access/roles';
export type { OrgMember } from '@/domain/access/org-team';

/* ------------------------------------------------------------------ session */

/**
 * A request carries exactly one session kind. A client session names exactly
 * one engagement and cannot be widened (INV-6) — there is no cross-engagement
 * client identity in v1, deliberately (ADR-005).
 */
export type Session =
  | { kind: 'agency'; userId: string; orgId: string; role: AgencyRole }
  | { kind: 'client'; contactId: string; engagementId: string };

export type AgencyRole = 'admin' | 'member';

export function isAgencySession(s: Session): s is Extract<Session, { kind: 'agency' }> {
  return s.kind === 'agency';
}

export function isClientSession(s: Session): s is Extract<Session, { kind: 'client' }> {
  return s.kind === 'client';
}

/* ------------------------------------------------------------- board shapes */

/** The states a client contact may observe. `internal_review` is not among them. */
export type ClientCardState = Exclude<CardState, 'draft' | 'internal_review'>;

export type LaneVisibility = 'published' | 'private';
export type CardVisibilityOverride = 'inherit' | 'private';

export interface ClientVersion {
  id: string;
  versionNo: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  publishedAt: string;
}

export interface AgencyVersion extends ClientVersion {
  mime: string;
  uploadedByUserId: string | null;
  /** Null until an agency member passes the internal gate. */
  publishedToClientAt: string | null;
  supersededBy: string | null;
}

/**
 * What a client contact receives. The absence of `assignee`, `internalNotes`,
 * `effortEstimate` and `possession` is structural, not conditional — the client
 * serialiser cannot emit them (INV-1).
 */
export interface ClientCard {
  id: string;
  laneId: string;
  title: string;
  description: string | null;
  state: ClientCardState;
  dueAt: string | null;
  position: number;
  roundsUsed: number;
  contractedRounds: number | null;
  versions: ClientVersion[];
  awaitingYou: boolean;
}

export interface AgencyCard extends Omit<ClientCard, 'state' | 'versions' | 'awaitingYou'> {
  state: CardState;
  versions: AgencyVersion[];
  assignee: { id: string; name: string } | null;
  internalNotes: string | null;
  effortEstimate: number | null;
  possession: PossessionSplit;
  visibilityOverride: CardVisibilityOverride;
}

/** Derived from `state_transitions` and nowhere else (ADR-010, INV-5). */
export interface PossessionSplit {
  agencyMs: number;
  clientMs: number;
  /** Which side holds it now. Null once the card is signed off. */
  current: Possession | null;
  /** Milliseconds accrued in the current possession, for the card's bar label. */
  currentMs: number;
}

export interface ClientLane {
  id: string;
  name: string;
  position: number;
  cards: ClientCard[];
}

export interface AgencyLane extends Omit<ClientLane, 'cards'> {
  visibility: LaneVisibility;
  cards: AgencyCard[];
}

/* -------------------------------------------------------------- engagements */

export type EngagementStatus = 'draft' | 'active' | 'archived' | 'purged';
export type Plan = 'free' | 'pro' | 'studio';

export interface EngagementSummary {
  id: string;
  title: string;
  clientOrgName: string;
  status: EngagementStatus;
  lastActivityAt: string;
  /** Null on a retaining plan — paid plans null out the countdown entirely. */
  daysToPurge: number | null;
  cardCounts: { total: number; awaitingClient: number; awaitingAgency: number };
  possession: PossessionSplit;
}

/** Ranked by actionability, not deadline proximity (PRD §5.5). */
export type AttentionBucket =
  | 'blocked_on_you'
  | 'blocked_on_your_team'
  | 'with_the_client'
  | 'no_movement_7d';

export interface AttentionItem {
  cardId: string;
  engagementId: string;
  engagementTitle: string;
  cardTitle: string;
  bucket: AttentionBucket;
  possessionMs: number;
  dueAt: string | null;
  /** True when rounds used exceeds rounds contracted. The only use of --breach. */
  roundsBreached: boolean;
}

/* ------------------------------------------------------------------ removal */

/**
 * What happened when a lane or card was removed (ADR-026).
 *
 * There is no `delete` in this product's vocabulary except purge. A card
 * carries approvals that bind a version hash so "approved" survives a dispute
 * (INV-3), versions that only the purge worker may delete (INV-4), and the
 * transition rows the possession clock is derived from (INV-5). Deleting one
 * would destroy all three through a path that is not purge — and purge is the
 * only path that ends in a certificate (INV-7).
 *
 * So removal takes the least destructive mechanism that works, and **the
 * caller does not choose**: a person clicking remove cannot know whether a
 * card has an approval behind it, and asking them is how the wrong answer gets
 * clicked. `kind` reports which happened.
 */
export type RemovalKind = 'discarded' | 'archived';

/** Rows a hard delete would have taken with it. Empty means discard is safe. */
export interface CardDependents {
  readonly versions: number;
  readonly transitions: number;
  readonly comments: number;
}

export interface CardRemoval {
  readonly kind: RemovalKind;
  readonly cardId: string;
  /** Null when discarded — there is nothing left to carry a timestamp. */
  readonly archivedAt: string | null;
  /** Why archiving was necessary. Zeroes when discarded. */
  readonly kept: CardDependents;
}

export interface LaneRemoval {
  readonly kind: RemovalKind;
  readonly laneId: string;
  readonly archivedAt: string | null;
  /** Zero on a discard: a lane is only discarded when it holds nothing. */
  readonly cardsHidden: number;
}

export interface RestoredCard {
  readonly cardId: string;
  /**
   * The card came back into a lane that is itself archived, so the board still
   * will not show it. Reported rather than silently fixed — un-archiving a
   * whole column because someone restored one card in it is a larger action
   * than the one that was asked for.
   */
  readonly laneIsArchived: boolean;
}

export interface RestoredLane {
  readonly laneId: string;
  /** Cards returning with it — the ones not separately archived. */
  readonly cardsRestored: number;
}

export interface ArchivedLane {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly archivedAt: string;
  readonly archivedByName: string | null;
  readonly cardsHidden: number;
}

export interface ArchivedCard {
  readonly id: string;
  readonly laneId: string;
  readonly laneName: string;
  readonly title: string;
  readonly state: CardState;
  readonly archivedAt: string;
  readonly archivedByName: string | null;
  /**
   * What archiving kept, and the number that makes the design legible: it is
   * precisely why this card was archived instead of discarded.
   */
  readonly versionCount: number;
}

/* ---------------------------------------------------------------- templates */

/**
 * What a template stamps (PRD §5.7).
 *
 * Templates are v1, not v2, and the reason is structural rather than
 * convenience: disposable workspaces only work if creating one is nearly free.
 * Without them ephemerality becomes a tax, agencies reuse one long-lived
 * workspace, and that breaks billing, purge, and isolation at once.
 *
 * Three properties this shape enforces by having no field for the alternative:
 *
 * 1. **No ids anywhere.** Ids are minted at stamp time, which is what lets
 *    `applyTemplate()` be pure and lets stamping twice produce structurally
 *    identical graphs — the phase's exit condition.
 * 2. **No `state`.** A template that could set a card's state would be a second
 *    writer of `cards.state`, and INV-2 says there is exactly one. A stamped
 *    card starts at the column default and moves only through the machine.
 * 3. **No absolute dates.** `dueAfterDays` is relative to the engagement's
 *    start. A template carrying calendar dates is correct on the day it is
 *    written and quietly wrong forever after — the same failure the fixture
 *    timeline shipped and had to be rescued from.
 *
 * Persisted as `templates.definition` jsonb, so it outlives the code that
 * wrote it: `version` is how a future shape stays readable rather than
 * ambiguous.
 */
export interface TemplateDefinition {
  readonly version: 1;
  readonly lanes: readonly TemplateLane[];
  /** Flat labelled groups for the reference shelf. No tree, no versioning. */
  readonly shelfGroups: readonly string[];
  /** Applied to any card that does not state its own. */
  readonly contractedRoundsDefault: number | null;
}

export interface TemplateLane {
  readonly name: string;
  /** Published by default; private is explicit (ADR-006). */
  readonly visibility: LaneVisibility;
  readonly cards: readonly TemplateCard[];
}

export interface TemplateCard {
  readonly title: string;
  readonly description: string | null;
  readonly contractedRounds: number | null;
  /** Days after the engagement starts, never a calendar date. */
  readonly dueAfterDays: number | null;
}

export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  /** For the picker, so choosing one does not require fetching it. */
  readonly laneCount: number;
  readonly cardCount: number;
}

/* ---------------------------------------------------------------- decisions */

export type Decision = 'approved' | 'changes_requested';

export interface DecisionRequest {
  decision: Decision;
  /** Required when decision is `changes_requested`. Enforced in the domain and by a CHECK. */
  note?: string;
}

/* ------------------------------------------------------------------- errors */

export const ERROR_CODES = {
  PLAN_LIMIT_REACHED: 402,
  INVALID_TRANSITION: 409,
  ENGAGEMENT_ARCHIVED: 423,
  ENGAGEMENT_PURGED: 410,
  /**
   * 404, never 403. Telling a client that a lane exists but is hidden leaks the
   * thing INV-1 protects.
   */
  NOT_VISIBLE: 404,
  /**
   * This build cannot accept uploads at all — object storage is unconfigured.
   * A fact about the deployment, not about the request, and never worth a
   * retry. 503 rather than 500 so a deploy gate holds traffic on the old
   * version rather than promoting one that cannot take a file.
   */
  STORAGE_NOT_CONFIGURED: 503,
  /**
   * Object storage is configured and not answering. Somebody else's outage,
   * and a retry is exactly the right response — which is the whole reason it
   * is a separate code from the one above. The old copy collapsed both into
   * "could not reach the workspace", which told a user to retry something that
   * could never succeed.
   */
  STORAGE_UNREACHABLE: 503,
  /**
   * The invited address and the verified one are different people.
   *
   * Its own code because this is the refusal a person is most likely to meet
   * and least able to diagnose: they clicked a real link, signed in as
   * themselves, and were refused. Collapsed into a generic 400 it reads as
   * "something is broken"; named, the interface can say whose address the
   * invitation was for and offer to request another. Note the invite is **not**
   * consumed by this refusal — burning it would turn a forwarded email into a
   * denial of service against the intended recipient.
   */
  INVITE_ADDRESS_MISMATCH: 409,
  INVITE_EXPIRED: 410,
  INVITE_CONSUMED: 409,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  /**
   * Throttled. Introduced with the client-code rate limit — six digits and a
   * fifteen-minute window is a guessable space, and before the limit every
   * unused code stayed live, so a thousand requests shrank it to one in a
   * thousand.
   *
   * Deliberately **not** returned by `POST /api/auth/client/request`: a
   * distinct code there confirms a live engagement to an unauthenticated
   * caller, which is the thing the 404-not-403 rule exists to prevent. That
   * route stays a silent no-op. Only the verify route may answer 429.
   */
  RATE_LIMITED: 429,
  /**
   * The only code that does not describe a decision the product made. It
   * carries no details to the caller — an internal failure explaining itself
   * to a client contact is an information leak with a stack trace attached.
   */
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

/* ------------------------------------------------------------------- events */

export type ServerEvent =
  | { type: 'card.transitioned'; cardId: string; to: CardState }
  | { type: 'version.published'; cardId: string; versionId: string; versionNo: number }
  | { type: 'decision.recorded'; versionId: string; decision: Decision }
  | { type: 'comment.created'; cardId: string; commentId: string }
  | { type: 'engagement.warned'; engagementId: string; daysToPurge: number };
