'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, eyebrow, mono } from '@/components/style-tokens';

/**
 * Two destinations. The client is not motivated and is not going to learn a
 * navigation — everything they have to do is in one of these.
 */
export function ClientTabs({ token, awaitingCount }: { token: string; awaitingCount: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/e/${token}/board`, label: 'Everything' },
    { href: `/e/${token}/queue`, label: 'Your decisions' },
  ];

  return (
    <nav aria-label="Workspace" className="flex flex-wrap gap-x-4 gap-y-1">
      {tabs.map((tab, i) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              eyebrow,
              'border-b-2 pb-1',
              active ? 'border-ink text-ink' : 'border-transparent hover:text-ink',
            )}
          >
            {tab.label}
            {i === 1 && awaitingCount > 0 && (
              <span className={cn(mono, 'ml-2 text-12 text-client')}>{awaitingCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
