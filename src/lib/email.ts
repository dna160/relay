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
  engagementId: string;
  engagementTitle: string;
  code: string;
  expiresInMinutes: number;
}): Promise<void> {
  captureClientCode(input.engagementId, input.to, input.code);
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

export async function sendSigninCode(input: {
  to: string;
  code: string;
  expiresInMinutes: number;
  /** The secondary affordance. A page with a confirm button, never a consumer. */
  linkUrl: string;
}): Promise<void> {
  captureAccountCode(input.to, input.code);
  await sendMail({
    to: input.to,
    subject: `Your Relay sign-in code: ${input.code}`,
    text: [
      `Your sign-in code is ${input.code}.`,
      `It expires in ${String(input.expiresInMinutes)} minutes and can be used once.`,
      '',
      `Or open this page and press the button: ${input.linkUrl}`,
      '',
      'If you did not ask for this, you can ignore this message. Nothing has changed.',
    ].join('\n'),
  });
}

/**
 * The organization invitation.
 *
 * It says, in the body, that the link does not sign anybody in — because that is
 * the surprising part of the flow (ADR-021 §5) and a person who forwards it to a
 * colleague should know before they do that the colleague cannot use it.
 */
export async function sendOrgInvite(input: {
  to: string;
  orgName: string;
  invitedBy: string;
  role: string;
  linkUrl: string;
  expiresInDays: number;
}): Promise<void> {
  await sendMail({
    to: input.to,
    subject: `${input.invitedBy} invited you to ${input.orgName} on Relay`,
    text: [
      `${input.invitedBy} has invited you to join ${input.orgName} on Relay as ${input.role}.`,
      '',
      `Accept it here: ${input.linkUrl}`,
      '',
      'Opening that link does not sign you in. You will be asked to confirm this',
      `email address — ${input.to} — before anything is added to your account, and`,
      'the invitation can only be accepted by that address.',
      '',
      `It expires in ${String(input.expiresInDays)} days.`,
    ].join('\n'),
  });
}

/* ------------------------------------------------------- the e2e mail capture */

/**
 * The e2e suite cannot read a magic link out of a real inbox, so the last code
 * issued for a contact is held in memory for `GET /api/test/last-code` to read
 * back. `tests/e2e/_helpers.ts` calls that endpoint; without it 22 e2e tests
 * fail at their first `beforeEach`.
 *
 * Gated on the same two conditions as the test routes themselves — never in
 * production, and only when `E2E_SEED_TOKEN` is set. The check is repeated here
 * rather than imported from `src/app/api/test/_gate.ts` because `src/lib`
 * importing out of `src/app` is the wrong direction and would make this module
 * unloadable outside Next.
 *
 * A capture, not a log: the code is the credential, and outside a test run
 * nothing is retained at all. In a test run it lives in one process's memory,
 * keyed by engagement and address, and is overwritten by the next request.
 */

interface CapturedCode {
  code: string;
  issuedAt: number;
}

declare global {
  var __relayCodeCapture: Map<string, CapturedCode> | undefined;
}

function captureEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const token = process.env.E2E_SEED_TOKEN;
  return typeof token === 'string' && token.length > 0;
}

function captureKey(engagementId: string, email: string): string {
  return `${engagementId}:${email.toLowerCase()}`;
}

function captureClientCode(engagementId: string, email: string, code: string): void {
  if (!captureEnabled()) return;
  globalThis.__relayCodeCapture ??= new Map<string, CapturedCode>();
  globalThis.__relayCodeCapture.set(captureKey(engagementId, email), {
    code,
    issuedAt: Date.now(),
  });
}

/** The most recent code issued for this address on this engagement, if any. */
export function lastClientCode(engagementId: string, email: string): string | null {
  if (!captureEnabled()) return null;
  return globalThis.__relayCodeCapture?.get(captureKey(engagementId, email))?.code ?? null;
}

/**
 * The same capture for the account sign-in code (Phase 10).
 *
 * Keyed under the literal `account` where an engagement id would go, which is
 * not a UUID and therefore cannot collide with a client capture. Gated on the
 * identical two conditions — never in production, and only with
 * `E2E_SEED_TOKEN` set.
 */
const ACCOUNT_SCOPE = 'account';

function captureAccountCode(email: string, code: string): void {
  if (!captureEnabled()) return;
  globalThis.__relayCodeCapture ??= new Map<string, CapturedCode>();
  globalThis.__relayCodeCapture.set(captureKey(ACCOUNT_SCOPE, email), { code, issuedAt: Date.now() });
}

/** The most recent sign-in code issued for this address, if any. */
export function lastAccountCode(email: string): string | null {
  if (!captureEnabled()) return null;
  return globalThis.__relayCodeCapture?.get(captureKey(ACCOUNT_SCOPE, email))?.code ?? null;
}
