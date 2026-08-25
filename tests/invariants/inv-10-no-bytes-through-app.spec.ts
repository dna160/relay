/**
 * INV-10 — File bytes never traverse the app server. Uploads and downloads are
 * presigned direct to object storage.
 *
 * Structural, live from Phase 0. Keeps the app stateless and the bill
 * predictable (ADR-009). A single innocent `formData()` in a route is how a
 * 5 GB upload starts flowing through a container with 512 MB of memory.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { sourceFiles, statementsMatching } from './_source';

/**
 * Reading a request body as bytes, in any of the shapes Next offers.
 *
 * The receiver is deliberately *not* pinned to `req`/`request`. It used to be,
 * and that made the invariant a rule about a variable name: rename the handler
 * parameter to `r` and a 5 GB upload flows through a 512 MB container with the
 * guard still green. What matters is the call, not what the caller called it.
 */
export const BYTE_INTAKE = [
  /\.\s*formData\s*\(/,
  /\.\s*arrayBuffer\s*\(/,
  /\.\s*blob\s*\(\s*\)/,
  /\bnew\s+Response\s*\(\s*(file|stream|body|buffer)\b/i,
];

/** Streaming an object out of storage through the app instead of redirecting. */
export const BYTE_EGRESS = [/GetObjectCommand[\s\S]{0,200}\.\s*Body/, /\.\s*Body\s*\.\s*(pipe|transformToByteArray)/];

describe('INV-10 no file bytes traverse the app server', () => {
  it('no route reads an uploaded body as bytes', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('app')) {
      for (const re of BYTE_INTAKE) {
        for (const stmt of statementsMatching(file, re)) {
          offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
        }
      }
    }
    expect(offenders, 'a route accepted file bytes; presign instead').toEqual([]);
  });

  /**
   * The egress scan covers the whole server, not just `src/app/`.
   *
   * INV-10 says bytes never traverse *the app server*. Scanning only the route
   * layer left the obvious way around it wide open: put the stream in
   * `src/lib/storage.ts` and have the route call it. The bytes still land in
   * the container; only the guard stops noticing. `src/lib/storage.ts` is the
   * file that legitimately holds `GetObjectCommand`, and it is checked below
   * rather than excused — it may build the command for a presign, it may not
   * read a `Body`.
   */
  it('nothing on the server streams object storage bytes back to a caller', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('workers')]) {
      for (const re of BYTE_EGRESS) {
        if (re.test(file.text)) offenders.push(file.path);
      }
    }
    expect(offenders, 'the server proxied a download; 302 to a presigned GET instead').toEqual([]);
  });

  it('the storage helper presigns rather than fetching', () => {
    const storage = sourceFiles('lib').find((f) => /storage\.tsx?$/.test(f.path));
    if (!storage) return;
    expect(
      storage.text,
      'src/lib/storage.ts must not send a GetObjectCommand; it signs one',
    ).not.toMatch(/(client|s3)\s*\.\s*send\s*\(\s*new\s+GetObjectCommand/);
    expect(storage.text, 'a download must be signed, not performed').toMatch(/getSignedUrl/);
  });

  it('the download route redirects rather than returning a body', () => {
    const dl = sourceFiles('app').find((f) => /client\/download\/\[versionId\]\/route\.tsx?$/.test(f.path));
    if (!dl) return; // Phase 4 creates it.
    expect(dl.text, 'download must 302 to a presigned GET').toMatch(/redirect\s*\(|status:\s*302/);
  });
});
