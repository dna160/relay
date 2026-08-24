'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Possession-coloured, because in Relay the primary action on a surface is
 * always "hand the work to the other side". `agency` fills a button in pine,
 * `client` in indigo, and the label is `--on-hue`, which is `--paper` in both
 * light and dark (globals.css §5 proves the ratio).
 *
 * There is deliberately no `breach` variant. `--breach` means one thing — a
 * commitment was missed — and a red Delete button would spend that meaning.
 * Destructive actions use `quiet` inside a Dialog that states the consequence.
 */
export type ButtonTone = 'agency' | 'client' | 'quiet' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Renders a mono progress token and sets aria-busy. Keeps the button's width. */
  loading?: boolean;
  /** Announced in place of the label while `loading`. */
  loadingLabel?: string;
  block?: boolean;
  children?: ReactNode;
}

const TONE: Record<ButtonTone, string> = {
  agency:
    'bg-agency text-on-hue border-agency enabled:hover:bg-agency-hover enabled:hover:border-agency-hover',
  client:
    'bg-client text-on-hue border-client enabled:hover:bg-client-hover enabled:hover:border-client-hover',
  quiet: 'bg-paper-2 text-ink border-rule-strong enabled:hover:bg-paper-hover',
  ghost:
    'bg-transparent text-ink border-transparent enabled:hover:bg-paper-hover',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-12 gap-1',
  md: 'h-9 px-3 text-14 gap-1.5',
  /* 44px: the client decision bar's touch target on a phone. */
  lg: 'h-11 px-4 text-16 gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = 'quiet',
    size = 'md',
    loading = false,
    loadingLabel = 'Working',
    block = false,
    className,
    disabled,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-tone={tone}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap',
        'border-hairline rounded-sm font-sans font-medium',
        'transition-colors duration-chip ease-chip',
        // Disabled reads as "not yet", not as "broken": the shape stays, the
        // contrast drops one step, and the cursor says so. Hover is suppressed
        // by the `enabled:` variants on the tone rather than fought here.
        'disabled:opacity-45 disabled:cursor-not-allowed',
        TONE[tone],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="font-mono tracking-mono text-12 opacity-70"
          >
            ···
          </span>
          <span className="sr-only">{loadingLabel}</span>
          <span aria-hidden="true" className="opacity-45">
            {children}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
