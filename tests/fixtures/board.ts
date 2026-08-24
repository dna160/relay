/**
 * One board, shaped to be hostile to a careless projection.
 *
 * It contains, deliberately: a private lane with a card in it; a card in a
 * published lane overridden to private; a `draft` card; an `internal_review`
 * card; a card with three versions of which only two are published; a card with
 * no versions at all; and a card whose rounds used exceed rounds contracted.
 *
 * The row types are imported from the projection itself rather than restated
 * here. If a Phase 2 agent adds an internal column to `CardRow`, this fixture
 * stops compiling until someone decides what the client should see — which is
 * the moment that decision should be made.
 */

import type {
  CardRow,
  LaneRow,
  VersionRow,
} from '@/domain/projection/client-view';
import { at, days, hours } from './clock';
import { APPROVAL, CARD, CONTACT, LANE, SHA, USER, VERSION } from './ids';

export const lanes: readonly LaneRow[] = [
  { id: LANE.published, name: 'Deliverables', position: 0, visibility: 'published' },
  { id: LANE.publishedSecond, name: 'Sign-off', position: 1, visibility: 'published' },
  { id: LANE.private, name: 'Internal QA', position: 2, visibility: 'private' },
];

const internal = {
  assigneeId: USER.freeAdmin,
  internalNotes: 'client is difficult; do not show',
  effortEstimate: 13,
} as const;

export const cards: readonly CardRow[] = [
  {
    ...internal,
    id: CARD.awaitingClient,
    laneId: LANE.published,
    title: 'Key art',
    description: 'Hero image for the spring campaign.',
    state: 'awaiting_client',
    position: 0,
    dueAt: at(days(96)),
    roundsUsed: 1,
    contractedRounds: 2,
    visibilityOverride: 'inherit',
  },
  {
    ...internal,
    id: CARD.draft,
    laneId: LANE.published,
    title: 'Unstarted deliverable',
    description: null,
    state: 'draft',
    position: 1,
    dueAt: null,
    roundsUsed: 0,
    contractedRounds: 2,
    visibilityOverride: 'inherit',
  },
  {
    ...internal,
    id: CARD.internalReview,
    laneId: LANE.published,
    title: 'Being reviewed',
    description: 'Art director has it.',
    state: 'internal_review',
    position: 2,
    dueAt: null,
    roundsUsed: 0,
    contractedRounds: 2,
    visibilityOverride: 'inherit',
  },
  {
    ...internal,
    id: CARD.privateOverride,
    laneId: LANE.published,
    title: 'Hidden one',
    description: 'Overridden to private in a published lane.',
    state: 'in_progress',
    position: 3,
    dueAt: null,
    roundsUsed: 0,
    contractedRounds: null,
    visibilityOverride: 'private',
  },
  {
    ...internal,
    id: CARD.empty,
    laneId: LANE.published,
    title: 'Nothing uploaded yet',
    description: null,
    state: 'assigned',
    position: 4,
    dueAt: null,
    roundsUsed: 0,
    contractedRounds: 2,
    visibilityOverride: 'inherit',
  },
  {
    ...internal,
    id: CARD.signedOff,
    laneId: LANE.publishedSecond,
    title: 'Brand guidelines',
    description: null,
    state: 'signed_off',
    position: 0,
    dueAt: at(days(50)),
    roundsUsed: 1,
    contractedRounds: 2,
    visibilityOverride: 'inherit',
  },
  {
    ...internal,
    // rounds 3 of 2. The only use of --breach in the design system.
    id: CARD.changesRequested,
    laneId: LANE.publishedSecond,
    title: 'Launch film',
    description: null,
    state: 'changes_requested',
    position: 1,
    dueAt: null,
    roundsUsed: 3,
    contractedRounds: 2,
    visibilityOverride: 'inherit',
  },
  {
    ...internal,
    id: CARD.inPrivateLane,
    laneId: LANE.private,
    title: 'QA notes',
    description: 'Never leaves the agency.',
    state: 'in_progress',
    position: 0,
    dueAt: null,
    roundsUsed: 0,
    contractedRounds: null,
    visibilityOverride: 'inherit',
  },
];

export const versions: readonly VersionRow[] = [
  {
    id: VERSION.v1,
    cardId: CARD.awaitingClient,
    versionNo: 1,
    filename: 'key-art-v1.png',
    sizeBytes: 12_400_000,
    sha256: SHA.v1,
    publishedToClientAt: at(days(70)),
  },
  {
    id: VERSION.v2,
    cardId: CARD.awaitingClient,
    versionNo: 2,
    filename: 'key-art-v2.png',
    sizeBytes: 13_100_000,
    sha256: SHA.v2,
    publishedToClientAt: at(days(88)),
  },
  {
    // Uploaded and hashed. Never passed the internal gate, so the client must
    // never see its filename, its size, or its hash.
    id: VERSION.v3,
    cardId: CARD.awaitingClient,
    versionNo: 3,
    filename: 'key-art-v3-WIP-DO-NOT-SEND.png',
    sizeBytes: 13_900_000,
    sha256: SHA.v3,
    publishedToClientAt: null,
  },
  {
    id: VERSION.signed,
    cardId: CARD.signedOff,
    versionNo: 1,
    filename: 'brand-guidelines.pdf',
    sizeBytes: 4_200_000,
    sha256: SHA.signed,
    publishedToClientAt: at(days(40)),
  },
];

/**
 * The version columns permitted to change after insert (INV-4). Both are
 * set-once. Any other update against `asset_versions` is a bug, and the purge
 * worker is the only sanctioned deleter.
 */
export const MUTABLE_VERSION_COLUMNS: readonly string[] = [
  'published_to_client_at',
  'superseded_by',
];

export interface ApprovalRow {
  id: string;
  assetVersionId: string;
  decision: 'approved' | 'changes_requested';
  decidedByContactId: string | null;
  decidedByUserId: string | null;
  /** Copied from the version at decision time and never re-read (INV-3). */
  versionSha256: string;
  note: string | null;
  ip: string | null;
  userAgent: string | null;
  decidedAt: Date;
}

export const approvals: readonly ApprovalRow[] = [
  {
    id: APPROVAL.changesOnV1,
    assetVersionId: VERSION.v1,
    decision: 'changes_requested',
    decidedByContactId: CONTACT.active,
    decidedByUserId: null,
    versionSha256: SHA.v1,
    note: 'The logo reads too small at the bottom of the frame.',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
    decidedAt: at(days(74) + hours(3)),
  },
  {
    id: APPROVAL.approvedOnSigned,
    assetVersionId: VERSION.signed,
    decision: 'approved',
    decidedByContactId: CONTACT.active,
    decidedByUserId: null,
    versionSha256: SHA.signed,
    note: null,
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
    decidedAt: at(days(42)),
  },
];

/** Ids a client contact on this engagement is entitled to see. */
export const EXPECTED_CLIENT_VISIBLE: {
  laneIds: readonly string[];
  cardIds: readonly string[];
  versionIds: readonly string[];
} = {
  laneIds: [LANE.published, LANE.publishedSecond],
  cardIds: [
    CARD.awaitingClient,
    CARD.internalReview,
    CARD.empty,
    CARD.signedOff,
    CARD.changesRequested,
  ],
  versionIds: [VERSION.v1, VERSION.v2, VERSION.signed],
};

/**
 * Strings that must not appear anywhere in a serialised client response. Any
 * one of them turning up is a leak, not a formatting difference.
 */
export const MUST_NOT_LEAK: readonly string[] = [
  'QA notes',
  'Internal QA',
  'Unstarted deliverable',
  'Hidden one',
  'key-art-v3-WIP-DO-NOT-SEND.png',
  'client is difficult; do not show',
  'internal_review',
  SHA.v3,
  USER.freeAdmin,
];
