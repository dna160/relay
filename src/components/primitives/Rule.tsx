import { cn } from './cn';

/**
 * A hairline. The only divider in the product.
 *
 * `weight="hairline"` (default) uses `--rule`, which is decorative and is never
 * the sole boundary of an interactive control. `weight="strong"` uses
 * `--rule-strong`, which meets 3:1 against both grounds and is what a control
 * boundary, a table header underline, or a section break is drawn with.
 */
export interface RuleProps {
  orientation?: 'horizontal' | 'vertical';
  weight?: 'hairline' | 'strong';
  /** Adds symmetrical margin on the cross axis. */
  inset?: boolean;
  className?: string;
}

export function Rule({
  orientation = 'horizontal',
  weight = 'hairline',
  inset = false,
  className,
}: RuleProps): React.JSX.Element {
  const color = weight === 'strong' ? 'border-rule-strong' : 'border-rule';
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        'border-0 shrink-0',
        orientation === 'horizontal'
          ? cn('w-full border-t-hairline', color, inset && 'my-2')
          : cn('self-stretch border-l-hairline', color, inset && 'mx-2'),
        className,
      )}
    />
  );
}
