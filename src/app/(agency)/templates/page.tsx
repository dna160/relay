/**
 * TEMPLATES — the dockets an agency stamps a workspace from.
 *
 * They are v1 and not v2 for a structural reason (PRD §5.7): disposable
 * workspaces only work if creating one is nearly free. Without templates,
 * ephemerality becomes a tax, and an agency paying that tax will keep one
 * long-lived workspace instead — which breaks billing, purge, and isolation
 * together. Everything Phase 6 built to make deletion trustworthy assumes
 * creation is cheap; this is the surface that makes it cheap.
 *
 * ## Why the definitions are read here and not on demand
 *
 * The list route returns `TemplateSummary`, whose counts exist so that
 * *choosing* costs nothing. This page is not choosing — it is the register, the
 * place someone comes to check what a docket actually contains before they trust
 * it on a live job. So the definitions are read alongside the summaries, in one
 * parallel batch, and the whole page is server-rendered with no client
 * JavaScript at all. A disclosure per template is a native `<details>`: keyboard
 * operable, focusable through `globals.css`'s base ring, and it does not animate
 * — a register is a document and opening a document is not an event
 * (MOTION.md §5).
 *
 * A detail read that fails does not blank the entry. The summary is authoritative
 * on the counts, so the entry still states them and says the breakdown is
 * unavailable — an empty preview would claim the template is empty, which is the
 * one thing it must never say about a docket somebody is about to stamp.
 *
 * ## Vernacular
 *
 * A template reads as a *thing* rather than as a row, so each one is a
 * `.dieline` block (LABEL-SYSTEM §3a) with a `Plate` of its records. Its name is
 * prose and is set in sans; its lane count, card count and issue date are facts
 * about a document and are set in mono. That is the same rule the card, the
 * version stack and the certificate already follow.
 */

import type { Metadata } from 'next';
import { agencyApi, type TemplateDetail, type TemplateSummary } from '@/lib/api-client.agency';
import type { ApiResult } from '@/lib/api-client.core';
import { formatDate, plural } from '@/lib/format';
import { cn, display, eyebrow, muted } from '@/components/style-tokens';
import { Plate, type PlateRow } from '@/components/primitives';
import { EmptyState } from '@/components/agency/empty-state';
import { ErrorPanel } from '@/components/agency/error-panel';
import { TemplatePreview } from '@/components/agency/template-preview';
import { isReadableDefinition, shapeFromDefinition } from '@/components/agency/template-shape';
import { serverContext } from '../_lib/server-context';

export const metadata: Metadata = { title: 'Templates · Relay' };

export default async function TemplatesPage() {
  const ctx = await serverContext();
  const templates = await agencyApi.templates(ctx);

  const details: ApiResult<TemplateDetail>[] = templates.ok
    ? await Promise.all(templates.data.map((t) => agencyApi.template(t.id, ctx)))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-prose">
        <h1 className={cn(display, 'text-28 text-ink')}>Templates</h1>
        <p className={cn('mt-1 text-14', muted)}>
          A template stamps lanes, deliverables, contracted round counts and shelf groups in one
          action. It carries structure only — never files, versions, approvals or client contacts.
        </p>
        <p className={cn('mt-2 text-14', muted)}>
          Templates are made by capturing a board you have already built: open an engagement&rsquo;s
          settings and save it as one.
        </p>
      </div>

      {!templates.ok ? (
        <ErrorPanel failure={templates} />
      ) : templates.data.length === 0 ? (
        <EmptyState instruction="No templates yet. Open an engagement you have finished, and save its board as one from Settings." />
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.data.map((t, i) => (
            <TemplateEntry key={t.id} summary={t} detail={details[i]} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateEntry({
  summary,
  detail,
}: {
  summary: TemplateSummary;
  detail: ApiResult<TemplateDetail> | undefined;
}) {
  const definition = detail?.ok === true ? detail.data.definition : null;
  const readable = definition !== null && isReadableDefinition(definition);

  /*
    The record. Counts come from the *summary* even when the definition was
    read, because the summary is what the list route states and what the picker
    will show — two numbers for one fact, sourced differently, is how a page
    ends up disagreeing with the control it is meant to explain.
  */
  const rows: PlateRow[] = [
    { term: 'Lanes', value: String(summary.laneCount) },
    { term: 'Cards', value: String(summary.cardCount) },
    {
      term: 'Issued',
      value: formatDate(summary.createdAt),
      title: summary.createdAt,
      tone: 'muted',
    },
  ];

  return (
    <li className="dieline border-hairline border-rule-strong bg-paper-2 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className={cn(display, 'min-w-0 text-16 text-ink')}>{summary.name}</h2>
        <Plate layout="strip" label={`${summary.name} template record`} rows={rows} />
      </div>

      {/*
        The disclosure exists only when there is something behind it. A control
        labelled "What it stamps" that opens onto "this could not be read" is a
        promise the page cannot keep, and it is worse than the sentence it hides:
        the reader spends a click to find out nothing, on the surface whose whole
        job is to be trustworthy about what a docket contains.
      */}
      {readable && definition ? (
        <details className="mt-2 group">
          <summary className={cn(eyebrow, 'cursor-pointer select-none hover:text-ink')}>
            <span className="group-open:hidden">What it stamps</span>
            <span className="hidden group-open:inline">Hide what it stamps</span>
          </summary>
          <div className="mt-2">
            <TemplatePreview
              shape={shapeFromDefinition(definition)}
              label={`${summary.name} lane breakdown`}
              totals={false}
            />
          </div>
        </details>
      ) : (
        <p className={cn('mt-2 max-w-prose text-12', muted)}>
          {definition !== null
            ? 'Written by a newer version of Relay. It still stamps correctly; the breakdown cannot be shown here.'
            : 'The lane breakdown is unavailable. The record above still stands — ' +
              `${plural(summary.laneCount, 'lane', 'lanes')}, ${plural(summary.cardCount, 'card', 'cards')} — and stamping is unaffected.`}
        </p>
      )}
    </li>
  );
}
