'use client';

/**
 * VersionStack — reverse-chronological, one row per version the client can see.
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
 *
 * ## The record as a plate (LABEL-SYSTEM.md §5)
 *
 * The row's three batch facts — version, size, hash — are a
 * `Plate layout="strip"`: hairline-divided, one line, at spec-label density.
 * Nothing here is new information; the plate is the run of values this row
 * already carried, set in the place a reader looks for a serial number. The
 * filename and the control stay outside it, because they are not records.
 *
 * **Three pairs, not four**, and the published timestamp sits on the line above
 * instead. COMPONENTS.md §10's 360 note: below `xs` a strip of more than three
 * pairs should be a stack. A strip that wraps keeps `divide-x`'s hairline on the
 * item that wrapped, so the second line opens with a rule that divides nothing —
 * a mark that means something in this system, appearing where it means nothing.
 * At the client's 412px viewport four pairs wrap and three do not.
 *
 * **No `Barcode` per row.** LABEL-SYSTEM.md §3b allows one only on a surface
 * that carries exactly one and is not a list.
 *
 * ## The motion (COMPONENTS.md §14)
 *
 * A row this stack **gains** seats — three beats, staggered half a beat per
 * newcomer, capped at six. Rows merely present do not, which is why this
 * component has to remember: an entrance on first render would be the one thing
 * in the motion system that spends first paint.
 *
 * The version pip's `animate-stamp` is the *other* entry in §14 and belongs to
 * the other event — a version being published onto a row that already existed.
 * On this surface the two collapse: the client only ever sees a version once it
 * is published, so a publish always arrives as a new row. Rule R1 then decides
 * it: one event, one motion, and the motion is the row seating. A pip stamped
 * inside a row that is simultaneously arriving is two animations competing for
 * one fact, which is precisely the failure R1 names.
 */

import type { CSSProperties } from 'react';
import type { ClientVersion } from '@/lib/types';
import { hrefs } from '@/lib/api-client.client';
import {
  formatBytes,
  formatPurgeDate,
  formatTimestamp,
  shortHash,
  versionPip,
} from '@/lib/format';
import { useGainedRows } from '@/lib/hooks/use-list-events';
import { Badge, Mono, Plate } from '@/components/primitives';
import { cn, muted } from '@/components/style-tokens';
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
  /**
   * The server's clock, so the date here matches the one in the slate above.
   *
   * Required, and deliberately not defaulted to `Date.now()`. A fallback here
   * reads as a convenience and is really a latent hydration bug: this file is a
   * client component, so the server would format the date against one clock and
   * the browser against another, and React would find a `<time dateTime>` that
   * does not match. It would not patch that up — it abandons the subtree, and
   * the links inside it stop working. Every time-dependent component on this
   * surface takes `nowMs` as a prop for that reason; this one cannot opt out.
   */
  nowMs: number;
}) {
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);
  const gained = useGainedRows(ordered.map((v) => v.id));

  if (versions.length === 0) {
    return <EmptyState instruction="No files yet. Your agency will publish the first version here." />;
  }

  const purgeOn = formatPurgeDate(daysToPurge, nowMs);

  return (
    <ol className="divide-y divide-rule border border-hairline border-rule">
      {ordered.map((v) => {
        const isNew = gained.has(v.id);
        return (
          <li
            key={v.id}
            className={cn(
              'flex flex-col gap-1 px-3 py-2',
              v.id === selectedId && 'bg-tint-client',
              isNew && 'animate-seat stagger',
            )}
            style={
              isNew ? ({ '--stagger-index': gained.indexOf(v.id) } as CSSProperties) : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-12 text-muted" title={v.filename}>
                {v.filename}
              </span>
              <Mono tone="muted" label="Published">
                {formatTimestamp(v.publishedAt)}
              </Mono>
              {v.id === selectedId && (
                <Badge tone="client" label="This is the version a decision binds to">
                  LATEST
                </Badge>
              )}
              {archived ? (
                <a
                  className={cn('text-12 underline underline-offset-2', muted)}
                  href={hrefs.clientExport()}
                >
                  {purgeOn ? `Export before ${purgeOn} to keep this` : 'Export to keep this'}
                </a>
              ) : (
                <a
                  className="font-mono tracking-mono text-12 text-ink underline underline-offset-2"
                  href={hrefs.clientDownload(v.id)}
                >
                  Download
                </a>
              )}
            </div>

            <Plate
              layout="strip"
              label={`Record for version ${v.versionNo}`}
              rows={[
                { term: 'Version', value: versionPip(v.versionNo) },
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
