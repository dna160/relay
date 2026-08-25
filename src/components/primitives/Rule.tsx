import { cn } from './cn';

/**
 * A hairline. The only divider in the product.
 *
 * `weight="hairline"` (default) uses `--rule`, which is decorative and is never
 * the sole boundary of an interactive control. `weight="strong"` uses
 * `--rule-strong`, which meets 3:1 against both grounds and is what a control
 * boundary, a table header underline, or a section break is drawn with.
 *
 * `weight="hazard"` is the third and it has exactly one referent: the purge
 * boundary. A 6px band of achromatic diagonals, `--ink` on the ground.
 *
 * The reference sheets this vocabulary comes from draw hazard stripes in alert
 * red. Relay cannot: `--breach` means `roundsUsed > contractedRounds` and
 * nothing else, and a reservation that bends is not a reservation. Black and
 * white diagonals carry "there is a line here and a far side to it" without
 * spending a hue — and purge is not urgency, it is a stated property of the
 * document, never sprung. Horizontal only, and it always sits beside text that
 * says what the boundary is; the stripes never carry the meaning alone.
 */
export interface RuleProps {
  orientation?: 'horizontal' | 'vertical';
  weight?: 'hairline' | 'strong' | 'hazard';
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
  if (weight === 'hazard') {
    return (
      <hr
        aria-hidden="true"
        className={cn('hazard-rule w-full border-0 shrink-0', inset && 'my-2', className)}
      />
    );
  }
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
