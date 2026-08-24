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

/* ----------------------------------------------------------------- envelopes */

/**
 * Every shipped route wraps its payload in a named key — `{ card }`,
 * `{ lane }`, `{ engagements }` (amendment A3). The unwrapping happens here and
 * the pages never see it. This is the whole reason the seam exists.
 */
export function pick<E, T>(result: ApiResult<E>, take: (payload: E) => T): ApiResult<T> {
  return result.ok ? { ok: true, status: result.status, data: take(result.data) } : result;
}
