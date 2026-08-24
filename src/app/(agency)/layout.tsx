/**
 * The agency shell. Two destinations and a wordmark — the workspace chrome
 * lives one level down, on the engagement, because that is the unit of work.
 *
 * Nothing in this file or its subtree is importable from `(client)`.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn, display, eyebrow } from '@/components/style-tokens';

export default function AgencyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/portfolio" className={cn(display, 'text-16 uppercase tracking-lane text-ink')}>
            Relay
          </Link>
          <Link href="/portfolio" className={cn(eyebrow, 'hover:text-ink')}>
            Portfolio
          </Link>
          <Link href="/templates" className={cn(eyebrow, 'hover:text-ink')}>
            Templates
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
