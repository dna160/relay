'use client';

/**
 * VersionStack — reverse-chronological, one row per immutable version.
 *
 * The agency stack shows every version, including the ones that never passed
 * the internal gate, and says which ones the client can see. `asset_versions`
 * is append-only (INV-4), so this list only ever grows — there is no edit
 * affordance here by design.
 *
 * ## The record as a plate (LABEL-SYSTEM.md §5)
 *
 * The row's three batch facts are a `Plate layout="strip"` — hairline-divided,
 * one line, at spec-label density. Nothing new is stated; the plate is the run
 * of values this row already carried, set where a reader looks for a serial
 * number. The filename, the publication time and the visibility badges stay
 * outside it: a badge is a stamp on the thing, not one of its numbers. No
 * `Barcode` per row (LABEL-SYSTEM.md §3b).
 *
 * Three pairs and not four, because a `strip` that wraps keeps `divide-x`'s
 * hairline on the wrapped item and opens the second line with a rule that
 * divides nothing (COMPONENTS.md §10, 360).
 *
 * ## Two events, two motions, never both on one row (COMPONENTS.md §14)
 *
 * This is the one surface where §14's two version-stack entries are genuinely
 * distinct events, because the agency sees a version before the client does:
 *
 *   - **the stack gains a row** — a file was uploaded. The row seats, three
 *     beats, staggered half a beat per newcomer and capped at six.
 *   - **a version is published to the client** — no row appears and nothing
 *     moves in the list; one timestamp lands on a row that has been sitting
 *     there. The version pip takes the two-beat stamp.
 *
 * A row cannot take both, and `useChangedRows` will not report a row it is
 * seeing for the first time. That is rule R1 held at the row: one event, one
 * motion, and the reader's eye is never asked to choose.
 */

import type { CSSProperties } from 'react';
import type { AgencyVersion } from '@/lib/types';
import { formatBytes, formatTimestamp, shortHash, versionPip } from '@/lib/format';
import { useChangedRows, useGainedRows } from '@/lib/hooks/use-list-events';
import { Badge, Mono, Plate } from '@/components/primitives';
import { cn } from '@/components/style-tokens';
import { EmptyState } from './empty-state';

export function VersionStack({ versions }: { versions: AgencyVersion[] }) {
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);
  const gained = useGainedRows(ordered.map((v) => v.id));
  const published = useChangedRows(ordered.map((v) => [v.id, v.publishedToClientAt ?? null]));

  if (versions.length === 0) {
    return <EmptyState instruction="No versions yet. Upload the first file to start the record." />;
  }

  return (
    <ol className="divide-y divide-rule border border-rule">
      {ordered.map((v) => {
        const isNew = gained.has(v.id);
        const justPublished = published.has(v.id);
        return (
          <li
            key={v.id}
            className={cn('flex flex-col gap-1 px-3 py-2', isNew && 'animate-seat stagger')}
            style={
              isNew ? ({ '--stagger-index': gained.indexOf(v.id) } as CSSProperties) : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-12 text-muted" title={v.filename}>
                {v.filename}
              </span>
              {v.publishedToClientAt && (
                <Mono tone="muted" label="Published to the client">
                  {formatTimestamp(v.publishedToClientAt)}
                </Mono>
              )}
              {!v.publishedToClientAt && (
                <Badge tone="neutral" label="Not published to the client">
                  INTERNAL
                </Badge>
              )}
              {v.supersededBy && (
                <Badge tone="neutral" label="A later version replaced this one">
                  SUPERSEDED
                </Badge>
              )}
            </div>

            <Plate
              layout="strip"
              label={`Record for version ${v.versionNo}`}
              rows={[
                {
                  term: 'Version',
                  value: (
                    <span
                      // Re-keyed only when this row's published state changes,
                      // so the stamp runs on the publish and never again.
                      key={justPublished ? 'published' : 'held'}
                      className={cn(justPublished && 'animate-stamp', 'inline-block')}
                    >
                      {versionPip(v.versionNo)}
                    </span>
                  ),
                },
                { term: 'Size', value: formatBytes(v.sizeBytes) },
                { term: 'Sha', value: shortHash(v.sha256), title: v.sha256 },
              ]}
            />
          </li>
        );
      })}
    </ol>
  );
}
