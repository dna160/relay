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
