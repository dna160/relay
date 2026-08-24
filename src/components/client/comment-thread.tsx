'use client';

/**
 * Discussion on a card, client side.
 *
 * This component was deleted in round 2 and is back on the architect's ruling.
 * The reason it was deleted was not that card-level comments are wrong — PRD §7
 * cuts chat rooms and says in the same breath that discussion attaches to cards
 * *and* versions — it was that `POST /api/client/comments` had shipped without
 * a reader. A contact would have been given a box, typed into it, and watched
 * their own words vanish. `GET /api/client/comments?cardId=` has now shipped,
 * so the thread can be read back, and the objection is spent.
 *
 * ## A comment is not a revision note
 *
 * They sit on the same page and they are not the same thing, so the copy on
 * both has to say which is which or people will use the wrong one.
 *
 * - A **revision note** is bound to one immutable version. "This crop is wrong
 *   on v4" stays on v4 when v5 lands (PRD §5.3). It is what an approval
 *   argument is made of, and `RevisionNotes` renders it under a mono `on v4`.
 * - A **comment** is about the card: can we move the deadline, who is the right
 *   person to ask, is this still the brief. It has no version binding and
 *   claims none.
 *
 * That is why this component takes a `cardId` and never a version, and why the
 * empty state below spends a sentence sending file-specific remarks to the
 * other control rather than assuming anyone will guess.
 *
 * ## Threading
 *
 * One level, enforced in the domain — `postComment()` refuses a reply to a
 * reply — which is what makes it safe to draw a two-level tree from a flat
 * list. The read arrives roots-first with each root's replies immediately
 * behind it, oldest first, because a thread on a deliverable is a record and
 * not a feed. A reply whose root is missing is dropped rather than promoted to
 * a root: with the shipped SQL that cannot happen, and inventing a parent for
 * an orphan is how a renderer starts lying.
 *
 * There is no reaction, no presence, no typing indicator, and no room. That is
 * still ADR-011 and it has not moved.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Textarea } from '@/components/primitives';
import { type ClientComment, clientApi } from '@/lib/api-client.client';
import { formatTimestamp } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { cn, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';
import { ErrorPanel } from './error-panel';

interface Thread {
  root: ClientComment;
  replies: ClientComment[];
}

/**
 * Flat list to one level of nesting. Roots keep the order the server sent;
 * replies keep theirs. Nothing is sorted here — the order is the contract's and
 * re-deriving it locally is how the two get to disagree.
 */
function toThreads(comments: readonly ClientComment[]): Thread[] {
  const threads: Thread[] = [];
  const byId = new Map<string, Thread>();
  for (const comment of comments) {
    if (comment.parentId === null) {
      const thread: Thread = { root: comment, replies: [] };
      byId.set(comment.id, thread);
      threads.push(thread);
    } else {
      // Dropped, not promoted. See the header.
      byId.get(comment.parentId)?.replies.push(comment);
    }
  }
  return threads;
}

/**
 * A name, "Your agency", or "You". Never an email and never an id — the client
 * read emits no identifiers of people at all, so there is nothing here to fall
 * back to and nothing to render by accident (INV-1).
 */
function authorLabel(comment: ClientComment): string {
  return comment.authorName ?? (comment.side === 'agency' ? 'Your agency' : 'You');
}

function Meta({ comment }: { comment: ClientComment }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-14 text-ink">{authorLabel(comment)}</span>
      <span className={cn(mono, 'text-12', muted)}>{formatTimestamp(comment.createdAt)}</span>
    </div>
  );
}

/** The reply box. Mounted only once its root's Reply has been pressed. */
function ReplyForm({
  cardId,
  parentId,
  onDone,
  onCancel,
}: {
  cardId: string;
  parentId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState('');
  const post = useAction(clientApi.createComment);
  const ready = body.trim().length > 0;

  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        const r = await post.run('Reply added', { cardId, body: body.trim(), parentId });
        if (r.ok) {
          setBody('');
          onDone();
        }
      }}
    >
      <Textarea
        label="Your reply"
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          tone="client"
          size="sm"
          loading={post.pending}
          loadingLabel="Adding"
          disabled={!ready}
        >
          Reply
        </Button>
        {/* Reversible, moves nothing: `ghost`, per the tone rule. */}
        <Button tone="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {post.failure && <ErrorPanel failure={post.failure} />}
    </form>
  );
}

export function CommentThread({
  cardId,
  comments,
  readOnly,
}: {
  cardId: string;
  /** Server order, unmodified: roots oldest-first, replies behind their root. */
  comments: ClientComment[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const post = useAction(clientApi.createComment);
  const ready = body.trim().length > 0;
  const threads = toThreads(comments);

  const refresh = () => {
    setReplyingTo(null);
    router.refresh();
  };

  return (
    <section aria-label="Discussion" className="flex flex-col gap-4">
      {threads.length === 0 ? (
        <EmptyState
          instruction={
            readOnly
              ? 'Nothing was discussed on this card.'
              : 'Nothing here yet. Use this for anything about the card itself — a question, a date, who to ask. A remark about one of the files goes under Notes, where it stays attached to that version.'
          }
        />
      ) : (
        <ol className="flex flex-col gap-4">
          {threads.map((thread) => (
            <li key={thread.root.id} className="border-l border-rule pl-3">
              <Meta comment={thread.root} />
              <p className="mt-1 max-w-prose whitespace-pre-wrap text-14 text-ink">
                {thread.root.body}
              </p>

              {thread.replies.length > 0 && (
                <ol className="mt-3 flex flex-col gap-3 border-l border-rule pl-3">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Meta comment={reply} />
                      <p className="mt-1 max-w-prose whitespace-pre-wrap text-14 text-ink">
                        {reply.body}
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              {!readOnly &&
                (replyingTo === thread.root.id ? (
                  <ReplyForm
                    cardId={cardId}
                    parentId={thread.root.id}
                    onDone={refresh}
                    onCancel={() => setReplyingTo(null)}
                  />
                ) : (
                  <div className="mt-2">
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => setReplyingTo(thread.root.id)}
                    >
                      Reply
                    </Button>
                  </div>
                ))}
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
            const r = await post.run('Comment added', { cardId, body: body.trim() });
            if (r.ok) {
              setBody('');
              refresh();
            }
          }}
        >
          <Textarea
            label="Start a new thread"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Anything about this card that is not about one particular file."
            hint="Your agency sees this against this card. It is not attached to any one version — for that, use Notes."
          />
          <div>
            {/* `client`: a comment hands nothing over, so the ball stays on
                this side of the workspace. Same sentence as the access form. */}
            <Button
              type="submit"
              tone="client"
              loading={post.pending}
              loadingLabel="Adding"
              disabled={!ready}
            >
              Add comment
            </Button>
          </div>
          {post.failure && <ErrorPanel failure={post.failure} />}
        </form>
      )}

      {readOnly && threads.length > 0 && (
        <p className={cn('text-14', muted)}>
          This workspace is read-only. Every comment is still here to read.
        </p>
      )}
    </section>
  );
}
