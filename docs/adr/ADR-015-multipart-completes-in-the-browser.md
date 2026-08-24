# ADR-015 — Multipart uploads complete and abort in the browser

**Status:** accepted (Phase 3) · **Relates to:** ADR-009, INV-10

## Context

API-CONTRACT.md specifies `POST /api/uploads/presign` with a request shape but
no response shape. Above 100 MB the upload must be multipart, and a multipart
upload needs three more signed calls after the parts: complete, and abort on
failure. `CompleteMultipartUpload` takes the list of part ETags the browser
collected.

The obvious alternative is a `POST /api/uploads/complete` route that receives
the ETag list and calls S3 itself.

## Decision

`presignUpload()` returns presigned `CompleteMultipartUpload` and
`AbortMultipartUpload` URLs alongside the part URLs. The browser drives all
three. The app server holds no upload state.

Response shape:

```ts
type Presign =
  | { mode: 'single'; key: string; url: string; expiresIn: number }
  | { mode: 'multipart'; key: string; uploadId: string; partSize: number;
      parts: { partNumber: number; url: string }[];
      completeUrl: string; abortUrl: string; expiresIn: number };
```

Thresholds: multipart above 100 MB, ceiling 5 GB, part size
`max(64 MiB, ceil(size / 1000))` so the part count stays under 1000 at the
ceiling. Upload URLs live one hour; download URLs live five minutes.

## Consequences

- A 5 GB upload can run for hours across an app restart or a deploy. There is no
  server-side upload session to lose.
- The app never learns an upload was abandoned. Orphaned multipart uploads are
  reclaimed by a bucket lifecycle rule (`AbortIncompleteMultipartUpload`, 7
  days), which is infrastructure configuration, not application code — noted for
  the deployment agent.
- The front-end owns retry and part ordering. In exchange, no byte and no ETag
  list traverses the app server (INV-10).
