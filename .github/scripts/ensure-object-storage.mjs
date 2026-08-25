#!/usr/bin/env node
/**
 * Object storage, proved working before anything depends on it.
 *
 * ## Why this exists
 *
 * INV-10 says file bytes never traverse the app server: uploads and downloads
 * are presigned direct to object storage. Every structural scan for that
 * invariant has been green since Phase 3 — and **the byte path has never once
 * been exercised**, because neither `docker-compose.yml` nor the e2e job
 * provided an S3 endpoint. The presign route 500s without credentials, so no
 * PUT was ever made, so the assertion *"no PUT reached the app server"* was
 * being made against a run containing no PUT at all.
 *
 * That is a green light for an absent byte path, and it is the same shape as
 * everything else this build has found: the guard reads something narrower than
 * the invariant claims. The two affected e2e tests now refuse to conclude
 * without storage rather than passing vacuously. This script is the other half
 * — it makes storage *exist*, so the refusal turns into a run.
 *
 * ## Why it does a full round trip rather than a port check
 *
 * "The port is open" is the same standard as "the URL answered", which is what
 * let a 500-ing stale dev server be adopted for a whole Playwright run
 * (DEFECT-9). A bucket that exists but rejects writes, a region mismatch, or a
 * path-style addressing difference all present as an open port and then fail
 * six minutes later inside a browser test, where the error reads as a product
 * bug rather than as missing infrastructure.
 *
 * So this puts an object, reads it back, compares the bytes, and deletes it. If
 * that round trip works, the byte path works, and any later failure is the
 * product's. Twenty lines here save an afternoon of misattributed debugging.
 *
 * Uses `@aws-sdk/client-s3`, already a dependency of the app. No new package.
 *
 * Usage:
 *   node .github/scripts/ensure-object-storage.mjs           # create + prove
 *   node .github/scripts/ensure-object-storage.mjs --wait 60 # poll for N seconds
 */

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const waitIndex = args.indexOf('--wait');
const WAIT_SECONDS = waitIndex === -1 ? 60 : Number(args[waitIndex + 1] ?? 60);

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION ?? 'auto';
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const Bucket = process.env.S3_BUCKET;

if (!endpoint || !accessKeyId || !secretAccessKey || !Bucket) {
  console.error(
    'Object storage is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY_ID,\n' +
      'S3_SECRET_ACCESS_KEY and S3_BUCKET.\n\n' +
      'Locally: `npm run db:up` now starts MinIO alongside Postgres, and\n' +
      '`.env.example` carries the matching values.',
  );
  process.exit(1);
}

/**
 * `forcePathStyle` mirrors `src/lib/storage.ts` exactly.
 *
 * It has to: a virtual-host-style client against MinIO resolves
 * `relay-dev.127.0.0.1`, which does not exist. Proving the round trip with a
 * client configured differently from the one the product uses would prove the
 * wrong thing — the whole point is that this is the same path.
 */
const client = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until the endpoint answers at all. A container takes a second to boot. */
async function waitForEndpoint() {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
      return 'exists';
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      // A 404/NoSuchBucket means the service is up and the bucket is not. That
      // is a *successful* probe — it is the thing this script is here to fix.
      if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchBucket') {
        return 'missing';
      }
      // A 403 means the service is up and the credentials are wrong. Fail now
      // and say so, rather than spending the whole timeout on it.
      if (status === 403) {
        console.error(`Object storage rejected the credentials (403) at ${endpoint}.`);
        process.exit(1);
      }
      lastError = error;
      await sleep(1000);
    }
  }
  console.error(
    `Object storage at ${endpoint} did not answer within ${WAIT_SECONDS}s.\n` +
      `Last error: ${lastError?.message ?? 'unknown'}`,
  );
  process.exit(1);
}

const state = await waitForEndpoint();
console.log(`object storage — ${endpoint}`);
console.log(`  bucket ${Bucket}: ${state}`);

if (state === 'missing') {
  await client.send(new CreateBucketCommand({ Bucket }));
  console.log(`  created ${Bucket}`);
}

/* --------------------------------------------------- the round trip itself */

const Key = `__readiness/${Date.now()}-${Math.random().toString(36).slice(2)}`;
const payload = `relay object-storage readiness ${new Date().toISOString()}`;

try {
  await client.send(new PutObjectCommand({ Bucket, Key, Body: payload }));
  const got = await client.send(new GetObjectCommand({ Bucket, Key }));
  const body = await got.Body.transformToString();
  if (body !== payload) {
    console.error(
      `  the object read back did not match the object written.\n` +
        `  wrote ${JSON.stringify(payload)}\n  read  ${JSON.stringify(body)}`,
    );
    process.exit(1);
  }
  console.log(`  round trip OK — put, get and compare on ${Key}`);
} catch (error) {
  console.error(
    `  the byte path does not work: ${error?.name ?? 'error'}: ${error?.message ?? ''}\n` +
      '  Fix this before running the e2e suite. A presign that cannot be fulfilled\n' +
      '  surfaces inside a browser test as a product failure.',
  );
  process.exit(1);
} finally {
  // Best effort. A leftover readiness object is harmless; failing the gate on
  // a failed cleanup would be failing for the wrong reason.
  await client.send(new DeleteObjectCommand({ Bucket, Key })).catch(() => {});
}

console.log('\nOK — object storage is reachable, writable and readable.');
