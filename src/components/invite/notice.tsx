/**
 * The panel every unhappy invite state renders into.
 *
 * Shaped like `agency/error-panel.tsx` on purpose — one bordered block, a
 * display-face heading, the mono code in the corner — so that the two surfaces
 * look like one product. What differs is what it is allowed to omit: the agency
 * panel always prints `CODE · STATUS`, because an agency member reporting a
 * problem to us benefits from having it on screen. Here the code is optional,
 * and it is left off for the states that are not errors at all.
 *
 * **An invite that cannot be redeemed is not a breach.** `--breach` in this
 * product means exhaustively one thing — a commitment missed, rounds over
 * contract — and it is the only red the palette has. An expired link, a wrong
 * address, a spent invite: all of these are ordinary, none of them is a broken
 * promise, and painting them red would spend the meaning of the one colour that
 * has one. So this panel is `surface` and ink, like every other statement of
 * fact in Relay, and the weight it carries comes from the words.
 */

import type { ReactNode } from 'react';
import { cn, display, mono, muted, surface } from '@/components/style-tokens';

export function InviteNotice({
  title,
  body,
  code,
  children,
}: {
  title: string;
  body: string;
  /** `CODE · 404`, shown only where a reader could usefully quote it back. */
  code?: string;
  /** The ways forward. Rendered under the body, never in place of it. */
  children?: ReactNode;
}) {
  return (
    <section role="status" className={cn(surface, 'px-4 py-4')}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={cn(display, 'text-16 text-ink')}>{title}</h2>
        {code && <span className={cn(mono, 'text-12', muted)}>{code}</span>}
      </div>
      <p className={cn('mt-2 max-w-prose text-14', muted)}>{body}</p>
      {children && <div className="mt-3 flex flex-col gap-2">{children}</div>}
    </section>
  );
}
