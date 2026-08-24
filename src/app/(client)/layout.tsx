/**
 * The client shell.
 *
 * Deliberately almost empty. This is the acquisition surface, the reader did
 * not ask to be here, and every kilobyte of chrome is spent from a 1.5s
 * first-paint budget on 4G. There is no agency navigation, no org switcher, and
 * nothing imported from `components/agency` anywhere in this subtree.
 */

import type { ReactNode } from 'react';
import { cn, display } from '@/components/style-tokens';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <span className={cn(display, 'text-16 uppercase tracking-lane text-ink')}>Relay</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
