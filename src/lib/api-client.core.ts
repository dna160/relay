/**
 * The transport half of the API seam. Route strings are deliberately absent.
 *
 * `api-client.agency.ts` and `api-client.client.ts` both import from here, and
 * `api-client.ts` re-exports all three. That shape is not a filing preference —
 * it is what makes Phase 4's exit condition ("the client bundle contains no
 * agency route code") a property of the module graph rather than a promise.
 *
 * The obvious arrangement — transport in `api-client.ts`, the two surfaces
 * importing it — is a cycle: `api-client.ts` re-exports `.agency`, so a client
 * component reaching for `request()` would drag `agencyApi`'s route strings
 * into its chunk through the back door. A third leaf module is what breaks it.
 * Nothing here knows the difference between the two surfaces, so nothing here
 * can leak one into the other.
 *
 * Two rules carried over from the single file this was split out of:
 *
 * 1. **Shapes come from `src/lib/types.ts`.** Nothing here or in either half
 *    redeclares a contract type. The interfaces the two halves define are for
 *    endpoints the contract names but does not yet type; each is marked.
 * 2. **Nothing throws.** A page that renders a board must not blow up because
 *    the API returned 423. Every call returns a discriminated result and the
 *    surfaces render a designed panel for each documented code. Failure copy is
 *    not here — each surface owns the words it uses for a given code.
 */

import type { ApiError, ErrorCode } from '@/lib/types';

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

export function baseUrl(ctx?: RequestContext): string {
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

export async function request<T>(
  path: string,
  init: RequestInitLite = {},
): Promise<ApiResult<T>> {
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

/* -------------------------------------------------------------- 410 details */

/**
 * What a 410 `ENGAGEMENT_PURGED` points at.
 *
 * API-CONTRACT.md says the 410 "points at the certificate", and the certificate
 * is the compliance artifact an agency forwards to its client's legal team —
 * so the page that renders the 410 has to be able to state what was destroyed,
 * when, and that the certificate exists. The columns are DATA-MODEL.md's
 * `purge_certificates`.
 *
 * **Every field is optional and nothing here is invented.** The domain's
 * `engagementPurged()` currently carries no `details` at all, and a receipt
 * that filled in a plausible object count would be a fabricated compliance
 * record — the single worst thing this page could do. So the parser reads what
 * is actually present, and the surfaces render only the lines they were given.
 */
export interface PurgeCertificateRef {
  certificateId?: string;
  purgedAt?: string;
  objectCount?: number;
  cardCount?: number;
  approvalCount?: number;
  totalBytes?: number;
  manifestSha256?: string;
  /** Where the signed manifest can be fetched. Followed, never parsed (INV-10). */
  certificateUrl?: string;
}

function str(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Reads a certificate reference out of an `ApiFailure`'s `details`, tolerating
 * every shape it is not.
 *
 * `details` is typed `unknown` in the contract and is written by a worker this
 * module has never seen run. A receipt page that threw on an unexpected shape
 * would replace the last thing a client ever sees of the workspace with a stack
 * trace, so this returns `null` rather than throwing and the surfaces degrade to
 * the facts they can state without it.
 */
export function purgeCertificateFrom(details: unknown): PurgeCertificateRef | null {
  if (typeof details !== 'object' || details === null) return null;
  const source = details as Record<string, unknown>;
  const nested = source['certificate'];
  const row =
    typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : source;

  const ref: PurgeCertificateRef = {
    certificateId: str(row, 'certificateId') ?? str(row, 'id'),
    purgedAt: str(row, 'purgedAt'),
    objectCount: num(row, 'objectCount'),
    cardCount: num(row, 'cardCount'),
    approvalCount: num(row, 'approvalCount'),
    totalBytes: num(row, 'totalBytes'),
    manifestSha256: str(row, 'manifestSha256'),
    certificateUrl: str(row, 'certificateUrl'),
  };

  return Object.values(ref).some((v) => v !== undefined) ? ref : null;
}

/* ----------------------------------------------------------------- envelopes */

/**
 * Every shipped route wraps its payload in a named key — `{ card }`,
 * `{ lane }`, `{ engagements }` (amendment A3). The unwrapping happens here and
 * the pages never see it. This is the whole reason the seam exists.
 */
export function pick<E, T>(result: ApiResult<E>, take: (payload: E) => T): ApiResult<T> {
  return result.ok ? { ok: true, status: result.status, data: take(result.data) } : result;
}
