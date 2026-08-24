/**
 * One panel for every documented failure: 402, 409, 423, 410, 404, plus the
 * transport failure that has no code because the request never landed.
 *
 * The copy comes from `failureCopy` so that the same words appear wherever a
 * given code surfaces.
 */

import type { ReactNode } from 'react';
import type { ApiFailure } from '@/lib/api-client.core';
import { failureCopy } from './failure-copy';
import { cn, display, mono, muted, surface } from '@/components/style-tokens';

export function ErrorPanel({
  failure,
  action,
  className,
}: {
  failure: ApiFailure;
  /** The panel names an action; the caller decides what it does. */
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
