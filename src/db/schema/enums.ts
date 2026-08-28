/**
 * The three SQL enums named in DATA-MODEL.md. Everything else that reads like
 * an enum in the doc (`plan`, `status`, `role`, `decision`,
 * `visibility_override`) is a constrained `text` column — those move with
 * product decisions, and an `ALTER TYPE` in a forward-only migration is a worse
 * trade than a one-line check.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const cardStateEnum = pgEnum('card_state', [
  'draft',
  'assigned',
  'in_progress',
  'internal_review',
  'awaiting_client',
  'changes_requested',
  'approved',
  'signed_off',
]);

export const possessionEnum = pgEnum('possession', ['agency', 'client']);

export const laneVisibilityEnum = pgEnum('lane_visibility', ['published', 'private']);

export const PLANS = ['free', 'pro', 'studio'] as const;
export const ENGAGEMENT_STATUSES = ['draft', 'active', 'archived', 'purged'] as const;
export const AGENCY_ROLES = ['admin', 'member'] as const;
export const CARD_VISIBILITY_OVERRIDES = ['inherit', 'private'] as const;
export const DECISIONS = ['approved', 'changes_requested'] as const;
/**
 * Which side recorded a decision. Deliberately its own list rather than a reuse
 * of `possessionEnum`: possession is where the ball currently is, and this is
 * who acted, once, in the past. They happen to share their two values today and
 * there is no reason they must forever.
 */
export const DECIDER_SIDES = ['client', 'agency'] as const;

/* --------------------------------------------------- v1.1 permission graph */

/**
 * ADR-021's three org roles. `owner` and `admin` derive project access (D3,
 * ADR-022); `member` derives nothing and must have a `project_memberships` row
 * to see anything at all.
 */
export const ORG_ROLES = ['owner', 'admin', 'member'] as const;

/** ADR-021's three project roles, strongest first. Order is load-bearing. */
export const PROJECT_ROLES = ['lead', 'contributor', 'reviewer'] as const;

/**
 * Every account gets a `personal` org at signup (ADR-021 §2). There is no
 * orgless project, so there is no nullable `org_id` branch in any query.
 */
export const ORG_KINDS = ['personal', 'team'] as const;

/**
 * Phase 10 (ADR-021 §5). What an invite is an offer of membership *in*.
 *
 * `invites.target_id` is polymorphic across these two and therefore carries no
 * foreign key; `invites.org_id` is the referential anchor. Two values rather
 * than one because the table shape in DELIVERY-PLAN §IV has both, and a column
 * with exactly one legal value is a column that lies about what it constrains.
 */
export const INVITE_TARGET_KINDS = ['org', 'project'] as const;
