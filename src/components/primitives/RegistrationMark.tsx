import { cn } from './cn';

/**
 * A PRINTER'S REGISTRATION MARK.
 *
 * On a press sheet this is where the plates line up; on a Relay document it
 * marks the point at which the document was *issued* — the top corner of the
 * wrap slate, the head of a purge certificate, the header of an export.
 *
 * It is drawn entirely in `background-image` gradients on one element (see
 * `.reg-mark` in globals.css §7): no request, no SVG, no extra node.
 *
 * It is also the only circle in a product whose radius ceiling is 3px. That
 * ceiling exists so surfaces do not read as a SaaS dashboard; a registration
 * mark is a printer's mark and is a circle by definition. The exception is
 * named here so nobody has to guess whether it was an oversight.
 *
 * Decorative by default and therefore `aria-hidden`. Pass `label` only if the
 * mark is the sole carrier of something a reader needs, which it should not be.
 */
export interface RegistrationMarkProps {
  label?: string;
  className?: string;
}

export function RegistrationMark({
  label,
  className,
}: RegistrationMarkProps): React.JSX.Element {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('reg-mark inline-block shrink-0 align-middle', className)}
    />
  );
}
