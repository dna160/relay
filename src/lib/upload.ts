'use client';

/**
 * The upload engine. It runs in the browser and it is the *only* thing in Relay
 * that touches a byte of user content.
 *
 * INV-10 / ADR-009 / ADR-015: file bytes never traverse the app server. The
 * sequence is presign → PUT direct to object storage → sha256 computed here →
 * `POST /api/versions` with metadata and the hash. Multipart is the browser's
 * job, which means the part loop, the ETag list, the complete call and the
 * abort call all live here rather than in a route. An app restart in the middle
 * of a two-hour upload is then a non-event, because the app was never holding
 * anything.
 *
 * Three consequences worth stating, because each one is a support ticket if it
 * is a surprise:
 *
 * 1. **The hash is computed over the bytes we send, before we send them.** The
 *    server cannot verify it — it never sees the content — so the uploader is
 *    the authority. That is the trade ADR-009 makes, and it is why the hash is
 *    computed from the same `File` object the PUT reads from, in one pass each,
 *    rather than from anything the UI passes alongside it.
 * 2. **A failed multipart upload is aborted, not abandoned.** An orphaned
 *    multipart upload holds its parts in the bucket and bills for them, and
 *    nothing on the app side knows it exists. Every exit from the part loop
 *    goes through `abort`.
 * 3. **`ETag` must be exposed by the bucket's CORS policy.** Multipart complete
 *    needs the per-part ETags and a browser cannot read a response header that
 *    CORS has not exposed. Without `ExposeHeaders: [ETag]` on the bucket, every
 *    upload over 100 MB fails at the complete step with a clear message from
 *    `MISSING_ETAG` below. This is infrastructure, not code.
 *
 * `XMLHttpRequest` rather than `fetch`, for one reason: `fetch` reports no
 * upload progress. A 4 GB master with no progress bar is indistinguishable from
 * a hung tab, and this is a product where the upload happens at 3am against a
 * delivery deadline.
 */

import { hashBlob } from '@/lib/sha256';

/**
 * The 5 GB ceiling, mirrored from `src/lib/storage.ts`.
 *
 * Restated rather than imported, because `storage.ts` imports the AWS SDK and
 * a client component that reached for the constant would pull the whole client
 * into the bundle a browser downloads. The server is still the authority — the
 * presign route rejects anything larger with `VALIDATION_FAILED` — and this
 * copy exists only so a person who picked the wrong file is told before they
 * wait for a round trip. If the ceiling ever moves, it moves in `storage.ts`
 * first and here second, and the worst a stale copy can do is ask the server a
 * question it already knows the answer to.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

export type UploadPhase =
  | 'queued'
  | 'hashing'
  | 'uploading'
  | 'recording'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface UploadProgress {
  phase: UploadPhase;
  /** Bytes hashed so far. Reaches `totalBytes` before `uploading` begins. */
  hashedBytes: number;
  /** Bytes accepted by object storage so far. */
  sentBytes: number;
  totalBytes: number;
  /** Multipart only. `null` for a single PUT — there is one part and it is the file. */
  partsDone: number | null;
  partsTotal: number | null;
  /** Set once hashing completes, so the UI can show the record before it exists. */
  sha256: string | null;
  error: UploadError | null;
}

export type UploadErrorCode =
  | 'PRESIGN_FAILED'
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'HASH_FAILED'
  | 'TRANSFER_FAILED'
  | 'MISSING_ETAG'
  | 'COMPLETE_FAILED'
  | 'RECORD_FAILED'
  | 'CANCELLED';

export interface UploadError {
  code: UploadErrorCode;
  message: string;
  /** True when trying the same file again is a reasonable next act. */
  retryable: boolean;
}

/** What the caller gets back. `storageKey` is what the record call needs. */
export interface CompletedUpload {
  storageKey: string;
  sha256: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

/** Named so a caller can read the error without importing the union's literals. */
function fail(code: UploadErrorCode, message: string, retryable = true): UploadError {
  return { code, message, retryable };
}

/* ---------------------------------------------------------------- transport */

interface PutResult {
  etag: string | null;
}

/**
 * One PUT, with upload progress and cancellation.
 *
 * `onSent` reports bytes for *this* request; the caller adds the offset. S3
 * returns nothing useful in the body, so only the ETag is read back.
 */
function put(
  url: string,
  body: Blob,
  options: {
    contentType?: string;
    signal?: AbortSignal;
    onSent?: (bytes: number) => void;
  } = {},
): Promise<PutResult> {
  return new Promise<PutResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // Only set it when the signature covers it. `PutObjectCommand` is signed
    // with `ContentType`, so a single PUT must send exactly that value or the
    // signature does not match; `UploadPartCommand` is not, so a part must not
    // send one at all.
    if (options.contentType) xhr.setRequestHeader('Content-Type', options.contentType);

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener('abort', onAbort);

    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (e) => options.onSent?.(e.loaded);
    xhr.onerror = () => {
      cleanup();
      reject(fail('TRANSFER_FAILED', 'The connection to storage dropped.'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(fail('CANCELLED', 'Cancelled.', false));
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') });
        return;
      }
      reject(
        fail(
          'TRANSFER_FAILED',
          xhr.status === 403
            ? 'The upload link expired before the file finished. Try again.'
            : `Storage refused the upload (${xhr.status}).`,
        ),
      );
    };
    xhr.send(body);
  });
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function completeMultipart(
  url: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const body =
    '<CompleteMultipartUpload>' +
    parts
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`,
      )
      .join('') +
    '</CompleteMultipartUpload>';

  const response = await fetch(url, { method: 'POST', body });
  if (!response.ok) {
    throw fail('COMPLETE_FAILED', `Storage could not assemble the parts (${response.status}).`);
  }
  /**
   * S3 can return 200 with an error document — the connection is held open
   * while the parts are stitched, so the status line is sent before the outcome
   * is known. Reading the body is the only way to tell.
   */
  const text = await response.text();
  if (text.includes('<Error>')) {
    throw fail('COMPLETE_FAILED', 'Storage could not assemble the parts.');
  }
}

/** Best-effort. A failed abort is not worth reporting over the failure that
 *  caused it, but leaving the parts behind silently bills someone. */
async function abortMultipart(url: string): Promise<void> {
  try {
    await fetch(url, { method: 'DELETE', keepalive: true });
  } catch {
    // The upload already failed; this is cleanup, not the story.
  }
}

/* ------------------------------------------------------------------- engine */

/**
 * What the engine needs from the API seam. Passed in rather than imported so
 * that this module carries no route strings and the shelf and the card version
 * — which record to two different endpoints — run the identical byte path.
 */
export interface PresignFn {
  (input: { filename: string; mime: string; size: number }): Promise<
    | {
        ok: true;
        presign:
          | { mode: 'single'; key: string; url: string }
          | {
              mode: 'multipart';
              key: string;
              partSize: number;
              parts: { partNumber: number; url: string }[];
              completeUrl: string;
              abortUrl: string;
            };
        maxBytes: number;
      }
    | { ok: false; message: string }
  >;
}

const PART_ATTEMPTS = 3;

/**
 * Presign, hash, transfer, and hand back what `POST /api/versions` or
 * `POST /api/reference-files` needs. Recording is the caller's job — the two
 * endpoints differ and the byte path does not.
 *
 * Hashing runs before the transfer rather than beside it. Two passes over the
 * file is the cost; the benefit is that a hash failure costs no bandwidth, and
 * that the phases the UI reports are honest rather than interleaved.
 */
export async function uploadFile(
  file: File,
  presign: PresignFn,
  options: {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<CompletedUpload> {
  const { onProgress, signal } = options;

  const state: UploadProgress = {
    phase: 'queued',
    hashedBytes: 0,
    sentBytes: 0,
    totalBytes: file.size,
    partsDone: null,
    partsTotal: null,
    sha256: null,
    error: null,
  };
  const report = (patch: Partial<UploadProgress>) => {
    Object.assign(state, patch);
    onProgress?.({ ...state });
  };

  const mime = file.type || 'application/octet-stream';

  if (file.size > MAX_UPLOAD_BYTES) {
    const error = fail('TOO_LARGE', 'That file is larger than the 5 GB limit.', false);
    report({ phase: 'failed', error });
    throw error;
  }
  if (file.size === 0) {
    // The presign schema is `size: positive()`, so an empty file is a 400 with
    // a developer's sentence in it. Say the real thing here instead.
    const error = fail('EMPTY', 'That file is empty.', false);
    report({ phase: 'failed', error });
    throw error;
  }

  const signed = await presign({ filename: file.name, mime, size: file.size });
  if (!signed.ok) {
    const error = fail('PRESIGN_FAILED', signed.message);
    report({ phase: 'failed', error });
    throw error;
  }

  report({
    phase: 'hashing',
    partsTotal: signed.presign.mode === 'multipart' ? signed.presign.parts.length : null,
    partsDone: signed.presign.mode === 'multipart' ? 0 : null,
  });

  let sha256: string;
  try {
    const hashOptions: { onProgress: (n: number) => void; signal?: AbortSignal } = {
      onProgress: (n) => report({ hashedBytes: n }),
    };
    if (signal) hashOptions.signal = signal;
    sha256 = await hashBlob(file, hashOptions);
  } catch (cause) {
    const error =
      cause instanceof DOMException && cause.name === 'AbortError'
        ? fail('CANCELLED', 'Cancelled.', false)
        : fail('HASH_FAILED', 'The file could not be read. It may have moved or been renamed.');
    report({ phase: error.code === 'CANCELLED' ? 'cancelled' : 'failed', error });
    throw error;
  }

  report({ phase: 'uploading', sha256, hashedBytes: file.size });

  try {
    if (signed.presign.mode === 'single') {
      const putOptions: Parameters<typeof put>[2] = {
        contentType: mime,
        onSent: (bytes) => report({ sentBytes: bytes }),
      };
      if (signal) putOptions.signal = signal;
      await put(signed.presign.url, file, putOptions);
      report({ sentBytes: file.size });
    } else {
      const { partSize, parts: partUrls, completeUrl, abortUrl } = signed.presign;
      const done: { partNumber: number; etag: string }[] = [];
      try {
        for (const part of partUrls) {
          const start = (part.partNumber - 1) * partSize;
          const slice = file.slice(start, Math.min(start + partSize, file.size));

          let result: PutResult | null = null;
          let lastError: UploadError | null = null;
          for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
            try {
              const putOptions: Parameters<typeof put>[2] = {
                onSent: (bytes) => report({ sentBytes: start + bytes }),
              };
              if (signal) putOptions.signal = signal;
              result = await put(part.url, slice, putOptions);
              break;
            } catch (cause) {
              lastError = cause as UploadError;
              // A cancel is not a flake. Anything else gets a short backoff:
              // one part failing on a hotel wifi should not lose two hours.
              if (lastError.code === 'CANCELLED' || attempt === PART_ATTEMPTS) throw lastError;
              await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
            }
          }

          if (!result?.etag) {
            throw fail(
              'MISSING_ETAG',
              'Storage did not return a part identifier. The bucket needs ETag in its CORS ExposeHeaders.',
              false,
            );
          }
          done.push({ partNumber: part.partNumber, etag: result.etag });
          report({ partsDone: done.length, sentBytes: start + slice.size });
        }

        await completeMultipart(completeUrl, done);
      } catch (cause) {
        await abortMultipart(abortUrl);
        throw cause;
      }
    }
  } catch (cause) {
    const error = (cause as UploadError).code
      ? (cause as UploadError)
      : fail('TRANSFER_FAILED', 'The upload did not complete.');
    report({ phase: error.code === 'CANCELLED' ? 'cancelled' : 'failed', error });
    throw error;
  }

  report({ phase: 'recording' });

  return {
    storageKey: signed.presign.key,
    sha256,
    filename: file.name,
    mime,
    sizeBytes: file.size,
  };
}
