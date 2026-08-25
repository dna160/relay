/**
 * Types for the bundle-purity audit's exported detector.
 *
 * The script is `.mjs` because CI runs it with bare `node` and no loader, the
 * same as its three neighbours in this directory. `allowJs` is deliberately
 * `false` in `tsconfig.json`, so this declaration is what lets
 * `tests/unit/chunk-purity-detector.spec.ts` import the detector under
 * `strict` with no `any` — rather than turning `allowJs` on, which would pull
 * every script here into the typecheck for the sake of one import.
 *
 * Only the pure surface is declared. The audit's browser half is behind an
 * entry-point guard and is not importable by design.
 */

/** One downloaded chunk: the filename the audit reports, and its bytes. */
export interface ChunkBody {
  file: string;
  body: string;
}

/** The vocabulary a detector run looks for. */
export interface DetectVocabulary {
  markers: readonly string[];
  routes: readonly RegExp[];
}

/** Agency route literals, re-anchored from `tests/e2e/routes.ts` for a bundle. */
export declare const AGENCY_ROUTE_PATTERNS: readonly RegExp[];

/** Strings that exist only in agency components, routes, or vocabulary. */
export declare const AGENCY_MARKERS: readonly string[];

/** Strings unavoidably present in the client bundle; an empty read is not a pass. */
export declare const POSITIVE_PROBE: readonly string[];

/**
 * Every offending chunk, as a human-readable line naming the file and the hit.
 * Empty means clean — which is why the caller must also check that the positive
 * probe found something before treating it as evidence.
 */
export declare function detect(
  bodies: readonly ChunkBody[],
  vocabulary: DetectVocabulary,
): string[];
