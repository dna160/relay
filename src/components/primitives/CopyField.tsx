'use client';

import { useId, useRef, useState } from 'react';
import { cn } from './cn';
import { Button } from './Button';

/**
 * A value the interface is *handing over* — one a person has to get out of the
 * screen and into somewhere else.
 *
 * This is a primitive because it knows nothing about engagements. It knows one
 * thing: that a string printed as text is not the same as a string a person can
 * take. Relay hands over exactly three kinds of value — a client link, a full
 * sha256, an export job id — and every one of them was, before this, raw text
 * with no affordance on it. "I don't know what the string of words means" is
 * what that reads as to somebody who did not mint it.
 *
 * ## Three rules, and they are the whole component
 *
 * **1. The primary action is the take, not the value.** The button is the first
 * thing that carries a verb, and the verb names the object — `Copy link`, not
 * `Copy`. A bare `Copy` in a page with four copyable things is the same failure
 * as a bare `Export` in a strip with two records: a verb with no object is a
 * control a reader has to guess at.
 *
 * **2. The result is shown where the action was taken.** A `role="status"` line
 * under the control, exactly as `ExportControl` does it. There are no toasts in
 * this product (MOTION.md §5) and the button label does not mutate into
 * `Copied` — a control that stops saying what it does is a control that has
 * traded its label for a receipt. `announce` is keyed by a press counter so a
 * second press re-announces rather than going silent.
 *
 * **3. Nothing here is on a timer.** No revert after two seconds, no fade. This
 * product has exactly one duration token and a dwell is not a duration
 * (MOTION.md §2); a state that disappears on its own is also a state a screen
 * reader can miss. The status line stays until the value changes.
 *
 * ## `secret`
 *
 * Some handed-over values are not for printing continuously on a page that gets
 * screen-shared. `secret` masks the value until asked for, and — the part that
 * matters — **copy works without revealing**. Revealing is for the person who
 * wants to check it, not a step on the path. See COMPONENTS.md §15 for when a
 * value earns the mask.
 *
 * ## The clipboard can refuse
 *
 * `navigator.clipboard` needs a secure context and a permission that a browser
 * may not grant. When it refuses, this does not fail silently and it does not
 * claim success: it reveals the value, selects it, and says what to press. The
 * point of the component is that the person leaves with the value, and the
 * fallback has to serve that rather than the component's own tidiness.
 */

export interface CopyFieldProps {
  /** Names the value. Always rendered — a placeholder is not a label. */
  label: string;
  /** The value that is copied. Always the whole thing, never the display form. */
  value: string;
  /** Line under the control explaining what the value is for. */
  hint?: string;
  /** Masks the value until `Show`. Copy still works while masked. */
  secret?: boolean;
  /** Names the object: `Copy link`, `Copy hash`. Default `Copy`. */
  copyLabel?: string;
  /** The confirmation. Default `Copied to your clipboard.` */
  copiedLabel?: string;
  className?: string;
}

/**
 * The mask. A fixed-width run of the mono face's own middle dot, so a masked
 * value reads as a redacted record rather than as an empty box or as a
 * password field borrowed from a login form.
 */
const MASK = '····································';

export function CopyField({
  label,
  value,
  hint,
  secret = false,
  copyLabel = 'Copy',
  copiedLabel = 'Copied to your clipboard.',
  className,
}: CopyFieldProps): React.JSX.Element {
  const id = useId();
  const valueId = `${id}-value`;
  const hintId = `${id}-hint`;
  const outputRef = useRef<HTMLElement | null>(null);

  const [revealed, setRevealed] = useState(!secret);
  /** Counts presses so an unchanged message is announced again. */
  const [presses, setPresses] = useState(0);
  const [result, setResult] = useState<'copied' | 'manual' | null>(null);

  const shown = revealed ? value : MASK;

  function selectValue(): void {
    const node = outputRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function copy(): Promise<void> {
    setPresses((n) => n + 1);
    try {
      await navigator.clipboard.writeText(value);
      setResult('copied');
    } catch {
      // The browser refused. Put the value where a keyboard can take it and
      // say so, rather than reporting a success that did not happen.
      setRevealed(true);
      selectValue();
      setResult('manual');
    }
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span id={valueId} className="font-sans text-14 font-medium leading-5 text-ink">
        {label}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          `<code>` rather than `<input readOnly>` or `<output>`. A read-only
          input invites a click that does nothing, and `<output>` is an implicit
          `aria-live` region — revealing a masked value would read the whole
          token aloud to somebody who only wanted to look at it. This is text.
          It is focusable, and only so that the manual-copy fallback has
          somewhere for a keyboard to land; `tabIndex={0}` never reorders.
        */}
        <code
          ref={outputRef}
          id={`${id}-out`}
          tabIndex={0}
          aria-labelledby={valueId}
          aria-describedby={hint ? hintId : undefined}
          className={cn(
            'min-w-0 flex-1 break-all rounded-sm border-hairline border-rule-strong bg-field',
            'px-2.5 py-2 font-mono tracking-mono tabular-nums text-14 text-ink',
            !revealed && 'select-none text-muted',
          )}
        >
          {shown}
          {!revealed && <span className="sr-only">Hidden. Copy works without showing it.</span>}
        </code>

        <div className="flex shrink-0 items-center gap-2">
          {secret && (
            <Button
              tone="ghost"
              size="md"
              aria-expanded={revealed}
              aria-controls={`${id}-out`}
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? 'Hide' : 'Show'}
            </Button>
          )}
          <Button tone="quiet" size="md" onClick={() => void copy()}>
            {copyLabel}
          </Button>
        </div>
      </div>

      {/*
        One slot, one line. The hint is what the value is for; the result
        replaces nothing — it is appended, because a person who has just copied
        still needs to know what they copied.
      */}
      {hint && (
        <p id={hintId} className="font-sans text-12 leading-4 text-muted">
          {hint}
        </p>
      )}
      <p role="status" className="min-h-4 font-sans text-12 leading-4 text-muted">
        {result === null ? (
          ''
        ) : (
          <span key={presses}>
            {result === 'copied'
              ? copiedLabel
              : 'Your browser would not let the page copy this. It is selected above — press ⌘C or Ctrl-C.'}
          </span>
        )}
      </p>
    </div>
  );
}
