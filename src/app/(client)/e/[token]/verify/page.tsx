/**
 * The code step, reachable directly from the emailed link.
 *
 * The code arrives in the query string; the email does not, and is typed. That
 * is deliberate: an email address in a URL is personal data in a referrer
 * header and a browser history, and asking for it again also means a forwarded
 * link does not sign in the person it was forwarded to.
 */

import type { Metadata } from 'next';
import { cn, display, muted } from '@/components/style-tokens';
import { AccessForm } from '@/components/client/access-form';

export const metadata: Metadata = { title: 'Confirm it is you · Relay' };

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { token } = await params;
  const { code } = await searchParams;

  return (
    <div className="flex max-w-dialog flex-col gap-4">
      <div>
        <h1 className={cn(display, 'text-28 text-ink')}>Confirm it is you</h1>
        <p className={cn('mt-1 text-14', muted)}>
          Your email is what an approval is recorded against, so it is checked once before you go in.
        </p>
      </div>
      <AccessForm engagementToken={token} initialCode={code ?? ''} startAtCode />
    </div>
  );
}
