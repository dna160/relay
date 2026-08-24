import type { ElementType, ReactNode } from 'react';
import { cn } from './cn';

/**
 * The two layout primitives. Everything in Relay is a column of rows.
 *
 * `gap` is a fixed 4px-based scale rather than a free number, so vertical
 * rhythm is a decision made once. 0=0, 1=4, 2=8, 3=12, 4=16, 6=24, 8=32.
 * If you need a gap that is not on this list, the layout is wrong.
 */
export type Gap = 0 | 1 | 2 | 3 | 4 | 6 | 8;

const GAP_Y: Record<Gap, string> = {
  0: 'gap-y-0',
  1: 'gap-y-1',
  2: 'gap-y-2',
  3: 'gap-y-3',
  4: 'gap-y-4',
  6: 'gap-y-6',
  8: 'gap-y-8',
};

const GAP_X: Record<Gap, string> = {
  0: 'gap-x-0',
  1: 'gap-x-1',
  2: 'gap-x-2',
  3: 'gap-x-3',
  4: 'gap-x-4',
  6: 'gap-x-6',
  8: 'gap-x-8',
};

export interface StackProps {
  children: ReactNode;
  gap?: Gap;
  align?: 'start' | 'center' | 'end' | 'stretch';
  as?: ElementType;
  className?: string;
}

export function Stack({
  children,
  gap = 2,
  align = 'stretch',
  as,
  className,
}: StackProps): React.JSX.Element {
  const Tag: ElementType = as ?? 'div';
  return (
    <Tag
      className={cn(
        'flex flex-col min-w-0',
        GAP_Y[gap],
        align === 'start' && 'items-start',
        align === 'center' && 'items-center',
        align === 'end' && 'items-end',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export interface RowProps extends StackProps {
  justify?: 'start' | 'between' | 'end' | 'center';
  /** Wraps below 360px instead of overflowing. On by default. */
  wrap?: boolean;
  /** Aligns to the text baseline — for a title beside a mono record. */
  baseline?: boolean;
}

export function Row({
  children,
  gap = 2,
  align = 'center',
  justify = 'start',
  wrap = true,
  baseline = false,
  as,
  className,
}: RowProps): React.JSX.Element {
  const Tag: ElementType = as ?? 'div';
  return (
    <Tag
      className={cn(
        'flex flex-row min-w-0',
        GAP_X[gap],
        GAP_Y[gap],
        wrap && 'flex-wrap',
        baseline
          ? 'items-baseline'
          : align === 'start'
            ? 'items-start'
            : align === 'end'
              ? 'items-end'
              : align === 'stretch'
                ? 'items-stretch'
                : 'items-center',
        justify === 'between' && 'justify-between',
        justify === 'end' && 'justify-end',
        justify === 'center' && 'justify-center',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
