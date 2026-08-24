import { redirect } from 'next/navigation';

/**
 * The root path belongs to the agency: a client never arrives here, they arrive
 * at `/e/{token}`. Sending it straight to the portfolio keeps one home screen
 * rather than a marketing page nobody in the product ever wants.
 */
export default function Home() {
  redirect('/portfolio');
}
