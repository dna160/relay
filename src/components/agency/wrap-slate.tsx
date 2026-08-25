'use client';

/**
 * WrapSlate — the persistent mono strip in the workspace header:
 * `WRAP +12d · PURGE IN 48d · EXPORT`
 *
 * Ephemerality is stated, never sprung. There is no dismiss control on this
 * component and adding one would be a product regression, not a UX improvement:
 * the strip is the only continuous statement that this workspace has an end
 * date, and it is also the conversion surface (COMPONENTS.md §6, rule 1).
 *
 * `daysToPurge === null` — a retaining plan — replaces the countdown with a
 * `RETAINED` badge and the strip stays. Its job is to say what happens to this
 * workspace, and "nothing" is an answer (rule 3).
 *
 * **Escalation is by weight and surface area, and the countdown never turns
 * red.** `--breach` is exhaustively `roundsUsed > contractedRounds`. A scheduled
 * deletion the reader was warned about four times is the contract working, not
 * a breached commitment, and spending the red here would spend it everywhere.
 * The four bands live in `purgeBand()` so this file and the board strip cannot
 * disagree about where 14 days is.
 *
 * `nowMs` is a prop rather than a `Date.now()` call. This is a client component
 * whose text is produced on the server first: reading the clock twice puts a
 * hydration mismatch one midnight boundary away from every workspace page.
 */

import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import {
  formatPurgeCountdown,
  formatPurgeDate,
  formatWrapAge,
  purgeBand,
  purgeDateISO,
  type PurgeBand,
} from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { Badge, Mono } from '@/components/primitives';
import { cn, muted } from '@/components/style-tokens';
import { ExportControl } from './export-control';

export interface WrapSlateProps {
  engagementId: string;
  wrappedAt: string | null;
  /** Null on a retaining plan — paid plans null out the countdown entirely. */
  daysToPurge: number | null;
  archived: boolean;
  /** The server's clock, so the server render and its hydration agree. */
  nowMs: number;
}

/** COMPONENTS.md §6 — weight, never hue. */
const RECORD_TONE: Record<PurgeBand, 'muted' | 'ink'> = {
  retained: 'muted',
  distant: 'muted',
  near: 'ink',
  imminent: 'ink',
  today: 'ink',
};

function recordWeight(band: PurgeBand): string {
  return band === 'imminent' || band === 'today' ? 'font-semibold' : '';
}

export function WrapSlate({
  engagementId,
  wrappedAt,
  daysToPurge,
  archived,
  nowMs,
}: WrapSlateProps) {
  const router = useRouter();
  const wrap = useAction(agencyApi.wrap);

  const band = purgeBand(daysToPurge);
  const wrapAge = formatWrapAge(wrappedAt, nowMs);
  const countdown = formatPurgeCountdown(daysToPurge);
  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);

  return (
    <aside
      role="region"
      aria-label="Engagement lifecycle"
      className={cn(
        'sticky top-0 z-slate w-full bg-paper px-3 py-1.5 sm:h-9 sm:py-0',
        'flex flex-col justify-center border-b-hairline',
        // The strip's own border is the fourth band's extra surface area.
        band === 'imminent' || band === 'today' ? 'border-ink' : 'border-rule-strong',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {wrapAge ? (
            <Mono tone="ink" label="Days since wrap">
              {wrapAge}
            </Mono>
          ) : (
            /*
             * Not wrapped yet, so the first record is the control that starts
             * the countdown rather than a reading of it. It is a mutation, so on
             * an archived engagement it is disabled and says why rather than
             * failing on submit with a 423.
             */
            <button
              type="button"
              disabled={wrap.pending || archived}
              title={
                archived
                  ? 'This engagement is archived and read-only. Its countdown has already started.'
                  : 'Mark delivered and start the retention countdown'
              }
              onClick={async () => {
                const r = await wrap.run('Wrapped', engagementId);
                if (r.ok) router.refresh();
              }}
              className={cn(
                'font-mono tracking-mono tabular-nums text-12 text-ink',
                'underline underline-offset-2',
                'disabled:no-underline disabled:cursor-not-allowed disabled:text-muted',
              )}
            >
              {wrap.pending ? 'WRAPPING…' : 'WRAP'}
            </button>
          )}

          <span aria-hidden="true" className={muted}>
            ·
          </span>

          {countdown === null ? (
            <Badge tone="neutral" label="This plan retains this workspace indefinitely">
              RETAINED
            </Badge>
          ) : (
            <Mono
              as="time"
              dateTime={purgeOnISO ?? undefined}
              tone={RECORD_TONE[band]}
              label="Days until purge"
              title={purgeOn ? `Everything here is destroyed on ${purgeOn}` : undefined}
              className={recordWeight(band)}
            >
              {countdown}
            </Mono>
          )}

          {archived && (
            <>
              <span aria-hidden="true" className={muted}>
                ·
              </span>
              <Mono tone="muted" label="This engagement is">
                READ-ONLY
              </Mono>
            </>
          )}
        </div>

        <ExportControl engagementId={engagementId} tone="quiet" size="sm" />
      </div>

      {/*
        Band four's extra weight: a second line, in prose rather than mono,
        because it is the one thing on this strip that is an instruction rather
        than a record. The date is absolute — a relative countdown alone is
        unactionable in a calendar (FLOWS.md §3).
      */}
      {band === 'today' && (
        <p className="text-14 font-medium text-ink">
          Everything in this workspace is deleted today
          {purgeOn ? `, ${purgeOn}` : ''}. Export now.
        </p>
      )}

      {wrap.failure && (
        <p role="alert" className="border-t-hairline border-ink pt-1 text-12 font-semibold text-ink">
          That did not go through. Nothing has changed — try again.
        </p>
      )}
    </aside>
  );
}
