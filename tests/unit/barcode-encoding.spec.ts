/**
 * The barcode encodes what it prints, and it is not themed.
 *
 * ## Why a decoder, and not a snapshot
 *
 * `Barcode`'s own header states the argument: *"A barcode that encodes nothing
 * is decoration wearing a record's clothes."* That claim had nothing behind it.
 * `code39Path()` was exported specifically so a test could assert the encoding
 * rather than a screenshot, and then no such test was written — so the strongest
 * sentence in the primitive was an aspiration.
 *
 * A snapshot of the path would not have helped. It pins the bytes and says
 * nothing about whether they mean anything, and it is updated with `-u` the
 * first time it fails. The only assertion that can distinguish *correct* from
 * *stable* is a decoder: read the emitted geometry back to element widths, look
 * each character up, and require the input to come out. It fails the day
 * someone transposes two rows of the lookup table, which is a change a
 * snapshot would happily record as the new truth.
 *
 * A barcode that encodes wrongly is worse than one that encodes nothing,
 * because it looks like proof. This runs on the purge certificate — the one
 * document in this product written to be handed to a client's legal team.
 *
 * ## And the polarity, which is the part that was silently broken
 *
 * Round 3 shipped the bars in `currentColor`: light bars on a dark ground in
 * dark mode, which most laser and CCD readers do not consider a symbol at all.
 * The uncomfortable part is that **every per-mode colour assertion in the suite
 * passed against it.** The contrast apparatus was green, at maximum ratio, on a
 * mark that could not be scanned — because contrast is symmetric and scanners
 * are not. Nothing was asking whether the two modes agreed with *each other*.
 *
 * The browser half of that (computed `fill` in both themes, under a hostile
 * tenant style) belongs to the e2e a11y shell. The half that can be settled
 * without a browser is settled here, and it is the load-bearing half: the
 * tokens are declared **once**, so there is no second declaration for a theme
 * to reach.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BARCODE } from '@/styles/a11y-contract';
import { code39Path, normaliseForCode39 } from '@/components/primitives/Barcode';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/* -------------------------------------------------------------------------- */
/* The decoder.                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Code 39's alphabet, transcribed **independently** of the primitive's table.
 *
 * Deliberately not imported. `CODE39` in `Barcode.tsx` is the thing under test;
 * decoding with it would verify that the encoder is its own inverse, which is
 * true of any lookup table including a wrong one. Two transpositions in one row
 * of the same table cancel out perfectly. This copy is from the Code 39
 * specification, and a disagreement between them is the finding.
 *
 * Nine elements per character: bar, space, bar, … — five bars, four spaces,
 * exactly three of the nine wide.
 */
const SPEC_CODE39: Readonly<Record<string, string>> = {
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

const BY_PATTERN = new Map(Object.entries(SPEC_CODE39).map(([char, p]) => [p, char]));

interface Bar {
  x: number;
  width: number;
}

/** Reads the bar rectangles back out of the emitted path. */
function bars(d: string, height: number): Bar[] {
  const out: Bar[] = [];
  // `M{x} 0h{w}v{height}h-{w}z` — the only subpath shape the encoder emits.
  const shape = new RegExp(String.raw`M(-?[\d.]+) 0h([\d.]+)v${height}h-\2z`, 'g');
  for (const m of d.matchAll(shape)) {
    out.push({ x: Number(m[1]), width: Number(m[2]) });
  }
  return out;
}

export interface Decoded {
  text: string;
  /** Substrate before the first bar and after the last, in narrow modules. */
  quiet: { leading: number; trailing: number };
}

/**
 * Decodes a `code39Path()` result back to the string it encodes.
 *
 * Spaces are not drawn — a space is the gap between two bars — so they are
 * recovered from the geometry, which is the only way this can be checked at
 * all. Throws rather than returning null: every failure mode here is a defect
 * with a specific name, and a null would collapse them into "did not decode".
 */
export function decodeCode39(d: string, width: number, height: number): Decoded {
  const found = bars(d, height);
  if (found.length === 0) throw new Error('no bars in the path');
  if (found.length % 5 !== 0) {
    throw new Error(`${found.length} bars is not a whole number of characters (5 bars each)`);
  }

  const widthOf = (w: number): string => {
    if (w === 1) return 'n';
    if (w === 3) return 'w';
    throw new Error(`element width ${w} is neither one narrow module nor three`);
  };

  let text = '';
  for (let c = 0; c * 5 < found.length; c += 1) {
    const group = found.slice(c * 5, c * 5 + 5);
    const elements: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const bar = group[i];
      if (!bar) throw new Error('truncated character');
      elements.push(widthOf(bar.width));
      if (i < 4) {
        const next = group[i + 1];
        if (!next) throw new Error('truncated character');
        elements.push(widthOf(next.x - (bar.x + bar.width)));
      }
    }
    const pattern = elements.join('');
    const wides = [...pattern].filter((e) => e === 'w').length;
    if (wides !== 3) {
      throw new Error(`character ${c} has ${wides} wide elements; Code 39 requires exactly 3`);
    }
    const char = BY_PATTERN.get(pattern);
    if (char === undefined) throw new Error(`character ${c} decodes to no Code 39 symbol`);
    text += char;

    // The inter-character gap. One narrow module, and not part of either
    // character's pattern — get it wrong and every scanner reads one long
    // malformed symbol instead of a string.
    const nextChar = found[(c + 1) * 5];
    if (nextChar) {
      const last = group[4];
      if (!last) throw new Error('truncated character');
      const gap = nextChar.x - (last.x + last.width);
      if (gap !== 1) throw new Error(`inter-character gap ${gap} is not one narrow module`);
    }
  }

  const first = found[0];
  const last = found[found.length - 1];
  if (!first || !last) throw new Error('no bars');
  return {
    text,
    quiet: { leading: first.x, trailing: width - (last.x + last.width) },
  };
}

/* -------------------------------------------------------------------------- */

describe('the barcode encodes the value printed under it', () => {
  const HEIGHT = 28;

  it('round-trips a sha256 prefix through the geometry it emits', () => {
    // The case UI/UX verified by hand, now in the suite instead of in a
    // transcript. Point a scanner at this and you get the hash back.
    const value = '3A91F2C7';
    const { d, width } = code39Path(value, HEIGHT);
    const decoded = decodeCode39(d, width, HEIGHT);
    expect(decoded.text).toBe(`*${value}*`);
  });

  it('leaves a quiet zone of ten narrow modules on both sides', () => {
    // Part of the encoding, not of the styling. A symbol with a clipped quiet
    // zone is a symbol a scanner will not start reading — and it is the failure
    // that looks fine to a human eye, because the bars are all present.
    const { d, width } = code39Path('3A91F2C7', HEIGHT);
    const { quiet } = decodeCode39(d, width, HEIGHT);
    expect(quiet.leading).toBe(BARCODE.quietModules);
    expect(quiet.trailing).toBe(BARCODE.quietModules);
  });

  it('brackets every value in start and stop sentinels', () => {
    for (const value of ['0', 'FF', 'DEADBEEF', '1234567890ABCDEF']) {
      const { d, width } = code39Path(value, HEIGHT);
      const { text } = decodeCode39(d, width, HEIGHT);
      expect(text.startsWith('*'), `${value} has no start sentinel`).toBe(true);
      expect(text.endsWith('*'), `${value} has no stop sentinel`).toBe(true);
      expect(text.slice(1, -1)).toBe(value);
    }
  });

  it('encodes every character of its own alphabet correctly', () => {
    // One case per symbol. A single assertion over a joined string passes while
    // fifteen of the eighteen are wrong, and the lookup table is exactly the
    // kind of thing that gets one row transposed.
    for (const char of Object.keys(SPEC_CODE39)) {
      if (char === '*') continue; // the sentinel is added by the encoder
      const { d, width } = code39Path(char, HEIGHT);
      const { text } = decodeCode39(d, width, HEIGHT);
      expect(text, `${char} does not survive a round trip`).toBe(`*${char}*`);
    }
  });

  it('agrees with the Code 39 specification, not merely with itself', () => {
    // The assertion the imported-table version of this test could never make.
    // `SPEC_CODE39` above is a second transcription; if the primitive's table
    // has a transposed row, the decode fails here and nowhere else.
    const { d, width } = code39Path('ABCDEF0123456789', HEIGHT);
    expect(decodeCode39(d, width, HEIGHT).text).toBe('*ABCDEF0123456789*');
  });

  it('drops characters outside the alphabet rather than encoding them wrongly', () => {
    // A sha256 prefix is hex, so this should never fire in production — but a
    // silent substitution would produce a symbol that scans cleanly to the
    // wrong value, which is the failure mode this whole file exists for.
    expect(normaliseForCode39('3a91-f2c7')).toBe('3A91-F2C7');
    expect(normaliseForCode39('g h i')).toBe('');
    expect(normaliseForCode39('*3A*')).toBe('3A');
  });

  it('refuses to decode a corrupted symbol instead of guessing', () => {
    // The decoder's own negative control. If it silently tolerated a malformed
    // width, every assertion above would pass against a broken encoder.
    const { d, width } = code39Path('3A91F2C7', HEIGHT);
    // A *well-formed* subpath carrying an illegal width — both the `h{w}` and
    // the closing `h-{w}` are widened, so the shape still parses and the bar is
    // still found. Corrupting only one of the two would make the subpath
    // unmatchable, and the decoder would reject it for the wrong reason: the
    // count would come out wrong and the width check would never run.
    const corrupted = d.replace(`h1v${HEIGHT}h-1z`, `h2v${HEIGHT}h-2z`);
    expect(corrupted, 'the corruption did not apply; this test proves nothing').not.toBe(d);
    expect(() => decodeCode39(corrupted, width, HEIGHT)).toThrow(/neither one narrow module/);
  });

  it('notices a symbol that is not a whole number of characters', () => {
    const { d, width } = code39Path('3A91F2C7', HEIGHT);
    const truncated = d.slice(0, d.lastIndexOf('M'));
    expect(() => decodeCode39(truncated, width, HEIGHT)).toThrow();
  });
});

describe('the barcode is not themed, and cannot become themed', () => {
  const css = readFileSync(`${ROOT}/src/app/globals.css`, 'utf8');

  it('declares the substrate and bar tokens exactly once each', () => {
    // This is the mechanism, and it is stronger than asserting the two themes
    // agree: a token declared once has no second declaration for a theme block
    // to override. A future `@media (prefers-color-scheme: dark)` entry for
    // either token fails here, which is where the round-3 defect would have
    // been caught before it reached a certificate.
    for (const token of [BARCODE.substrateToken, BARCODE.barToken]) {
      const declarations = [...css.matchAll(new RegExp(`${token}\\s*:`, 'g'))];
      expect(
        declarations.length,
        `${token} is declared ${declarations.length} times. Once, or a theme can move it — ` +
          'and an inverted Code 39 is not a symbol to most scanners.',
      ).toBe(1);
    }
  });

  it('paints black bars on a white substrate, at the maximum ratio', () => {
    expect(css).toContain(`${BARCODE.substrateToken}: ${BARCODE.substrate.toLowerCase()}`);
    expect(css).toContain(`${BARCODE.barToken}: ${BARCODE.bar.toLowerCase()}`);
    // 21:1 is not a comfortable margin, it is the ceiling. Scan margin is the
    // entire reason this element opts out of the palette.
    expect(BARCODE.minContrast).toBe(21);
  });

  it('locks both tokens against a tenant inline style', () => {
    // The tokens are literals rather than `var()`s of a locked token, so they
    // do not inherit the white-label lock's protection. `!important` is what
    // stops a tenant brand style inverting a machine-readable mark.
    for (const token of [BARCODE.substrateToken, BARCODE.barToken]) {
      expect(
        new RegExp(`${token}\\s*:[^;]*!important`).test(css),
        `${token} is not !important; a tenant style can invert the barcode`,
      ).toBe(true);
    }
  });

  it('renders the tokens rather than currentColor', () => {
    // The round-3 defect in one line. `currentColor` is what made the symbol
    // follow the theme, and it is what every colour assertion in the suite was
    // blind to because contrast is symmetric and a scanner is not.
    const source = readFileSync(`${ROOT}/src/components/primitives/Barcode.tsx`, 'utf8');
    expect(source).toContain(`fill="var(${BARCODE.barToken})"`);
    expect(source).toContain(`fill="var(${BARCODE.substrateToken})"`);
    expect(
      /fill=["']currentColor["']/.test(source),
      'the barcode paints with currentColor again; in dark mode that is an inverted ' +
        'symbol, which scans correctly in a contrast test and not at all with a scanner',
    ).toBe(false);
  });

  it('states that theme invariance is the property under test', () => {
    expect(BARCODE.themeInvariant).toBe(true);
  });
});
