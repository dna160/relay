/**
 * Class-name strings, not components.
 *
 * This module is imported by both surfaces on purpose and it is safe to be: it
 * contains no JSX, no data shape, no agency concept — only the composed
 * Tailwind strings that recur across screens. Sharing them is what stops the
 * two surfaces drifting into two visual languages while still keeping every
 * *component* separate.
 *
 * Every value below is written in the theme keys defined by
 * `tailwind.config.ts` — `text-ink`, `bg-paper-2`, `text-14`. No arbitrary
 * values, no `var(--…)` inline: the token layer in `globals.css` is the single
 * source of truth and the white-label clamp depends on it staying that way.
 *
 * Focus rings are deliberately absent. `globals.css` puts a visible ring on
 * every focusable element in its base layer; restating it per component is how
 * one component ends up with `outline: none`.
 */

import type { Possession } from '@/lib/types';

export { cn } from '@/components/primitives/cn';

/** Records: version numbers, hashes, timestamps, countdowns, card ids. */
export const mono = 'font-mono tracking-mono';

/** Engagement titles, lane headers, section eyebrows. */
export const display = 'font-display';

/** Lane headers: 14 uppercase, tracking +0.08em. */
export const laneHeading = 'font-display uppercase text-lane text-ink';

/** Section eyebrows above a group. */
export const eyebrow = 'font-display uppercase text-eyebrow text-muted';

/** A raised surface: card, panel, row group. */
export const surface = 'bg-paper-2 border border-hairline border-rule';

export const muted = 'text-muted';

const buttonBase =
  'inline-flex items-center justify-center gap-2 h-9 px-3 text-14 border border-hairline disabled:opacity-40 disabled:cursor-not-allowed';

export const buttonPrimary = `${buttonBase} bg-ink text-paper border-ink hover:opacity-90`;

/** `--rule-strong` because a hairline is decorative and never a control's only boundary. */
export const buttonSecondary = `${buttonBase} bg-paper-2 text-ink border-rule-strong hover:border-ink`;

export const buttonGhost = `${buttonBase} bg-transparent text-ink border-transparent hover:border-rule-strong`;

export const input =
  'w-full bg-field border border-hairline border-rule-strong px-3 py-2 text-14 text-ink placeholder:text-muted';

/** The state chip. Hue is never applied here — a chip is a label, not a signal. */
export const chip =
  'font-mono tracking-mono inline-flex items-center h-5 px-1.5 text-12 border border-hairline border-rule text-ink bg-paper';

/**
 * `--breach` red, and the one condition it is allowed under: a breached
 * commitment. Not "due soon", not "overdue by an hour", not an error toast.
 */
export const breach = 'text-breach border-breach';

/**
 * Possession hue. Written as literal class names so Tailwind's scanner sees
 * them; a class assembled at runtime would be invisible to it.
 */
export const POSSESSION_FILL: Record<Possession, string> = {
  agency: 'bg-agency',
  client: 'bg-client',
};

export const POSSESSION_TEXT: Record<Possession, string> = {
  agency: 'text-agency',
  client: 'text-client',
};

/** Signed off: the ball is with nobody. Neutral, not a third hue. */
export const POSSESSION_CLOSED_FILL = 'bg-rule-strong';
export const POSSESSION_CLOSED_TEXT = 'text-muted';

/**
 * The only motion in the product. `--dur-chip` is 0ms under
 * `prefers-reduced-motion`, so this resolves to an instant swap rather than
 * needing a second code path.
 */
export const crossfade = 'transition-opacity duration-chip ease-chip';
