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
import { linesMatching, sourceFiles } from './_source';

/** Reading a request body as bytes, in any of the shapes Next offers. */
const BYTE_INTAKE = [
  /\breq(uest)?\s*\.\s*formData\s*\(/,
  /\breq(uest)?\s*\.\s*arrayBuffer\s*\(/,
  /\breq(uest)?\s*\.\s*blob\s*\(/,
  /\bnew\s+Response\s*\(\s*(file|stream|body|buffer)\b/i,
];

/** Streaming an object out of storage through the app instead of redirecting. */
const BYTE_EGRESS = [/GetObjectCommand[\s\S]{0,200}\.\s*Body/, /\.\s*Body\s*\.\s*(pipe|transformToByteArray)/];

describe('INV-10 no file bytes traverse the app server', () => {
  it('no route reads an uploaded body as bytes', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('app')) {
      for (const re of BYTE_INTAKE) {
        for (const line of linesMatching(file, re)) offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'a route accepted file bytes; presign instead').toEqual([]);
  });

  it('no route streams object storage bytes back to the caller', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('app')) {
      for (const re of BYTE_EGRESS) {
        if (re.test(file.text)) offenders.push(file.path);
      }
    }
    expect(offenders, 'a route proxied a download; 302 to a presigned GET instead').toEqual([]);
  });

  it('the download route redirects rather than returning a body', () => {
    const dl = sourceFiles('app').find((f) => /client\/download\/\[versionId\]\/route\.tsx?$/.test(f.path));
    if (!dl) return; // Phase 4 creates it.
    expect(dl.text, 'download must 302 to a presigned GET').toMatch(/redirect\s*\(|status:\s*302/);
  });
});
