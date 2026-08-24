/**
 * Client twin of the agency empty state.
 *
 * Duplicated rather than shared on purpose: nothing in `components/agency/` is
 * importable from this bundle, and a "shared" component with a surface flag is
 * exactly the seam through which an agency-only field eventually travels. The
 * cost is fifteen lines. The benefit is that the rule can be checked with a
 * single grep instead of read for.
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
