/**
 * The agency half of the API seam.
 *
 * **Nothing under `src/app/(client)` or `src/components/client` may import this
 * module.** Every route string an agency member can reach lives here, and a
 * single import from the client tree would put the whole map — `/api/lanes`,
 * `/api/cards/:id/transition`, `/api/engagements/:id/settings` — into the
 * bundle a client contact downloads. That is not an INV-1 breach on its own
 * (the server would still refuse the call) but it is a map of the agency
 * surface handed to the wrong reader, and Phase 4's exit condition forbids it.
 *
 * Shapes come from `src/lib/types.ts`. The interfaces declared below are for
 * endpoints the contract names but does not type; each is marked.
 */

import type {
  AgencyCard,
  AgencyLane,
  AgencyVersion,
  AttentionItem,
  CardState,
  CardVisibilityOverride,
  EngagementStatus,
  EngagementSummary,
  LaneVisibility,
  Plan,
  Possession,
} from '@/lib/types';
import { pick, request, type RequestContext } from './api-client.core';

/* -------------------------------------------------- shapes the contract omits */

/**
 * `GET /api/engagements/:id`. Matches what the route ships, which is a
 * different shape from `EngagementSummary` — no counts, no possession. The
 * portfolio is where those live.
 */
export interface EngagementDetail {
  id: string;
  title: string;
  clientOrgName: string;
  status: EngagementStatus;
  templateId: string | null;
  startedAt: string | null;
  wrappedAt: string | null;
  lastActivityAt: string;
  /** Null on a retaining plan — paid plans null out the countdown entirely. */
  daysToPurge: number | null;
  contractedRoundsDefault: number;
  plan: Plan;
  agencyName: string;
}

/** `GET /api/engagements/:id` also returns the value that goes in the client link. */
export interface EngagementDetailResult {
  engagement: EngagementDetail;
  clientLinkToken: string;
}

/** `GET /api/engagements/:id/board`. */
export interface AgencyBoard {
  engagementId: string;
  lanes: AgencyLane[];
}

/** `POST /api/cards/:id/transition`. */
export interface TransitionOutcome {
  cardId: string;
  from: CardState;
  to: CardState;
  possession: Possession | null;
  roundsUsed: number;
  occurredAt: string;
}

/** `POST /api/cards/:id/publish` — the internal gate. */
export interface PublishOutcome {
  version: { id: string; versionNo: number; publishedToClientAt: string | null };
  newlyPublished: boolean;
  transition: { from: CardState; to: CardState; possession: Possession | null };
}

/** `POST /api/engagements` — creation reports the plan gate it just passed. */
export interface CreatedEngagement {
  engagement: Pick<
    EngagementSummary,
    'id' | 'title' | 'clientOrgName' | 'status' | 'lastActivityAt'
  >;
  plan: { activeCount: number; limit: number | null; remaining: number | null };
}

/** `POST /api/engagements/:id/invite`. */
export interface ClientContact {
  id: string;
  email: string;
  name: string | null;
  verifiedAt: string | null;
}

/** `POST /api/engagements/:id/wrap`. */
export interface WrapOutcome {
  id: string;
  status: EngagementStatus;
  wrappedAt: string | null;
  lastActivityAt: string;
  daysToPurge: number | null;
}

/** `POST /api/onboarding/org` (amendment A6). */
export interface OnboardedOrganization {
  orgId: string;
  slug: string;
}

/**
 * `POST /api/uploads/presign`. Bytes go direct to storage (INV-10) — this is a
 * description of an intended upload, never the upload itself.
 */
export type Presign =
  | { mode: 'single'; key: string; url: string; expiresIn: number }
  | {
      mode: 'multipart';
      key: string;
      uploadId: string;
      partSize: number;
      parts: { partNumber: number; url: string }[];
      completeUrl: string;
      abortUrl: string;
      expiresIn: number;
    };

export interface PresignResult {
  presign: Presign;
  multipartThresholdBytes: number;
  maxBytes: number;
  hashAlgorithm: 'sha256';
}

/** One row of a reorder batch. Position is a dense integer index within a lane. */
export interface ReorderItem {
  cardId: string;
  laneId: string;
  position: number;
}

/**
 * `GET /api/engagements/:id/shelf` (amendment A6).
 *
 * A "group" is a label on a row, not an entity — `group_label` is a text column
 * and the shelf has "no versioning, no approval, no tree" (PRD §5.3). There is
 * no group id to rename or leave dangling, so `id` below *is* the label. Shape
 * verified against `src/db/queries/shelf.ts`: a shelf row carries
 * `clientVisible` and does **not** carry a hash, because nothing on the shelf
 * is ever cited in an approval.
 */
export interface ShelfItem {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
  clientVisible: boolean;
}

export interface ShelfGroup {
  id: string;
  label: string;
  position: number;
  items: ShelfItem[];
}

/** `POST /api/reference-files` (amendment A6). */
export interface ReferenceFile {
  id: string;
  engagementId: string;
  groupLabel: string | null;
  filename: string;
  mime: string;
  sizeBytes: number;
  clientVisible: boolean;
  createdAt: string;
}

/**
 * A revision note as the agency reads it back: threaded to the version it was
 * written against, never floating forward (PRD §5.3).
 *
 * `internal` is agency-only in the strongest sense — the client read filters it
 * out in the SQL predicate rather than in a serialiser, so an internal note is
 * never selected for a client at all. Shape matches
 * `AgencyRevisionNote` in `src/db/queries/revision-notes.ts`.
 */
export interface RevisionNote {
  id: string;
  versionId: string;
  body: string;
  internal: boolean;
  side: 'agency' | 'client';
  authorName: string | null;
  authorUserId: string | null;
  authorContactId: string | null;
  createdAt: string;
}

/* --------------------------------------------------- endpoints not yet built */

/** NOT BUILT — `GET /api/templates`. Phase 7 owns the behaviour. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  laneCount: number;
  cardCount: number;
  updatedAt: string;
}

/** NOT BUILT — `POST /api/engagements/:id/export` "queues a zip; returns a job id". */
export interface ExportJob {
  jobId: string;
}

/* ---------------------------------------------------------------- agency api */

export const agencyApi = {
  /** GET /api/engagements */
  portfolio(ctx?: RequestContext) {
    return request<{ engagements: EngagementSummary[] }>('/api/engagements', { ctx }).then((r) =>
      pick(r, (p) => p.engagements),
    );
  },

  /** GET /api/attention — the portfolio's primary content (PRD §5.5). */
  attention(ctx?: RequestContext) {
    return request<{ items: AttentionItem[] }>('/api/attention', { ctx }).then((r) =>
      pick(r, (p) => p.items),
    );
  },

  /** POST /api/onboarding/org — the agency's first step; no org exists yet. */
  onboardOrg(body: { name: string; slug: string }, ctx?: RequestContext) {
    return request<{ organization: OnboardedOrganization }>('/api/onboarding/org', {
      method: 'POST',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.organization));
  },

  /** POST /api/engagements. 402 PLAN_LIMIT_REACHED when the active cap is hit. */
  createEngagement(
    body: {
      title: string;
      clientOrgName: string;
      templateId?: string;
      contractedRoundsDefault?: number;
    },
    ctx?: RequestContext,
  ) {
    return request<CreatedEngagement>('/api/engagements', { method: 'POST', body, ctx });
  },

  /** GET /api/engagements/:id */
  engagement(id: string, ctx?: RequestContext) {
    return request<EngagementDetailResult>(`/api/engagements/${encodeURIComponent(id)}`, { ctx });
  },

  /** GET /api/engagements/:id/board */
  board(id: string, ctx?: RequestContext) {
    return request<AgencyBoard>(`/api/engagements/${encodeURIComponent(id)}/board`, { ctx });
  },

  /** GET /api/engagements/:id/shelf */
  shelf(id: string, ctx?: RequestContext) {
    return request<{ groups: ShelfGroup[] }>(
      `/api/engagements/${encodeURIComponent(id)}/shelf`,
      { ctx },
    ).then((r) => pick(r, (p) => p.groups));
  },

  /** POST /api/reference-files. Metadata only; never bytes (INV-10). */
  recordReferenceFile(
    body: {
      engagementId: string;
      storageKey: string;
      filename: string;
      mime: string;
      sizeBytes: number;
      groupLabel?: string | null;
      clientVisible?: boolean;
    },
    ctx?: RequestContext,
  ) {
    return request<{ file: ReferenceFile }>('/api/reference-files', {
      method: 'POST',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.file));
  },

  /** POST /api/engagements/:id/invite */
  invite(id: string, body: { email: string; name?: string }, ctx?: RequestContext) {
    return request<{ contact: ClientContact }>(
      `/api/engagements/${encodeURIComponent(id)}/invite`,
      { method: 'POST', body, ctx },
    ).then((r) => pick(r, (p) => p.contact));
  },

  /** POST /api/engagements/:id/wrap */
  wrap(id: string, ctx?: RequestContext) {
    return request<{ engagement: WrapOutcome }>(
      `/api/engagements/${encodeURIComponent(id)}/wrap`,
      { method: 'POST', ctx },
    ).then((r) => pick(r, (p) => p.engagement));
  },

  /** POST /api/engagements/:id/export — NOT BUILT. */
  requestExport(id: string, ctx?: RequestContext) {
    return request<ExportJob>(`/api/engagements/${encodeURIComponent(id)}/export`, {
      method: 'POST',
      ctx,
    });
  },

  /** POST /api/lanes. `visibility` defaults to published (ADR-006). */
  createLane(
    body: { engagementId: string; name: string; visibility?: LaneVisibility; position?: number },
    ctx?: RequestContext,
  ) {
    return request<{ lane: AgencyLane }>('/api/lanes', { method: 'POST', body, ctx }).then((r) =>
      pick(r, (p) => p.lane),
    );
  },

  /** PATCH /api/lanes/:id */
  updateLane(
    id: string,
    body: {
      engagementId: string;
      name?: string;
      visibility?: LaneVisibility;
      position?: number;
    },
    ctx?: RequestContext,
  ) {
    return request<{ lane: AgencyLane }>(`/api/lanes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.lane));
  },

  /** POST /api/cards. A card is born in `draft`; state is never sent. */
  createCard(
    body: {
      engagementId: string;
      laneId: string;
      title: string;
      description?: string | null;
      assigneeId?: string | null;
      dueAt?: string | null;
      contractedRounds?: number | null;
      internalNotes?: string | null;
      effortEstimate?: number | null;
      visibilityOverride?: CardVisibilityOverride;
      position?: number;
    },
    ctx?: RequestContext,
  ) {
    return request<{ card: AgencyCard }>('/api/cards', { method: 'POST', body, ctx }).then((r) =>
      pick(r, (p) => p.card),
    );
  },

  /**
   * PATCH /api/cards/:id
   *
   * There is no `state` key on this type and there must never be one — the
   * route's schema is `.strict()` and rejects it with 400 (INV-2). Position and
   * lane are editable here; a single-card move uses it, a drag uses the batch
   * below.
   */
  updateCard(
    id: string,
    body: {
      engagementId: string;
      title?: string;
      description?: string | null;
      assigneeId?: string | null;
      dueAt?: string | null;
      contractedRounds?: number | null;
      internalNotes?: string | null;
      effortEstimate?: number | null;
      visibilityOverride?: CardVisibilityOverride;
      laneId?: string;
      position?: number;
    },
    ctx?: RequestContext,
  ) {
    return request<{ card: AgencyCard }>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.card));
  },

  /**
   * POST /api/cards/reorder — the batch a drag produces.
   *
   * Writes `position` and `laneId` and nothing else (ADR-003). Sent as a whole
   * ordering rather than N patches so a refresh cannot land mid-sequence and
   * render a board that is briefly wrong.
   */
  reorderCards(body: { engagementId: string; items: ReorderItem[] }, ctx?: RequestContext) {
    return request<{ reordered: number }>('/api/cards/reorder', { method: 'POST', body, ctx });
  },

  /** POST /api/cards/:id/transition — the only state writer. 409 on an illegal edge. */
  transitionCard(
    id: string,
    body: { engagementId: string; to: CardState; reason?: string },
    ctx?: RequestContext,
  ) {
    return request<{ transition: TransitionOutcome }>(
      `/api/cards/${encodeURIComponent(id)}/transition`,
      { method: 'POST', body, ctx },
    ).then((r) => pick(r, (p) => p.transition));
  },

  /** POST /api/cards/:id/publish — the internal gate onto the client projection. */
  publishCard(id: string, body: { engagementId: string; versionId?: string }, ctx?: RequestContext) {
    return request<PublishOutcome>(`/api/cards/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body,
      ctx,
    });
  },

  /** POST /api/uploads/presign */
  presignUpload(
    body: { engagementId: string; cardId?: string; filename: string; mime: string; size: number },
    ctx?: RequestContext,
  ) {
    return request<PresignResult>('/api/uploads/presign', { method: 'POST', body, ctx });
  },

  /** POST /api/versions. Metadata and sha256 only; never bytes (INV-10). */
  recordVersion(
    body: {
      engagementId: string;
      cardId: string;
      storageKey: string;
      filename: string;
      mime: string;
      sizeBytes: number;
      sha256: string;
    },
    ctx?: RequestContext,
  ) {
    return request<{ version: AgencyVersion }>('/api/versions', {
      method: 'POST',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.version));
  },

  /** GET /api/versions/:id/notes — what the client asked for, against that version. */
  revisionNotes(versionId: string, ctx?: RequestContext) {
    return request<{ notes: RevisionNote[] }>(
      `/api/versions/${encodeURIComponent(versionId)}/notes`,
      { ctx },
    ).then((r) => pick(r, (p) => p.notes));
  },

  /**
   * POST /api/versions/:id/notes
   *
   * `engagementId` is amendment A5: an agency mutation names its subject so the
   * authorisation check has one before any row is read. `internal` keeps a
   * working note off the client's thread — a client read cannot return a row
   * where it is true.
   */
  addRevisionNote(
    versionId: string,
    body: { engagementId: string; body: string; internal?: boolean },
    ctx?: RequestContext,
  ) {
    return request<{ note: RevisionNote }>(
      `/api/versions/${encodeURIComponent(versionId)}/notes`,
      { method: 'POST', body, ctx },
    ).then((r) => pick(r, (p) => p.note));
  },

  /** GET /api/templates — NOT BUILT. */
  templates(ctx?: RequestContext) {
    return request<{ templates: TemplateSummary[] }>('/api/templates', { ctx }).then((r) =>
      pick(r, (p) => p.templates),
    );
  },

  /** POST /api/templates — NOT BUILT. */
  createTemplate(
    body: { name: string; description?: string; fromEngagementId?: string },
    ctx?: RequestContext,
  ) {
    return request<{ template: TemplateSummary }>('/api/templates', {
      method: 'POST',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.template));
  },
};

/* -------------------------------------------------------------------- events */

/** `GET /api/events?engagementId=` (amendment A1). Agency only — the parameter
 *  is authorised against the org, which is exactly why the client stream has
 *  none and why this string does not live in a shared module. */
export function agencyEventStreamUrl(engagementId: string): string {
  return `/api/events?engagementId=${encodeURIComponent(engagementId)}`;
}
