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

import type { ButtonSize, ButtonTone } from '@/components/primitives/Button';
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

/* ------------------------------------------------------------------ buttons */

/**
 * There is **one** button vocabulary in Relay and it is the `Button`
 * primitive's: four tones — `agency`, `client`, `quiet`, `ghost` — and three
 * sizes. What follows is that vocabulary projected onto a class string, for the
 * two cases where a `<button>` element is not what the markup wants: a
 * `next/link` that has to look like a control, and an `<a>`/`<label>` acting as
 * one. Anything that renders an actual button imports the primitive.
 *
 * The strings below are kept byte-identical in effect to
 * `src/components/primitives/Button.tsx`'s `TONE` and `SIZE` maps. Two things
 * that were true here in round 1 and are not any more:
 *
 * - There was a second vocabulary — `buttonPrimary` / `buttonSecondary` /
 *   `buttonGhost` — where primary was `bg-ink text-paper`. The primitive fills
 *   its primary with the *possession* hue, which is the product's whole colour
 *   idea: the main action on a surface is "hand the work to the other side", so
 *   the button is the colour of the side it hands to. An ink-filled primary
 *   said nothing, and having both meant a screen could be built from either.
 * - `hover:opacity-90` did nothing. Every colour here is a `var()` string and
 *   Tailwind 3 cannot compute an alpha from one, so the utility emitted a rule
 *   the browser could not act on and the hover state was silently missing.
 *   `--agency-hover` / `--client-hover` / `--paper-hover` exist for exactly
 *   this and are mixed toward `--ink`, which moves *away* from the ground in
 *   both light and dark rather than fading toward it.
 *
 * `enabled:` on the hover pairs matches the primitive: a disabled control must
 * not light up under the pointer, and a link cannot be disabled at all.
 */
const BUTTON_BASE =
  'inline-flex items-center justify-center whitespace-nowrap border-hairline rounded-sm font-sans font-medium transition-colors duration-chip ease-chip disabled:opacity-45 disabled:cursor-not-allowed';

const BUTTON_TONE: Record<ButtonTone, string> = {
  agency:
    'bg-agency text-on-hue border-agency enabled:hover:bg-agency-hover enabled:hover:border-agency-hover',
  client:
    'bg-client text-on-hue border-client enabled:hover:bg-client-hover enabled:hover:border-client-hover',
  /** `--rule-strong`: a hairline is decorative and never a control's only boundary. */
  quiet: 'bg-paper-2 text-ink border-rule-strong enabled:hover:bg-paper-hover',
  ghost: 'bg-transparent text-ink border-transparent enabled:hover:bg-paper-hover',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-12 gap-1',
  md: 'h-9 px-3 text-14 gap-1.5',
  /* 44px: the client decision bar's touch target on a phone. */
  lg: 'h-11 px-4 text-16 gap-2',
};

/**
 * Which tone a control takes, stated once so two screens cannot answer it
 * differently.
 *
 * **The hue names the side that holds the work once the control has been
 * pressed.** That is the same sentence DESIGN-SYSTEM.md uses for the possession
 * bar — hue tells you whose move it is — applied to a control instead of a
 * card, and it is why the primary action is coloured at all.
 *
 * - Agency **Publish to client** hands the ball over, so it is `client`.
 * - The client's **Approve** and **Request changes** hand it back, so both are
 *   `agency`. They are told apart by fill versus `quiet`, not by hue, because
 *   they have the same consequence for possession and differ in what they ask
 *   for.
 * - An action that moves nothing — sign in, add a lane, add a deliverable, save
 *   a setting — leaves the ball where it is, which is with the side whose
 *   surface it is: `agency` on the agency's screens, `client` on the client's.
 * - Cancel, Back, and anything reversible is `quiet` or `ghost`. They are not
 *   possession events.
 *
 * There is no `breach` tone and there must not be one: `--breach` means a
 * commitment was missed, and a red Delete would spend that meaning on something
 * else. Destructive actions are `quiet` inside a `Dialog` that states the
 * consequence.
 */
export function buttonClass(tone: ButtonTone = 'quiet', size: ButtonSize = 'md'): string {
  return `${BUTTON_BASE} ${BUTTON_TONE[tone]} ${BUTTON_SIZE[size]}`;
}

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
