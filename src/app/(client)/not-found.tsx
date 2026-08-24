import { cn, display, muted } from '@/components/style-tokens';

/**
 * The client 404.
 *
 * No link back and no suggestion of what else exists: a client session names
 * one engagement, and a "try one of these instead" would be inventing a
 * navigation over things they may not be able to see. A 404 that stays quiet is
 * the same 404 a private lane returns, which is what INV-1 depends on.
 */
export default function ClientNotFound() {
  return (
    <div className="flex max-w-prose flex-col gap-3">
      <h1 className={cn(display, 'text-28 text-ink')}>Not found</h1>
      <p className={cn('text-14', muted)}>
        This page does not exist, or the link has expired. If you were sent a link recently, open it
        again and we will send a fresh code.
      </p>
    </div>
  );
}
