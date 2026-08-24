'use client';

/**
 * Creating an engagement has to be nearly free, or agencies will reuse one
 * long-lived workspace and break billing, purge, and isolation at once
 * (PRD §5.7). Two fields and an optional template.
 *
 * 402 `PLAN_LIMIT_REACHED` is not an error state here so much as the product's
 * only pricing lever surfacing — one scaling unit, concurrent active
 * engagements — so it is rendered as a panel with a named next step rather than
 * as a red toast.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type TemplateSummary, agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, input, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';

export function NewEngagementForm({ templates }: { templates: TemplateSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [clientOrgName, setClientOrgName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const create = useAction(agencyApi.createEngagement);

  if (!open) {
    return (
      <Button tone="agency" onClick={() => setOpen(true)}>
        New engagement
      </Button>
    );
  }

  return (
    <form
      className="flex max-w-dialog flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || !clientOrgName.trim()) return;
        const r = await create.run('Created', {
          title: title.trim(),
          clientOrgName: clientOrgName.trim(),
          ...(templateId ? { templateId } : {}),
        });
        if (r.ok) {
          setOpen(false);
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

      {templates.length > 0 && (
        <>
          <label htmlFor="engagement-template" className="text-14 text-ink">
            Start from a template
          </label>
          <select
            id="engagement-template"
            className={input}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Empty workspace</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className={cn('text-12', muted)}>
            A template stamps lanes, cards, gates, contracted rounds, and shelf groups in one action.
          </p>
        </>
      )}

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
