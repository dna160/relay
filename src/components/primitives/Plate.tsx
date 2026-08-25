import type { ReactNode } from 'react';
import { cn } from './cn';
import { Mono } from './Mono';

/**
 * THE DATA PLATE — the batch/serial block off an industrial spec label.
 *
 * A dense mono key/value table on a recessed ground, for the values that are
 * already records: the card id, the version, the sha256 prefix, the byte
 * count, the wrap and purge dates, the round count. It is a `<dl>`, because
 * that is what it is: terms and their values.
 *
 * WHY THIS IS NATIVE AND NOT A THEME. DESIGN-SYSTEM.md already says mono marks
 * everything that could be cited in a dispute. A spec-label plate is that rule
 * given a shape — the same values, set at the density the reference sheets
 * have, in the place a reader looks for a serial number. Nothing here is new
 * information and nothing here is decoration; the plate is a layout for facts
 * the product already publishes one at a time.
 *
 * THE GROUND IS `--paper`, deliberately. On a card (`--paper-2`) it reads one
 * step recessed in both light and dark, and it is a ground the contrast table
 * in `src/styles/a11y-contract.ts` already covers on every text token. A
 * bespoke mix would be a new contrast pair nobody measured.
 *
 * Keys are `--muted` (4.87:1 light / 6.64:1 dark on `--paper`), values are
 * `--ink`. Both are asserted pairs.
 */
export interface PlateRow {
  /** The term. Rendered uppercase; keep it to one or two words. */
  readonly term: string;
  /** The value. Set in mono because it is a record. */
  readonly value: ReactNode;
  /** Unabbreviated value behind a truncated one — the full hash, the full ISO date. */
  readonly title?: string;
  /** `breach` only for `roundsUsed > contractedRounds`. Never for "soon". */
  readonly tone?: 'ink' | 'muted' | 'agency' | 'client' | 'breach';
}

export interface PlateProps {
  rows: readonly PlateRow[];
  /**
   * `stack` — one row per line, terms left, values right. The card and the
   * version detail.
   * `strip` — a single horizontal run of `TERM value` pairs separated by
   * hairlines. The wrap slate and any header that must stay one line tall.
   *
   * A `strip` of more than three pairs renders as a `stack` below `xs` — see
   * `STRIP_STACKS_ABOVE` below and COMPONENTS.md §10/360.
   */
  layout?: 'stack' | 'strip';
  /** Accessible name for the whole plate, e.g. "Card record". */
  label?: string;
  /** Adds the dieline cut line. Use on a plate that is itself the document. */
  dieline?: boolean;
  className?: string;
}

/**
 * COMPONENTS.md §10/360: "`layout="stack"` is the fallback: `strip` wraps, and
 * below `xs` a strip of more than three pairs should be rendered as a stack
 * instead." The primitive did not honour its own note, so a five-pair strip on
 * a 360px screen wrapped instead — and a wrapped strip was worse than either
 * form, because the divider was `divide-x` (a leading hairline on every item
 * but the first), so line two opened with a rule that divided nothing.
 *
 * Both halves are fixed here and they are separate fixes:
 *
 *   1. Above this many pairs, a strip is a stack below `xs`. Two or three
 *      pairs fit on one line at the 360px floor; four do not, and a strip that
 *      wraps at the floor is a stack that has not admitted it.
 *   2. The divider is a TRAILING hairline on every item but the last, not a
 *      leading one on every item but the first. A strip can still wrap above
 *      `xs` on a narrow container, and when it does, line one now ends with a
 *      rule that separates it from line two and line two starts flush. The old
 *      form put the rule at the head of line two, where it divided the item
 *      from the edge of the plate.
 */
const STRIP_STACKS_ABOVE = 3;

export function Plate({
  rows,
  layout = 'stack',
  label,
  dieline = false,
  className,
}: PlateProps): React.JSX.Element {
  /** A strip that must fall back to a stack at the 360px floor. */
  const narrowStacks = layout === 'strip' && rows.length > STRIP_STACKS_ABOVE;

  const STACK_CONTAINER = 'grid grid-cols-[auto_1fr] gap-x-2 px-1.5 py-1';
  const STRIP_CONTAINER = 'flex flex-wrap items-center px-1.5 py-1';
  const STRIP_GROUP =
    'flex items-baseline gap-1 px-1.5 border-r-hairline border-rule ' +
    'first:pl-0 last:pr-0 last:border-r-0';

  const container =
    layout === 'stack'
      ? STACK_CONTAINER
      : narrowStacks
        ? // `gap-x-0` because the grid's column gap would otherwise survive
          // into the flex row and push the hairline off the item it divides.
          `${STACK_CONTAINER} xs:flex xs:flex-wrap xs:items-center xs:gap-x-0`
        : STRIP_CONTAINER;

  const group =
    layout === 'stack'
      ? 'contents'
      : narrowStacks
        ? 'contents xs:flex xs:items-baseline xs:gap-1 xs:px-1.5 ' +
          'xs:border-r-hairline xs:border-rule xs:first:pl-0 xs:last:pr-0 ' +
          'xs:last:border-r-0'
        : STRIP_GROUP;

  const value =
    layout === 'stack'
      ? 'justify-self-end min-w-0 truncate'
      : narrowStacks
        ? 'min-w-0 justify-self-end truncate xs:justify-self-auto ' +
          'xs:overflow-visible xs:whitespace-normal'
        : 'min-w-0';

  return (
    <dl aria-label={label} className={cn('plate', dieline && 'dieline', container, className)}>
      {rows.map((row) => (
        <div key={row.term} className={group}>
          <dt className="font-display text-eyebrow uppercase text-muted whitespace-nowrap">
            {row.term}
          </dt>
          <dd className={value}>
            <Mono tone={row.tone ?? 'ink'} title={row.title}>
              {row.value}
            </Mono>
          </dd>
        </div>
      ))}
    </dl>
  );
}
