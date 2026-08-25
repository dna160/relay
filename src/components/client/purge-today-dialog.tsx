'use client';

/**
 * The day-0 dialog — **the only interruption in the entire product.**
 *
 * FLOWS.md §3 permits exactly one, on the day the workspace is destroyed, and
 * constrains it hard: it appears once, it is dismissible, and closing it costs
 * nothing because every fact it contained is still on the page behind it — the
 * slate at the top, the strip above the lanes, and the same export button in
 * both. It is a tap on the shoulder, not a gate.
 *
 * Three things it deliberately is not: it is not `--breach`, it is not modal
 * over a surface with no other route to the export, and it does not say "Action
 * required", "Final warning", or "Don't lose your data!". The product is calm
 * about this because the product told the truth about it from screen one — the
 * sign-in footer said "this workspace is deleted on 12 May" before the contact
 * had typed their email.
 *
 * **Seen-ness is keyed on the date, not on the engagement.** A client session is
 * scoped to exactly one engagement and cannot be widened (INV-6), so per-browser
 * is already per-engagement, and keying on the engagement's link token would put
 * that token into `localStorage` for no benefit at all. A browser with storage
 * disabled or blocked gets the dialog once per page load, which is the correct
 * direction to fail on the day the files are destroyed.
 */

import { useEffect, useState } from 'react';
import { hrefs } from '@/lib/api-client.client';
import { Button, Dialog } from '@/components/primitives';
import { formatRetentionCounts, type RetentionCounts } from '@/lib/format';
import { buttonClass, cn, muted } from '@/components/style-tokens';

function seenKey(purgeOnISO: string): string {
  return `relay.purge-notice.${purgeOnISO}`;
}

export function PurgeTodayDialog({
  counts,
  purgeOn,
  purgeOnISO,
}: {
  counts: RetentionCounts;
  /** `12 May 2026`. */
  purgeOn: string;
  /** `2026-05-12` — the seen-ness key, and nothing more. */
  purgeOnISO: string;
}) {
  const [open, setOpen] = useState(false);

  // Opened after mount rather than during render: `localStorage` does not exist
  // on the server, and a dialog that differs between the server's HTML and the
  // first client render is a hydration mismatch on the most consequential
  // screen in the product.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(seenKey(purgeOnISO)) === null) setOpen(true);
    } catch {
      // Storage blocked (private mode, third-party restrictions). Show it —
      // once per load is the right way to be wrong today.
      setOpen(true);
    }
  }, [purgeOnISO]);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(seenKey(purgeOnISO), '1');
    } catch {
      // Nothing to do. The dialog is dismissible either way.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      dismissible
      title={`Everything here is deleted today, ${purgeOn}.`}
      description={`${formatRetentionCounts(
        counts,
      )}. Exporting takes one tap and gives you a zip of every file and decision you can see.`}
      footer={
        <>
          <Button tone="quiet" size="lg" onClick={dismiss}>
            Not now
          </Button>
          {/*
            An anchor, not a button: the export is a direct link to a streamed
            archive and the bytes never pass through the app (INV-10). It is
            never paywalled.
          */}
          <a className={buttonClass('client', 'lg')} href={hrefs.clientExport()} onClick={dismiss}>
            Export everything
          </a>
        </>
      }
    >
      <p className={cn('max-w-prose text-14', muted)}>
        Closing this changes nothing — the countdown and the export are still on the page behind it.
      </p>
    </Dialog>
  );
}
