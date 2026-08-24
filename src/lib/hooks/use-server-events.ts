'use client';

/**
 * Subscribes to the engagement's SSE stream and asks the router to re-fetch the
 * server-rendered tree when something moves.
 *
 * Deliberately dumb: the event says *what* changed, not the new value. Trusting
 * a payload to patch local state is how two clients end up disagreeing about a
 * card's state; re-reading the projection is how they do not. The stream is
 * filtered through the same projection as REST — it is not a side door.
 *
 * `GET /api/events` is in the contract and is not built yet. An `EventSource`
 * reconnects on its own forever, so a missing route would mean a board quietly
 * polling a 404 for as long as the tab is open. The error handler closes the
 * stream after a small number of attempts instead: live updates are a
 * nice-to-have, a reconnect storm is not.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ServerEvent } from '@/lib/types';

export function useServerEvents(engagementId: string | null, enabled = true): void {
  const router = useRouter();

  useEffect(() => {
    if (!enabled || !engagementId) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const source = new EventSource(
      `/api/events?engagementId=${encodeURIComponent(engagementId)}`,
    );

    let failures = 0;
    const onError = () => {
      failures += 1;
      if (failures >= 3) source.close();
    };

    const onMessage = (e: MessageEvent<string>) => {
      failures = 0;
      try {
        const parsed = JSON.parse(e.data) as ServerEvent;
        if (parsed.type) router.refresh();
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    source.addEventListener('message', onMessage);
    source.addEventListener('error', onError);
    return () => {
      source.removeEventListener('message', onMessage);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [engagementId, enabled, router]);
}
