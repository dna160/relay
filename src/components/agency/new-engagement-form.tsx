'use client';

/**
 * Creating an engagement has to be nearly free, or agencies will reuse one
 * long-lived workspace and break billing, purge, and isolation at once
 * (PRD §5.7). Two fields and a choice of how the board starts.
 *
 * The template choice is a `TemplatePicker` and not a `<select>`, and the
 * reason is in that component's header: a dropdown whose first option reads
 * "Empty workspace" demotes starting blank into the absence of a choice.
 *
 * 402 `PLAN_LIMIT_REACHED` is not an error state here so much as the product's
 * only pricing lever surfacing — one scaling unit, concurrent active
 * engagements — so it is rendered as a panel with a named next step rather than
 * as a red toast. And it is *stated before it fires*: the line above the submit
 * says which slot this workspace takes, because stamping a template makes a
 * workspace that counts, and a docket that is one click from a board is exactly
 * the control that would otherwise make the cap a surprise.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type TemplateSummary, agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, input, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';
import { START_BLANK, TemplatePicker } from './template-picker';

export interface NewEngagementFormProps {
  templates: TemplateSummary[];
  /**
   * The same plan block the portfolio prints, threaded down rather than
   * recomputed. One evaluation of the counter, so the number stated here and
   * the number the 402 is thrown from cannot drift (INV-8).
   */
  plan?: { activeCount: number; limit: number | null } | null;
}

export function NewEngagementForm({ templates, plan = null }: NewEngagementFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [clientOrgName, setClientOrgName] = useState('');
  const [templateId, setTemplateId] = useState(START_BLANK);
  const create = useAction(agencyApi.createEngagement);

  if (!open) {
    return (
      <Button tone="agency" onClick={() => setOpen(true)}>
        New engagement
      </Button>
    );
  }

  /*
    What pressing the button costs, named before it is pressed. A template is
    one click from a live board, so the slot it spends has to be visible at the
    moment of spending it — DESIGN-SYSTEM's "stated, never sprung", the same
    sentence that puts `PURGE IN 5d` on the wrap slate.

    It stops at the cap, and that is not an omission. `PlanUsageRecord` already
    says what being at the cap means and names the two ways out; a second
    sentence saying it again, four lines apart, reads as the interface stammering
    and makes the *record* look like a duplicate of the form rather than the
    thing the form is quoting. Under the cap the record states the quantity and
    this states the consequence, which are different jobs.

    Being at the cap is also not a breach — nothing was promised and missed —
    so the emphasis is a sentence, never `--breach`.
  */
  const slotLine =
    plan && plan.limit !== null && plan.activeCount < plan.limit
      ? `This workspace takes active slot ${String(plan.activeCount + 1)} of ${String(plan.limit)}.`
      : null;

  return (
    <form
      className="flex max-w-dialog flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || !clientOrgName.trim()) return;
        const r = await create.run('Created', {
          title: title.trim(),
          clientOrgName: clientOrgName.trim(),
          ...(templateId === START_BLANK ? {} : { templateId }),
        });
        if (r.ok) {
          setOpen(false);
          /*
            The stamped board arrives as a page. It is not animated into
            existence and must not be: MOTION.md §5 forbids animating the
            initial render, and a board that flew in would read as a thing the
            interface did rather than as a document that is now there.
          */
          router.push(`/w/${r.data.engagement.id}/board`);
        }
      }}
    >
      <label htmlFor="engagement-title" className="text-14 text-ink">
        What is being delivered?
      </label>
      <input
        id="engagement-title"
        className={input}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Spring campaign — film and stills"
      />

      <label htmlFor="engagement-client" className="text-14 text-ink">
        Client
      </label>
      <input
        id="engagement-client"
        className={input}
        value={clientOrgName}
        onChange={(e) => setClientOrgName(e.target.value)}
        placeholder="Northbank Coffee"
      />

      {/*
        Rendered even when the org has no templates yet. The group is then one
        option — "Start blank" — which reads as a statement of what is about to
        happen rather than as a control with nothing in it, and it is the place
        the first saved template will appear without the form changing shape.
      */}
      <TemplatePicker templates={templates} value={templateId} onChange={setTemplateId} />

      {slotLine && <p className={cn('max-w-prose text-12', muted)}>{slotLine}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          tone="agency"
          loading={create.pending}
          loadingLabel="Creating"
          disabled={!title.trim() || !clientOrgName.trim()}
        >
          Create engagement
        </Button>
        <Button tone="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      {create.failure && <ErrorPanel failure={create.failure} />}
    </form>
  );
}
