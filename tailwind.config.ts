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

      /* Quiet chip grounds. Four, not three: `tint-neutral` is what a chip
         carrying no possession stands on, so it keeps a ground of its own on
         a card instead of being painted the card's own `--paper-2`. */
      'tint-agency': 'var(--tint-agency)',
      'tint-client': 'var(--tint-client)',
      'tint-breach': 'var(--tint-breach)',
      'tint-neutral': 'var(--tint-neutral)',

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

      /* MOTION. Every duration is a multiple of the one beat token; see
         globals.css §5 and docs/design/MOTION.md. `chip` is kept as a key so
         nothing that already writes `duration-chip` has to change — the value
         behind it is now two beats rather than a second literal. */
      transitionDuration: {
        beat: 'var(--dur-beat)',
        tick: 'var(--time-tick)',
        chip: 'var(--time-chip)',
        strike: 'var(--time-strike)',
        seat: 'var(--time-seat)',
        stamp: 'var(--time-stamp)',
        sheet: 'var(--time-sheet)',
      },
      transitionTimingFunction: {
        chip: 'var(--ease-chip)',
        strike: 'var(--ease-strike)',
        seat: 'var(--ease-seat)',
        stamp: 'var(--ease-stamp)',
      },
      transitionDelay: { step: 'var(--time-step)' },

      /* The amplitudes, so a call site can write `translate-y-strike` rather
         than an arbitrary value that the reduced-motion query cannot reach. */
      translate: {
        nudge: 'var(--dist-nudge)',
        seat: 'var(--dist-seat)',
        strike: 'var(--dist-strike)',
      },
      scale: { stamp: 'var(--scale-stamp)' },
      rotate: { strike: 'var(--tilt-strike)' },

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

      /* THE SANCTIONED KEYFRAMES. Eight, named in
         `src/styles/a11y-contract.ts` as `ALLOWED_ANIMATION_NAMES`; a ninth
         appearing on a page is a spec violation the e2e suite fails on.

         TWO RULES HOLD FOR EVERY ENTRY:
         (1) Compositor-only. `transform` and `opacity`, nothing else. Nothing
             here reads or writes a layout property, so none of it can thrash.
         (2) 100% IS THE RESTING STATE. Every keyframe resolves to the pixel
             the element occupies when nothing is happening. That is what makes
             a 0ms beat under prefers-reduced-motion correct rather than merely
             fast: the element lands exactly where it belongs, with `both` fill
             holding it there. A keyframe that ends anywhere else would leave
             the interface wrong for a reduced-motion reader. */
      keyframes: {
        /* The state-chip crossfade. Unchanged from round 1. */
        'chip-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'chip-out': { from: { opacity: '1' }, to: { opacity: '0' } },

        /* THE SIGNATURE MOMENT — possession changing hands.
           Two phases in one animation, so they cannot drift apart:
             0%  → 40%  STRIKE, `--ease-strike`, accelerating. The plate is
                        thrown at the surface from `--dist-strike` off its
                        seat, over-scaled and off-square.
             40% → 100% SEAT, `--ease-seat`, hard decelerate. It arrives
                        `--dist-seat` past true and settles back against the
                        stop, square and at scale.
           40% is strike:seat = 2:3 and is LOCKED to `--time-attach`. Change a
           beat count and this percentage changes with it. */
        'label-attach': {
          '0%': {
            opacity: '0',
            transform:
              'translate3d(0, calc(var(--dist-strike) * -1), 0) rotate(var(--tilt-strike)) scale(var(--scale-stamp))',
            animationTimingFunction: 'var(--ease-strike)',
          },
          '40%': {
            opacity: '1',
            transform:
              'translate3d(0, var(--dist-seat), 0) rotate(calc(var(--tilt-strike) * 0.25)) scale(1)',
            animationTimingFunction: 'var(--ease-seat)',
          },
          '100%': {
            opacity: '1',
            transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)',
          },
        },

        /* The possession bar being printed: a stroke drawn from the head of
           the card downward. The colour is already the new one when this runs,
           so the old possession is covered rather than faded — a second pass
           of ink, not a dissolve. */
        'bar-draw': {
          from: { transform: 'scale3d(1, 0, 1)' },
          to: { transform: 'scale3d(1, 1, 1)' },
        },

        /* A mark being applied: the version pip on publish, the decision
           timestamp on record, the rounds counter when a round is consumed. */
        stamp: {
          from: { opacity: '0', transform: 'scale(var(--scale-stamp))' },
          to: { opacity: '1', transform: 'scale(1)' },
        },

        /* A record appended to a list — a new version row. The modest one. */
        seat: {
          from: {
            opacity: '0',
            transform: 'translate3d(0, var(--dist-strike), 0)',
          },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },

        /* A dialog. A document laid on the desk: it does not fly in from an
           edge, it settles onto the surface it was already on. */
        'sheet-in': {
          from: { opacity: '0', transform: 'scale(0.985)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'scrim-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'chip-in': 'chip-in var(--time-chip) var(--ease-chip) both',
        'chip-out': 'chip-out var(--time-chip) var(--ease-chip) both',
        /* `linear` at the top level is deliberate and inert: both segments
           declare their own timing function inside the keyframes. */
        'label-attach': 'label-attach var(--time-attach) linear both',
        'bar-draw':
          'bar-draw var(--time-seat) var(--ease-seat) var(--time-strike) both',
        stamp: 'stamp var(--time-stamp) var(--ease-stamp) both',
        seat: 'seat var(--time-seat) var(--ease-seat) both',
        'sheet-in': 'sheet-in var(--time-sheet) var(--ease-seat) both',
        'scrim-in': 'scrim-in var(--time-tick) var(--ease-chip) both',
      },

      transformOrigin: {
        /* `bar-draw` scales from the head of the card, never from centre. */
        head: 'top center',
      },
    },
  },
  plugins: [],
};

export default config;
