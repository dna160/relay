/**
 * Object storage. INV-10 / ADR-009: file bytes never traverse the app server.
 *
 * Everything in this file hands out a *URL*. Nothing in it reads or writes a
 * byte of user content. That is the whole design: a single innocent
 * `formData()` in a route is how a 5 GB upload starts flowing through a
 * container with 512 MB of memory, and a single `GetObjectCommand(...).Body`
 * is how the egress bill stops being predictable.
 *
 * Keys are prefixed with the engagement id so that purge can enumerate and
 * delete an engagement's objects by prefix, without a manifest of its own.
 */

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { engagementPrefix, safeFilename } from '@/domain/storage/keys';

/** Above this, the browser must use multipart. Below it, one PUT. */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;

/** Hard ceiling (ARCHITECTURE: presigned upload supports files to 5 GB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

/** S3 requires >= 5 MiB parts except for the last one. 64 MiB keeps the part
 *  count for a 5 GB file at 80, which is a manageable number of signatures. */
export const MIN_PART_SIZE_BYTES = 64 * 1024 * 1024;

/** Long enough for a slow 4G client to finish a part, short enough to matter. */
const PUT_EXPIRY_SECONDS = 60 * 60;

/** A download link the client follows immediately. It does not need an hour. */
const GET_EXPIRY_SECONDS = 5 * 60;

/* ------------------------------------------------ configured vs. reachable */

/**
 * The four variables without which nothing here can work.
 *
 * `S3_REGION` is absent deliberately: it defaults to `auto`, which is correct
 * for R2 and for MinIO, so an unset region is a working deployment and does not
 * belong in a list of reasons uploads are broken.
 */
export const REQUIRED_STORAGE_ENV = [
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
] as const;

/**
 * Raised when object storage is not configured on this deployment.
 *
 * A distinct class rather than a bare `Error` because the two failures it
 * separates are genuinely different and used to read the same: a deployment
 * with no `S3_ENDPOINT` cannot presign *at all*, ever, for anybody, and a
 * deployment whose bucket is briefly unreachable will work again in a minute.
 * Collapsed into one 500 they both reached the user as "could not reach the
 * workspace" — which tells an operator nothing and tells a user to retry
 * something that will never succeed.
 *
 * `missing` is for the server log. It never reaches a response body.
 */
export class StorageNotConfiguredError extends Error {
  readonly code = 'STORAGE_NOT_CONFIGURED';
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(`object storage is not configured: ${missing.join(', ')} unset`);
    this.name = 'StorageNotConfiguredError';
    this.missing = missing;
  }
}

/** Which of the required variables are unset. Pure; no network, no client. */
export function missingStorageEnv(): string[] {
  return REQUIRED_STORAGE_ENV.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.length === 0;
  });
}

export function isStorageConfigured(): boolean {
  return missingStorageEnv().length === 0;
}

let client: S3Client | undefined;

export function storageClient(): S3Client {
  if (client) return client;
  const missing = missingStorageEnv();
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);

  client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    credentials: {
      // `missingStorageEnv()` above is the proof these are set. The assertions
      // are absent on purpose (CLAUDE.md standing rules), so the fallbacks are
      // empty strings that the check has already ruled out.
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    forcePathStyle: true,
  });
  return client;
}

export function bucket(): string {
  const name = process.env.S3_BUCKET;
  if (!name) throw new StorageNotConfiguredError(['S3_BUCKET']);
  return name;
}

/** What `/api/health` reports about object storage, and what presign maps to. */
export type StorageHealth = 'ok' | 'unconfigured' | 'unreachable';

/**
 * A real round trip to the bucket, cached for a few seconds.
 *
 * `/api/health` is the most-hit route on any deployment — Railway polls it, and
 * so does everything else on the internet. An uncached probe would turn that
 * traffic into traffic against the object store, so the answer is memoised for
 * long enough to stop that and short enough that an operator watching a
 * recovery does not think the check is stuck.
 *
 * `HeadBucket` is the cheapest call that proves credentials *and* reachability
 * *and* that the bucket exists. It moves no bytes, so INV-10 is untouched.
 */
const STORAGE_PROBE_TTL_MS = 10_000;

let probe: { at: number; result: StorageHealth } | undefined;

export async function checkStorage(timeoutMs = 3_000): Promise<StorageHealth> {
  if (!isStorageConfigured()) return 'unconfigured';

  const now = Date.now();
  if (probe && now - probe.at < STORAGE_PROBE_TTL_MS) return probe.result;

  let result: StorageHealth;
  try {
    await storageClient().send(new HeadBucketCommand({ Bucket: bucket() }), {
      requestTimeout: timeoutMs,
    });
    result = 'ok';
  } catch (error) {
    console.error('[health] object storage check failed', error);
    result = 'unreachable';
  }

  probe = { at: now, result };
  return result;
}

/**
 * Key construction and key validation are domain rules (INV-7 enumerates by
 * prefix; INV-6 depends on one engagement's objects being unreachable from
 * another's rows), so they live in `src/domain/storage/keys.ts`. They are
 * re-exported here because this is where callers that sign URLs expect to find
 * them, and because `src/domain/**` may not import this file (INV-9).
 */
export {
  engagementPrefix,
  isShelfKeyFor,
  isVersionKeyFor,
  safeFilename,
  shelfKey,
  versionKey,
} from '@/domain/storage/keys';

export function partSizeFor(sizeBytes: number): number {
  // Keep the part count under 1000 even at the 5 GB ceiling.
  return Math.max(MIN_PART_SIZE_BYTES, Math.ceil(sizeBytes / 1000));
}

export interface SinglePresign {
  mode: 'single';
  key: string;
  url: string;
  expiresIn: number;
}

export interface MultipartPresign {
  mode: 'multipart';
  key: string;
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; url: string }[];
  completeUrl: string;
  abortUrl: string;
  expiresIn: number;
}

export type Presign = SinglePresign | MultipartPresign;

export async function presignUpload(input: {
  key: string;
  mime: string;
  sizeBytes: number;
}): Promise<Presign> {
  const s3 = storageClient();
  const Bucket = bucket();

  if (input.sizeBytes <= MULTIPART_THRESHOLD_BYTES) {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket, Key: input.key, ContentType: input.mime }),
      { expiresIn: PUT_EXPIRY_SECONDS },
    );
    return { mode: 'single', key: input.key, url, expiresIn: PUT_EXPIRY_SECONDS };
  }

  const created = await s3.send(
    new CreateMultipartUploadCommand({ Bucket, Key: input.key, ContentType: input.mime }),
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error('storage did not return an upload id');

  const partSize = partSizeFor(input.sizeBytes);
  const partCount = Math.ceil(input.sizeBytes / partSize);

  const parts = await Promise.all(
    Array.from({ length: partCount }, (_, i) => i + 1).map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket, Key: input.key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PUT_EXPIRY_SECONDS },
      ),
    })),
  );

  /**
   * The browser completes and aborts directly too. Routing either through the
   * app would mean the app holding the part-ETag list for a multi-hour upload,
   * and an app restart mid-upload would orphan the whole thing.
   */
  const completeUrl = await getSignedUrl(
    s3,
    new CompleteMultipartUploadCommand({ Bucket, Key: input.key, UploadId: uploadId }),
    { expiresIn: PUT_EXPIRY_SECONDS },
  );
  const abortUrl = await getSignedUrl(
    s3,
    new AbortMultipartUploadCommand({ Bucket, Key: input.key, UploadId: uploadId }),
    { expiresIn: PUT_EXPIRY_SECONDS },
  );

  return {
    mode: 'multipart',
    key: input.key,
    uploadId,
    partSize,
    parts,
    completeUrl,
    abortUrl,
    expiresIn: PUT_EXPIRY_SECONDS,
  };
}

/**
 * A presigned GET. The download route 302s to this and never touches the body —
 * `ResponseContentDisposition` is what makes the browser save it under the
 * original filename rather than the opaque storage key.
 */
export async function presignDownload(input: {
  key: string;
  filename: string;
  /**
   * Defaults to five minutes, which is right for a link the browser follows
   * immediately. The export bundle is the exception: it is a file an agency
   * downloads once and works through, and every link inside it has to still
   * work an hour later (Phase 6).
   */
  expiresIn?: number;
}): Promise<{ url: string; expiresIn: number }> {
  const expiresIn = input.expiresIn ?? GET_EXPIRY_SECONDS;
  const url = await getSignedUrl(
    storageClient(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: input.key,
      ResponseContentDisposition: `attachment; filename="${safeFilename(input.filename)}"`,
    }),
    { expiresIn },
  );
  return { url, expiresIn };
}

/** Used by the purge worker (Phase 6). Listed here so the prefix rule lives
 *  next to the code that builds the keys. */
export async function listEngagementObjects(engagementId: string): Promise<string[]> {
  const s3 = storageClient();
  const Bucket = bucket();
  const Prefix = engagementPrefix(engagementId);
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    ContinuationToken = page.NextContinuationToken;
  } while (ContinuationToken);
  return keys;
}

export async function deleteObjects(keys: readonly string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const s3 = storageClient();
  const Bucket = bucket();
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
    deleted += result.Deleted?.length ?? 0;
  }
  return deleted;
}
