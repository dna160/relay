'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, eyebrow } from '@/components/style-tokens';

/** The three faces of one engagement. The board is the default. */
const TABS = [
  { slug: 'board', label: 'Board' },
  { slug: 'shelf', label: 'Shelf' },
  { slug: 'settings', label: 'Settings' },
] as const;

export function WorkspaceTabs({ engagementId }: { engagementId: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-wrap gap-x-4 gap-y-1">
      {TABS.map((tab) => {
        const href = `/w/${engagementId}/${tab.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              eyebrow,
              'border-b-2 pb-1',
              active ? 'border-ink text-ink' : 'border-transparent hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
