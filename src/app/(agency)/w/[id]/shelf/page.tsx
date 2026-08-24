/**
 * The reference shelf: brand guidelines, raw footage, the contract.
 *
 * Deliberately not a filesystem (PRD §5.3). Flat, a handful of labelled groups,
 * no versioning, no approval state, no tree. Everything that needs a version
 * number and a decision lives on a card instead, and the split is what keeps
 * "which file did we approve" answerable.
 *
 * A shelf row therefore carries no hash. That is not an omission: a hash is
 * what an approval cites (INV-3), nothing on the shelf is ever approved, and
 * printing a fingerprint next to a file nobody signed for would imply a record
 * that does not exist. What a shelf row does carry, and what the agency needs
 * to see at a glance, is whether the client can see it.
 */

import { formatBytes, formatDate, plural } from '@/lib/format';
import { cn, eyebrow, mono, muted, surface } from '@/components/style-tokens';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { UploadPanel } from '@/components/agency/upload-panel';
import { serverContext } from '../../../_lib/server-context';
import { getEngagement } from '../../../_lib/reads';
import { agencyApi } from '@/lib/api-client.agency';

export default async function ShelfPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await serverContext();
  const [shelf, engagement] = await Promise.all([agencyApi.shelf(id, ctx), getEngagement(id)]);

  if (!shelf.ok) return <ErrorPanel failure={shelf} />;

  // Read-only is predicted from `status`, not discovered on a 423. Offering a
  // drop zone that can only fail is worse than not offering one.
  const archived = engagement.ok && engagement.data.engagement.status !== 'active';

  const groups = [...shelf.data].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="shelf-add">
        <h2 id="shelf-add" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Add to the shelf
        </h2>
        <div className="mt-3">
          <UploadPanel
            target={{ kind: 'shelf', engagementId: id }}
            disabled={archived}
            disabledReason="This engagement is read-only. The shelf is still here to read and to export."
          />
        </div>
      </section>

      {groups.length === 0 ? (
        <EmptyState instruction="Nothing on the shelf yet. Add the contract, the brand guidelines, and the raw footage." />
      ) : (
        groups.map((group) => (
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
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-14 text-ink"
                      title={item.filename}
                    >
                      {item.filename}
                    </span>
                    <span className={cn(mono, 'text-12', muted)}>{formatBytes(item.sizeBytes)}</span>
                    <span className={cn(mono, 'text-12', muted)}>{formatDate(item.uploadedAt)}</span>
                    {/*
                      Stated on both sides rather than only when it is true. A
                      badge that appears only for shared files makes "no badge"
                      ambiguous between private and not-yet-rendered, and this
                      is the field someone checks before sending a client a link.
                    */}
                    <span className={cn(mono, 'text-12', item.clientVisible ? 'text-ink' : muted)}>
                      {item.clientVisible ? 'CLIENT CAN SEE' : 'AGENCY ONLY'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
