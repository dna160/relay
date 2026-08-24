/**
 * Client twin of the failure panel.
 *
 * `NOT_VISIBLE` is a 404 here and reads as one. A client who follows a link to
 * a private lane is told the page does not exist, which is the same thing they
 * would be told if it truly did not — that is the point of returning 404 rather
 * than 403 (INV-1).
 */

import type { ReactNode } from 'react';
import type { ApiFailure } from '@/lib/api-client';
import { failureCopy } from './failure-copy';
import { cn, display, mono, muted, surface } from '@/components/style-tokens';

export function ErrorPanel({
  failure,
  action,
  className,
}: {
  failure: ApiFailure;
  action?: ReactNode;
  className?: string;
}) {
  const copy = failureCopy(failure);
  return (
    <section role="alert" className={cn(surface, 'px-4 py-4', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={cn(display, 'text-16 text-ink')}>{copy.title}</h2>
        <span className={cn(mono, 'text-12', muted)}>
          {failure.code}
          {failure.status ? ` · ${failure.status}` : ''}
        </span>
      </div>
      <p className={cn('mt-2 max-w-prose text-14', muted)}>{copy.body}</p>
      {action && <div className="mt-3">{action}</div>}
    </section>
  );
}
