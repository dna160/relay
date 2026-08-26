'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

/**
 * Label, control, hint, error and counter, wired together so the front-end
 * cannot ship an input whose error is invisible to a screen reader.
 *
 * The label is always *present* and never a placeholder. An error replaces the
 * hint in the same slot so the control never moves when validation fires — the
 * decision bar's note field is the highest-stakes input in the product and it
 * must not jump under a thumb.
 *
 * `labelHidden` hides the label visually and never removes it. The two call
 * sites it exists for both sit under something that already names the control:
 * the inline add-a-lane and add-a-card boxes under a lane heading, and a
 * `<select>` inside a `<dl>` whose `<dt>` is its name. Rendering a second
 * visible label there is redundancy on the board, and rendering none at all is
 * a control with no accessible name. This is the prop that lets the last of the
 * legacy `input` string in `style-tokens.ts` be deleted.
 */

interface FieldShellProps {
  label: string;
  /** Visually hidden, never absent. Use only where a heading already names it. */
  labelHidden?: boolean;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Renders "n / max" in mono under the control. */
  counter?: { value: number; max: number };
  className?: string;
}

interface ShellRender extends FieldShellProps {
  id: string;
  describedBy: string | undefined;
  children: ReactNode;
}

function Shell({
  label,
  labelHidden,
  hint,
  error,
  required,
  counter,
  className,
  id,
  describedBy,
  children,
}: ShellRender): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn(
          'font-sans text-14 font-medium text-ink leading-5',
          labelHidden && 'sr-only',
        )}
      >
        {label}
        {required ? (
          <>
            {' '}
            <span className="text-muted font-normal">(required)</span>
          </>
        ) : null}
      </label>
      {children}
      {/* `min-h-4` is unconditional, including under `labelHidden`: the slot is
          reserved so the control does not move when an error replaces a hint. */}
      <div className="flex items-baseline justify-between gap-2 min-h-4">
        <p
          id={describedBy}
          role={error ? 'alert' : undefined}
          className={cn(
            'font-sans text-12 leading-4',
            // Not --breach. Red in this product means one thing: a contracted
            // revision round was exceeded. A validation error is not that, and
            // spending the colour here would spend it everywhere. An error is
            // marked by weight, by the field's leading bar, and by role=alert.
            error ? 'text-ink font-semibold' : 'text-muted',
          )}
        >
          {error ?? hint ?? ''}
        </p>
        {counter ? (
          <span
            aria-hidden="true"
            className={cn(
              'font-mono tracking-mono text-12 leading-4 shrink-0',
              counter.value > counter.max
                ? 'text-ink font-semibold'
                : 'text-muted',
            )}
          >
            {counter.value}/{counter.max}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const CONTROL = [
  'w-full bg-field text-ink font-sans text-16',
  'border-hairline border-rule-strong rounded-sm',
  'placeholder:text-muted',
  'disabled:opacity-45 disabled:cursor-not-allowed',
  // A field in error grows a 3px leading bar in --ink. Shape, not hue: the
  // error is legible to a monochrome reader and to a colour-blind one without
  // spending --breach.
  'aria-[invalid=true]:border-l-bar aria-[invalid=true]:border-l-ink',
].join(' ');

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>,
    FieldShellProps {}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, labelHidden, hint, error, required, counter, className, ...rest },
  ref,
) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <Shell
      id={id}
      describedBy={msgId}
      label={label}
      labelHidden={labelHidden}
      hint={hint}
      error={error}
      required={required}
      counter={counter}
      className={className}
    >
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={msgId}
        className={cn(CONTROL, 'h-11 px-2.5')}
        {...rest}
      />
    </Shell>
  );
});

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>,
    FieldShellProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, labelHidden, hint, error, required, counter, className, rows = 4, ...rest },
    ref,
  ) {
    const id = useId();
    const msgId = `${id}-msg`;
    return (
      <Shell
        id={id}
        describedBy={msgId}
        label={label}
        labelHidden={labelHidden}
        hint={hint}
        error={error}
        required={required}
        counter={counter}
        className={className}
      >
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={msgId}
          className={cn(CONTROL, 'py-2 px-2.5 resize-y min-h-[88px]')}
          {...rest}
        />
      </Shell>
    );
  },
);

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'>,
    FieldShellProps {
  options: readonly SelectOption[];
}

/**
 * A native `<select>` in the field shell.
 *
 * Native, for the same reason `Dialog` is built on `<dialog>` and the decision
 * bar's choice is two real radios: the platform already ships the keyboard
 * behaviour, the typeahead, the mobile wheel and the screen-reader semantics,
 * and a bespoke listbox is a dependency's worth of code that gets one of those
 * subtly wrong. Relay takes behaviour from the platform and spends its own
 * effort on the parts the platform has no opinion about.
 *
 * It carries the same 44px / 16px control as `Field`, which is a floor and not
 * a preference — below 16px iOS Safari zooms the viewport on focus.
 *
 * A select is for choosing among values that already exist. It is not for
 * choosing among *one*: see COMPONENTS.md §16 on the single-member case, where
 * the correct control is a button and not a menu of one.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, labelHidden, hint, error, required, counter, className, options, ...rest },
  ref,
) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <Shell
      id={id}
      describedBy={msgId}
      label={label}
      labelHidden={labelHidden}
      hint={hint}
      error={error}
      required={required}
      counter={counter}
      className={className}
    >
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={msgId}
        className={cn(CONTROL, 'h-11 px-2.5')}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Shell>
  );
});
