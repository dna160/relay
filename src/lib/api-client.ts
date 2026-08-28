/**
 * The API seam, in one import for anything that legitimately spans both
 * surfaces — a script, a test, a tool.
 *
 * **Nothing in `src/app` or `src/components` should import this file.** Reach
 * for the half you belong to instead:
 *
 * | Importer | Module |
 * |---|---|
 * | `src/app/(agency)/**`, `src/components/agency/**` | `@/lib/api-client.agency` |
 * | `src/app/(client)/**`, `src/components/client/**` | `@/lib/api-client.client` |
 * | `src/app/invite/**`, `src/components/invite/**` | `@/lib/api-client.invite` |
 * | anything surface-agnostic (`useAction`, an `ErrorPanel`'s prop type) | `@/lib/api-client.core` |
 *
 * The reason is a bundle, not a filing system. A barrel that re-exports both
 * halves is a single import away from putting the agency's whole route map —
 * `/api/lanes`, `/api/cards/:id/transition`, `/api/engagements/:id/settings` —
 * into the JavaScript a client contact downloads over their phone. Phase 4's
 * exit condition is that this cannot happen, and the way to make it structural
 * rather than remembered is for the client tree to have no path to
 * `api-client.agency.ts` at all.
 *
 * Kept because the split is newer than the callers, and a barrel that says why
 * it should not be used is more useful than a broken import.
 */

export * from './api-client.core';
export * from './api-client.agency';
export * from './api-client.client';
export * from './api-client.invite';
