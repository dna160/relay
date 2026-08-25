'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Built on the native `<dialog>` element with `showModal()`, which gives focus
 * trapping, inertness of the page behind, `aria-modal`, and Escape-to-close
 * from the platform rather than from a dependency.
 *
 * Two things are added on top:
 *   - a labelled title, wired with `aria-labelledby`, so the dialog announces
 *     what it is rather than "dialog";
 *   - a click-outside close that is opt-out (`dismissible={false}`), because
 *     the purge confirmation must not be dismissable by a stray tap.
 */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional line under the title. Wired as `aria-describedby`. */
  description?: string;
  /** Footer actions, laid out right-aligned on desktop, stacked below 360px. */
  footer?: ReactNode;
  /** Escape and backdrop click close the dialog. Default true. */
  dismissible?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  dismissible = true,
  children,
  className,
}: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const handleCancel = useCallback(
    (event: React.SyntheticEvent<HTMLDialogElement>) => {
      // `cancel` fires on Escape. Suppressing it is what makes a confirmation
      // require an explicit answer.
      event.preventDefault();
      if (dismissible) onClose();
    },
    [dismissible, onClose],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDialogElement>) => {
      if (!dismissible) return;
      // The backdrop is part of the dialog element's own box, so a click whose
      // target is the dialog itself (not the panel inside it) is a backdrop hit.
      if (event.target === ref.current) onClose();
    },
    [dismissible, onClose],
  );

  return (
    <dialog
      ref={ref}
      onCancel={handleCancel}
      onClose={onClose}
      onClick={handleClick}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={cn(
        'm-auto w-[calc(100vw-32px)] max-w-dialog p-0 bg-transparent',
        // A document laid on the desk: it settles onto the surface it was
        // already on, it does not fly in from an edge. Three beats, and the
        // scrim comes up in one so the page behind is out of the way first.
        'animate-sheet-in',
        'backdrop:bg-scrim backdrop:animate-scrim-in',
      )}
    >
      <div
        className={cn(
          'bg-paper-2 text-ink border-hairline border-rule-strong rounded-md',
          'shadow-dialog p-4 flex flex-col gap-3',
          className,
        )}
      >
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="font-display text-20 text-ink">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="font-sans text-14 text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {children}
        {footer ? (
          <div className="flex flex-col-reverse xs:flex-row xs:justify-end gap-2 pt-1">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
