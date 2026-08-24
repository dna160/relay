import type { Config } from 'tailwindcss';

/**
 * The token layer lives in `src/app/globals.css`. This file only maps it into
 * Tailwind's theme so the front-end writes `text-ink` / `bg-paper-2` /
 * `border-rule` and never an arbitrary value.
 *
 * Rule of thumb for anyone extending this: if you find yourself writing
 * `text-[#1F4E46]` or `bg-[var(--agency)]`, the token is missing here — add it
 * here rather than inlining it, or the white-label lock in globals.css §3 stops
 * being airtight.
 */

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    /* Colours are replaced, not extended: an engineer reaching for
       `bg-slate-100` should get nothing back. There are eight grounds in this
       product and no more. */
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',

      ink: 'var(--ink)',
      paper: 'var(--paper)',
      'paper-2': 'var(--paper-2)',
      rule: 'var(--rule)',
      'rule-strong': 'var(--rule-strong)',
      muted: 'var(--muted)',

      /* Possession. Hue means whose move it is. Never urgency. */
      agency: 'var(--agency)',
      client: 'var(--client)',
      /* One thing only: a breached commitment. */
      breach: 'var(--breach)',

      /* Text laid over a filled possession or breach surface. */
      'on-hue': 'var(--on-hue)',

      /* Quiet chip grounds. */
      'tint-agency': 'var(--tint-agency)',
      'tint-client': 'var(--tint-client)',
      'tint-breach': 'var(--tint-breach)',

      /* Hover steps. Never use an opacity modifier (`bg-agency/90`) on a token
         colour — the tokens are `var()` strings and Tailwind 3 cannot compute
         an alpha from them. Use these instead. */
      'agency-hover': 'var(--agency-hover)',
      'client-hover': 'var(--client-hover)',
      'paper-hover': 'var(--paper-hover)',

      field: 'var(--field)',
      scrim: 'var(--scrim)',
      focus: 'var(--focus)',
    },

    /* 12 / 14 / 16 / 20 / 28 / 40, named by their size so a spec can say "20"
       and the code says `text-20`. Plus two role sizes. */
    fontSize: {
      '12': ['12px', { lineHeight: '16px' }],
      '14': ['14px', { lineHeight: '20px' }],
      '16': ['16px', { lineHeight: '24px' }],
      '20': ['20px', { lineHeight: '26px' }],
      '28': ['28px', { lineHeight: '32px' }],
      '40': ['40px', { lineHeight: '44px', letterSpacing: '-0.015em' }],

      /* Lane header: 14 uppercase, tracking +0.08em, display weight.
         Pair with `font-display uppercase`. */
      lane: [
        '14px',
        { lineHeight: '20px', letterSpacing: '0.08em', fontWeight: '600' },
      ],
      /* Section eyebrow: the same treatment one step down. */
      eyebrow: [
        '12px',
        { lineHeight: '16px', letterSpacing: '0.08em', fontWeight: '600' },
      ],
    },

    fontFamily: {
      /* Display — Archivo held at wdth 125 (Expanded), wght 600.
         There is no other configuration of the display face in this product. */
      display: [
        ['Archivo', 'Archivo Expanded', 'Helvetica Neue', 'Arial', 'sans-serif'],
        { fontVariationSettings: '"wdth" 125, "wght" 600' },
      ],
      sans: [
        [
          'Public Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        { fontFeatureSettings: '"cv11"' },
      ],
      /* Utility — the record face. Martian Mono narrowed to wdth 87.5 so a
         sha256 prefix and a countdown fit inside a 280px card. Everything that
         could be cited in a dispute is set in this. */
      mono: [
        [
          'Martian Mono',
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Menlo',
          'Consolas',
          'monospace',
        ],
        { fontVariationSettings: '"wdth" 87.5' },
      ],
    },

    extend: {
      letterSpacing: {
        /* Lane headers and eyebrows. */
        lane: '0.08em',
        /* Martian Mono sets wide; this pulls a record back to a scannable
           density without touching its rhythm. */
        mono: '-0.02em',
      },

      borderRadius: {
        /* Production stationery. Nothing in this product is rounder than 3px. */
        none: '0',
        DEFAULT: 'var(--radius-1)',
        sm: 'var(--radius-1)',
        md: 'var(--radius-2)',
        full: '9999px',
      },

      borderWidth: {
        hairline: 'var(--hairline)',
        /* The possession bar. */
        bar: 'var(--bar-width)',
      },

      spacing: {
        bar: 'var(--bar-width)',
        /* Board metrics, so lane and card widths agree across files. */
        lane: '304px',
        'lane-sm': '288px',
        card: '280px',
      },

      minWidth: { card: '256px' },
      maxWidth: { prose: '68ch', dialog: '520px' },

      transitionDuration: { chip: 'var(--dur-chip)' },
      transitionTimingFunction: { chip: 'var(--ease-chip)' },

      outlineWidth: { focus: 'var(--focus-width)' },
      outlineOffset: { focus: 'var(--focus-offset)' },

      boxShadow: {
        /* Paper does not float. The only elevation in the product is a dialog,
           and it is a hairline plus a scrim, not a blur. */
        none: 'none',
        dialog: '0 1px 0 0 var(--rule), 0 8px 24px -12px rgb(0 0 0 / 0.35)',
      },

      zIndex: { slate: '30', dialog: '50' },

      screens: {
        /* 360px is the floor the whole product is responsive to. `xs` exists so
           a spec can say "single column below xs" and mean something. */
        xs: '360px',
      },

      keyframes: {
        /* The only motion in the product: a state chip crossfading when a card
           transitions. `--dur-chip` is 0ms under prefers-reduced-motion, so
           both halves resolve instantly rather than being disabled piecemeal. */
        'chip-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'chip-out': { from: { opacity: '1' }, to: { opacity: '0' } },
      },
      animation: {
        'chip-in': 'chip-in var(--dur-chip) var(--ease-chip) both',
        'chip-out': 'chip-out var(--dur-chip) var(--ease-chip) both',
      },
    },
  },
  plugins: [],
};

export default config;
