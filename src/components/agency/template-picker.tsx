'use client';

/**
 * THE PICKER — the load-bearing moment of the whole surface.
 *
 * A template that exists and a template that gets used are different features,
 * and the difference is entirely this control. Everything Phase 6 built to make
 * deletion trustworthy assumes creation is cheap (PRD §5.7); creation is cheap
 * only if the thing that makes it cheap is in front of the person creating.
 *
 * ## Why "Start blank" is an option and not a default value in a dropdown
 *
 * It was a `<select>` whose first `<option>` read "Empty workspace", which is
 * the shape that quietly demotes it: a select is a list of *the things*, and
 * whatever sits above them reads as the absence of a choice rather than a
 * choice. Blank is not the absence of a template. It is the right answer for a
 * one-off, for the first engagement an agency ever creates, and for any job
 * that does not resemble the last one — and a surface that made it feel like
 * skipping a step would push people into stamping a docket that does not fit
 * and then deleting half of it.
 *
 * So it is a radio group, blank is the **first** option, it is **checked by
 * default**, and it is drawn at exactly the same weight as every template
 * beside it: same tile, same dieline, same selected treatment. What it does not
 * carry is a `Plate` — a plate is a layout for records, blank has none, and a
 * row of zeroes would be inventing facts to fill a shape.
 *
 * Native `<input type="radio">` in a `<fieldset>`, so arrow-key navigation,
 * roving focus, the focus ring from `globals.css`, and the group's accessible
 * name all come from the platform rather than from an implementation of them.
 *
 * ## The preview is a read, and it is deliberate about not having one
 *
 * `TemplateSummary` carries the counts so that *choosing* costs nothing. The
 * lane breakdown is a second request, made only for the template actually
 * selected, because stamping creates a workspace that counts against the plan
 * limit and the person pressing the button should have seen what it makes.
 * If that read fails, the tile still states its counts and the panel says the
 * breakdown could not be read — it never renders an empty preview, which would
 * claim the template is empty.
 *
 * ## Motion
 *
 * None. Selecting a radio changes what is displayed; it is not an event in
 * MOTION.md's sense, and the stamped board that follows arrives through a route
 * navigation, which §5 forbids animating.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agencyApi,
  type TemplateDefinition,
  type TemplateSummary,
} from '@/lib/api-client.agency';
import { cn, mono, muted } from '@/components/style-tokens';
import { plural } from '@/lib/format';
import { TemplatePreview } from './template-preview';
import { isReadableDefinition, shapeFromDefinition } from './template-shape';

/** The value the blank option carries. Empty string is "no template id". */
export const START_BLANK = '';

type Preview =
  | { status: 'loading' }
  | { status: 'ready'; definition: TemplateDefinition }
  | { status: 'unreadable' }
  | { status: 'failed' };

export interface TemplatePickerProps {
  templates: readonly TemplateSummary[];
  /** `''` for blank. The form sends `templateId` only when this is non-empty. */
  value: string;
  onChange: (templateId: string) => void;
  /** Radio `name`, so two pickers on one page cannot join the same group. */
  name?: string;
  disabled?: boolean;
}

export function TemplatePicker({
  templates,
  value,
  onChange,
  name = 'engagement-template',
  disabled = false,
}: TemplatePickerProps) {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  /*
    Selecting A then B before A lands must not paint A's lanes under B's name.
    The ref is read inside the async continuation, so a response for a template
    that is no longer selected is stored but never displayed — and storing it is
    the point, because coming back to A is then free.
  */
  const selected = useRef(value);
  selected.current = value;

  const load = useCallback((id: string) => {
    setPreviews((prev) => (prev[id] ? prev : { ...prev, [id]: { status: 'loading' } }));
    void agencyApi.template(id).then((result) => {
      setPreviews((prev) => ({
        ...prev,
        [id]: !result.ok
          ? { status: 'failed' }
          : isReadableDefinition(result.data.definition)
            ? { status: 'ready', definition: result.data.definition }
            : { status: 'unreadable' },
      }));
    });
  }, []);

  useEffect(() => {
    if (value === START_BLANK) return;
    if (previews[value]) return;
    load(value);
  }, [value, previews, load]);

  const preview = value === START_BLANK ? null : previews[value];
  const chosen = templates.find((t) => t.id === value) ?? null;

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-14 font-medium text-ink">How should this workspace start?</legend>

      <div className="flex flex-col gap-2">
        <Option
          name={name}
          value={START_BLANK}
          checked={value === START_BLANK}
          onSelect={onChange}
          title="Start blank"
          detail="An empty board. Add lanes and deliverables as the work is scoped."
        />

        {templates.map((t) => (
          <Option
            key={t.id}
            name={name}
            value={t.id}
            checked={value === t.id}
            onSelect={onChange}
            title={t.name}
            record={`${plural(t.laneCount, 'lane', 'lanes')} · ${plural(t.cardCount, 'card', 'cards')}`}
          />
        ))}
      </div>

      {chosen && (
        <div className="mt-1 flex flex-col gap-2">
          <h3 className="text-14 font-medium text-ink">
            What <span className="font-normal">{chosen.name}</span> stamps
          </h3>
          {preview?.status === 'ready' ? (
            <TemplatePreview
              shape={shapeFromDefinition(preview.definition)}
              label={`${chosen.name} template record`}
            />
          ) : (
            /*
              Three not-ready states and three different sentences, because they
              mean different things and a shared "couldn't load" would hide the
              one that matters — a docket this build cannot read is not a docket
              that failed to arrive. None of them is a spinner: an infinite
              animation says a change is occurring, forever (MOTION.md §5).
            */
            <p className={cn('text-14', muted)} aria-live="polite">
              {preview?.status === 'unreadable'
                ? 'This template was written by a newer version of Relay. It will still stamp correctly; the breakdown cannot be shown here.'
                : preview?.status === 'failed'
                  ? 'The lane breakdown is unavailable. The counts above still stand, and stamping is unaffected.'
                  : 'Reading the docket…'}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/**
 * One tile. A template reads as a *thing* rather than as a row, so it gets the
 * dieline — the cut line that turns a rectangle into something that was cut out
 * of a sheet (LABEL-SYSTEM §3a). Blank gets it too: it is the same kind of
 * choice, and drawing it as a plain row would be the demotion this control
 * exists to undo.
 */
function Option({
  name,
  value,
  checked,
  onSelect,
  title,
  detail,
  record,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (value: string) => void;
  title: string;
  detail?: string;
  record?: string;
}) {
  return (
    <label
      className={cn(
        'dieline flex cursor-pointer items-start gap-2 border-hairline px-3 py-2',
        // The selected tile is marked by its trimmed edge going to ink, not by
        // a fill: both fills available are possession hues and this control has
        // nothing to do with possession.
        checked ? 'border-ink bg-paper-2' : 'border-rule-strong bg-paper',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => {
          onSelect(value);
        }}
        className="mt-1 h-4 w-4 shrink-0 accent-agency"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-14 text-ink">{title}</span>
        {detail && <span className={cn('text-12', muted)}>{detail}</span>}
        {record && <span className={cn(mono, 'text-12', muted)}>{record}</span>}
      </span>
    </label>
  );
}
