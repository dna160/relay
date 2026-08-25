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
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { uuidv7 } from 'uuidv7';

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

let client: S3Client | undefined;

export function storageClient(): S3Client {
  if (client) return client;
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? 'auto';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set');
  }
  client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return client;
}

export function bucket(): string {
  const name = process.env.S3_BUCKET;
  if (!name) throw new Error('S3_BUCKET is not set');
  return name;
}

/** Strips anything that would let a filename escape its prefix. */
export function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\-]+/g, '_').slice(0, 180);
  return cleaned.length > 0 ? cleaned : 'file';
}

export function versionKey(engagementId: string, cardId: string, filename: string): string {
  return `engagements/${engagementId}/cards/${cardId}/${uuidv7()}/${safeFilename(filename)}`;
}

export function shelfKey(engagementId: string, filename: string): string {
  return `engagements/${engagementId}/shelf/${uuidv7()}/${safeFilename(filename)}`;
}

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
  const Prefix = `engagements/${engagementId}/`;
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
