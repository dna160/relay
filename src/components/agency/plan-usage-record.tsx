/**
 * PLAN USAGE — the pricing model's one number, set beside the control that
 * spends it.
 *
 * PRD §9: concurrent active engagements are the single scaling unit. Everything
 * else on the pricing page is a gate or a cap. That makes this count the only
 * quantity in the product that can stop someone mid-task, and DESIGN-SYSTEM is
 * explicit that a limit is *stated, never sprung* — the same sentence that puts
 * `PURGE IN 5d` on the wrap slate rather than a deletion notice after the fact.
 * Before this existed, the free plan's third engagement was indistinguishable
 * from its first and the cap was discovered as a 402 at the button.
 *
 * It is a `Plate`, not a progress bar. The count is a *record* — it is the
 * number an invoice would be argued from, and mono is what this product marks
 * those with (DESIGN-SYSTEM, LABEL-SYSTEM §5). A bar would also have to pick a
 * fill colour, and both hues here already mean possession while `--breach`
 * means one thing exhaustively: rounds used past rounds contracted. Being at
 * the cap is not a breach. Nothing was promised and missed; the plan is doing
 * what the plan says. So the emphasis at the limit is weight and a sentence,
 * never red.
 *
 * The sentence appears only at the cap, and it names the two ways out in the
 * order the product prefers them: wrapping a finished engagement is free and is
 * usually the true answer, because an agency at three active engagements
 * generally has one that shipped last month.
 */

import type { Plan } from '@/lib/types';
import { Plate, type PlateRow } from '@/components/primitives';
import { cn, muted } from '@/components/style-tokens';

export interface PlanUsageRecordProps {
  plan: Plan;
  activeCount: number;
  /** Null means unlimited — Studio. */
  limit: number | null;
  className?: string;
}

export function PlanUsageRecord({ plan, activeCount, limit, className }: PlanUsageRecordProps) {
  const atLimit = limit !== null && activeCount >= limit;

  const rows: PlateRow[] = [
    {
      term: 'Active',
      /*
       * One text node, deliberately. "3 of 3" is the fact; splitting the count
       * from the limit across two nodes would leave a screen reader announcing
       * two unrelated numbers, and it is the pair that means anything.
       */
      value: (
        // The weight goes on the count, not on the whole plate. At the cap it
        // is the number that has changed meaning; bolding the terms alongside
        // it would make the record shout its own labels.
        <span className={atLimit ? 'font-semibold' : undefined}>
          {limit === null ? String(activeCount) : `${activeCount} of ${limit}`}
        </span>
      ),
      title:
        limit === null
          ? `${String(activeCount)} active engagements; this plan does not cap them`
          : `${String(activeCount)} of ${String(limit)} active engagements used on the ${plan} plan`,
      tone: 'ink',
    },
    { term: 'Plan', value: plan.toUpperCase(), tone: 'muted' },
  ];

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <Plate
        layout="strip"
        label="Active engagements against this plan"
        rows={rows}
      />
      {atLimit && (
        <p className={cn('max-w-prose text-12', muted)}>
          Every active slot is in use. Wrap one that has shipped, or move to a plan with more,
          before starting another.
        </p>
      )}
    </div>
  );
}
