'use client';

/**
 * The revision thread, backstage.
 *
 * Same rule as the client's — a note threads to the version it was written
 * against and never floats forward (PRD §5.3) — with two things the client's
 * does not have:
 *
 * - **internal notes.** A working note the client never sees. The client read
 *   filters `internal = false` in its SQL predicate, so an internal note is not
 *   omitted from a client response, it is never selected into one. The checkbox
 *   below is the only place that flag is ever set.
 * - **every version**, including the ones that never passed the internal gate.
 *
 * The internal state is stated on the row, not implied by its absence
 * elsewhere. Someone scanning this thread for "what did we promise them" needs
 * to be able to tell at a glance which sentences the client has actually read,
 * and a badge that only appears sometimes makes its absence ambiguous.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/primitives';
import { type RevisionNote, agencyApi } from '@/lib/api-client.agency';
import { formatTimestamp, versionPip } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { chip, cn, input, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';
import { ErrorPanel } from './error-panel';

export interface VersionThread {
  versionId: string;
  versionNo: number;
  notes: RevisionNote[];
}

function Note({ note, versionNo }: { note: RevisionNote; versionNo: number }) {
  return (
    <li className="border-l border-rule pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-14 text-ink">
          {note.authorName ?? (note.side === 'client' ? 'The client' : 'A teammate')}
        </span>
        <span className={cn(mono, 'text-12', muted)}>{formatTimestamp(note.createdAt)}</span>
        <span className={cn(mono, 'text-12', muted)}>on {versionPip(versionNo)}</span>
        <span className={chip}>{note.internal ? 'INTERNAL' : 'CLIENT CAN SEE'}</span>
      </div>
      <p className="mt-1 max-w-prose whitespace-pre-wrap text-14 text-ink">{note.body}</p>
    </li>
  );
}

export function RevisionNotes({
  engagementId,
  threads,
  latestVersionId,
  latestVersionNo,
  readOnly,
}: {
  engagementId: string;
  /** Newest version first, matching the version stack. */
  threads: VersionThread[];
  latestVersionId: string | null;
  latestVersionNo: number | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const post = useAction(agencyApi.addRevisionNote);
  const ready = body.trim().length > 0;

  const withNotes = threads.filter((t) => t.notes.length > 0);
  const pip = latestVersionNo === null ? null : versionPip(latestVersionNo);

  return (
    <section aria-label="Revision notes" className="flex flex-col gap-4">
      {withNotes.length === 0 ? (
        <EmptyState instruction="No notes on any version yet. The client's change requests land here." />
      ) : (
        withNotes.map((thread) => (
          <div key={thread.versionId} className="flex flex-col gap-2">
            <h3 className={cn(mono, 'text-12', muted)}>{versionPip(thread.versionNo)}</h3>
            <ol className="flex flex-col gap-3">
              {thread.notes.map((note) => (
                <Note key={note.id} note={note} versionNo={thread.versionNo} />
              ))}
            </ol>
          </div>
        ))
      )}

      {!readOnly && latestVersionId !== null && (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            const r = await post.run('Note added', latestVersionId, {
              engagementId,
              body: body.trim(),
              internal,
            });
            if (r.ok) {
              setBody('');
              router.refresh();
            }
          }}
        >
          <label htmlFor="agency-note" className="text-14 text-ink">
            Add a note on <span className={cn(mono, 'text-ink')}>{pip}</span>
          </label>
          <textarea
            id="agency-note"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={cn(input, 'resize-y')}
            placeholder="What changed, or what you want the client to look at."
          />
          <label className="flex items-center gap-2 text-12 text-muted">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              className="accent-ink"
            />
            Internal — the client never sees this
          </label>
          <div>
            <Button
              type="submit"
              /* Not internal: the note is addressed to the client, and the ball
                 is theirs to read it. Internal: it stays with us. */
              tone={internal ? 'agency' : 'client'}
              loading={post.pending}
              loadingLabel="Adding"
              disabled={!ready}
            >
              Add note
            </Button>
          </div>
          {post.failure && <ErrorPanel failure={post.failure} />}
        </form>
      )}
    </section>
  );
}
