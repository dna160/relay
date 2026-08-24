'use client';

/**
 * Subscribes to a server-sent event stream and asks the router to re-fetch the
 * server-rendered tree when something moves.
 *
 * Deliberately dumb: the event says *what* changed, not the new value. Trusting
 * a payload to patch local state is how two clients end up disagreeing about a
 * card's state; re-reading the projection is how they do not. Both streams are
 * filtered through the same visibility predicate as the REST reads, so this is
 * not a side door into the board.
 *
 * **The hook takes a URL and builds none.** There are two streams and they are
 * not interchangeable (amendment A1): the agency's is
 * `GET /api/events?engagementId=`, which authorises the parameter against the
 * org, and the client's is `GET /api/client/events`, which takes no parameter
 * at all because a client route must take its engagement from the session
 * (INV-6). Building either URL here would put the other surface's route string
 * into both bundles, and the agency one in the client bundle is exactly what
 * Phase 4's exit condition forbids. `agencyEventStreamUrl()` and
 * `CLIENT_EVENT_STREAM_URL` live in their respective halves of the API seam.
 *
 * An `EventSource` reconnects on its own, forever, with no ceiling. A route
 * that is down — or a session that has expired mid-stream — would otherwise
 * mean a board quietly retrying for as long as the tab is open. The error
 * handler closes the stream after a small number of consecutive failures
 * instead: live updates are a nice-to-have, a reconnect storm is not.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ServerEvent } from '@/lib/types';

/** How the stream is doing, for surfaces that want to say so. */
export type StreamStatus = 'connecting' | 'live' | 'dropped';

const MAX_CONSECUTIVE_FAILURES = 3;

export function useEventStream(url: string | null, enabled = true): StreamStatus {
  const router = useRouter();
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    if (!enabled || !url) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    setStatus('connecting');
    const source = new EventSource(url);

    let failures = 0;
    const onOpen = () => {
      failures = 0;
      setStatus('live');
    };
    const onError = () => {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        source.close();
        setStatus('dropped');
      } else {
        setStatus('connecting');
      }
    };

    const onMessage = (e: MessageEvent<string>) => {
      failures = 0;
      setStatus('live');
      try {
        const parsed = JSON.parse(e.data) as ServerEvent;
        if (parsed.type) router.refresh();
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    source.addEventListener('open', onOpen);
    source.addEventListener('message', onMessage);
    source.addEventListener('error', onError);
    return () => {
      source.removeEventListener('open', onOpen);
      source.removeEventListener('message', onMessage);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [url, enabled, router]);

  return status;
}
