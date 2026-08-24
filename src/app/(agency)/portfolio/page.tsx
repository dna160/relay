/**
 * The portfolio — the agency's home screen.
 *
 * Two lists, in this order on purpose. The attention list comes first because
 * the question the product exists to answer is "what is blocked, and on whom",
 * and it is grouped by actionability rather than by deadline: a list sorted by
 * due date tells you what is nearest, not what you can do something about
 * (PRD §5.5).
 *
 * A server component. The three reads are issued together rather than in
 * sequence — the portfolio is a read path and a waterfall here is felt.
 */

import type { Metadata } from 'next';
import { agencyApi } from '@/lib/api-client';
import { cn, display, eyebrow, muted } from '@/components/style-tokens';
import { AttentionList } from '@/components/agency/attention-list';
import { EngagementRow } from '@/components/agency/engagement-row';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { NewEngagementForm } from '@/components/agency/new-engagement-form';
import { serverContext } from '../_lib/server-context';

export const metadata: Metadata = { title: 'Portfolio · Relay' };

export default async function PortfolioPage() {
  const ctx = await serverContext();
  const [engagements, attention, templates] = await Promise.all([
    agencyApi.portfolio(ctx),
    agencyApi.attention(ctx),
    agencyApi.templates(ctx),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="attention-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 id="attention-heading" className={cn(display, 'text-28 text-ink')}>
            Needs a decision
          </h1>
          <NewEngagementForm templates={templates.ok ? templates.data : []} />
        </div>
        <p className={cn('mt-1 max-w-prose text-14', muted)}>
          Ranked by who is holding the work, not by what is due soonest.
        </p>
        <div className="mt-4">
          {attention.ok ? (
            <AttentionList items={attention.data} />
          ) : (
            <ErrorPanel failure={attention} />
          )}
        </div>
      </section>

      <section aria-labelledby="engagements-heading">
        <h2 id="engagements-heading" className={cn(eyebrow, 'border-b border-ink pb-1')}>
          Engagements
        </h2>
        <div className="mt-3">
          {!engagements.ok ? (
            <ErrorPanel failure={engagements} />
          ) : engagements.data.length === 0 ? (
            <EmptyState instruction="No engagements yet. Create the first one when a contract is signed." />
          ) : (
            <ul>
              {engagements.data.map((e) => (
                <EngagementRow key={e.id} engagement={e} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
