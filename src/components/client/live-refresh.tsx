'use client';

/**
 * The client's live connection to their own workspace.
 *
 * `GET /api/client/events` takes **no parameter** (amendment A1). The frozen
 * contract had one stream with `?engagementId=`, and for a client session that
 * is precisely what INV-6 forbids — a client's engagement comes from the
 * session and never from the request. There is nothing to pass here, which is
 * why this component takes no props about *which* workspace it is watching.
 *
 * It renders in the workspace layout rather than on the board, so a contact
 * sitting on the queue or on a card sees the same updates. Every frame is
 * filtered server-side through the same visibility predicate as the REST reads:
 * an event about a private lane or an unpublished version never arrives, since
 * its mere arrival would be a signal about something meant to be invisible.
 *
 * The only visible output is the dropped state. A workspace that is quietly no
 * longer updating is worse than one that says so — this is a product where
 * someone waits on a page for a file to appear.
 */

import { CLIENT_EVENT_STREAM_URL } from '@/lib/api-client.client';
import { useEventStream } from '@/lib/hooks/use-server-events';
import { cn, muted } from '@/components/style-tokens';

export function LiveRefresh({ enabled = true }: { enabled?: boolean }) {
  const status = useEventStream(CLIENT_EVENT_STREAM_URL, enabled);

  if (status !== 'dropped') return null;

  return (
    <p role="status" className={cn('text-12', muted)}>
      This page stopped updating on its own. Everything below is still what it was a moment ago —{' '}
      <button
        type="button"
        className="underline hover:text-ink"
        onClick={() => window.location.reload()}
      >
        reload to check for anything new
      </button>
      .
    </p>
  );
}
