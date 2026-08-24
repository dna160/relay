import Link from 'next/link';
import { buttonSecondary, cn, display, muted } from '@/components/style-tokens';

/**
 * The agency 404. `NOT_VISIBLE` is a 404 rather than a 403 throughout the
 * product, so this page is reached by "does not exist" and by "not yours"
 * alike, and it says only the first — which is the point.
 */
export default function AgencyNotFound() {
  return (
    <div className="flex max-w-prose flex-col gap-3">
      <h1 className={cn(display, 'text-28 text-ink')}>Not found</h1>
      <p className={cn('text-14', muted)}>
        This page does not exist, or it belongs to an engagement you do not have.
      </p>
      <div>
        <Link href="/portfolio" className={buttonSecondary}>
          Back to the portfolio
        </Link>
      </div>
    </div>
  );
}
