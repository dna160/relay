/**
 * The last thing a client ever sees of the workspace.
 *
 * Every client read answers 410 `ENGAGEMENT_PURGED` once the engagement is gone,
 * and this replaces the whole page. FLOWS.md §3 "After the purge" specifies it
 * exactly: one mono block, centred at `max-w-prose`, on `bg-paper`, with
 * `--rule-strong` hairlines above and below.
 *
 * ```
 * PURGED · 12 May 2026 14:02 UTC
 * 41 files · 12 cards · 3 approvals
 * CERTIFICATE 9f2c11…
 * ```
 *
 * **It is doing reputational work.** A client who follows their link one more
 * time and lands on a 404, or on an error page, concludes their agency lost
 * their files. A client who lands on a receipt concludes their agency runs a
 * process — and this page is the last impression the agency makes. So it is set
 * as a record rather than as a failure, and the surface's `ErrorPanel` is
 * deliberately not reused: a 410 here is not a malfunction, it is the product
 * doing precisely what it said it would on the day it said it would.
 *
 * **There is no retry control**, because there is nothing to retry, and no
 * "contact support" link, because the person to contact is the agency and they
 * are named on the page.
 *
 * **Nothing here is invented.** Each line renders only if the 410 carried it. A
 * count this page guessed at would be a fabricated compliance statement handed
 * to the party least able to check it.
 */

import type { ApiFailure } from '@/lib/api-client.core';
import { purgeCertificateFrom } from '@/lib/api-client.core';
import { formatCertificateStamp, formatDestroyedCounts, shortHash } from '@/lib/format';
import { buttonClass, cn, mono, muted } from '@/components/style-tokens';

export function PurgedReceipt({
  failure,
  agencyName,
}: {
  failure: ApiFailure;
  /** Absent before a session exists — the header it comes from is gone too. */
  agencyName?: string;
}) {
  const cert = purgeCertificateFrom(failure.details);
  const stamp = cert?.purgedAt ? formatCertificateStamp(cert.purgedAt) : null;
  // Only what the certificate signed. `purge_certificates` carries an object
  // count and a byte total today and no card or approval count; the line
  // shortens rather than being padded out from somewhere unsigned.
  const counts = cert
    ? formatDestroyedCounts({
        files: cert.objectCount,
        cards: cert.cardCount,
        approvals: cert.approvalCount,
      })
    : null;
  const agency = agencyName ?? 'your agency';

  return (
    <section
      role="status"
      aria-label="This workspace was deleted"
      className="mx-auto flex max-w-prose flex-col gap-2 border-y-hairline border-rule-strong bg-paper px-3 py-6"
    >
      <p className={cn(mono, 'text-14 text-ink')}>PURGED{stamp ? ` · ${stamp}` : ''}</p>

      {counts && <p className={cn(mono, 'text-14', muted)}>{counts}</p>}

      {(cert?.certificateId ?? cert?.manifestSha256) && (
        <p className={cn(mono, 'text-14 text-ink')} title={cert?.manifestSha256}>
          CERTIFICATE {shortHash(cert?.manifestSha256 ?? cert?.certificateId ?? '')}
        </p>
      )}

      <p className={cn('mt-2 max-w-prose text-14', muted)}>
        This workspace reached the end of the retention period it carried from the day it opened.
        Every file, note and approval in it has been permanently destroyed, on the date shown in the
        notices you were sent.
      </p>
      <p className={cn('max-w-prose text-14', muted)}>
        A signed certificate listing what was destroyed, its file hashes and the exact time was
        issued to you and to {agency}. It is the proof of deletion and it does not expire. If you
        need the files themselves, {agency} is the only party who may still hold a copy.
      </p>

      {cert?.certificateUrl && (
        <div className="mt-2">
          <a className={buttonClass('client', 'lg')} href={cert.certificateUrl}>
            Download certificate
          </a>
        </div>
      )}
    </section>
  );
}
