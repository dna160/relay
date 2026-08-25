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
   */
  layout?: 'stack' | 'strip';
  /** Accessible name for the whole plate, e.g. "Card record". */
  label?: string;
  /** Adds the dieline cut line. Use on a plate that is itself the document. */
  dieline?: boolean;
  className?: string;
}

export function Plate({
  rows,
  layout = 'stack',
  label,
  dieline = false,
  className,
}: PlateProps): React.JSX.Element {
  return (
    <dl
      aria-label={label}
      className={cn(
        'plate',
        dieline && 'dieline',
        layout === 'stack'
          ? 'grid grid-cols-[auto_1fr] gap-x-2 px-1.5 py-1'
          : 'flex flex-wrap items-center divide-x divide-rule px-1.5 py-1',
        className,
      )}
    >
      {rows.map((row) => (
        <div
          key={row.term}
          className={
            layout === 'stack'
              ? 'contents'
              : 'flex items-baseline gap-1 px-1.5 first:pl-0 last:pr-0'
          }
        >
          <dt className="font-display text-eyebrow uppercase text-muted whitespace-nowrap">
            {row.term}
          </dt>
          <dd
            className={
              layout === 'stack' ? 'justify-self-end min-w-0 truncate' : 'min-w-0'
            }
          >
            <Mono tone={row.tone ?? 'ink'} title={row.title}>
              {row.value}
            </Mono>
          </dd>
        </div>
      ))}
    </dl>
  );
}
