/**
 * WHAT THIS DOCKET STAMPS — the preview, used on both sides of the loop.
 *
 * The same component renders "what this template will create" in the picker and
 * on `/templates`, and "what a capture of this board would take" in the save
 * dialog. That is deliberate and it is the cheapest possible proof of the
 * phase's exit condition: if the capture preview and the stamp preview are one
 * renderer over one view model (`template-shape.ts`), the two cannot drift into
 * describing different graphs.
 *
 * ## Why the counts are mono and the name is not
 *
 * DESIGN-SYSTEM.md: mono marks a record — a value that could be cited. A
 * template's lane and card counts are facts about a document and are set in a
 * `Plate`, which is the layout this product gives to facts of that kind
 * (LABEL-SYSTEM §3a). Its *name* is prose someone typed and is set in sans. A
 * lane's name is prose too. The card count beside a lane is a record.
 *
 * ## Private lanes are stated, never warned about
 *
 * A template with private lanes is normal — private is where the agency's own
 * work lives, and a capture that dropped those lanes would stamp a board
 * missing exactly the columns the last engagement was actually run in. So the
 * count appears in the plate as a fact and each private lane carries the same
 * `PRIVATE` stamp the board and the settings register already use. There is no
 * amber, no icon and no `--breach`: `--breach` is exhaustively `roundsUsed >
 * contractedRounds`, and spending it on "this docket has a private column"
 * would leave a reader unable to tell a missed commitment from a layout.
 *
 * ## Nothing here animates
 *
 * Not on `/templates`, not in the picker, not in the dialog. A template list is
 * an initial render, and MOTION.md §5 forbids animating one; a preview changing
 * because a radio moved is a *display* change, not an event, which is the same
 * reading the card's hover-revealed controls already get.
 */

import { Plate, type PlateRow } from '@/components/primitives';
import { chip, cn, eyebrow, mono, muted } from '@/components/style-tokens';
import { plural } from '@/lib/format';
import { templateCounts, type TemplateShape } from './template-shape';

/** Beyond this many titles a lane states the remainder as a record instead. */
const TITLES_SHOWN = 6;

export interface TemplatePreviewProps {
  shape: TemplateShape;
  /**
   * Screen-reader name for the plate, e.g. "Onboarding template record". The
   * plate is a `<dl>` and an unlabelled one announces as a run of numbers.
   */
  label: string;
  /** Drops the lane breakdown and shows the plate only. The picker's rest state. */
  countsOnly?: boolean;
  /**
   * `false` when the surface around this already prints LANES and CARDS — the
   * `/templates` register does, in the entry header. Two plates four lines
   * apart, both opening `LANES 3 · CARDS 8`, read as the interface stuttering,
   * and they make the second one look like a restatement rather than the extra
   * facts it actually carries. What is left is what the header does not have:
   * the private-lane count and the contracted round default.
   */
  totals?: boolean;
  className?: string;
}

export function TemplatePreview({
  shape,
  label,
  countsOnly = false,
  totals = true,
  className,
}: TemplatePreviewProps) {
  const counts = templateCounts(shape);

  /*
    Four pairs at most, and `Plate` renders a strip of more than three as a
    stack below `xs` — which is why PRIVATE and SHELF are conditional rather
    than rendered as zeroes. A zero here is not a fact anybody needs; it is a
    pair of columns spent saying nothing at the 360px floor.
  */
  const rows: PlateRow[] = totals
    ? [
        { term: 'Lanes', value: String(counts.laneCount) },
        { term: 'Cards', value: String(counts.cardCount) },
      ]
    : [];
  if (counts.privateLaneCount > 0) {
    rows.push({
      term: 'Private',
      value: String(counts.privateLaneCount),
      title: `${plural(counts.privateLaneCount, 'lane', 'lanes')} the client never receives`,
      tone: 'muted',
    });
  }
  if (counts.shelfGroupCount > 0) {
    rows.push({ term: 'Shelf', value: String(counts.shelfGroupCount), tone: 'muted' });
  }
  if (shape.contractedRoundsDefault !== null) {
    rows.push({
      term: 'Rounds',
      value: String(shape.contractedRoundsDefault),
      title: 'Contracted revision rounds applied to any card that does not state its own',
      tone: 'muted',
    });
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* A plate with no rows is an empty box asserting nothing. */}
      {rows.length > 0 && <Plate layout="strip" label={label} rows={rows} />}

      {!countsOnly && (
        <>
          {shape.lanes.length === 0 ? (
            <p className={cn('text-14', muted)}>
              This docket has no lanes. Stamping it produces an empty board.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shape.lanes.map((lane) => {
                const shown = lane.cardTitles.slice(0, TITLES_SHOWN);
                const rest = lane.cardTitles.length - shown.length;
                return (
                  <li key={lane.name} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 flex-1 truncate text-14 text-ink">{lane.name}</span>
                      <span className={cn(mono, 'text-12', muted)}>
                        {plural(lane.cardTitles.length, 'card', 'cards')}
                      </span>
                      {/*
                        The same stamp the board and the settings register use.
                        A published lane carries no stamp at all — published is
                        the default (ADR-006) and stamping the default would
                        make the exception harder to see, not easier.
                      */}
                      {lane.visibility === 'private' && <span className={chip}>PRIVATE</span>}
                    </div>
                    {shown.length > 0 && (
                      <ul className={cn('flex flex-col gap-0.5 border-l border-rule pl-2 text-12', muted)}>
                        {shown.map((title) => (
                          <li key={title} className="truncate">
                            {title}
                          </li>
                        ))}
                        {rest > 0 && (
                          <li className={cn(mono, 'text-12')}>+{rest} more</li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {shape.shelfGroups.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className={eyebrow}>Shelf groups</h4>
              <p className={cn('text-12', muted)}>{shape.shelfGroups.join(' · ')}</p>
            </div>
          )}

          {counts.privateLaneCount > 0 && (
            <p className={cn('max-w-prose text-12', muted)}>
              A private lane and every card in it are invisible to the client — not hidden in their
              interface, never sent to it.
            </p>
          )}
        </>
      )}
    </div>
  );
}
