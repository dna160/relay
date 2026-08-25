/**
 * THE CERTIFICATE OF DESTRUCTION, and the last thing a client ever sees of the
 * workspace.
 *
 * Every client read answers 410 `ENGAGEMENT_PURGED` once the engagement is
 * gone, and this replaces the whole page.
 *
 * ## Why this is a genre and not a style (LABEL-SYSTEM.md §3c)
 *
 * **It is doing reputational work.** A client who follows their link one more
 * time and lands on a 404, or on an error page, concludes their agency lost
 * their files. A client who lands on a certificate concludes their agency runs
 * a process. So this is not an error screen with better typography — it is a
 * certificate of destruction, which is a real document type, and Relay produces
 * a real one: the bytes are gone, and this is the proof.
 *
 * Down the page, in order: the registration mark and the issuing plate, the
 * display title, the hazard boundary, the dieline'd record plate, the barcode
 * of the manifest digest, the attestation.
 *
 * **There is no retry control**, because there is nothing to retry, and no
 * "contact support" link, because the person to contact is the agency and they
 * are named on the page.
 *
 * ## The issuer is Relay and nobody else
 *
 * No CE, FCC, UL, WEEE or ISO mark appears here — LABEL-SYSTEM.md §6's firmest
 * rejection. Those are regulatory marks owned by real bodies with real legal
 * meaning, and printing one on a document forwarded to a legal team is a false
 * compliance claim. The *treatment* — a bounded plate bearing an issuing
 * authority and a code — is adopted; the marks are not. `RELAY · SYS` is a
 * claim this product can actually make.
 *
 * ## Nothing on this page animates, in either motion mode
 *
 * An entry in the motion restraint list (MOTION.md §5), and one of the two that
 * prove the list is real. **A record does not perform.** A certificate that
 * faded in would be a certificate a reader would be right to distrust. There is
 * no `animate-*` class anywhere in this file and there must never be one.
 *
 * ## Nothing on this page is invented
 *
 * Each line renders only if the 410 carried it. A count this page guessed at
 * would be a fabricated compliance statement handed to the party least able to
 * check it.
 */

import type { ApiFailure } from '@/lib/api-client.core';
import { purgeCertificateFrom } from '@/lib/api-client.core';
import { formatBytes, formatCertificateStamp, shortHash } from '@/lib/format';
import {
  Barcode,
  Plate,
  RegistrationMark,
  Rule,
  type PlateRow,
} from '@/components/primitives';
import { buttonClass, cn, muted } from '@/components/style-tokens';

/** The digest prefix the bars encode, and the line printed beneath them. */
const BARCODE_CHARS = 8;

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
  const digest = cert?.manifestSha256 ?? null;
  const agency = agencyName ?? 'your agency';

  const issuing: PlateRow[] = [{ term: 'Issuer', value: 'RELAY · SYS' }];
  if (stamp) issuing.push({ term: 'Issued', value: stamp, title: cert?.purgedAt });

  /**
   * Only what the certificate signed. `purge_certificates` carries an object
   * count and a byte total today and no card or approval count; the plate
   * shortens rather than being padded out from somewhere unsigned.
   */
  const record: PlateRow[] = [];
  if (cert?.objectCount !== undefined) {
    record.push({ term: 'Files', value: String(cert.objectCount) });
  }
  if (cert?.cardCount !== undefined) {
    record.push({ term: 'Cards', value: String(cert.cardCount) });
  }
  if (cert?.approvalCount !== undefined) {
    record.push({ term: 'Approvals', value: String(cert.approvalCount) });
  }
  if (cert?.totalBytes !== undefined) {
    record.push({ term: 'Bytes', value: formatBytes(cert.totalBytes) });
  }
  if (stamp) record.push({ term: 'Purged', value: stamp, title: cert?.purgedAt });
  if (digest) record.push({ term: 'Digest', value: shortHash(digest), title: digest });
  if (cert?.certificateId) {
    record.push({
      term: 'Certificate',
      value: shortHash(cert.certificateId),
      title: cert.certificateId,
    });
  }

  return (
    <section
      role="status"
      aria-label="Certificate of destruction"
      className="mx-auto flex max-w-prose flex-col gap-3 border-y-hairline border-rule-strong bg-paper px-4 py-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <RegistrationMark />
        <Plate layout="strip" label="Issued by" rows={issuing} />
      </div>

      <h1 className="font-display uppercase text-28 tracking-lane text-ink">
        Certificate of destruction
      </h1>

      {/*
        The purge boundary. Achromatic diagonals, `aria-hidden`, and never the
        only channel — the title above and the attestation below both say in
        words what the far side of this line is.
      */}
      <Rule weight="hazard" />

      {record.length > 0 && (
        <Plate layout="stack" dieline label="What was destroyed" rows={record} />
      )}

      {digest && (
        <div className="flex flex-col gap-1">
          <p className={cn('text-eyebrow font-display uppercase', muted)}>Manifest digest</p>
          {/*
            Encodes exactly the value printed beneath it. The bars are
            `aria-hidden`; the `Mono` line under them is the accessible content,
            and the full digest is on the plate above behind the `Digest` row's
            title.
          */}
          <Barcode
            value={digest.slice(0, BARCODE_CHARS)}
            label="Manifest digest, first eight characters"
            height={28}
          />
        </div>
      )}

      <p className={cn('max-w-prose text-14', muted)}>
        This workspace reached the end of the retention period it carried from the day it opened.
        Every file, note and approval in it has been permanently destroyed, on the date shown in the
        notices you were sent.
      </p>
      <p className={cn('max-w-prose text-14', muted)}>
        This certificate lists what was destroyed, its file hashes and the exact time. It was issued
        to you and to {agency}, it is the proof of deletion, and it does not expire. If you need the
        files themselves, {agency} is the only party who may still hold a copy.
      </p>

      {cert?.certificateUrl && (
        <div>
          <a className={buttonClass('client', 'lg')} href={cert.certificateUrl}>
            Download certificate
          </a>
        </div>
      )}
    </section>
  );
}
