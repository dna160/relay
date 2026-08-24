/**
 * The workspace chrome: title, client, tabs, and the wrap slate.
 *
 * The slate sits in the layout rather than on each page so that it cannot be
 * navigated away from. It is persistent and non-dismissible by design — it is
 * the only continuous statement that this workspace has an end date, and it is
 * also the conversion surface.
 *
 * A failed read renders the panel and nothing else. If the engagement is purged
 * (410) or not visible (404) there is no chrome to draw around it.
 */

import type { ReactNode } from 'react';
import { cn, display, muted } from '@/components/style-tokens';
import { ErrorPanel } from '@/components/agency/error-panel';
import { WrapSlate } from '@/components/agency/wrap-slate';
import { WorkspaceTabs } from '@/components/agency/workspace-tabs';
import { getEngagement } from '../../_lib/reads';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const engagement = await getEngagement(id);

  if (!engagement.ok) {
    return <ErrorPanel failure={engagement} />;
  }

  const e = engagement.data.engagement;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className={cn(display, 'text-28 text-ink')}>{e.title}</h1>
        <p className={cn('text-14', muted)}>{e.clientOrgName}</p>
      </div>

      <WrapSlate
        engagementId={e.id}
        wrappedAt={e.wrappedAt}
        daysToPurge={e.daysToPurge}
        archived={e.status === 'archived'}
      />

      <WorkspaceTabs engagementId={e.id} />

      <div>{children}</div>
    </div>
  );
}
