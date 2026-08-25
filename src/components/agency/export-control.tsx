'use client';

/**
 * The agency's export, in its three real states.
 *
 * `POST /api/engagements/:id/export` "queues a zip; returns a job id"
 * (API-CONTRACT.md). That is an asynchronous act, so the control has to say so
 * — FLOWS.md §3: the button goes `loading` with
 * `loadingLabel="Preparing your export"`, and a `role="status"` line reads
 * "We'll email you a link when it's ready — usually under a minute."
 *
 * Three states and no fourth:
 *
 * - **idle** — the button.
 * - **queued** — the job id as a mono record plus the status line. The id is on
 *   screen because it is the thing a support conversation is about, and because
 *   a queued job with no visible identity is indistinguishable from a click that
 *   did nothing.
 * - **ready** — if the response carries a URL the archive already exists, so the
 *   link is offered immediately rather than making someone wait for an email
 *   about a file that is sitting there. Followed, never fetched: the archive is
 *   presigned and bytes do not pass through the app (INV-10).
 *
 * The failure is `role="alert"` and bold `--ink`, never `--breach`. A failed
 * export is not a breached commitment, and the sentence says the thing the
 * reader is actually afraid of: **nothing has been deleted.**
 *
 * It is never disabled by the engagement being archived. Export is the action
 * an archived workspace exists to still offer.
 */

import { agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button, type ButtonSize, type ButtonTone } from '@/components/primitives';
import { cn, mono, muted } from '@/components/style-tokens';

export function ExportControl({
  engagementId,
  tone = 'quiet',
  size = 'sm',
  label = 'Export',
  className,
}: {
  engagementId: string;
  tone?: ButtonTone;
  size?: ButtonSize;
  label?: string;
  className?: string;
}) {
  const job = useAction(agencyApi.requestExport);
  const queued = job.data;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div>
        <Button
          tone={tone}
          size={size}
          loading={job.pending}
          loadingLabel="Preparing your export"
          onClick={() => void job.run('Export queued', engagementId)}
        >
          {queued ? 'Export again' : label}
        </Button>
      </div>

      {queued && (
        <p role="status" className={cn('text-12', muted)}>
          {queued.url ? (
            <>
              Your export is ready.{' '}
              <a className={cn(mono, 'text-ink underline underline-offset-2')} href={queued.url}>
                Download the zip
              </a>
            </>
          ) : (
            <>
              We&rsquo;ll email you a link when it&rsquo;s ready — usually under a minute.{' '}
              <span className={cn(mono, 'text-ink')} title="Export job id">
                {queued.jobId}
              </span>
            </>
          )}
        </p>
      )}

      {job.failure && (
        <p role="alert" className="border-t-hairline border-ink pt-1 text-12 font-semibold text-ink">
          Export failed. Try again — nothing has been deleted.
        </p>
      )}
    </div>
  );
}
