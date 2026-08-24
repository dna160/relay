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
 */

import type { ClientVersion } from '@/lib/types';
import { hrefs } from '@/lib/api-client.client';
import { formatBytes, formatTimestamp, shortHash, versionPip } from '@/lib/format';
import { chip, cn, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';

export function VersionStack({
  versions,
  selectedId,
}: {
  versions: ClientVersion[];
  /** The version a decision would bind to — always the most recent. */
  selectedId?: string;
}) {
  if (versions.length === 0) {
    return <EmptyState instruction="No files yet. Your agency will publish the first version here." />;
  }

  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);

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
          <a className={cn(mono, 'text-12 text-ink underline underline-offset-2')} href={hrefs.clientDownload(v.id)}>
            Download
          </a>
        </li>
      ))}
    </ol>
  );
}
