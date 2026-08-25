/**
 * What is left of an engagement after the purge, on the agency's side.
 *
 * `GET /api/engagements/:id` answers 410 `ENGAGEMENT_PURGED` and points at the
 * certificate; this is what the reader gets instead of a workspace. FLOWS.md §3
 * "After the purge" specifies the whole page as a single mono block, centred at
 * `max-w-prose`, on `bg-paper`, with `--rule-strong` hairlines above and below:
 *
 * ```
 * PURGED · 12 May 2026 14:02 UTC
 * 41 files · 12 cards · 3 approvals
 * CERTIFICATE 9f2c11…
 * [ Download certificate ]
 * ```
 *
 * **It is a receipt and it should look like one.** This is the artifact an
 * agency forwards to their client's legal team, which is how the paywall's
 * downside becomes a compliance feature — so it is set as a record, not as an
 * error, and the failure panel is deliberately not reused here. A 410 is not a
 * malfunction; it is the product doing exactly what it said it would.
 *
 * **Nothing on this page is invented.** Every line is rendered only when the 410
 * actually carried it. A receipt that filled in a plausible object count would
 * be a fabricated compliance record, which is the worst thing this page could
 * possibly do, so an absent count prints nothing and the standing sentence below
 * carries what is true regardless: the content was destroyed and a certificate
 * exists.
 */

import type { ApiFailure } from '@/lib/api-client.core';
import { purgeCertificateFrom } from '@/lib/api-client.core';
import {
  formatBytes,
  formatCertificateStamp,
  formatDestroyedCounts,
  shortHash,
} from '@/lib/format';
import { buttonClass, cn, mono, muted } from '@/components/style-tokens';

export function PurgedReceipt({ failure }: { failure: ApiFailure }) {
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

  return (
    <section
      role="status"
      aria-label="Deletion certificate"
      className="mx-auto flex max-w-prose flex-col gap-2 border-y-hairline border-rule-strong bg-paper px-3 py-6"
    >
      <p className={cn(mono, 'text-14 text-ink')}>
        PURGED{stamp ? ` · ${stamp}` : ''}
      </p>

      {counts && <p className={cn(mono, 'text-14', muted)}>{counts}</p>}

      {cert?.totalBytes !== undefined && (
        <p className={cn(mono, 'text-14', muted)}>{formatBytes(cert.totalBytes)} DESTROYED</p>
      )}

      {(cert?.certificateId ?? cert?.manifestSha256) && (
        <p className={cn(mono, 'text-14 text-ink')} title={cert?.manifestSha256}>
          CERTIFICATE {shortHash(cert?.manifestSha256 ?? cert?.certificateId ?? '')}
        </p>
      )}

      {/*
        Prose, deliberately, and the only prose on the page: the mono block is
        the record and this is the sentence that tells an agency member what
        they are looking at and what they can still do with it.
      */}
      <p className={cn('mt-2 max-w-prose text-14', muted)}>
        Every file, card, version and approval in this engagement was destroyed on schedule, along
        with the object bytes behind them. A signed deletion certificate listing the hashes, the
        counts and the timestamp was issued to your organisation and to the client contact. It is
        the record of destruction and it does not expire.
      </p>

      {cert?.certificateUrl && (
        <div className="mt-2">
          <a className={buttonClass('quiet', 'md')} href={cert.certificateUrl}>
            Download certificate
          </a>
        </div>
      )}
    </section>
  );
}
