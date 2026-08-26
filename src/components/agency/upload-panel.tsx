'use client';

/**
 * The upload surface. One component for both classes of file, because the byte
 * path is identical and only the record call differs:
 *
 * - **a card version** — immutable, numbered, hashed, and the thing an approval
 *   binds to (INV-3, INV-4). Recorded with `POST /api/versions`.
 * - **a shelf file** — the contract, the brand guidelines, the raw footage. No
 *   version, no approval, no tree (PRD §5.3). Recorded with
 *   `POST /api/reference-files`.
 *
 * Nothing here touches a byte. `src/lib/upload.ts` does the presign, the hash
 * and the direct PUT; this file is the part a person looks at while that
 * happens, and what it shows during the wait is most of its job. A 4 GB master
 * uploaded at 3am against a delivery deadline needs to say, at every moment,
 * which of four things is happening and how far through it is — because the
 * alternative is someone closing the tab and starting again.
 *
 * The four phases are named rather than merged into one bar, and `hashing` is
 * named loudest, because it is the one that surprises people: the file appears
 * to be "doing nothing" for a minute while it is read. Saying *reading the file
 * to fingerprint it* is the difference between a wait and a fault.
 *
 * Keyboard: the drop zone is a convenience, never the only way in. Choose files
 * is a real button, the file input is off-screen and out of the tab order
 * behind it, and every per-file control is a button.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/primitives';
import { agencyApi } from '@/lib/api-client.agency';
import { formatBytes, shortHash } from '@/lib/format';
import {
  MAX_UPLOAD_BYTES,
  uploadFile,
  type PresignFn,
  type UploadError,
  type UploadProgress,
} from '@/lib/upload';
import { cn, input, mono, muted, surface } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';
import { failureCopy } from './failure-copy';
import type { ApiFailure } from '@/lib/api-client.core';

export type UploadTarget =
  | { kind: 'version'; engagementId: string; cardId: string }
  | { kind: 'shelf'; engagementId: string };

interface Job {
  id: string;
  file: File;
  progress: UploadProgress;
  controller: AbortController;
  /** Set once the record call has returned. `v4` for a version. */
  recorded: string | null;
  apiFailure: ApiFailure | null;
}

const PHASE_LABEL: Record<UploadProgress['phase'], string> = {
  queued: 'Queued',
  hashing: 'Reading the file to fingerprint it',
  uploading: 'Uploading',
  recording: 'Recording it',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function newProgress(file: File): UploadProgress {
  return {
    phase: 'queued',
    hashedBytes: 0,
    sentBytes: 0,
    totalBytes: file.size,
    partsDone: null,
    partsTotal: null,
    sha256: null,
    error: null,
  };
}

/**
 * Hashing is a full read and uploading is a full send, so the honest overall
 * figure weights them equally rather than jumping to 50% the moment the hash
 * finishes.
 */
function fraction(p: UploadProgress): number {
  if (p.totalBytes === 0) return 0;
  if (p.phase === 'done') return 1;
  const hashed = Math.min(p.hashedBytes, p.totalBytes) / p.totalBytes;
  const sent = Math.min(p.sentBytes, p.totalBytes) / p.totalBytes;
  return (hashed + sent) / 2;
}

export function UploadPanel({
  target,
  disabled = false,
  disabledReason,
}: {
  target: UploadTarget;
  /** An archived engagement is read-only. Say so rather than failing on submit. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const [groupLabel, setGroupLabel] = useState('');
  const [clientVisible, setClientVisible] = useState(false);

  const patch = useCallback((id: string, next: Partial<Job>) => {
    setJobs((current) => current.map((j) => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  const run = useCallback(
    async (job: Job) => {
      const presign: PresignFn = async ({ filename, mime, size }) => {
        const result = await agencyApi.presignUpload({
          engagementId: target.engagementId,
          ...(target.kind === 'version' ? { cardId: target.cardId } : {}),
          filename,
          mime,
          size,
        });
        if (!result.ok) {
          patch(job.id, { apiFailure: result });
          return { ok: false, message: result.message };
        }
        return {
          ok: true,
          presign: result.data.presign,
          maxBytes: result.data.maxBytes,
        };
      };

      let completed;
      try {
        completed = await uploadFile(job.file, presign, {
          signal: job.controller.signal,
          onProgress: (progress) => patch(job.id, { progress }),
        });
      } catch {
        // `uploadFile` has already reported the terminal phase through
        // `onProgress`; re-reporting it here would overwrite the specific
        // message with a generic one.
        return;
      }

      // Recording is the one step that goes through the app, and it carries no
      // bytes — metadata and the hash (INV-10).
      const recorded =
        target.kind === 'version'
          ? await agencyApi.recordVersion({
              engagementId: target.engagementId,
              cardId: target.cardId,
              storageKey: completed.storageKey,
              filename: completed.filename,
              mime: completed.mime,
              sizeBytes: completed.sizeBytes,
              sha256: completed.sha256,
            })
          : await agencyApi.recordReferenceFile({
              engagementId: target.engagementId,
              storageKey: completed.storageKey,
              filename: completed.filename,
              mime: completed.mime,
              sizeBytes: completed.sizeBytes,
              groupLabel: groupLabel.trim() === '' ? null : groupLabel.trim(),
              clientVisible,
            });

      if (!recorded.ok) {
        const error: UploadError = {
          code: 'RECORD_FAILED',
          message: recorded.message,
          retryable: true,
        };
        patch(job.id, {
          apiFailure: recorded,
          progress: { ...job.progress, phase: 'failed', sha256: completed.sha256, error },
        });
        return;
      }

      patch(job.id, {
        apiFailure: null,
        recorded:
          'versionNo' in recorded.data ? `v${recorded.data.versionNo}` : recorded.data.filename,
        progress: {
          ...job.progress,
          phase: 'done',
          sha256: completed.sha256,
          hashedBytes: job.file.size,
          sentBytes: job.file.size,
          error: null,
        },
      });
      // The version stack and the shelf are server-rendered. Re-read the
      // projection rather than splicing the new row in locally — a list that
      // disagrees with the server about what exists is worse than a reload.
      router.refresh();
    },
    [clientVisible, groupLabel, patch, router, target],
  );

  const accept = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0 || disabled) return;
      const added: Job[] = Array.from(files).map((file) => ({
        id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2)}`,
        file,
        progress: newProgress(file),
        controller: new AbortController(),
        recorded: null,
        apiFailure: null,
      }));
      setJobs((current) => [...added, ...current]);
      // Sequential, not parallel. Four 2 GB files at once share one uplink and
      // all four finish later than they would one after another, and the
      // progress a person is watching stops meaning anything.
      void added.reduce<Promise<void>>(
        (chain, job) => chain.then(() => run(job)),
        Promise.resolve(),
      );
    },
    [disabled, run],
  );

  const retry = useCallback(
    (job: Job) => {
      const fresh: Job = {
        ...job,
        controller: new AbortController(),
        progress: newProgress(job.file),
        apiFailure: null,
      };
      patch(job.id, fresh);
      void run(fresh);
    },
    [patch, run],
  );

  if (disabled) {
    return (
      <p className={cn('text-14', muted)}>
        {disabledReason ?? 'This engagement is read-only. Nothing new can be uploaded to it.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files);
        }}
        className={cn(
          surface,
          'flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3',
          // The hue is `--agency`: a drop target is not a warning, and the only
          // red in this product is a breached commitment.
          dragging && 'border-agency bg-tint-agency',
        )}
      >
        {/*
          Off-screen and out of the tab order. The button beside it is the real
          control, so the input is never something a keyboard reaches and finds
          invisible.
        */}
        <input
          ref={fileInput}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = '';
          }}
        />
        <Button tone="agency" onClick={() => fileInput.current?.click()}>
          {target.kind === 'version' ? 'Upload a version' : 'Add files'}
        </Button>
        <p className={cn('text-14', muted)}>
          or drop files here.{' '}
          <span className={cn(mono, 'text-12')}>up to {formatBytes(MAX_UPLOAD_BYTES)}</span>
        </p>
      </div>

      {target.kind === 'shelf' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="shelf-group" className={cn('text-12', muted)}>
              Group (optional)
            </label>
            {/*
              A label on a row, not an entity — `group_label` is a text column
              and the shelf has no tree. Typing a label that already exists puts
              the file in that group; there is nothing to create and nothing to
              leave dangling when its last file goes.
            */}
            <input
              id="shelf-group"
              className={input}
              value={groupLabel}
              placeholder="Brand, Footage, Contract…"
              onChange={(e) => setGroupLabel(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-12 text-muted">
            <input
              type="checkbox"
              checked={clientVisible}
              onChange={(e) => setClientVisible(e.target.checked)}
              className="accent-ink"
            />
            The client can see these
          </label>
        </div>
      )}

      {jobs.length > 0 && (
        <ol className={cn(surface, 'divide-y divide-rule')} aria-label="Uploads">
          {jobs.map((job) => {
            const p = job.progress;
            const running = p.phase === 'hashing' || p.phase === 'uploading' || p.phase === 'recording';
            const pct = Math.round(fraction(p) * 100);
            return (
              <li key={job.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 truncate text-14 text-ink" title={job.file.name}>
                    {job.file.name}
                  </span>
                  <span className={cn(mono, 'text-12', muted)}>{formatBytes(job.file.size)}</span>
                  {p.sha256 && (
                    <span className={cn(mono, 'text-12', muted)} title={p.sha256}>
                      {shortHash(p.sha256)}
                    </span>
                  )}
                  {job.recorded && <span className={cn(mono, 'text-12 text-ink')}>{job.recorded}</span>}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/*
                   * `aria-live="polite"` on the phase and not on the percentage:
                   * a screen reader announcing "31%… 32%… 33%" for four minutes
                   * is worse than no progress at all. The four phase changes are
                   * the events worth speaking.
                   */}
                  <span aria-live="polite" className={cn('text-12', muted)}>
                    {PHASE_LABEL[p.phase]}
                    {p.partsTotal !== null &&
                      p.phase === 'uploading' &&
                      ` · part ${(p.partsDone ?? 0) + 1} of ${p.partsTotal}`}
                  </span>
                  {running && <span className={cn(mono, 'text-12', muted)}>{pct}%</span>}
                  {running && (
                    <Button tone="ghost" size="sm" onClick={() => job.controller.abort()}>
                      Cancel
                    </Button>
                  )}
                  {(p.phase === 'failed' || p.phase === 'cancelled') &&
                    (p.error?.retryable ?? true) &&
                    /*
                     * `uploadFile` marks a presign refusal retryable by default,
                     * because from its side one refusal looks like any other.
                     * From here we can see the actual answer: a deployment with
                     * no object storage configured returns a 500 on every
                     * presign it will ever be asked for, and offering "Try
                     * again" next to copy that says retrying will not fix it is
                     * the interface arguing with itself. `failureCopy` owns that
                     * judgement so the words and the button cannot disagree.
                     */
                    (job.apiFailure === null || failureCopy(job.apiFailure).retryable) && (
                      <Button tone="quiet" size="sm" onClick={() => retry(job)}>
                        Try again
                      </Button>
                    )}
                </div>

                {running && (
                  <div
                    role="progressbar"
                    aria-label={`Uploading ${job.file.name}`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-bar w-full bg-rule"
                  >
                    <div className="h-full bg-agency" style={{ width: `${pct}%` }} />
                  </div>
                )}

                {p.error && job.apiFailure === null && (
                  /*
                   * A storage-side failure has no `ErrorCode` and no
                   * `ApiFailure` to hand `ErrorPanel` — it never reached the
                   * app. Bold `--ink` and a leading rule, never `--breach`:
                   * red means a breached commitment and nothing else.
                   *
                   * The guard is `apiFailure === null` and no longer a list of
                   * the codes that happen to have one. Whenever the app answered,
                   * `ErrorPanel` below is the authority and this line is the same
                   * failure said twice — as `STORAGE_NOT_CONFIGURED` showed the
                   * moment it landed: the server's sentence and the product's
                   * sentence stacked on top of each other, saying the same thing
                   * in two registers. `failure-copy.ts` opens by drawing exactly
                   * that distinction — the server sends a developer's sentence,
                   * these are the product's — and printing both abandons it.
                   * `RECORD_FAILED` was the only code named here before, which
                   * was this rule discovered one code at a time.
                   */
                  <p role="alert" className="border-l-bar border-l-ink pl-2 text-12 font-semibold text-ink">
                    {p.error.message}
                  </p>
                )}
                {job.apiFailure && <ErrorPanel failure={job.apiFailure} />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
