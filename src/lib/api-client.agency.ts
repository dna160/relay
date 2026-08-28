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
  InvitableOrgRole,
  LaneVisibility,
  OrgMember,
  PendingInvite,
  Plan,
  Possession,
  TemplateDefinition,
  TemplateSummary,
} from '@/lib/types';
import { pick, request, type RequestContext } from './api-client.core';

/**
 * Re-exported, not redeclared.
 *
 * This module carried its own `TemplateSummary` until Phase 7 — with a
 * `description` and an `updatedAt` that the contract's shape does not have —
 * and `/templates` was rendering both. A redeclaration inside the API seam is
 * the exact failure this file's header forbids: the surface reads a field the
 * route never sends, typechecks, and prints `Invalid Date`. Shapes come from
 * `src/lib/types.ts` and nothing here defines a second one.
 */
export type { TemplateDefinition, TemplateLane, TemplateCard, TemplateSummary } from '@/lib/types';

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

/**
 * `GET /api/engagements` — the portfolio, plus what the org has spent of its
 * plan.
 *
 * `plan` is the *same block* `POST /api/engagements` already returns as
 * `CreatedEngagement['plan']`, widened by the plan's own name. That is
 * deliberate and it is the whole point: the number the portfolio states and the
 * number the 402 enforces have to be one evaluation, or the surface eventually
 * promises a slot the route refuses (INV-8).
 *
 * **Optional, for one round only.** The route does not ship the block yet; the
 * portfolio derives it in `_lib/plan-usage.ts` in the meantime and stops the
 * moment this field arrives. Owner: back-end, alongside Phase 9's
 * `countActiveEngagements()` signature change.
 */
export interface PlanUsage {
  readonly plan: Plan;
  readonly activeCount: number;
  /** Null means unlimited — Studio. */
  readonly limit: number | null;
  /** Null when the limit is. */
  readonly remaining: number | null;
}

export interface PortfolioPayload {
  engagements: EngagementSummary[];
  plan?: PlanUsage;
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
  /**
   * Phase 7. What the template stamped, or `null` when none was named.
   *
   * Reported by the route rather than left for the board to reveal, because a
   * create that named a template and stamped nothing — an empty definition, a
   * template with no lanes — is otherwise indistinguishable from a board that
   * failed to load. Nothing is optional inside it: the stamp is one
   * transaction, so these counts describe a board that certainly exists.
   */
  stamped: { templateId: string; laneCount: number; cardCount: number } | null;
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

/**
 * Card-level discussion, backstage. Shape is `AgencyComment` in
 * `src/db/queries/comments.ts` verbatim.
 *
 * Two things the client's `ClientComment` does not have, for the usual reason:
 *
 * - **`internal`** — an agency working comment. The client read filters it in
 *   SQL, root and reply both, so an internal comment is never selected into a
 *   client response rather than merely omitted from one.
 * - **author ids** — the agency may correlate a comment to a person; INV-1
 *   only forbids handing that correlation to a client.
 *
 * A comment is about the card. A `RevisionNote` is bound to one immutable
 * version. PRD §7 cuts chat rooms and says discussion attaches to cards *and*
 * versions — both, doing different jobs.
 */
export interface AgencyComment {
  id: string;
  cardId: string;
  /** Null for a root. One level only: the domain refuses a reply to a reply. */
  parentId: string | null;
  body: string;
  internal: boolean;
  side: 'agency' | 'client';
  authorName: string | null;
  authorUserId: string | null;
  authorContactId: string | null;
  createdAt: string;
}

/* --------------------------------------------------------------- the team */

/**
 * The team read's shapes come from `src/lib/types.ts` and are re-exported here,
 * never restated. `OrgMember` and `PendingInvite` are produced by
 * `listOrgMembers()` and `listPendingInvites()`; a second declaration in this
 * file is exactly the defect the `TemplateSummary` note above records.
 *
 * `PendingInvite` carries an invite **id** and no token — it cannot carry one,
 * because only the token's sha256 is stored. That is the storage choice made
 * for this reason rather than a happy accident: an invite token is a bearer
 * credential for one address, and a roster that printed it would let anybody
 * who can read the page redeem it, which is the single thing INV-12 spends a
 * verification step preventing.
 *
 * `OrgMember.name` is null for somebody who was invited by address and has not
 * yet told us anything else, which is *every* newly invited colleague. Surfaces
 * fall back to the address; they never render an id, which names nobody.
 */
export type { OrgMember, PendingInvite, InvitableOrgRole } from '@/lib/types';

/**
 * `POST /api/orgs/:id/invites` — what issuing one reports back.
 *
 * The route returns three display fields and the link. There is no invite id in
 * it and nothing that could be turned into a second request, which is the same
 * discipline `InvitePreview` follows on the other side of the wire.
 *
 * `inviteUrl` **contains the raw token**, which is a bearer credential for one
 * address. It is served to the one person who has by definition just created it
 * — the route says so — and it exists because mail delivery is the least
 * reliable part of this flow and an agency should not be stuck when a message
 * is quarantined. It belongs at the control that produced it and nowhere else:
 * not stored, not listed, and not shown again on a later render, because a
 * roster that reprinted invite links would let anybody who can read that page
 * redeem them.
 */
export interface IssuedOrgInvite {
  invite: { email: string; role: InvitableOrgRole; expiresAt: string };
  inviteUrl: string;
}

/**
 * `GET /api/orgs/:id/team` — the organisation, its people, and its outstanding
 * invitations.
 *
 * One read rather than three because the page is one answer: a roster whose
 * pending invitations arrived in a second request renders, for a moment, an
 * organisation that appears not to have invited anybody — and "did that invite
 * send?" is the exact question this surface exists to answer.
 *
 * **`viewerCanInvite` is a capability and not a role, and that is INV-11 rather
 * than a style preference.** The obvious field here was `viewerRole: OrgRole`,
 * with the page drawing the invite form when it is not `'member'` — which is a
 * permission decision made from a role literal in a React component, and
 * therefore a second place that knows how the roles rank and can disagree with
 * the resolver. `tests/invariants/inv-11-*` fails it, correctly. The route
 * resolves once and reports what this reader may do; the surface renders what
 * it is told and knows nothing about ordering.
 *
 * It stays rendering-only either way (DELIVERY-PLAN §III): it decides whether
 * the form is drawn, and the route decides whether an invitation is accepted. A
 * member who reaches the form by other means gets a refusal from the server
 * rather than a surprise.
 */
export interface OrgTeam {
  organization: { id: string; name: string; slug: string; plan: string };
  viewerCanInvite: boolean;
  members: OrgMember[];
  invites: PendingInvite[];
}

/* --------------------------------------------------- endpoints not yet built */

/**
 * `GET /api/templates/:id` — one template with the graph it stamps. Landed in
 * Phase 7 alongside the list and the capture.
 *
 * The list route returns `TemplateSummary`, whose counts exist "for the picker,
 * so choosing one does not require fetching it". That sentence is also the
 * reason this second read exists: the counts answer *how big*, and the preview
 * before stamping has to answer *what*, which is lane names, their visibility,
 * and the deliverables under each. A workspace that counts against the plan
 * limit should not arrive as a surprise.
 *
 * The definition is the persisted `templates.definition` jsonb, parsed by
 * `parseTemplateDefinition()` before it is served — never cast. A stored row
 * whose `version` this build does not know is a **400 from the route**, not a
 * half-parsed object handed to the surface, so `isReadableDefinition()` is a
 * belt to that braces rather than the only check. A preview surface still
 * renders its unavailable state on that failure; nothing renders an *empty*
 * preview, which would claim the template stamps nothing.
 */
export interface TemplateDetail {
  template: TemplateSummary;
  definition: TemplateDefinition;
}

/**
 * `POST /api/engagements/:id/export` — "queues a zip; returns a job id".
 *
 * `jobId` is what the contract promises and the only field the surface requires.
 * The rest are optional and read defensively, because the queue is allowed to
 * finish before the request returns: pg-boss can complete a small engagement's
 * archive in the time the round trip takes, and a control that told someone to
 * wait for an email about a file already sitting in storage would be lying to
 * them. When `url` is absent the surface renders the queued state and says an
 * email is coming, which is the contract's own promise.
 *
 * `url` is followed by the browser, never fetched: the archive is presigned and
 * its bytes do not pass through the app (INV-10).
 */
export interface ExportJob {
  jobId: string;
  status?: 'queued' | 'ready';
  /** Present only when the archive already exists. Presigned. */
  url?: string;
  readyAt?: string;
}

/**
 * `GET /api/engagements/:id/members` — who can be assigned a card here.
 *
 * `id` is the value to send back as `assigneeId`: a `users.id`, not an account
 * id and not a membership id. The route's own header is explicit about that,
 * because Phase 9 introduced an account graph and the two are not the same
 * column.
 *
 * The list is scoped to *this engagement*, never to the org. That is what makes
 * the single-member rule in COMPONENTS.md §17 a fact about the picker rather
 * than a guess: when this returns one row, one person can hold this card.
 */
export interface AssignableMember {
  id: string;
  name: string | null;
  email: string;
}

/**
 * What `DELETE /api/cards/:id` did (ADR-026).
 *
 * `kind` is reported rather than assumed because the caller does not choose it:
 * `removeCard()` takes the least destructive mechanism that satisfies the
 * request, which is a real delete only when the cascade has nothing to cascade
 * to. The surface needs to know which happened — an "Undo" offered on a row
 * that no longer exists is the worst affordance in the feature.
 */
export interface CardDependents {
  versions: number;
  transitions: number;
  comments: number;
}

export interface CardRemoval {
  kind: 'discarded' | 'archived';
  cardId: string;
  /** Null when discarded. There is nothing left to carry a timestamp. */
  archivedAt: string | null;
  kept: CardDependents;
}

export interface LaneRemoval {
  kind: 'discarded' | 'archived';
  laneId: string;
  archivedAt: string | null;
  /** Zero on a discard: a lane is only discarded when it holds nothing. */
  cardsHidden: number;
}

/**
 * `GET /api/engagements/:id/archive` — what has been removed and can come back.
 *
 * A separate read from the board rather than a flag on it, because an archived
 * card whose lane was archived too has no lane to sit in. `versionCount` is the
 * number that makes the design legible: it is precisely why the card was
 * archived instead of deleted.
 */
export interface ArchivedLane {
  id: string;
  name: string;
  position: number;
  archivedAt: string;
  archivedByName: string | null;
  cardsHidden: number;
}

export interface ArchivedCard {
  id: string;
  laneId: string;
  laneName: string;
  title: string;
  state: string;
  archivedAt: string;
  archivedByName: string | null;
  versionCount: number;
}

export interface ArchivedBoard {
  lanes: ArchivedLane[];
  cards: ArchivedCard[];
}

/* ---------------------------------------------------------------- agency api */

export const agencyApi = {
  /**
   * GET /api/engagements
   *
   * Returns the payload rather than only the list: the portfolio needs the
   * plan block beside the rows, and unwrapping to an array here is what would
   * make a second request the only way to get it.
   */
  portfolio(ctx?: RequestContext) {
    return request<PortfolioPayload>('/api/engagements', { ctx });
  },

  /** GET /api/attention — the portfolio's primary content (PRD §5.5). */
  attention(ctx?: RequestContext) {
    return request<{ items: AttentionItem[] }>('/api/attention', { ctx }).then((r) =>
      pick(r, (p) => p.items),
    );
  },

  /**
   * POST /api/auth/signin/request — an address, and out goes a six-digit code.
   *
   * **Always 200, whatever the address.** On this product email sign-in is also
   * sign-up: the account is created when the address is *proved*, at
   * `/confirm`, not when a code is asked for — so the route does identical work
   * for a known and an unknown address and there is no branch for a timing
   * measurement to find. Being over the rate limit answers identically too.
   *
   * The surface must not undo that. There is no copy anywhere in this flow that
   * says whether an address is known to Relay, because the honest sentence — we
   * sent it if it exists — is also the safe one.
   */
  requestSigninCode(body: { email: string }, ctx?: RequestContext) {
    return request<{ sent: boolean; expiresInMinutes: number }>('/api/auth/signin/request', {
      method: 'POST',
      body,
      ctx,
    });
  },

  /**
   * POST /api/auth/signin/confirm — six digits in, a session cookie out.
   *
   * **POST, and only POST**, and that is the whole mail-scanner defence rather
   * than half of it. Outlook Safe Links and Proofpoint fetch every URL in an
   * inbound message before a human sees it; the emailed link points at the
   * *page* `/signin/confirm`, which renders a button and consumes nothing. Only
   * this call spends the code, and a prescanner does not issue it.
   *
   * The page that calls this must therefore never call it on load — not in an
   * effect, not on mount, not "because the code was already in the query
   * string". `src/app/(agency)/signin/confirm/page.tsx` says the same thing at
   * greater length, because it is the file where somebody would be tempted.
   *
   * `needsOnboarding` is true for an address that proved itself and belongs to
   * no organisation — a first-ever sign-in, and *every* invited colleague
   * before they redeem. It decides where the caller goes next and nothing else.
   */
  confirmSigninCode(body: { email: string; code: string }, ctx?: RequestContext) {
    return request<{ needsOnboarding: boolean }>('/api/auth/signin/confirm', {
      method: 'POST',
      body,
      ctx,
    });
  },

  /**
   * GET /api/orgs/:id/team — who is in the organisation, and who has been asked.
   *
   * The id is the caller's own `session.orgId`, which is what makes this read's
   * 404 legible: a caller cannot fail to be visible to an organisation they
   * hold a session for, so a 404 here means the route is not on this build —
   * not that the team was hidden. `/team` says exactly that rather than
   * rendering the generic not-found panel, which on this screen would read as
   * "your colleagues are gone".
   */
  team(orgId: string, ctx?: RequestContext) {
    return request<OrgTeam>(`/api/orgs/${encodeURIComponent(orgId)}/team`, { ctx });
  },

  /**
   * POST /api/orgs/:id/invites — invite a teammate into the organisation.
   *
   * **Not to be confused with `invite()` below, which adds a client contact to
   * one engagement.** They differ in every way that matters: this one creates
   * an account holder with a membership across the organisation, that one
   * creates a reviewer scoped to a single workspace and to no other (INV-6).
   * The two live in different places in the interface for the same reason they
   * are two methods here, and the naming is deliberate — `inviteTeammate` and
   * `invite` would be one letter apart at a call site, so the engagement one
   * keeps the name it has had since Phase 1 and this one is spelled out.
   *
   * `role` is an `OrgRole`. `owner` is absent from the surface's choices on
   * purpose: transferring ownership is not an invitation, and an invite that
   * could mint a second owner is a privilege escalation wearing a form.
   */
  inviteTeammate(
    orgId: string,
    body: { email: string; role: InvitableOrgRole },
    ctx?: RequestContext,
  ) {
    return request<IssuedOrgInvite>(`/api/orgs/${encodeURIComponent(orgId)}/invites`, {
      method: 'POST',
      body,
      ctx,
    });
  },

  /**
   * DELETE /api/orgs/:id/invites/:inviteId — withdraw an unredeemed invitation.
   *
   * The undo for the expensive mistake on the team screen. An invitation sent
   * to the wrong address is live until it expires, and "wait a week" is not a
   * remedy when the wrong address belongs to the client whose private lanes it
   * would open.
   *
   * Withdrawing never touches a *consumed* invitation, which is the domain's
   * rule rather than this caller's: an invitation that has already been
   * accepted is a membership now, and removing somebody is a different act with
   * a different confirmation. The invite screen renders `revoked` in its own
   * words rather than as "expired", so a person who is turned away knows
   * somebody withdrew it and a replacement may not be coming.
   */
  revokeTeammateInvite(orgId: string, inviteId: string, ctx?: RequestContext) {
    return request<{ revoked: { id: string } }>(
      `/api/orgs/${encodeURIComponent(orgId)}/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE', ctx },
    ).then((r) => pick(r, (p) => p.revoked));
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

  /**
   * GET /api/engagements/:id/members — the assignee picker's candidates.
   *
   * Readable rather than writable on the route's side, deliberately: an
   * archived engagement's board still renders assignee names, and a picker that
   * 423'd here would make the read-only board unopenable.
   */
  members(id: string, ctx?: RequestContext) {
    return request<{ members: AssignableMember[] }>(
      `/api/engagements/${encodeURIComponent(id)}/members`,
      { ctx },
    ).then((r) => pick(r, (p) => p.members));
  },

  /** GET /api/engagements/:id/archive — removed lanes and cards, restorable. */
  archive(id: string, ctx?: RequestContext) {
    return request<{ archive: ArchivedBoard }>(
      `/api/engagements/${encodeURIComponent(id)}/archive`,
      { ctx },
    ).then((r) => pick(r, (p) => p.archive));
  },

  /**
   * DELETE /api/cards/:id?engagementId= — remove a deliverable.
   *
   * The engagement id rides in the query string because a DELETE with a body is
   * legal but inconsistently forwarded by proxies and `fetch` implementations.
   * The route says so too; this is the caller's half of that decision.
   *
   * Named `removeCard` and not `deleteCard`, matching the domain: what comes
   * back may be `archived`, and a method whose name promised deletion would be
   * lying about half its outcomes.
   */
  removeCard(id: string, engagementId: string, ctx?: RequestContext) {
    return request<{ removal: CardRemoval }>(
      `/api/cards/${encodeURIComponent(id)}?engagementId=${encodeURIComponent(engagementId)}`,
      { method: 'DELETE', ctx },
    ).then((r) => pick(r, (p) => p.removal));
  },

  /**
   * POST /api/cards/:id/restore — put an archived deliverable back.
   *
   * `laneIsArchived` is the field that must not be dropped on the floor. A card
   * can come back into a lane that is itself still archived, in which case the
   * board *still* will not show it — and a restore that reported success while
   * the card stayed invisible is precisely the bug that makes people stop
   * trusting an undo. The domain reports it rather than silently un-archiving
   * the whole column, because that would be a larger action than the one asked
   * for, so the surface has to say it instead.
   */
  restoreCard(id: string, body: { engagementId: string }, ctx?: RequestContext) {
    return request<{ restored: { cardId: string; laneIsArchived: boolean } }>(
      `/api/cards/${encodeURIComponent(id)}/restore`,
      { method: 'POST', body, ctx },
    ).then((r) => pick(r, (p) => p.restored));
  },

  /** DELETE /api/lanes/:id?engagementId= — remove a lane and hide what stands in it. */
  removeLane(id: string, engagementId: string, ctx?: RequestContext) {
    return request<{ removal: LaneRemoval }>(
      `/api/lanes/${encodeURIComponent(id)}?engagementId=${encodeURIComponent(engagementId)}`,
      { method: 'DELETE', ctx },
    ).then((r) => pick(r, (p) => p.removal));
  },

  /** POST /api/lanes/:id/restore — put a lane and its cards back. */
  restoreLane(id: string, body: { engagementId: string }, ctx?: RequestContext) {
    return request<{ restored: { laneId: string; cardsRestored: number } }>(
      `/api/lanes/${encodeURIComponent(id)}/restore`,
      { method: 'POST', body, ctx },
    ).then((r) => pick(r, (p) => p.restored));
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

  /**
   * POST /api/engagements/:id/invite — add a **client contact** to one
   * engagement and send them the link.
   *
   * The reviewer half of the pair. This creates no account and no password;
   * the contact is scoped to this engagement and to no other (INV-6), and
   * their verified address is what an approval is recorded against. See
   * `inviteTeammate` above for the other one, and do not reach for it here.
   */
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

  /** POST /api/engagements/:id/export — queues a zip and returns its job id. */
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
   * GET /api/comments?cardId= — the card's discussion, internal rows included.
   *
   * A card id and nothing else: the route resolves the engagement from the card
   * against the caller's org, so there is no engagement id in the query string
   * that could disagree with it, and a card on another agency's board is a 404.
   *
   * Order is contractual and the renderer relies on it: roots oldest-first,
   * each root immediately followed by its replies, oldest-first.
   */
  comments(cardId: string, ctx?: RequestContext) {
    return request<{ comments: AgencyComment[]; cardId: string }>(
      `/api/comments?cardId=${encodeURIComponent(cardId)}`,
      { ctx },
    ).then((r) => pick(r, (p) => p.comments));
  },

  /**
   * POST /api/comments — add to a card's discussion, backstage.
   *
   * `engagementId` is sent explicitly and the client's twin sends none. That
   * asymmetry is amendment A5 and INV-6, not an inconsistency: an agency
   * mutation names its subject so the authorisation check has one before a row
   * is read, and the route then verifies it against the card's own engagement
   * rather than trusting it. A client contact has exactly one engagement and it
   * comes from the session.
   *
   * `internal` is the agency-only flag, and the client route has no field
   * through which to reach it. A reply under an internal root is forced
   * internal by the domain whatever is passed here.
   *
   * The response is a full `AgencyComment`, `authorName` included — resolved in
   * the same transaction that wrote the row, so an optimistic render and the
   * next read agree.
   */
  createComment(
    body: {
      engagementId: string;
      cardId: string;
      body: string;
      parentId?: string | null;
      internal?: boolean;
    },
    ctx?: RequestContext,
  ) {
    return request<{ comment: AgencyComment }>('/api/comments', {
      method: 'POST',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.comment));
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

  /** GET /api/templates — the org's dockets, newest first. */
  templates(ctx?: RequestContext) {
    return request<{ templates: TemplateSummary[] }>('/api/templates', { ctx }).then((r) =>
      pick(r, (p) => p.templates),
    );
  },

  /** GET /api/templates/:id — the definition behind a summary, for the preview. */
  template(id: string, ctx?: RequestContext) {
    return request<TemplateDetail>(`/api/templates/${encodeURIComponent(id)}`, { ctx });
  },

  /**
   * POST /api/templates — capture a live engagement as a template.
   *
   * The body names the *engagement*, never a definition the browser assembled.
   * A template is a description of a graph, and the rows that graph is read
   * from live on the server: a client-supplied definition would let the browser
   * decide what a lane's visibility is, which is the single most consequential
   * value in the product (INV-1) and not one a form should be able to state.
   * The capture preview on the settings page renders the same board read the
   * route derives from, so what is previewed is what is saved.
   */
  createTemplate(body: { name: string; fromEngagementId: string }, ctx?: RequestContext) {
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
