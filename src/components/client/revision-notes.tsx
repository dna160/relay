'use client';

/**
 * The revision thread, client side.
 *
 * PRD §5.3: a note threads to the version it was written against and never
 * floats forward. That is the whole reason this component takes a *version* and
 * not a card. When v5 is published, the argument about v4 stays on v4 — it does
 * not reappear underneath a file it was never about, which is the failure mode
 * every card-level comment box has and the reason "which note was that about?"
 * is a question worth designing out.
 *
 * The binding is stated in mono, in the label and on every row: `on v4`. Mono
 * because it is a record — if a value would be cited in a dispute it is set in
 * mono (DESIGN-SYSTEM), and "the change you asked for on v4" is exactly the
 * kind of sentence that ends up in one.
 *
 * There is no chat here and there will not be (ADR-011). A note attaches to a
 * version, it is ordered oldest-first like a record rather than newest-first
 * like a feed, and there is no reply, no reaction, and no presence.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Textarea } from '@/components/primitives';
import { type ClientRevisionNote, clientApi } from '@/lib/api-client.client';
import { formatTimestamp, versionPip } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';
import { ErrorPanel } from './error-panel';

export interface VersionThread {
  versionId: string;
  versionNo: number;
  notes: ClientRevisionNote[];
}

function Note({ note }: { note: ClientRevisionNote }) {
  return (
    <li className="border-l border-rule pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {/*
          A name or "Your agency" — never an email and never an id. The client
          read emits no identifiers at all (INV-1), so there is nothing here to
          fall back to and nothing to accidentally render.
        */}
        <span className="text-14 text-ink">
          {note.authorName ?? (note.side === 'agency' ? 'Your agency' : 'You')}
        </span>
        <span className={cn(mono, 'text-12', muted)}>{formatTimestamp(note.createdAt)}</span>
        <span className={cn(mono, 'text-12', muted)}>on {versionPip(note.versionNo)}</span>
      </div>
      <p className="mt-1 max-w-prose whitespace-pre-wrap text-14 text-ink">{note.body}</p>
    </li>
  );
}

export function RevisionNotes({
  threads,
  latestVersionId,
  latestVersionNo,
  readOnly,
}: {
  /** Newest version first — the same order the version stack is in. */
  threads: VersionThread[];
  /** New notes attach here and nowhere else. Null when nothing is published. */
  latestVersionId: string | null;
  latestVersionNo: number | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const post = useAction(clientApi.addRevisionNote);
  const ready = body.trim().length > 0;

  const withNotes = threads.filter((t) => t.notes.length > 0);
  const pip = latestVersionNo === null ? null : versionPip(latestVersionNo);

  return (
    <section aria-label="Notes" className="flex flex-col gap-4">
      {withNotes.length === 0 ? (
        <EmptyState instruction="No notes yet. Add the first one against the latest version." />
      ) : (
        withNotes.map((thread) => (
          <div key={thread.versionId} className="flex flex-col gap-2">
            <h3 className={cn(mono, 'text-12', muted)}>{versionPip(thread.versionNo)}</h3>
            <ol className="flex flex-col gap-3">
              {thread.notes.map((note) => (
                <Note key={note.id} note={note} />
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
            const r = await post.run('Note added', latestVersionId, { body: body.trim() });
            if (r.ok) {
              setBody('');
              router.refresh();
            }
          }}
        >
          {/*
            The pip in the label and the hint was set in mono and is now plain:
            `Field`'s label, hint and error are typed `string`, and widening
            them to `ReactNode` is the primitives owner's call. The binding is
            still stated in mono where it is a record rather than a sentence —
            on the section heading and on every note row above.
          */}
          <Textarea
            label={`Add a note on ${pip}`}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say what you need. Your agency sees this against this version."
            hint={`This stays attached to ${pip}. When a newer version is published it will not follow it.`}
          />
          <div>
            <Button
              type="submit"
              tone="agency"
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

      {readOnly && (
        <p className={cn('text-14', muted)}>
          This workspace is read-only, so no new notes can be added. Every note is still here to
          read, and the export still works.
        </p>
      )}
    </section>
  );
}
