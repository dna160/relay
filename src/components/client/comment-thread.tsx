'use client';

/**
 * Discussion attaches to a card. There is no chat surface in Relay and there
 * will not be (ADR-011).
 *
 * PRD §5.3 says a note threads to the version it was written against and never
 * floats forward. The shipped route takes `cardId` and `parentId` and no
 * version, so this component does not claim a version binding it cannot honour
 * — better an honest card-level note than a label that lies about the record.
 * Raised in the handover.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ClientComment, clientApi } from '@/lib/api-client';
import { formatTimestamp } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { buttonPrimary, cn, input, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';
import { ErrorPanel } from './error-panel';

export function CommentThread({
  cardId,
  comments,
  readOnly,
}: {
  cardId: string;
  comments: ClientComment[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const post = useAction(clientApi.createComment);
  const ready = body.trim().length > 0;

  return (
    <section aria-label="Notes" className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <EmptyState instruction="No notes yet. Add the first one against the latest version." />
      ) : (
        <ol className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="border-l border-rule pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-14 text-ink">{c.authorName ?? 'You'}</span>
                <span className={cn(mono, 'text-12', muted)}>{formatTimestamp(c.createdAt)}</span>
              </div>
              <p className="mt-1 max-w-prose whitespace-pre-wrap text-14 text-ink">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      {!readOnly && (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            const r = await post.run('Note added', { cardId, body: body.trim() });
            if (r.ok) {
              setBody('');
              router.refresh();
            }
          }}
        >
          <label htmlFor="comment-body" className="text-14 text-ink">
            Add a note
          </label>
          <textarea
            id="comment-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={cn(input, 'resize-y')}
            placeholder="Say what you need. Your agency sees this against this deliverable."
          />
          <div>
            <button type="submit" className={buttonPrimary} disabled={!ready || post.pending}>
              {post.pending ? 'Adding…' : 'Add note'}
            </button>
          </div>
          {post.failure && <ErrorPanel failure={post.failure} />}
        </form>
      )}
    </section>
  );
}
