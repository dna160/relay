/**
 * The boundary between thrown domain errors and HTTP.
 *
 * Route handlers do three things (INV-9): parse input, call a domain function,
 * serialise output. This file is the serialise-the-failure half, so that no
 * route has to remember that `NOT_VISIBLE` is 404 and never 403 — telling a
 * client that a lane exists but is hidden leaks the thing INV-1 protects.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DomainError } from '@/domain/errors';
import { InvalidTransitionError } from '@/domain/card/state-machine';
import { ERROR_CODES, type ApiError, type ErrorCode } from '@/lib/types';

export function apiError(code: ErrorCode, message: string, details?: unknown): NextResponse {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return NextResponse.json(body, { status: ERROR_CODES[code] });
}

/**
 * The single catch. Anything that is not a recognised domain failure is a bug,
 * and a bug is a 500 with no detail — an unexpected error message is the one
 * place a table name or a query fragment escapes into a client's browser.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return apiError(error.code, error.message, error.details);
  }
  if (error instanceof InvalidTransitionError) {
    return apiError('INVALID_TRANSITION', error.message);
  }
  if (error instanceof ZodError) {
    return apiError('VALIDATION_FAILED', 'Request body failed validation', error.flatten());
  }
  console.error('[api] unhandled error', error);
  /**
   * `ERROR_CODES` in src/lib/types.ts has no entry for an unhandled failure, so
   * this one shape is not an `ApiError`. Raised to the architecture layer
   * rather than widened here — the contract file wins.
   */
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Something went wrong' } },
    { status: 500 },
  );
}
