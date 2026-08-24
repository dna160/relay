import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Relay replaces Tailwind's colour and font-size scales wholesale, so the stock
 * tailwind-merge cannot tell `text-14` (a size) from `text-ink` (a colour) and
 * would collapse one into the other. These groups teach it the Relay theme.
 *
 * If you add a colour or a size to `tailwind.config.ts`, add it here too.
 */

const COLORS = [
  'ink',
  'paper',
  'paper-2',
  'rule',
  'rule-strong',
  'muted',
  'agency',
  'client',
  'breach',
  'on-hue',
  'tint-agency',
  'tint-client',
  'tint-breach',
  'agency-hover',
  'client-hover',
  'paper-hover',
  'field',
  'scrim',
  'focus',
] as const;

const SIZES = ['12', '14', '16', '20', '28', '40', 'lane', 'eyebrow'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...SIZES] }],
      'text-color': [{ text: [...COLORS] }],
      'bg-color': [{ bg: [...COLORS] }],
      'border-color': [{ border: [...COLORS] }],
      'border-w': [{ border: ['hairline', 'bar'] }],
      'font-family': [{ font: ['display', 'sans', 'mono'] }],
      tracking: [{ tracking: ['lane', 'mono'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
