/**
 * The server-event bus behind both SSE streams (API-CONTRACT amendment A1).
 *
 * ## Why Postgres and not an in-process emitter
 *
 * `railway.json` runs two replicas in production. An in-process `EventEmitter`
 * delivers a card transition only to the browsers that happen to be attached to
 * the replica that served the mutation — which is not a bug you find in
 * development, where there is one process, and not one you find in staging,
 * where there is one process. Postgres `LISTEN`/`NOTIFY` costs one extra
 * connection per app process and is correct at any replica count. It also adds
 * no dependency: `pg` is already the driver.
 *
 * ## What travels on the wire
 *
 * An {@link EventEnvelope}, not a `ServerEvent`. The envelope carries the
 * routing and authorisation facts — which engagement, which card, which version
 * — and the `event` is what a subscriber is actually allowed to see. The
 * envelope never leaves the server: each stream filters on it and emits only
 * `envelope.event`. That separation is what lets the client stream ask "may this
 * contact see this card?" without the answer having to be encoded in the event
 * shape, and it means `ServerEvent` in `src/lib/types.ts` needs no new field.
 *
 * ## What an event is worth
 *
 * A hint that something moved, never the new value. Both surfaces respond by
 * re-reading the projection. Trusting a payload to patch local state is how two
 * browsers end up disagreeing about a card's state; re-reading is how they do
 * not. It also means a dropped event costs a stale board until the next one,
 * not a wrong one — which is why publishing is best-effort and never fails the
 * mutation that produced it.
 */

import pg from 'pg';
import { sql } from 'drizzle-orm';
import type { Executor } from '@/db/types';
import type { ServerEvent } from '@/lib/types';

/** One channel for the whole application. Filtering is the subscriber's job. */
const CHANNEL = 'relay_events';

/**
 * Postgres caps a NOTIFY payload at 8000 bytes. Every envelope this file builds
 * is a handful of uuids and a type string, so the cap is a guard against a
 * future event that forgets, not a limit anything approaches today.
 */
const MAX_PAYLOAD_BYTES = 7_500;

export interface EventEnvelope {
  /** Every event belongs to exactly one engagement. Both streams filter on it. */
  engagementId: string;
  /** The card the event concerns, when it concerns one. Drives INV-1 filtering. */
  cardId: string | null;
  /** The version the event concerns, when it concerns one. */
  versionId: string | null;
  /** The only part a subscriber ever receives. */
  event: ServerEvent;
}

type Listener = (envelope: EventEnvelope) => void;

/* ------------------------------------------------------------------ publish */

/**
 * Publishes on the caller's executor, so a publish inside a transaction is
 * delivered when — and only when — that transaction commits. Postgres queues
 * NOTIFY until commit; a rolled-back transition therefore announces nothing,
 * which is the behaviour we would otherwise have had to write by hand and get
 * wrong.
 *
 * Never throws. A failed announcement leaves a board stale until its next read;
 * a failed announcement that also 500s the transition that caused it turns a
 * cosmetic problem into a lost approval.
 */
export async function publishEvent(exec: Executor, envelope: EventEnvelope): Promise<void> {
  try {
    const payload = JSON.stringify(envelope);
    if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
      console.error('[sse] envelope too large to notify', envelope.event.type);
      return;
    }
    await exec.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
  } catch (error) {
    console.error('[sse] publish failed', error);
  }
}

/* ---------------------------------------------------------------- subscribe */

interface Hub {
  listeners: Set<Listener>;
  client: pg.Client | null;
  connecting: Promise<void> | null;
  /** Backoff for a listener connection that dropped. Reset on a good connect. */
  retryMs: number;
  closed: boolean;
}

declare global {
  var __relayEventHub: Hub | undefined;
}

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 30_000;

function hub(): Hub {
  globalThis.__relayEventHub ??= {
    listeners: new Set(),
    client: null,
    connecting: null,
    retryMs: RETRY_MIN_MS,
    closed: false,
  };
  return globalThis.__relayEventHub;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

/**
 * One `LISTEN` connection per process, shared by every open stream.
 *
 * Deliberately not taken from the pool: a pooled client held open for the life
 * of a browser tab is a pooled client that never comes back, and the pool is
 * sized for requests.
 */
async function ensureListening(): Promise<void> {
  const h = hub();
  if (h.client || h.listeners.size === 0) return;
  if (h.connecting) return h.connecting;

  h.connecting = (async () => {
    const client = new pg.Client({ connectionString: connectionString() });

    client.on('notification', (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      let envelope: EventEnvelope;
      try {
        envelope = JSON.parse(message.payload) as EventEnvelope;
      } catch {
        return; // A malformed frame is not worth tearing the connection down for.
      }
      for (const listener of hub().listeners) {
        try {
          listener(envelope);
        } catch (error) {
          // One stream's failure must not stop delivery to the others.
          console.error('[sse] listener threw', error);
        }
      }
    });

    client.on('error', (error) => {
      console.error('[sse] listen connection error', error);
      const current = hub();
      current.client = null;
      current.connecting = null;
      void client.end().catch(() => undefined);
      scheduleReconnect();
    });

    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);

    const current = hub();
    current.client = client;
    current.retryMs = RETRY_MIN_MS;
  })();

  try {
    await h.connecting;
  } catch (error) {
    console.error('[sse] could not start listening', error);
    const current = hub();
    current.client = null;
    scheduleReconnect();
  } finally {
    hub().connecting = null;
  }
}

function scheduleReconnect(): void {
  const h = hub();
  if (h.listeners.size === 0 || h.client) return;
  const delay = h.retryMs;
  h.retryMs = Math.min(delay * 2, RETRY_MAX_MS);
  setTimeout(() => {
    void ensureListening();
  }, delay).unref?.();
}

/**
 * Registers a listener and returns its unsubscribe.
 *
 * The connection is opened on the first subscriber and closed after the last
 * one leaves, so an idle deployment holds no extra database connection at all.
 */
export function subscribeToEvents(listener: Listener): () => void {
  const h = hub();
  h.listeners.add(listener);
  void ensureListening();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = hub();
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && current.client) {
      const client = current.client;
      current.client = null;
      current.retryMs = RETRY_MIN_MS;
      void client.end().catch(() => undefined);
    }
  };
}

/* --------------------------------------------------------------- SSE framing */

/**
 * Headers every stream response carries.
 *
 * `X-Accel-Buffering: no` is the one that is easy to omit and expensive to
 * debug: behind a buffering proxy the frames are held until the response ends,
 * which for a stream is never, and the board simply looks dead.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'private, no-cache, no-store, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

/**
 * Heartbeat interval. A comment frame keeps proxies and load balancers from
 * reaping an idle stream; `EventSource` ignores comments, so it costs the
 * browser nothing.
 */
export const HEARTBEAT_MS = 25_000;

export function sseData(event: ServerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function sseComment(text: string): string {
  return `: ${text}\n\n`;
}
