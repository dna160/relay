'use client';

/**
 * WrapSlate — the persistent mono strip in the workspace header:
 * `WRAP +12d · PURGE IN 48d · KEEP THIS WORKSPACE`
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
 *
 * ## Three marks (LABEL-SYSTEM.md §5)
 *
 * **The registration mark** at the head says this document was *issued* — the
 * printer's crosshair where the plates line up, and the only circle in a product
 * whose radius ceiling is 3px.
 *
 * **The countdown is a `Plate layout="strip"`** — hairlines rather than gaps,
 * at the density the reference sheets have, and a `<dl>` a screen reader can
 * read as terms and values rather than as a run of numbers. Nothing new is
 * stated; these are the records the strip already carried.
 *
 * **The hazard band** appears only inside the purge zone and has exactly one
 * referent in this product: the purge boundary. Achromatic, because `--breach`
 * means `roundsUsed > contractedRounds` and nothing else. It never appears
 * without the countdown beside it saying what the line is.
 *
 * `WRAP` stays outside the plate. A plate carries records; `WRAP` here is a
 * control that starts the countdown, and a button inside a `<dl>` value would be
 * a control dressed as a measurement.
 *
 * Nothing on this strip animates. The countdown ticking is on the restraint
 * list (MOTION.md §5) — a number that animates reads as urgency, and
 * ephemerality in this product is stated, never sprung.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import {
  formatPurgeCountdown,
  formatPurgeDate,
  purgeBand,
  purgeCountdownValue,
  purgeDateISO,
  wrapAgeValue,
  type PurgeBand,
} from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import {
  Badge,
  Plate,
  RegistrationMark,
  Rule,
  type PlateRow,
} from '@/components/primitives';
import { buttonClass, cn } from '@/components/style-tokens';

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
  const wrapAge = wrapAgeValue(wrappedAt, nowMs);
  const countdown = formatPurgeCountdown(daysToPurge);
  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);

  const heavy = band === 'imminent' || band === 'today';

  const rows: PlateRow[] = [];
  if (wrapAge) rows.push({ term: 'Wrap', value: wrapAge });
  if (countdown !== null) {
    rows.push({
      term: 'Purge',
      tone: RECORD_TONE[band],
      value: (
        <time dateTime={purgeOnISO ?? undefined} className={recordWeight(band)}>
          {purgeCountdownValue(daysToPurge)}
        </time>
      ),
      title: purgeOn ? `Everything here is destroyed on ${purgeOn}` : undefined,
    });
  }
  if (archived) rows.push({ term: 'Status', tone: 'muted', value: 'READ-ONLY' });

  return (
    <aside
      role="region"
      aria-label="Engagement lifecycle"
      className={cn(
        'sticky top-0 z-slate w-full bg-paper px-3 py-1.5 sm:h-9 sm:py-0',
        'flex flex-col justify-center border-b-hairline',
        // The strip's own border is the fourth band's extra surface area.
        heavy ? 'border-ink' : 'border-rule-strong',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {/* This workspace was issued, on a date, by a system. */}
          <RegistrationMark />

          {!wrapAge && (
            /*
             * Not wrapped yet, so the first thing on the strip is the control
             * that starts the countdown rather than a reading of it. It is a
             * mutation, so on an archived engagement it is disabled and says why
             * rather than failing on submit with a 423.
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

          {rows.length > 0 && (
            <Plate layout="strip" label="Engagement lifecycle record" rows={rows} className="py-0.5" />
          )}

          {countdown === null && (
            <Badge tone="neutral" label="This plan retains this workspace indefinitely">
              RETAINED
            </Badge>
          )}
        </div>

        {/*
          The one control, and it is the agency's — not the client's.

          This strip used to carry `Export everything`. `FLOWS.md` §3 assigns the
          agency **Keep this workspace** (the conversion) and the client
          **Export everything** (the rescue), and states that the two are never
          swapped. Rendering the client's rescue on the agency's header was
          exactly that swap, which meant the strip `DESIGN-SYSTEM.md` calls "the
          conversion surface" was not one on the side that converts. Worse, on a
          strip whose whole subject is deletion, a lone button reading `Export`
          reads as the answer to it — and exporting is the one thing that does
          *not* stop a purge. The settings page already says so in a sentence,
          written because somebody had already made that mistake in prose.

          A link, not a button, and it is never disabled: it goes to the
          retention section of settings, which already carries the correct
          sentence about what retaining is and what it is not. The anchor
          already existed for the ≤14-day board strip to point at.

          The agency's export has not been taken away — it lives on the settings
          page beneath the sentence that distinguishes it from retaining, and on
          the ≤14-day board strip where §3 already places both actions together.
          Nobody exports a live workspace on day three, and putting the rescue
          where the conversion belonged cost the product both.
        */}
        {countdown !== null && (
          <Link
            href={`/w/${engagementId}/settings#settings-retention`}
            className={cn(buttonClass('quiet', 'sm'), 'shrink-0')}
          >
            Keep this workspace
          </Link>
        )}
        {/*
          On `RETAINED` the strip carries no control at all. There is nothing to
          keep, the badge is the whole answer, and a button beside it would be a
          control with no job — the same defect one step quieter (§6 rule 5:
          one control, at most).
        */}
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

      {/*
        The purge boundary, and the only place in this product that draws one.
        `aria-hidden`, and never the only channel: the countdown directly above
        says what the line is and when it is crossed.
      */}
      {heavy && <Rule weight="hazard" className="mt-1" />}
    </aside>
  );
}
