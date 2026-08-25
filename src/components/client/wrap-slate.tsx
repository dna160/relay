/**
 * The client's wrap slate — `WRAP +12d · PURGE IN 48d · EXPORT`.
 *
 * Rendered on **both** sides (COMPONENTS.md §6, rule 2). The client sees the
 * same countdown the agency sees, because the agency's contract with its client
 * almost certainly obliges it to retain deliverables, and a silent purge
 * manufactures a breach out of a scheduled deletion. So the client receives
 * every notice the agency receives, plus the export — which is never paywalled.
 *
 * Non-dismissible, like its agency twin, and it does not disappear on a
 * retaining plan: `daysToPurge === null` swaps the countdown for a `RETAINED`
 * badge and the strip stays. Its job is to say what happens to this workspace,
 * and "nothing" is an answer.
 *
 * A server component. The countdown comes from the server, the export is an
 * anchor, and there is nothing here to hydrate — which is how the client board
 * keeps its 1.5s-on-4G budget with 178 bytes of route JavaScript.
 *
 * The escalation is by weight, and the countdown never turns red. `--breach` is
 * a breached commitment; a scheduled deletion stated on screen one, in the
 * footer of the sign-in page, and again here every single visit is the opposite
 * of a breach.
 */

import { hrefs } from '@/lib/api-client.client';
import {
  formatPurgeCountdown,
  formatPurgeDate,
  formatWrapAge,
  purgeBand,
  purgeDateISO,
  type PurgeBand,
} from '@/lib/format';
import { Badge, Mono } from '@/components/primitives';
import { buttonClass, cn, muted } from '@/components/style-tokens';

const RECORD_TONE: Record<PurgeBand, 'muted' | 'ink'> = {
  retained: 'muted',
  distant: 'muted',
  near: 'ink',
  imminent: 'ink',
  today: 'ink',
};

export function WrapSlate({
  daysToPurge,
  wrappedAt = null,
  archived = false,
  nowMs,
}: {
  /** Null on a retaining plan. */
  daysToPurge: number | null;
  /** Not yet carried by the client header — see the handover. */
  wrappedAt?: string | null;
  archived?: boolean;
  /** The server's clock, passed so every formatter on the page agrees on "now". */
  nowMs: number;
}) {
  const band = purgeBand(daysToPurge);
  const wrapAge = formatWrapAge(wrappedAt, nowMs);
  const countdown = formatPurgeCountdown(daysToPurge);
  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);
  const heavy = band === 'imminent' || band === 'today';

  return (
    <aside
      role="region"
      aria-label="Engagement lifecycle"
      className={cn(
        'sticky top-0 z-slate w-full bg-paper px-3 py-1.5 sm:h-9 sm:py-0',
        'flex flex-col justify-center border-b-hairline',
        heavy ? 'border-ink' : 'border-rule-strong',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {wrapAge && (
            <>
              <Mono tone="ink" label="Days since wrap">
                {wrapAge}
              </Mono>
              <span aria-hidden="true" className={muted}>
                ·
              </span>
            </>
          )}

          {countdown === null ? (
            <Badge tone="neutral" label="Your agency retains this workspace indefinitely">
              RETAINED
            </Badge>
          ) : (
            <Mono
              as="time"
              dateTime={purgeOnISO ?? undefined}
              tone={RECORD_TONE[band]}
              label="Days until this workspace is deleted"
              title={purgeOn ? `Everything here is deleted on ${purgeOn}` : undefined}
              className={heavy ? 'font-semibold' : ''}
            >
              {countdown}
            </Mono>
          )}

          {archived && (
            <>
              <span aria-hidden="true" className={muted}>
                ·
              </span>
              <Mono tone="muted" label="This workspace is">
                READ-ONLY
              </Mono>
            </>
          )}
        </div>

        {/*
          Followed, never fetched. The archive is streamed from storage and the
          route is a direct link, which is also why it survives an archived
          workspace and a page with no JavaScript on it at all. Same label as the
          full-size control on the board strip (FLOWS.md §3), `quiet` here.
        */}
        <a className={buttonClass('quiet', 'sm')} href={hrefs.clientExport()}>
          Export
        </a>
      </div>

      {band === 'today' && (
        <p className="text-14 font-medium text-ink">
          Everything in this workspace is deleted today
          {purgeOn ? `, ${purgeOn}` : ''}. Export now.
        </p>
      )}
    </aside>
  );
}
