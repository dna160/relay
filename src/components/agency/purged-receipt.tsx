/**
 * THE CERTIFICATE OF DESTRUCTION.
 *
 * `GET /api/engagements/:id` answers 410 `ENGAGEMENT_PURGED` and points at the
 * certificate; this is what the reader gets instead of a workspace.
 *
 * ## Why this is a genre and not a style (LABEL-SYSTEM.md §3c)
 *
 * Everywhere else in this round the spec-label vernacular is sharpening. Here
 * it is the *correct document type*. A certificate of destruction is a real
 * artifact with a real job: the bytes are gone, and this is the proof. It is
 * what an agency forwards to their client's legal team, which is how the
 * paywall's downside becomes a compliance feature. So it is set as a record —
 * issued, bounded, serialised — and the surface's `ErrorPanel` is deliberately
 * not reused. A 410 here is not a malfunction; it is the product doing exactly
 * what it said it would, on the day it said it would.
 *
 * Down the page, in order: the registration mark and the issuing plate, the
 * display title, the hazard boundary, the dieline'd record plate, the barcode
 * of the manifest digest, the attestation.
 *
 * ## The issuer is Relay and nobody else
 *
 * No CE, FCC, UL, WEEE or ISO mark appears here, and the rejection is the
 * firmest in LABEL-SYSTEM.md §6. Those are regulatory marks owned by real
 * bodies with real legal meaning, and printing one on a document that goes to a
 * client's legal team is a false compliance claim. The *treatment* — a bounded
 * plate bearing an issuing authority and a code — is exactly right and is what
 * the issuing plate is. `RELAY · SYS` is a claim this product can actually
 * make.
 *
 * ## Nothing on this page animates, in either motion mode
 *
 * An entry in the motion restraint list (MOTION.md §5), and one of the two that
 * prove the list is real. **A record does not perform.** A certificate that
 * faded in would be a certificate a reader would be right to distrust. There is
 * no `animate-*` class anywhere in this file and there must never be one — not
 * on the plate, not on the barcode, not on the title.
 *
 * ## Nothing on this page is invented
 *
 * Every row renders only when the 410 actually carried it. A receipt that
 * filled in a plausible object count would be a fabricated compliance record,
 * which is the worst thing this page could possibly do. An absent value prints
 * nothing, and the attestation below carries what is true regardless: the
 * content was destroyed and a certificate exists.
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

export function PurgedReceipt({ failure }: { failure: ApiFailure }) {
  const cert = purgeCertificateFrom(failure.details);
  const stamp = cert?.purgedAt ? formatCertificateStamp(cert.purgedAt) : null;
  const digest = cert?.manifestSha256 ?? null;

  /**
   * The issuing plate. Not the compliance mark it is modelled on — the honest
   * equivalent: who issued this, and when.
   */
  const issuing: PlateRow[] = [{ term: 'Issuer', value: 'RELAY · SYS' }];
  if (stamp) issuing.push({ term: 'Issued', value: stamp, title: cert?.purgedAt });

  /** The record itself. Only what the certificate signed. */
  const record: PlateRow[] = [];
  if (cert?.objectCount !== undefined) {
    record.push({ term: 'Objects', value: String(cert.objectCount) });
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
    record.push({ term: 'Certificate', value: shortHash(cert.certificateId), title: cert.certificateId });
  }

  return (
    <section
      role="status"
      aria-label="Certificate of destruction"
      className="mx-auto flex max-w-prose flex-col gap-3 border-y-hairline border-rule-strong bg-paper px-4 py-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Where the plates line up: this document was issued, at a moment. */}
        <RegistrationMark />
        <Plate layout="strip" label="Issued by" rows={issuing} />
      </div>

      <h1 className="font-display uppercase text-28 tracking-lane text-ink">
        Certificate of destruction
      </h1>

      {/*
        The purge boundary. Achromatic diagonals, `aria-hidden`, and never the
        only channel — the title above it and the attestation below it both say
        in words what the far side of this line is.
      */}
      <Rule weight="hazard" />

      {record.length > 0 && (
        <Plate layout="stack" dieline label="What was destroyed" rows={record} />
      )}

      {digest && (
        <div className="flex flex-col gap-1">
          <p className={cn('text-eyebrow font-display uppercase', muted)}>Manifest digest</p>
          {/*
            Encodes exactly the value printed beneath it. A barcode that encoded
            nothing would be decoration wearing a record's clothes, on the one
            document in this product whose entire value is that its numbers can
            be cited. The full digest is on the plate above, behind the `Digest`
            row's title.
          */}
          <Barcode
            value={digest.slice(0, BARCODE_CHARS)}
            label="Manifest digest, first eight characters"
            height={28}
          />
        </div>
      )}

      <p className={cn('max-w-prose text-14', muted)}>
        Every file, card, version and approval in this engagement was destroyed from live systems
        on schedule, along with the object bytes behind them, and is erased from encrypted backups
        within 30 days of that date. This certificate lists the hashes, the counts and the exact
        time, and it was issued to your organisation and to the client contact. It is the record of
        destruction, it is what remains, and it does not expire.
      </p>
      <p className={cn('max-w-prose text-14', muted)}>
        The 30-day backup window is stated because a client&rsquo;s legal team will ask, and because
        a certificate that claimed the bytes were gone everywhere the moment it was issued would be
        wrong on the day it is most likely to be read. D1/D2, resolved 2026-08-25.
      </p>

      {cert?.certificateUrl && (
        <div>
          <a className={buttonClass('quiet', 'md')} href={cert.certificateUrl}>
            Download certificate
          </a>
        </div>
      )}
    </section>
  );
}
