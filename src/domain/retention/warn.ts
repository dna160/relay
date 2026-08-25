/**
 * The four retention warnings, composed.
 *
 * PHASE-6: four notices — at archive, +14d, +23d, +29d — to **both** sides,
 * each carrying the days-to-purge count and the client's free one-click export
 * link.
 *
 * ## Why both sides, every time
 *
 * The agency's contract with its client almost certainly obliges it to retain
 * deliverables for some period. If Relay destroys a workspace and only the
 * agency was told, the agency has silently breached that contract on Relay's
 * behalf. If only the client was told, the agency finds out from its own client
 * that its files are gone. Neither is survivable, and "we emailed the account
 * owner" is not a defence. So the audience is both, on all four notices, and the
 * export link goes to both — the agency needs to know the client can still get
 * their files, because that is the sentence it will be repeating on the phone.
 *
 * Pure: composes text, and does not send. The worker does the sending, which is
 * what keeps this testable without a mail provider (INV-9).
 */

export type WarningAudienceSide = 'agency' | 'client';

export interface WarningContext {
  readonly engagementTitle: string;
  readonly clientOrgName: string;
  readonly agencyName: string;
  readonly daysToPurge: number;
  readonly purgeAt: Date;
  /** The client's free, never-paywalled export. Absolute, because it is emailed. */
  readonly exportUrl: string;
  /** Where the agency picks the engagement back up. */
  readonly workspaceUrl: string;
}

export interface ComposedWarning {
  readonly subject: string;
  readonly text: string;
}

function purgeDateLine(purgeAt: Date): string {
  return purgeAt.toISOString().slice(0, 10);
}

/**
 * The count is in the subject line, not just the body.
 *
 * A notice whose urgency is only legible after opening it is a notice that gets
 * opened on day 30. The number and the workspace name are what a person scans.
 */
export function warningSubject(side: WarningAudienceSide, ctx: WarningContext): string {
  const days = String(ctx.daysToPurge);
  if (side === 'client') {
    return `${ctx.agencyName}: "${ctx.engagementTitle}" and its files will be deleted in ${days} days`;
  }
  return `"${ctx.engagementTitle}" (${ctx.clientOrgName}) will be permanently deleted in ${days} days`;
}

export function composeWarning(side: WarningAudienceSide, ctx: WarningContext): ComposedWarning {
  const days = String(ctx.daysToPurge);
  const on = purgeDateLine(ctx.purgeAt);

  const body =
    side === 'client'
      ? [
          `${ctx.agencyName} has wrapped up "${ctx.engagementTitle}".`,
          '',
          `This workspace and every file in it will be permanently deleted in ${days} days, on ${on}.`,
          'Deletion is irreversible and the files cannot be recovered afterwards.',
          '',
          'Download everything you can see, free, in one click:',
          ctx.exportUrl,
          '',
          'There is no charge for this and no account to create. If you need the files',
          'after the date above, take a copy now.',
        ]
      : [
          `"${ctx.engagementTitle}" for ${ctx.clientOrgName} is on the retention countdown.`,
          '',
          `Its content — every version, approval, note and reference file — will be`,
          `permanently deleted in ${days} days, on ${on}. You will receive a signed`,
          'certificate of deletion, and the content itself will not be recoverable.',
          '',
          `${ctx.clientOrgName} has been sent the same notice and their own free export link,`,
          'so they can take a copy of everything they can see:',
          ctx.exportUrl,
          '',
          'To keep this workspace, reopen it or move to a retaining plan:',
          ctx.workspaceUrl,
        ];

  return { subject: warningSubject(side, ctx), text: body.join('\n') };
}

/**
 * Both notices for one due warning. Returned as a pair rather than sent one at
 * a time so that a caller cannot accidentally compose only half of it — the
 * shape is the reminder.
 */
export function composeBothWarnings(ctx: WarningContext): Record<WarningAudienceSide, ComposedWarning> {
  return { agency: composeWarning('agency', ctx), client: composeWarning('client', ctx) };
}

/* --------------------------------------------------------- the certificate */

export interface CertificateNoticeContext {
  readonly engagementTitle: string;
  readonly clientOrgName: string;
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly manifestSha256: string;
  readonly purgedAt: Date;
  readonly statement: string;
  readonly signature: string;
}

/**
 * The certificate as an email. This is the document the agency forwards, so it
 * is plain text with no link to click and nothing that needs Relay to still
 * exist in order to be read.
 */
export function composeCertificateNotice(ctx: CertificateNoticeContext): ComposedWarning {
  return {
    subject: `Certificate of deletion — "${ctx.engagementTitle}" (${ctx.clientOrgName})`,
    text: [
      'RELAY — CERTIFICATE OF DELETION',
      '',
      `Engagement:      ${ctx.engagementTitle}`,
      `Client:          ${ctx.clientOrgName}`,
      `Deleted at:      ${ctx.purgedAt.toISOString()}`,
      `Objects deleted: ${String(ctx.objectCount)}`,
      `Bytes deleted:   ${String(ctx.totalBytes)}`,
      `Manifest sha256: ${ctx.manifestSha256}`,
      `Signature:       ${ctx.signature}`,
      '',
      ctx.statement,
    ].join('\n'),
  };
}
