/**
 * The plumbing both SSE routes share.
 *
 * Not a route file — Next ignores anything under `app/` that is not `route.ts`
 * or a page, and `_guards.ts` next door sets the precedent. It lives here
 * rather than in `src/lib/` because it is HTTP-shaped: it turns a subscription
 * into a `Response`.
 *
 * The two streams differ in exactly one thing — which envelopes they are
 * allowed to emit — so that is the only thing a caller supplies. Everything
 * else (heartbeats, teardown on disconnect, back-pressure on a closed
 * controller) is identical, and identical code that is written twice diverges.
 */

import {
  HEARTBEAT_MS,
  SSE_HEADERS,
  sseComment,
  sseData,
  subscribeToEvents,
  type EventEnvelope,
} from '@/lib/sse';

/**
 * Decides whether one envelope may be emitted on this stream.
 *
 * Async because the client stream answers it with a query — the same visibility
 * predicate the REST reads use. The stream is not a side door (API-CONTRACT,
 * amendment A1), and the only way to be sure of that is to ask the same
 * question in the same place.
 */
export type EnvelopeFilter = (envelope: EventEnvelope) => Promise<boolean>;

export function eventStreamResponse(request: Request, allow: EnvelopeFilter): Response {
  const encoder = new TextEncoder();

  const frames = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      /**
       * Envelopes arrive on a synchronous notification callback but the filter
       * is async, so they are drained through one promise chain. Without it a
       * slow visibility check would let a later event overtake an earlier one
       * and the board would refresh in the wrong order — harmless for a hint,
       * confusing in a log, and free to avoid.
       */
      let queue: Promise<void> = Promise.resolve();

      const write = (chunk: string): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The consumer went away between the check and the write.
          open = false;
        }
      };

      // An immediate frame flushes any proxy that is waiting for first bytes
      // before it commits the response headers.
      write(sseComment('connected'));

      const heartbeat = setInterval(() => {
        write(sseComment('keep-alive'));
      }, HEARTBEAT_MS);

      const unsubscribe = subscribeToEvents((envelope) => {
        if (!open) return;
        queue = queue.then(async () => {
          if (!open) return;
          let permitted = false;
          try {
            permitted = await allow(envelope);
          } catch (error) {
            // A visibility check that fails closed is the only safe default: an
            // event nobody sees costs a stale board, an event the wrong person
            // sees costs INV-1.
            console.error('[sse] filter failed; dropping event', error);
            permitted = false;
          }
          if (permitted) write(sseData(envelope.event));
        });
      });

      const close = (): void => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime. Nothing to do.
        }
      };

      // Both paths matter: `abort` covers the browser navigating away, `cancel`
      // below covers the runtime tearing the response down. Missing either one
      // leaks a listener and, eventually, the LISTEN connection behind it.
      request.signal.addEventListener('abort', close);
      cleanupBySignal.set(request.signal, close);
    },

    cancel() {
      cleanupBySignal.get(request.signal)?.();
      cleanupBySignal.delete(request.signal);
    },
  });

  return new Response(frames, { status: 200, headers: SSE_HEADERS });
}

/**
 * `cancel()` has no access to the closure `start()` built, so the teardown is
 * parked here against the request's own signal. Weak keys so an aborted request
 * that never reaches `cancel()` does not pin anything.
 */
const cleanupBySignal = new WeakMap<AbortSignal, () => void>();
