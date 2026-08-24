/**
 * The reference shelf: brand guidelines, raw footage, the contract.
 *
 * Deliberately not a filesystem (PRD §5.3). Flat, a handful of labelled groups,
 * no versioning, no approval state, no tree. Everything that needs a version
 * number and a decision lives on a card instead, and the split is what keeps
 * "which file did we approve" answerable.
 *
 * Read-only in this round: `docs/API-CONTRACT.md` types no write endpoint for
 * the shelf, and inventing three of them here would be worse than the gap.
 */

import { agencyApi } from '@/lib/api-client';
import { formatBytes, formatDate, plural, shortHash } from '@/lib/format';
import { cn, eyebrow, mono, muted, surface } from '@/components/style-tokens';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { serverContext } from '../../../_lib/server-context';

export default async function ShelfPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await serverContext();
  const shelf = await agencyApi.shelf(id, ctx);

  if (!shelf.ok) return <ErrorPanel failure={shelf} />;

  if (shelf.data.groups.length === 0) {
    return (
      <EmptyState instruction="Nothing on the shelf yet. Add the contract, the brand guidelines, and the raw footage." />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {[...shelf.data.groups]
        .sort((a, b) => a.position - b.position)
        .map((group) => (
          <section key={group.id} aria-label={group.label}>
            <div className="flex items-baseline justify-between gap-2 border-b border-ink pb-1">
              <h2 className={eyebrow}>{group.label}</h2>
              <span className={cn(mono, 'text-12', muted)}>
                {plural(group.items.length, 'file', 'files')}
              </span>
            </div>

            {group.items.length === 0 ? (
              <EmptyState className="mt-3" instruction="Nothing in this group yet." />
            ) : (
              <ul className={cn(surface, 'mt-3 divide-y divide-rule')}>
                {group.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-14 text-ink" title={item.filename}>
                      {item.filename}
                    </span>
                    <span className={cn(mono, 'text-12', muted)}>{formatBytes(item.sizeBytes)}</span>
                    <span className={cn(mono, 'text-12', muted)} title={item.sha256}>
                      {shortHash(item.sha256)}
                    </span>
                    <span className={cn(mono, 'text-12', muted)}>{formatDate(item.uploadedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  );
}
