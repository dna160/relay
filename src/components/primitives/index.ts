/**
 * The primitive layer: unstyled behaviour plus token styling, nothing that
 * knows what an engagement is. Product components in `src/components/` compose
 * these; they never reach past them to a raw colour or a raw font size.
 */

export { cn } from './cn';
export { Button, type ButtonProps, type ButtonTone, type ButtonSize } from './Button';
export { Chip, type ChipProps, type ChipTone, type ChipVariant } from './Chip';
export { Field, Textarea, type FieldProps, type TextareaProps } from './Field';
export { Dialog, type DialogProps } from './Dialog';
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Mono, type MonoProps } from './Mono';
export { Plate, type PlateProps, type PlateRow } from './Plate';
export { ColourBar, type ColourBarProps } from './ColourBar';
export {
  Barcode,
  code39Path,
  normaliseForCode39,
  type BarcodeProps,
} from './Barcode';
export {
  RegistrationMark,
  type RegistrationMarkProps,
} from './RegistrationMark';
export { Rule, type RuleProps } from './Rule';
export { Stack, Row, type StackProps, type RowProps, type Gap } from './Stack';
