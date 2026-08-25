/**
 * How an object's key is built, and how one that comes back is checked.
 *
 * This is domain knowledge, not infrastructure: the shape
 * `engagements/{engagementId}/…` is what makes purge able to enumerate an
 * engagement's bytes by prefix (INV-7) and what makes one engagement's objects
 * unreachable from another's rows (INV-6). `src/lib/storage.ts` signs URLs for
 * the keys this file describes; it does not get to decide what they look like.
 *
 * It lives here rather than next to the S3 client for a mechanical reason too:
 * INV-9 forbids `src/domain/**` from importing `@/lib/storage`, and the
 * *checking* half has to be callable from `recordVersion()` and
 * `addReferenceFile()` — the two functions that receive a key from a request
 * body and write it to a row.
 */

import { uuidv7 } from 'uuidv7';

/** Strips anything that would let a filename escape its prefix. */
export function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\-]+/g, '_').slice(0, 180);
  return cleaned.length > 0 ? cleaned : 'file';
}

/** Everything belonging to one engagement sits under this. Purge lists it. */
export function engagementPrefix(engagementId: string): string {
  return `engagements/${engagementId}/`;
}

export function versionKeyPrefix(engagementId: string, cardId: string): string {
  return `${engagementPrefix(engagementId)}cards/${cardId}/`;
}

export function shelfKeyPrefix(engagementId: string): string {
  return `${engagementPrefix(engagementId)}shelf/`;
}

export function versionKey(engagementId: string, cardId: string, filename: string): string {
  return `${versionKeyPrefix(engagementId, cardId)}${uuidv7()}/${safeFilename(filename)}`;
}

export function shelfKey(engagementId: string, filename: string): string {
  return `${shelfKeyPrefix(engagementId)}${uuidv7()}/${safeFilename(filename)}`;
}

/* ------------------------------------------------- keys, on the way back in */

/**
 * `POST /api/versions` and `POST /api/reference-files` are called *after* the
 * browser has uploaded, and they carry the storage key in their request body.
 * The key the presign route hands out is safe by construction; the key that
 * comes back is a different thing, and until it is checked it is an arbitrary
 * caller-chosen string that a row will point at forever.
 *
 * Two things go wrong when it is trusted, and neither needs a second account —
 * one agency member with two of their own engagements is enough:
 *
 *   - **Purge stops being true.** Purge enumerates by the engagement prefix. A
 *     version row in engagement B whose key sits under engagement A's prefix
 *     keeps its bytes when B is purged, and loses them early when A is. The
 *     certificate INV-7 leaves behind then claims a destruction that did not
 *     happen, which is the one thing this product cannot be wrong about.
 *   - **A client is served another engagement's bytes.**
 *     `GET /api/client/download/:versionId` resolves the version through
 *     `clientScope()` and then signs a GET for whatever `storage_key` says.
 *     Visibility is checked on the row; the key is what names the object.
 */
function withinPrefix(key: string, prefix: string): boolean {
  /**
   * `..`, a leading slash and empty segments are rejected before the prefix
   * test. A key that satisfies `startsWith()` but normalises out of its own
   * prefix at the storage layer — `engagements/A/cards/C/../../B/x` — would
   * otherwise pass a check that only compares leading characters.
   */
  if (key.startsWith('/') || key.includes('//')) return false;
  if (key.split('/').includes('..')) return false;
  return key.startsWith(prefix) && key.length > prefix.length;
}

export function isVersionKeyFor(engagementId: string, cardId: string, key: string): boolean {
  return withinPrefix(key, versionKeyPrefix(engagementId, cardId));
}

export function isShelfKeyFor(engagementId: string, key: string): boolean {
  return withinPrefix(key, shelfKeyPrefix(engagementId));
}
