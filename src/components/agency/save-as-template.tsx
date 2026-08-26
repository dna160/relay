'use client';

/**
 * THE OTHER HALF OF THE LOOP — capture a live board as a docket.
 *
 * Templates that can only be authored in the abstract do not get authored. The
 * board an agency actually ran an engagement on is the only place a good
 * template exists, and it exists there *already* — the lanes are named, the
 * private ones are private, the deliverables are the ones the job really has.
 * So this is not a form for describing a template. It is a control for keeping
 * one that has already been built.
 *
 * Which is why the dialog leads with the preview and not with the field. What
 * dominates the sheet is a statement of what is being taken — the same
 * `TemplatePreview` the picker renders on the way back in, over the same view
 * model — and the name is one line under it, prefilled with the engagement's
 * own title. A person opening this should be answering "yes, that" and
 * adjusting a word, not filling in a specification.
 *
 * ## What is captured is what the server reads
 *
 * The request names the engagement (`fromEngagementId`) and never a definition
 * this component assembled. Lane visibility is the value INV-1 exists to
 * protect and it is not something a browser form gets to state. The preview
 * here renders the same board read the route derives from, which is what makes
 * "what you previewed is what you saved" a property of the data rather than a
 * promise.
 *
 * ## Motion
 *
 * The dialog is `Dialog`, which lays a sheet on the desk in three beats — one
 * event, one motion (R1). Nothing inside it animates: the preview is a
 * document, and the confirmation replaces the body rather than arriving.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button, Dialog, Field } from '@/components/primitives';
import { buttonClass, cn, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';
import { TemplatePreview } from './template-preview';
import { templateCounts, type TemplateShape } from './template-shape';

const NAME_MAX = 80;

export interface SaveAsTemplateProps {
  engagementId: string;
  engagementTitle: string;
  /** What a capture of this board would take, built by the server page. */
  shape: TemplateShape;
  /** An archived engagement is read-only; capturing it is still legitimate. */
  disabled?: boolean;
}

export function SaveAsTemplate({
  engagementId,
  engagementTitle,
  shape,
  disabled = false,
}: SaveAsTemplateProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(engagementTitle);
  const save = useAction(agencyApi.createTemplate);
  const counts = templateCounts(shape);
  const trimmed = name.trim();
  const empty = counts.laneCount === 0;

  function close() {
    setOpen(false);
    save.reset();
    setName(engagementTitle);
  }

  return (
    <>
      <Button tone="agency" disabled={disabled || empty} onClick={() => setOpen(true)}>
        Save as template
      </Button>
      {empty && (
        <p className={cn('max-w-prose text-12', muted)}>
          There is nothing to capture yet. Add a lane on the board first.
        </p>
      )}

      <Dialog
        open={open}
        onClose={close}
        title="Save this board as a template"
        description={
          save.data
            ? undefined
            : 'Everything below is captured as it stands. Nothing on this engagement changes.'
        }
        footer={
          save.data ? (
            <>
              <Link href="/templates" className={buttonClass('quiet', 'md')} onClick={close}>
                See all templates
              </Link>
              <Button tone="agency" onClick={close}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button tone="quiet" onClick={close}>
                Cancel
              </Button>
              <Button
                tone="agency"
                loading={save.pending}
                loadingLabel="Saving"
                disabled={trimmed.length === 0 || trimmed.length > NAME_MAX}
                onClick={async () => {
                  const r = await save.run('Saved as a template', {
                    name: trimmed,
                    fromEngagementId: engagementId,
                  });
                  // The list on /templates is server-rendered; without this the
                  // template exists and the page that lists it does not know.
                  if (r.ok) router.refresh();
                }}
              >
                Save as template
              </Button>
            </>
          )
        }
      >
        {save.data ? (
          <div className="flex flex-col gap-2">
            <p className="text-14 text-ink">
              <span className="font-semibold">{save.done}.</span> {save.data.name} is now on the
              list, and it appears as a choice the next time an engagement is created.
            </p>
            <p className={cn('text-12', muted)}>
              It carries the structure only — no files, no versions, no approvals, no client
              contacts. A template describes a kind of job, not a job.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <TemplatePreview shape={shape} label="What this capture takes" />
            <Field
              label="Name this template"
              hint="What kind of job is this? The name is what the picker shows."
              value={name}
              onChange={(e) => setName(e.target.value)}
              counter={{ value: name.length, max: NAME_MAX }}
              error={
                trimmed.length > NAME_MAX ? `Keep it under ${String(NAME_MAX)} characters.` : undefined
              }
              maxLength={NAME_MAX * 2}
            />
            {save.failure && <ErrorPanel failure={save.failure} />}
          </div>
        )}
      </Dialog>
    </>
  );
}
