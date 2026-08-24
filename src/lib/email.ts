/**
 * Transactional email via Resend.
 *
 * ARCHITECTURE, non-functional requirements: every email that references an
 * engagement includes the days-to-purge count. That is not decoration — a
 * silent purge manufactures a contract breach for the agency, so the countdown
 * travels with every notice either side receives.
 *
 * In development with no `RESEND_API_KEY`, messages are logged rather than
 * sent, so the magic-link flow is exercisable without a mail provider.
 */

import { Resend } from 'resend';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

let resend: Resend | undefined;

function from(): string {
  return process.env.EMAIL_FROM ?? 'Relay <no-reply@example.com>';
}

export async function sendMail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info('[email:dev] %s -> %s\n%s', mail.subject, mail.to, mail.text);
    return;
  }
  resend ??= new Resend(key);
  await resend.emails.send({
    from: from(),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}

function purgeLine(daysToPurge: number | null): string {
  if (daysToPurge === null) return 'This workspace is on a retaining plan and will not expire.';
  return `This workspace and its files will be permanently deleted in ${String(daysToPurge)} days.`;
}

export async function sendClientInvite(input: {
  to: string;
  engagementTitle: string;
  agencyName: string;
  linkUrl: string;
  daysToPurge: number | null;
}): Promise<void> {
  await sendMail({
    to: input.to,
    subject: `${input.agencyName} shared "${input.engagementTitle}" with you`,
    text: [
      `${input.agencyName} has set up a workspace for ${input.engagementTitle}.`,
      '',
      `Open it here: ${input.linkUrl}`,
      '',
      'You will be asked to confirm your email address. There is no account and no password.',
      '',
      purgeLine(input.daysToPurge),
    ].join('\n'),
  });
}

export async function sendClientCode(input: {
  to: string;
  engagementTitle: string;
  code: string;
  expiresInMinutes: number;
}): Promise<void> {
  await sendMail({
    to: input.to,
    subject: `Your code for ${input.engagementTitle}: ${input.code}`,
    text: [
      `Your sign-in code is ${input.code}.`,
      `It expires in ${String(input.expiresInMinutes)} minutes and can be used once.`,
      '',
      'If you did not ask for this, you can ignore this message.',
    ].join('\n'),
  });
}
