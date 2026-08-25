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
import { redirect } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import { cn, display, eyebrow, muted } from '@/components/style-tokens';
import { AttentionList } from '@/components/agency/attention-list';
import { EngagementRow } from '@/components/agency/engagement-row';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { NewEngagementForm } from '@/components/agency/new-engagement-form';
import { PlanUsageRecord } from '@/components/agency/plan-usage-record';
import { derivePlanUsage } from '../_lib/plan-usage';
import { serverContext } from '../_lib/server-context';

export const metadata: Metadata = { title: 'Portfolio · Relay' };

export default async function PortfolioPage() {
  const ctx = await serverContext();
  const [engagements, attention, templates] = await Promise.all([
    agencyApi.portfolio(ctx),
    agencyApi.attention(ctx),
    agencyApi.templates(ctx),
  ]);

  /**
   * A 401 here does not mean "your session expired". `requireAgency()` refuses
   * a user whose `org_id` is still null, which is every user between their
   * first magic link and their first agency (ADR-013) — so the most likely
   * reader of this branch is someone thirty seconds into the product, not
   * someone coming back after two weeks. `/onboarding` can tell the two apart
   * (it reads the Auth.js session as well as ours) and this page cannot, so it
   * hands the question over rather than guessing at it in an error panel.
   */
  if (!engagements.ok && engagements.code === 'UNAUTHENTICATED') redirect('/onboarding');

  const rows = engagements.ok ? engagements.data.engagements : [];

  /**
   * The plan block if the route states it, derived from these same rows if it
   * does not yet (see `_lib/plan-usage.ts`). Either way it is one evaluation of
   * `evaluatePlanGate()` — the function the 402 is thrown from — so the number
   * on this screen and the number at the button cannot drift (INV-8).
   */
  const planUsage = engagements.ok
    ? (engagements.data.plan ?? (await derivePlanUsage(rows, new Date())))
    : null;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="attention-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 id="attention-heading" className={cn(display, 'text-28 text-ink')}>
            Needs a decision
          </h1>
          {/*
            The usage record sits under the control it constrains rather than
            down beside the engagement list. What it is for is the moment before
            someone presses New engagement, not an audit of the portfolio — and
            when the form is open it is still on screen, above the two fields
            being filled in.
          */}
          <div className="flex flex-col items-start gap-2">
            <NewEngagementForm templates={templates.ok ? templates.data : []} />
            {planUsage && (
              <PlanUsageRecord
                plan={planUsage.plan}
                activeCount={planUsage.activeCount}
                limit={planUsage.limit}
              />
            )}
          </div>
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
          ) : rows.length === 0 ? (
            <EmptyState instruction="No engagements yet. Create the first one when a contract is signed." />
          ) : (
            <ul>
              {rows.map((e) => (
                <EngagementRow key={e.id} engagement={e} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
