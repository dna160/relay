/**
 * Empty states instruct rather than apologise. "Nothing here yet. Add the
 * first deliverable." — not "You don't have any cards :(".
 */

import type { ReactNode } from 'react';
import { cn, muted } from '@/components/style-tokens';

export function EmptyState({
  instruction,
  children,
  className,
}: {
  instruction: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border border-dashed border-rule px-3 py-6 text-center', className)}>
      <p className={cn('text-14', muted)}>{instruction}</p>
      {children && <div className="mt-3 flex justify-center">{children}</div>}
    </div>
  );
}
