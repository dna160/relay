/**
 * Where a sign-in is allowed to land.
 *
 * Auth.js appends `?callbackUrl=` when it bounces somebody here mid-navigation,
 * and `/invite/[token]` sends its readers here with the invitation as the
 * destination. Honouring it is the difference between landing back on the board
 * you were reading — or the invitation you were accepting — and landing on a
 * portfolio you then have to navigate out of again.
 *
 * It is also an open-redirect parameter that arrives through the browser, so it
 * is validated rather than trusted: a single leading slash and nothing else.
 * `//evil.example` is protocol-relative and would leave the origin, `/\evil` is
 * treated as protocol-relative by some browsers, and anything carrying a scheme
 * is not ours. A value that fails any of these is not an error worth a message
 * — it is discarded and the default is used.
 *
 * The default is `/onboarding` and not `/portfolio`, because a first-ever
 * sign-in has proved an address and belongs to no organisation yet (ADR-013).
 * `/onboarding` already tells the three states apart and forwards to
 * `/portfolio` when there is nothing left to do, so it is the correct
 * destination for the first sign-in and the thousandth.
 *
 * Its own module rather than a helper inside the page, because two pages need
 * it now — `/signin` and `/signin/confirm` — and a second copy is a second
 * place for the `//` case to be forgotten.
 */

export const DEFAULT_CALLBACK = '/onboarding';

export function safeCallback(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return DEFAULT_CALLBACK;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_CALLBACK;
  return raw;
}
