/**
 * The client half of the API seam.
 *
 * **Not one function here takes an engagement id, and none can be given one.**
 * The session names the engagement and cannot be widened (INV-6); a client
 * route that accepted one would be a bug, and so would a helper that made it
 * easy to send. That is a property of the signatures below, not a convention.
 *
 * `requestMagicLink` and `verifyMagicLink` take the engagement *token* from the
 * URL because at that point there is no session. That token is the invite, not
 * a selector over engagements.
 *
 * This module is the only API surface `src/app/(client)` and
 * `src/components/client` may import. It imports nothing from
 * `api-client.agency.ts` and must never do so.
 */

import type {
  ClientCard,
  ClientCardState,
  ClientLane,
  Decision,
  DecisionRequest,
  EngagementStatus,
} from '@/lib/types';
import { pick, request, type RequestContext } from './api-client.core';

/* -------------------------------------------------- shapes the contract omits */

/**
 * `GET /api/client/board` — the client's header.
 *
 * It cannot be `EngagementSummary`: that carries `possession`, which is
 * internal-only in v1 (PRD §9), and it carries no id at all, which is correct —
 * the client's engagement comes from the session and there is nothing for them
 * to select.
 *
 */
export interface ClientEngagementHeader {
  title: string;
  agencyName: string;
  brandPrimary: string | null;
  brandLogoKey: string | null;
  daysToPurge: number | null;
  contactEmail: string;
  contactName: string | null;
  /**
   * The engagement's lifecycle status, so the surface can render read-only
   * *before* the contact commits to a decision rather than discovering a 423 on
   * submit. Writing a revision note into a textarea and being told afterwards
   * that the workspace froze last Tuesday is the worst moment to learn it.
   *
   * Not an INV-1 concern: this is the contact's own engagement, named by their
   * own session, and `archived` is precisely the fact they most need.
   */
  status: EngagementStatus;
}

export interface ClientBoard {
  engagement: ClientEngagementHeader;
  lanes: ClientLane[];
}

/**
 * Card-level discussion, as the contact reads it (ADR-011, PRD §7:
 * "Discussion attaches to cards and versions").
 *
 * No longer assumed. `GET /api/client/comments?cardId=` shipped and this shape
 * is `ClientComment` in `src/db/queries/comments.ts` verbatim — the round-2
 * placeholder guessed `authorName?: string` and had no `side` at all.
 *
 * **No identifiers of people.** Not a user id, not a contact id, not an email:
 * a display name and a side, which is what a thread needs to be readable and
 * nothing that can be correlated (INV-1). `id` and `parentId` are ids of rows
 * the contact is looking at, and a reply has to be able to name its root.
 *
 * A comment is about *the card*. A `ClientRevisionNote` is bound to one
 * immutable version. Both are intended and they do different jobs — which is
 * why they are two shapes here and two tables underneath.
 */
export interface ClientComment {
  id: string;
  cardId: string;
  /** Null for a root. One level only: the domain refuses a reply to a reply. */
  parentId: string | null;
  body: string;
  side: 'agency' | 'client';
  authorName: string | null;
  createdAt: string;
}

/**
 * What `POST /api/client/comments` returns: the same shape minus `authorName`,
 * because the author is the caller. Typed as its own thing rather than made
 * optional on `ClientComment`, so a renderer cannot be handed a posted row
 * where it expected a read one.
 */
export type PostedClientComment = Omit<ClientComment, 'authorName'>;

/**
 * A revision note, threaded to the version it was written against and never
 * floating forward (PRD §5.3). `versionNo` is that binding — it is what lets a
 * thread say "on v4" and mean it.
 *
 * No identifiers. Not a user id, not a contact id, not an email: a note carries
 * a display name and a side, which is what a thread needs to be readable, and
 * nothing that can be correlated (INV-1). The client read also filters
 * `internal = false` in its predicate, so an agency working note is never
 * selected rather than merely omitted.
 */
export interface ClientRevisionNote {
  id: string;
  versionId: string;
  versionNo: number;
  body: string;
  side: 'agency' | 'client';
  authorName: string | null;
  createdAt: string;
}

/** `POST /api/client/versions/:id/decision`. */
export interface DecisionOutcome {
  decision: { id: string; versionId: string; decision: Decision; decidedAt: string };
  card: { id: string; state: ClientCardState; roundsUsed: number };
}

/* ---------------------------------------------------------------- client api */

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
   * GET /api/client/comments?cardId=
   *
   * `cardId` is not an engagement selector — the card is resolved through
   * `clientScope()` and a card outside the session's engagement is a 404, not a
   * 403 (INV-1).
   *
   * The order is part of the contract and the renderer depends on it: roots
   * oldest-first, each root immediately followed by its own replies,
   * oldest-first. Oldest-first because a thread on a deliverable is a record,
   * not a feed.
   */
  comments(cardId: string, ctx?: RequestContext) {
    return request<{ comments: ClientComment[]; cardId: string }>(
      `/api/client/comments?cardId=${encodeURIComponent(cardId)}`,
      { ctx },
    ).then((r) => pick(r, (p) => p.comments));
  },

  /**
   * POST /api/client/comments
   *
   * `parentId` is the one level of reply the schema allows. Sending the id of a
   * comment that is itself a reply is refused by the domain, not by this
   * signature — a type cannot know which rows are roots.
   *
   * No `internal` key, and nothing to strip: a client-authored comment cannot
   * be marked internal at all.
   */
  createComment(
    body: { cardId: string; body: string; parentId?: string | null },
    ctx?: RequestContext,
  ) {
    return request<{ comment: PostedClientComment }>('/api/client/comments', {
      method: 'POST',
      body,
      ctx,
    }).then((r) => pick(r, (p) => p.comment));
  },

  /**
   * GET /api/client/versions/:id/notes — the notes written against one version.
   *
   * Sibling of the decision route, and scoped the same way: the version id is
   * resolved through `clientScope()`, so a version on a private lane is a 404.
   */
  revisionNotes(versionId: string, ctx?: RequestContext) {
    return request<{ notes: ClientRevisionNote[] }>(
      `/api/client/versions/${encodeURIComponent(versionId)}/notes`,
      { ctx },
    ).then((r) => pick(r, (p) => p.notes));
  },

  /**
   * POST /api/client/versions/:id/notes — add a note against one version.
   *
   * No `internal` key, and there is nothing to remove: the route's schema is
   * `.strict()` and the domain cannot mark a client-authored note internal at
   * all. No engagement id either, for the usual reason (INV-6).
   */
  addRevisionNote(versionId: string, body: { body: string }, ctx?: RequestContext) {
    return request<{ note: Omit<ClientRevisionNote, 'versionNo'> }>(
      `/api/client/versions/${encodeURIComponent(versionId)}/notes`,
      { method: 'POST', body, ctx },
    ).then((r) => pick(r, (p) => p.note));
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

/* -------------------------------------------------------------------- events */

/**
 * `GET /api/client/events` (amendment A1). **No parameter, by construction.**
 *
 * The frozen contract had one stream taking the engagement from a query string.
 * For a client session that is precisely what INV-6 forbids, so the client
 * stream was split off and takes the engagement from the session. This is a
 * constant rather than a function because there is nothing to pass it.
 */
export const CLIENT_EVENT_STREAM_URL = '/api/client/events';
