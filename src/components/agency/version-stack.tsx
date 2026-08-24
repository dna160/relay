/**
 * VersionStack — reverse-chronological, one row per immutable version:
 * `v4 · 12.4 MB · 3a91f2…`
 *
 * The agency stack shows every version, including the ones that never passed
 * the internal gate, and says which ones the client can see. `asset_versions`
 * is append-only (INV-4), so this list only ever grows — there is no edit
 * affordance here by design.
 */

import type { AgencyVersion } from '@/lib/types';
import { formatBytes, formatTimestamp, shortHash, versionPip } from '@/lib/format';
import { chip, cn, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';

export function VersionStack({ versions }: { versions: AgencyVersion[] }) {
  if (versions.length === 0) {
    return <EmptyState instruction="No versions yet. Upload the first file to start the record." />;
  }

  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);

  return (
    <ol className="divide-y divide-rule border border-rule">
      {ordered.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
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
          {v.publishedToClientAt ? (
            <span className={cn(mono, 'text-12', muted)} title="Published to client">
              {formatTimestamp(v.publishedToClientAt)}
            </span>
          ) : (
            <span className={cn(chip)}>INTERNAL</span>
          )}
          {v.supersededBy && <span className={cn(chip, muted)}>SUPERSEDED</span>}
        </li>
      ))}
    </ol>
  );
}
