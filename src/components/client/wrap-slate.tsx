/**
 * The client's wrap slate — `WRAP +12d · DELETED IN 48d · EXPORT EVERYTHING`.
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
 *
 * ## Three marks (LABEL-SYSTEM.md §5)
 *
 * **The registration mark** at the head says this document was *issued* — by a
 * system, at a moment. It is the printer's crosshair where the plates line up,
 * and it is the only circle in a product whose radius ceiling is 3px.
 *
 * **The countdown is a `Plate layout="strip"`.** Hairlines rather than gaps, at
 * the density the reference sheets have. Nothing new is stated: it is the same
 * two records this strip already carried, now with their terms printed beside
 * them, which is also what turns the strip into a `<dl>` a screen reader can
 * read as terms and values rather than a run of numbers.
 *
 * **The hazard band** appears only inside the purge zone, and it has exactly one
 * referent in this product: the purge boundary. Achromatic, because `--breach`
 * means `roundsUsed > contractedRounds` and a reservation that bends once is not
 * a reservation. Diagonals in black and white carry "there is a line here and a
 * far side to it" without carrying "panic" — and the band never appears without
 * the countdown beside it saying what the boundary is.
 *
 * Nothing here animates. The countdown ticking is on the restraint list
 * (MOTION.md §5): a number that animates reads as urgency, and ephemerality in
 * this product is stated, never sprung.
 */

import { hrefs } from '@/lib/api-client.client';
import {
  formatPurgeCountdown,
  formatPurgeDate,
  purgeBand,
  purgeCountdownValue,
  purgeDateISO,
  wrapAgeValue,
  type PurgeBand,
} from '@/lib/format';
import { Badge, Plate, RegistrationMark, Rule, type PlateRow } from '@/components/primitives';
import { buttonClass, cn } from '@/components/style-tokens';

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
  const wrapAge = wrapAgeValue(wrappedAt, nowMs);
  const countdown = formatPurgeCountdown(daysToPurge);
  const purgeOn = formatPurgeDate(daysToPurge, nowMs);
  const purgeOnISO = purgeDateISO(daysToPurge, nowMs);
  const heavy = band === 'imminent' || band === 'today';

  /**
   * The strip's records, as plate rows. `RETAINED` stays a `Badge` rather than
   * becoming a row: a retaining plan is a marker on the workspace, not a
   * measurement of it, and a badge is what this product stamps a fact with.
   */
  const rows: PlateRow[] = [];
  if (wrapAge) rows.push({ term: 'Wrap', value: wrapAge });
  if (countdown !== null) {
    rows.push({
      /*
       * `DELETED`, not `PURGE`.
       *
       * `PURGE` is Relay's own noun, from the vocabulary table, and it is
       * correct on the agency's surface. Here it was an internal word printed at
       * somebody who has never used Relay and did not choose to be here — one
       * line above a control they are then expected to infer the purpose of.
       * Every other piece of client copy in the product already says *deleted*,
       * including this row's own `title` directly below, which has been saying
       * "Everything here is deleted on…" under a term reading `PURGE` the whole
       * time.
       *
       * One `<dt>` string. The value, the `<time>`, the `title` and the whole
       * escalation ladder are untouched — this is the difference between a
       * record and a record in a language the reader speaks.
       */
      term: 'Deleted',
      tone: RECORD_TONE[band],
      value: (
        <time dateTime={purgeOnISO ?? undefined} className={heavy ? 'font-semibold' : undefined}>
          {purgeCountdownValue(daysToPurge)}
        </time>
      ),
      title: purgeOn ? `Everything here is deleted on ${purgeOn}` : undefined,
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
        heavy ? 'border-ink' : 'border-rule-strong',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {/* This workspace was issued, on a date, by a system. */}
          <RegistrationMark />

          {rows.length > 0 && (
            <Plate layout="strip" label="Workspace lifecycle" rows={rows} className="py-0.5" />
          )}

          {countdown === null && (
            <Badge tone="neutral" label="Your agency retains this workspace indefinitely">
              RETAINED
            </Badge>
          )}
        </div>

        {/*
          Followed, never fetched. The archive is streamed from storage and the
          route is a direct link, which is also why it survives an archived
          workspace and a page with no JavaScript on it at all.

          `Export everything`, and never `Export` — the same label wherever it
          appears: slate, board strip, settings page, email (FLOWS.md §3, and the
          verb-takes-an-object rule in DESIGN-SYSTEM.md). This comment already
          claimed it was "the same label as the full-size control on the board
          strip" while rendering a different one, which is how a copy rule dies:
          not by being argued with, but by a comment asserting compliance next to
          the exception.

          The client's control never changes with the plan, in either direction.
          Their right to take a copy is not a function of somebody else's
          billing, so this renders on `RETAINED` too — unlike the agency strip,
          which carries no control there at all.
        */}
        <a className={cn(buttonClass('quiet', 'sm'), 'shrink-0')} href={hrefs.clientExport()}>
          Export everything
        </a>
      </div>

      {band === 'today' && (
        <p className="text-14 font-medium text-ink">
          Everything in this workspace is deleted today
          {purgeOn ? `, ${purgeOn}` : ''}. Export now.
        </p>
      )}

      {/*
        The purge boundary, and the only place in this product that draws one.
        `aria-hidden`, and never the only channel: the countdown directly above
        it says what the line is and when it is crossed.
      */}
      {heavy && <Rule weight="hazard" className="mt-1" />}
    </aside>
  );
}
