/**
 * Templates — scaffolded; Phase 7 owns stamping and capture.
 *
 * They are v1 and not v2 for a structural reason (PRD §5.7): disposable
 * workspaces only work if creating one is nearly free. Without templates,
 * ephemerality becomes a tax, and an agency paying that tax will keep one
 * long-lived workspace instead — which breaks billing, purge, and isolation
 * together. The list is here now so the path exists before the pressure does.
 */

import type { Metadata } from 'next';
import { agencyApi } from '@/lib/api-client';
import { formatDate, plural } from '@/lib/format';
import { cn, display, mono, muted, surface } from '@/components/style-tokens';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { serverContext } from '../_lib/server-context';

export const metadata: Metadata = { title: 'Templates · Relay' };

export default async function TemplatesPage() {
  const ctx = await serverContext();
  const templates = await agencyApi.templates(ctx);

  return (
    <div className="flex max-w-prose flex-col gap-4">
      <div>
        <h1 className={cn(display, 'text-28 text-ink')}>Templates</h1>
        <p className={cn('mt-1 text-14', muted)}>
          A template stamps lanes, cards, approval gates, contracted round counts, and shelf groups
          in one action.
        </p>
      </div>

      {!templates.ok ? (
        <ErrorPanel failure={templates} />
      ) : templates.data.length === 0 ? (
        <EmptyState instruction="No templates yet. Save a finished engagement as one from its settings." />
      ) : (
        <ul className={cn(surface, 'divide-y divide-rule')}>
          {templates.data.map((t) => (
            <li key={t.id} className="flex flex-col gap-1 px-3 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-16 text-ink">{t.name}</h2>
                <span className={cn(mono, 'text-12', muted)}>{formatDate(t.updatedAt)}</span>
              </div>
              {t.description && <p className={cn('text-14', muted)}>{t.description}</p>}
              <p className={cn(mono, 'text-12', muted)}>
                {plural(t.laneCount, 'lane', 'lanes')} · {plural(t.cardCount, 'card', 'cards')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
