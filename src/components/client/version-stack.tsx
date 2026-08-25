/**
 * VersionStack — reverse-chronological, one row per version the client can see:
 * `v4 · 12.4 MB · 3a91f2…`
 *
 * The hash is on screen, not hidden behind a detail view, because it is the
 * thing an approval binds to (INV-3, ADR-004). Six months later the argument is
 * "which file did we approve", and the answer has to be readable from the
 * record rather than reconstructed from it.
 *
 * Download is an anchor to a route that 302s to a presigned GET. Bytes never
 * pass through the app (INV-10), so there is nothing to fetch here.
 *
 * **On an archived engagement the per-file download is replaced, not disabled.**
 * COMPONENTS.md §4's `disabled` state is explicit: "the download control is
 * replaced by `text-12 text-muted` reading 'Export before {date} to keep this.'
 * linking to the export flow. Never a dead button." A row of greyed-out links
 * tells a reader the page is broken; a sentence tells them the one thing that
 * still works and the date it stops working. It is also the better instruction
 * on the merits — forty-one individual downloads is not a copy of a workspace,
 * and the export is the artifact that outlives the purge.
 */

import type { ClientVersion } from '@/lib/types';
import { hrefs } from '@/lib/api-client.client';
import {
  formatBytes,
  formatPurgeDate,
  formatTimestamp,
  shortHash,
  versionPip,
} from '@/lib/format';
import { chip, cn, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';

export function VersionStack({
  versions,
  selectedId,
  archived = false,
  daysToPurge = null,
  nowMs,
}: {
  versions: ClientVersion[];
  /** The version a decision would bind to — always the most recent. */
  selectedId?: string;
  /** An archived workspace is on its way to being destroyed. */
  archived?: boolean;
  daysToPurge?: number | null;
  /** The server's clock, so the date here matches the one in the slate above. */
  nowMs?: number;
}) {
  if (versions.length === 0) {
    return <EmptyState instruction="No files yet. Your agency will publish the first version here." />;
  }

  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);
  const purgeOn = formatPurgeDate(daysToPurge, nowMs ?? Date.now());

  return (
    <ol className="divide-y divide-rule border border-hairline border-rule">
      {ordered.map((v) => (
        <li
          key={v.id}
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2',
            v.id === selectedId && 'bg-tint-client',
          )}
        >
          <span className={cn(mono, 'text-14 text-ink')}>{versionPip(v.versionNo)}</span>
          <span className={cn(mono, 'text-12', muted)} aria-hidden="true">·</span>
          <span className={cn(mono, 'text-12', muted)}>{formatBytes(v.sizeBytes)}</span>
          <span className={cn(mono, 'text-12', muted)} aria-hidden="true">·</span>
          <span className={cn(mono, 'text-12', muted)} title={v.sha256}>
            {shortHash(v.sha256)}
          </span>
          <span className="min-w-0 flex-1 truncate text-12 text-muted" title={v.filename}>
            {v.filename}
          </span>
          <span className={cn(mono, 'text-12', muted)}>{formatTimestamp(v.publishedAt)}</span>
          {v.id === selectedId && <span className={cn(chip, 'border-client text-client')}>LATEST</span>}
          {archived ? (
            <a className={cn('text-12 underline underline-offset-2', muted)} href={hrefs.clientExport()}>
              {purgeOn ? `Export before ${purgeOn} to keep this` : 'Export to keep this'}
            </a>
          ) : (
            <a className={cn(mono, 'text-12 text-ink underline underline-offset-2')} href={hrefs.clientDownload(v.id)}>
              Download
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
