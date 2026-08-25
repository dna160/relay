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
