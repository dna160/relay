'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

/**
 * Label, control, hint, error and counter, wired together so the front-end
 * cannot ship an input whose error is invisible to a screen reader.
 *
 * The label is always rendered and never a placeholder. An error replaces the
 * hint in the same slot so the control never moves when validation fires — the
 * decision bar's note field is the highest-stakes input in the product and it
 * must not jump under a thumb.
 */

interface FieldShellProps {
  label: string;
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
        className="font-sans text-14 font-medium text-ink leading-5"
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
  { label, hint, error, required, counter, className, ...rest },
  ref,
) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <Shell
      id={id}
      describedBy={msgId}
      label={label}
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
    { label, hint, error, required, counter, className, rows = 4, ...rest },
    ref,
  ) {
    const id = useId();
    const msgId = `${id}-msg`;
    return (
      <Shell
        id={id}
        describedBy={msgId}
        label={label}
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
