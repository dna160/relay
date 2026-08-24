/**
 * The single seam between the two front-end surfaces and the HTTP API.
 *
 * Every fetch in `src/app` goes through this file. The back end is being
 * written in parallel, so when a route lands with a shape that differs from
 * `docs/API-CONTRACT.md`, exactly one file changes and no page does.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **Shapes come from `src/lib/types.ts`.** Nothing here redeclares
 *    `AgencyCard`, `ClientCard`, `ApiError` or any other contract type. The
 *    handful of interfaces defined below are for endpoints the contract names
 *    but does not yet type; each is marked and listed in the handover so the
 *    architect can fold them into `types.ts` or correct them.
 * 2. **Nothing throws.** A page that renders a board must not blow up because
 *    the API returned 423. Every call returns a discriminated result and the
 *    surfaces render a designed panel for each documented code.
 * 3. **Failure copy is not here.** Each surface owns the words it uses for a
 *    given code — a client must never be told to "move up a plan" — so the
 *    panels import their own vocabulary. This file reports the code.
 * 4. **Client routes never carry an engagement id.** The client's engagement
 *    comes from the session cookie (API-CONTRACT). There is deliberately no
 *    parameter on any `client*` function below through which one could be
 *    passed.
 */

import type {
  AgencyCard,
  AgencyLane,
  AgencyVersion,
  ApiError,
  AttentionItem,
  CardState,
  CardVisibilityOverride,
  ClientCard,
  ClientCardState,
  ClientLane,
  Decision,
  DecisionRequest,
  EngagementStatus,
  EngagementSummary,
  ErrorCode,
  LaneVisibility,
  Plan,
  Possession,
} from '@/lib/types';

/* ------------------------------------------------------------------ results */

/**
 * A request that never reached a server has no `ApiError` to report, so the
 * envelope carries a slightly wider code than `ErrorCode`. The body of a
 * *completed* request is always parsed as the contract's `ApiError`.
 */
export type TransportCode = 'NETWORK' | 'MALFORMED';

export interface ApiFailure {
  ok: false;
  /** 0 when the request never completed. */
  status: number;
  code: ErrorCode | TransportCode;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function isFailure<T>(r: ApiResult<T>): r is ApiFailure {
  return !r.ok;
}

/* ------------------------------------------------------------------ context */

/**
 * Server components pass the incoming cookie header through; browser code
 * passes nothing and relies on same-origin credentials.
 */
export interface RequestContext {
  cookie?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Next's fetch cache hint. The client board is a read path and wants it. */
  revalidate?: number | false;
}

function baseUrl(ctx?: RequestContext): string {
  if (ctx?.baseUrl) return ctx.baseUrl;
  if (typeof window !== 'undefined') return '';
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/* ------------------------------------------------------------------ request */

interface RequestInitLite {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  ctx?: RequestContext;
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  return typeof (err as { code?: unknown }).code === 'string';
}

async function request<T>(path: string, init: RequestInitLite = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, ctx } = init;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ctx?.cookie) headers['cookie'] = ctx.cookie;

  let response: Response;
  try {
    response = await fetch(`${baseUrl(ctx)}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
      ...(ctx?.revalidate === undefined
        ? { cache: method === 'GET' ? 'no-store' : 'default' }
        : { next: { revalidate: ctx.revalidate } }),
    });
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK',
      message: cause instanceof Error ? cause.message : 'The request did not complete.',
    };
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: undefined as T };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) return { ok: true, status: response.status, data: undefined as T };
    return {
      ok: false,
      status: response.status,
      code: 'MALFORMED',
      message: `The server returned ${response.status} with no readable body.`,
    };
  }

  if (response.ok) return { ok: true, status: response.status, data: payload as T };

  if (isApiError(payload)) {
    return {
      ok: false,
      status: response.status,
      code: payload.error.code,
      message: payload.error.message,
      details: payload.error.details,
    };
  }

  return {
    ok: false,
    status: response.status,
    code: 'MALFORMED',
    message: `The server returned ${response.status} in an unrecognised shape.`,
  };
}

/* ----------------------------------------------------------------- envelopes */

/**
 * Every shipped route wraps its payload in a named key — `{ card }`,
 * `{ lane }`, `{ engagements }`. That is a reasonable convention and it is not
 * the one `docs/API-CONTRACT.md` describes, so the unwrapping happens here and
 * the pages never see it. This is the whole reason the seam exists.
 */
function pick<E, T>(result: ApiResult<E>, take: (payload: E) => T): ApiResult<T> {
  return result.ok ? { ok: true, status: result.status, data: take(result.data) } : result;
}

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

/**
 * `GET /api/client/board` — the client's header.
 *
 * It cannot be `EngagementSummary`: that carries `possession`, which is
 * internal-only in v1 (PRD §9), and it carries no id at all, which is correct —
 * the client's engagement comes from the session and there is nothing for them
 * to select.
 */
export interface ClientEngagementHeader {
  title: string;
  agencyName: string;
  brandPrimary: string | null;
  brandLogoKey: string | null;
  daysToPurge: number | null;
  contactEmail: string;
  contactName: string | null;
}

export interface ClientBoard {
  engagement: ClientEngagementHeader;
  lanes: ClientLane[];
}

/** `POST /api/client/comments`. */
export interface ClientComment {
  id: string;
  cardId: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  /** ASSUMED — the shipped POST does not return one; a read endpoint would. */
  authorName?: string;
}

/** `POST /api/client/versions/:id/decision`. */
export interface DecisionOutcome {
  decision: { id: string; versionId: string; decision: Decision; decidedAt: string };
  card: { id: string; state: ClientCardState; roundsUsed: number };
}

/** `POST /api/uploads/presign`. Bytes go direct to storage (INV-10). */
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

/* --------------------------------------------------- endpoints not yet built */

/**
 * Everything below this line is a route the front end needs and the back end
 * has not shipped. Each is listed in the handover. They are declared here, in
 * the seam, rather than stubbed in a page — a page that invents a shape is a
 * page that has to be rewritten when the real one lands.
 */

/** NOT BUILT — PRD §5.3. Flat, a handful of labelled groups, no versioning. */
export interface ShelfItem {
  id: string;
  filename: string;
  sizeBytes: number;
  mime: string;
  uploadedAt: string;
  sha256: string;
}

export interface ShelfGroup {
  id: string;
  label: string;
  position: number;
  items: ShelfItem[];
}

export interface Shelf {
  groups: ShelfGroup[];
}

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

  /**
   * GET /api/attention — NOT BUILT.
   * `AttentionItem` is typed in `types.ts` and PRD §5.5 requires the list, but
   * no endpoint is specified in the contract or shipped.
   */
  attention(ctx?: RequestContext) {
    return request<{ items: AttentionItem[] }>('/api/attention', { ctx }).then((r) =>
      pick(r, (p) => p.items),
    );
  },

  /** POST /api/engagements. 402 PLAN_LIMIT_REACHED when the active cap is hit. */
  createEngagement(
    body: { title: string; clientOrgName: string; templateId?: string; contractedRoundsDefault?: number },
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

  /** GET /api/engagements/:id/shelf — NOT BUILT. */
  shelf(id: string, ctx?: RequestContext) {
    return request<Shelf>(`/api/engagements/${encodeURIComponent(id)}/shelf`, { ctx });
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

/* ---------------------------------------------------------------- client api */

/**
 * Not one function below takes an engagement id, and none can be given one. The
 * session names the engagement and cannot be widened (INV-6); a client route
 * that accepted one would be a bug, and so would a helper that made it easy to
 * send.
 *
 * `requestMagicLink` and `verifyMagicLink` take the engagement *token* from the
 * URL because at that point there is no session. That token is the invite, not
 * a selector over engagements.
 */
export const clientApi = {
  /** POST /api/auth/client/request */
  requestMagicLink(body: { engagementToken: string; email: string }, ctx?: RequestContext) {
    return request<{ sent: true; expiresInMinutes: number }>('/api/auth/client/request', {
      method: 'POST',
      body,
      ctx,
    });
  },

  /** POST /api/auth/client/verify. Sets the engagement-scoped cookie. */
  verifyMagicLink(
    body: { engagementToken: string; email: string; code: string },
    ctx?: RequestContext,
  ) {
    return request<{ engagementTitle: string; contactId: string }>('/api/auth/client/verify', {
      method: 'POST',
      body,
      ctx,
    });
  },

  /** GET /api/client/board. Published lanes and cards only. */
  board(ctx?: RequestContext) {
    return request<ClientBoard>('/api/client/board', { ctx });
  },

  /** GET /api/client/queue. Cards where `awaitingYou` is true. */
  queue(ctx?: RequestContext) {
    return request<{ cards: ClientCard[] }>('/api/client/queue', { ctx }).then((r) =>
      pick(r, (p) => p.cards),
    );
  },

  /**
   * GET /api/client/comments?cardId= — NOT BUILT.
   * The route ships POST only, so notes can be written and not yet read back.
   */
  comments(cardId: string, ctx?: RequestContext) {
    return request<{ comments: ClientComment[] }>(
      `/api/client/comments?cardId=${encodeURIComponent(cardId)}`,
      { ctx },
    ).then((r) => pick(r, (p) => p.comments));
  },

  /** POST /api/client/comments */
  createComment(
    body: { cardId: string; body: string; parentId?: string | null },
    ctx?: RequestContext,
  ) {
    return request<{ comment: ClientComment }>('/api/client/comments', {
      method: 'POST',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.comment));
  },

  /**
   * POST /api/client/versions/:id/decision
   *
   * `note` is required when the decision is `changes_requested` — enforced in
   * the domain and by a CHECK. The control that sends it is the third place,
   * and the only one the client ever meets.
   */
  decide(versionId: string, body: DecisionRequest, ctx?: RequestContext) {
    return request<DecisionOutcome>(
      `/api/client/versions/${encodeURIComponent(versionId)}/decision`,
      { method: 'POST', body, ctx },
    );
  },
};

/* ------------------------------------------------------------------- hrefs */

/**
 * Followed by the browser rather than fetched, because the response is a
 * redirect to object storage or a streamed archive. Anchor targets, not calls
 * (INV-10).
 */
export const hrefs = {
  clientDownload(versionId: string): string {
    return `/api/client/download/${encodeURIComponent(versionId)}`;
  },
  /** NOT BUILT. Never paywalled: everything the contact can see (PRD §5.6). */
  clientExport(): string {
    return '/api/client/export';
  },
};
