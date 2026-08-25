'use client';

/**
 * Discussion on a card, backstage.
 *
 * The agency twin of `components/client/comment-thread.tsx`, duplicated rather
 * than shared for the reason the whole component tree is duplicated: a "shared"
 * thread with an `internal` prop is exactly the seam an agency-only field
 * eventually travels through, and this one carries `internal`, author user ids
 * and contact ids — every field INV-1 exists to keep out of a client response.
 * Fifteen lines against a grep-checkable rule is the trade the two `EmptyState`
 * files already made.
 *
 * ## A comment is not a revision note
 *
 * A **revision note** is bound to one immutable version and never floats
 * forward (PRD §5.3) — it is what an approval argument is made of. A
 * **comment** is about the card: the deadline, who to ask, whether the brief
 * still holds. PRD §7 cuts chat rooms and asks for both, attached to the thing
 * being discussed (ADR-011). They sit on the same page, so the copy on each has
 * to say which is which or people will reach for the wrong one.
 *
 * ## Internal is stated, not implied
 *
 * Every row says `INTERNAL` or `CLIENT CAN SEE`, always — the same rule
 * `RevisionNotes` follows. A badge that appears only sometimes makes its own
 * absence ambiguous, and the question this thread gets scanned for is "which of
 * these has the client actually read".
 *
 * A reply under an internal root is internal whatever the composer asked for:
 * the domain forces the flag and the client read drops the whole thread in SQL,
 * root and replies together. So the reply box under an internal root offers no
 * choice and says why, rather than showing a checkbox that does nothing.
 *
 * ## Threading
 *
 * One level, enforced in the domain — `postComment()` refuses a reply to a
 * reply — which is what makes it safe to draw a two-level tree from a flat
 * list. Roots arrive oldest-first with each root's replies immediately behind
 * it, because a thread on a deliverable is a record and not a feed.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Textarea } from '@/components/primitives';
import { type AgencyComment, agencyApi } from '@/lib/api-client.agency';
import { formatTimestamp } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { chip, cn, mono, muted } from '@/components/style-tokens';
import { EmptyState } from './empty-state';
import { ErrorPanel } from './error-panel';

interface Thread {
  root: AgencyComment;
  replies: AgencyComment[];
}

/**
 * Flat list to one level of nesting, in the order the server sent. Nothing is
 * re-sorted here — the order is the contract's, and deriving it twice is how
 * the two get to disagree. An orphaned reply is dropped rather than promoted to
 * a root; the agency read cannot produce one, and inventing a parent for an
 * orphan is how a renderer starts lying.
 */
function toThreads(comments: readonly AgencyComment[]): Thread[] {
  const threads: Thread[] = [];
  const byId = new Map<string, Thread>();
  for (const comment of comments) {
    if (comment.parentId === null) {
      const thread: Thread = { root: comment, replies: [] };
      byId.set(comment.id, thread);
      threads.push(thread);
    } else {
      byId.get(comment.parentId)?.replies.push(comment);
    }
  }
  return threads;
}

function Comment({ comment }: { comment: AgencyComment }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-14 text-ink">
          {comment.authorName ?? (comment.side === 'client' ? 'The client' : 'A teammate')}
        </span>
        <span className={cn(mono, 'text-12', muted)}>{formatTimestamp(comment.createdAt)}</span>
        <span className={chip}>{comment.internal ? 'INTERNAL' : 'CLIENT CAN SEE'}</span>
      </div>
      <p className="mt-1 max-w-prose whitespace-pre-wrap text-14 text-ink">{comment.body}</p>
    </>
  );
}

/**
 * The `internal` checkbox and the tone rule it drives, in one place so the
 * compose box and the reply box cannot answer it differently.
 *
 * Tone follows `RevisionNotes`: a comment the client can read is addressed to
 * them, so the ball is theirs to read it — `client`. An internal one stays with
 * us — `agency`.
 */
function InternalChoice({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-12 text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-ink"
      />
      Internal — the client never sees this
    </label>
  );
}

function ReplyForm({
  engagementId,
  cardId,
  root,
  onDone,
  onCancel,
}: {
  engagementId: string;
  cardId: string;
  root: AgencyComment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(root.internal);
  const post = useAction(agencyApi.createComment);
  const ready = body.trim().length > 0;
  // Not a choice when the root is internal: the domain forces it either way.
  const forced = root.internal;
  const effective = forced || internal;

  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        const r = await post.run('Reply added', {
          engagementId,
          cardId,
          body: body.trim(),
          parentId: root.id,
          internal: effective,
        });
        if (r.ok) {
          setBody('');
          onDone();
        }
      }}
    >
      <Textarea label="Your reply" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
      {forced ? (
        <p className={cn('text-12', muted)}>
          This thread is internal, so the reply is too. The client never sees any of it.
        </p>
      ) : (
        <InternalChoice checked={internal} onChange={setInternal} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          tone={effective ? 'agency' : 'client'}
          size="sm"
          loading={post.pending}
          loadingLabel="Adding"
          disabled={!ready}
        >
          Reply
        </Button>
        <Button tone="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {post.failure && <ErrorPanel failure={post.failure} />}
    </form>
  );
}

export function CommentThread({
  engagementId,
  cardId,
  comments,
  readOnly,
}: {
  engagementId: string;
  cardId: string;
  /** Server order, unmodified: roots oldest-first, replies behind their root. */
  comments: AgencyComment[];
  /** Archived engagements are read-only — predicted from `status`, not from a 423. */
  readOnly: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const post = useAction(agencyApi.createComment);
  const ready = body.trim().length > 0;
  const threads = toThreads(comments);

  const refresh = () => {
    setReplyingTo(null);
    router.refresh();
  };

  return (
    <section aria-label="Discussion" className="flex flex-col gap-4">
      {threads.length === 0 ? (
        <EmptyState instruction="Nothing discussed on this card yet. A question about the card — rather than about one of the files — belongs here. A remark about a file belongs in a revision note, where it stays on that version." />
      ) : (
        <ol className="flex flex-col gap-4">
          {threads.map((thread) => (
            <li key={thread.root.id} className="border-l border-rule pl-3">
              <Comment comment={thread.root} />
              {thread.replies.length > 0 && (
                <ol className="mt-3 flex flex-col gap-3 border-l border-rule pl-3">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Comment comment={reply} />
                    </li>
                  ))}
                </ol>
              )}
              {!readOnly &&
                (replyingTo === thread.root.id ? (
                  <ReplyForm
                    engagementId={engagementId}
                    cardId={cardId}
                    root={thread.root}
                    onDone={refresh}
                    onCancel={() => setReplyingTo(null)}
                  />
                ) : (
                  <div className="mt-2">
                    <Button tone="ghost" size="sm" onClick={() => setReplyingTo(thread.root.id)}>
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
            const r = await post.run('Comment added', {
              engagementId,
              cardId,
              body: body.trim(),
              internal,
            });
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
            hint="Not attached to any one version. A remark about a file goes in a revision note."
          />
          <InternalChoice checked={internal} onChange={setInternal} />
          <div>
            <Button
              type="submit"
              tone={internal ? 'agency' : 'client'}
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

      {/* Stated whether or not there is a thread. `threads.length > 0` made the
          reason disappear on exactly the card where the absence of a compose box
          is most confusing: an empty discussion on an archived engagement. */}
      {readOnly && (
        <p className={cn('text-14', muted)}>
          This engagement is archived and read-only, so no new comments can be posted. Every comment
          is still here to read and to export.
        </p>
      )}
    </section>
  );
}
