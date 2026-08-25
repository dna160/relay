import { cn } from './cn';
import { Mono } from './Mono';

/**
 * A CODE 39 BARCODE THAT ENCODES THE VALUE PRINTED UNDER IT.
 *
 * THE ARGUMENT, because this is the decision most likely to be re-litigated:
 * DESIGN-SYSTEM.md says monospace marks everything that is a record. A barcode
 * that encodes nothing is decoration wearing a record's clothes — it borrows
 * the authority of a machine-readable mark while being a texture. So this one
 * encodes. Point a scanner at the bars over a purge certificate and you get
 * back exactly the sha256 prefix printed beneath them.
 *
 * WHY CODE 39 AND NOT A QR:
 *   - Code 39 is self-checking and needs no checksum, so the encoder is a
 *     lookup table and no dependency. A QR needs Reed-Solomon error correction
 *     — a real algorithm, and the rule for this round is no new dependency.
 *   - A hex sha prefix (0-9, A-F) is entirely inside the Code 39 alphabet.
 *   - A QR scanned by a phone yields a bare hex string with nothing to do
 *     about it. The only value worth making phone-scannable is the client
 *     link, and that is a security surface the design layer does not own.
 *   - A 2D block fights a stationery grid. A bar field sits in a rule system.
 *
 * WHERE IT IS ALLOWED: surfaces that carry exactly one, and are not the board.
 * The purge certificate, the export header, a version's detail record. NOT the
 * card — see the cost note below.
 *
 * COST. The bars are one `<path>`, not one node per bar: 5 bars per character
 * across `value.length + 2` characters is 50 subpaths for an 8-character
 * prefix, all inside a single DOM node with no script and no request. That is
 * cheap once per document and indefensible forty times on a board, which is
 * exactly why `CardTile` gets a `Plate` and not this.
 *
 * ACCESSIBILITY. The bars are `aria-hidden`: they are a second, machine-facing
 * rendering of text that is already on the page in `Mono`. A screen reader
 * that announced both would read the same hash twice.
 *
 * POLARITY, and why this one element does not follow the theme.
 * Round 3 shipped the bars in `currentColor`, which in dark mode is light bars
 * on a dark ground. The symbol still encoded correctly and could not be
 * scanned: an inverted Code 39 is, to most laser and CCD readers and to plenty
 * of camera decoders, not a symbol. A barcode that encodes nothing is
 * decoration wearing a record's clothes; a barcode that encodes correctly and
 * cannot be read is the same failure one step later, and it lands on the purge
 * certificate — the one document in this product meant to be scanned, and the
 * one that goes to a client's legal team.
 *
 * So bar/space polarity and the quiet zone are treated as part of the
 * encoding, which is what they are, and not as styling. The symbol brings its
 * own substrate: `--barcode-bar` on `--barcode-substrate`, black on white, in
 * light, in dark and in print. The reading is not "an element that ignores
 * dark mode" — it is a printed label stuck to the page, which is precisely
 * what a barcode on a certificate is.
 *
 * The human-readable line beneath the bars is NOT part of the plate. It is
 * text, it is `--ink` on the page ground, and it follows the theme like every
 * other record in the product. The plate is only as big as the symbol.
 */

/**
 * Code 39. Nine elements per character, alternating bar/space/bar/…, five bars
 * and four spaces, three of the nine wide. `w` is three narrow modules.
 */
const CODE39: Readonly<Record<string, string>> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  '-': 'nnwnnnwnw',
  '*': 'nnwnwnwnn',
};

const NARROW = 1;
const WIDE = 3;
/** Code 39 requires a quiet zone of at least ten narrow modules each side. */
const QUIET = 10;
/**
 * Narrow modules of substrate above and below the bars. The quiet zone the
 * standard specifies is horizontal, but the plate has to be a plate: bars that
 * touch the edge of their own white ground read as a cropped symbol, and a
 * scanner that clips the top or bottom of a bar loses the same edge.
 *
 * It is applied by growing the viewBox, never by moving the path, so the
 * geometry `code39Path` emits — and the test that decodes it — is untouched.
 */
const PLATE_PAD = 4;
/** One narrow module of space between characters. */
const GAP = 1;

/** Uppercases and drops anything outside the supported alphabet. */
export function normaliseForCode39(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((c) => c !== '*' && Object.prototype.hasOwnProperty.call(CODE39, c))
    .join('');
}

/**
 * Builds the bar geometry as a single SVG path.
 *
 * Exported so a test can assert the encoding rather than a screenshot: decode
 * the path back to widths and you must get the input.
 */
export function code39Path(value: string, height: number): { d: string; width: number } {
  const text = `*${normaliseForCode39(value)}*`;
  let x = QUIET;
  let d = '';
  for (let i = 0; i < text.length; i += 1) {
    const pattern = CODE39[text[i] as keyof typeof CODE39];
    if (pattern === undefined) continue;
    for (let e = 0; e < pattern.length; e += 1) {
      const w = pattern[e] === 'w' ? WIDE : NARROW;
      // Even elements are bars, odd elements are spaces.
      if (e % 2 === 0) d += `M${x} 0h${w}v${height}h-${w}z`;
      x += w;
    }
    x += GAP;
  }
  return { d, width: x - GAP + QUIET };
}

export interface BarcodeProps {
  /** The record being encoded. A sha256 prefix, a manifest digest, a batch id. */
  value: string;
  /** Screen-reader name for the human-readable line, e.g. "Manifest digest". */
  label?: string;
  /** Bar height in px. 28 on a certificate, 20 inside a record row. */
  height?: number;
  /** Set false when the value is already printed adjacent in the same block. */
  showValue?: boolean;
  className?: string;
}

export function Barcode({
  value,
  label,
  height = 28,
  showValue = true,
  className,
}: BarcodeProps): React.JSX.Element | null {
  const normalised = normaliseForCode39(value);
  if (normalised === '') return null;
  const { d, width } = code39Path(normalised, height);

  return (
    <div className={cn('inline-flex flex-col gap-0.5', className)}>
      <svg
        // A second rendering of text already on the page. Announcing it would
        // read the same hash twice.
        aria-hidden="true"
        focusable="false"
        viewBox={`0 ${-PLATE_PAD} ${width} ${height + PLATE_PAD * 2}`}
        width={width}
        height={height + PLATE_PAD * 2}
        preserveAspectRatio="xMinYMid meet"
        className="block max-w-full"
      >
        {/* The substrate. It covers the quiet zone as well as the bars,
            because the quiet zone is part of the encoding and a quiet zone
            painted in whatever ground the page happens to have is a quiet
            zone that inverts with the theme. */}
        <rect
          x={0}
          y={-PLATE_PAD}
          width={width}
          height={height + PLATE_PAD * 2}
          fill="var(--barcode-substrate)"
        />
        <path d={d} fill="var(--barcode-bar)" />
      </svg>
      {showValue ? (
        <Mono label={label}>{normalised}</Mono>
      ) : null}
    </div>
  );
}
