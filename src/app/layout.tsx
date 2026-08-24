/**
 * The one root layout. Both surfaces hang off it, and it deliberately contains
 * nothing but the document and the token layer — no navigation, no session
 * read, no chrome. Anything an agency needs goes in `(agency)/layout.tsx`;
 * anything the client needs goes in `(client)/layout.tsx`. A shared header here
 * would be the first agency component in the client bundle.
 */

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Relay',
  description: 'One contract, one workspace, one link. Board, files, approvals, and sign-off.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The palette inverts with the reader's system setting; both grounds declared
  // so the browser chrome does not flash the wrong one.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E8EAE5' },
    { media: '(prefers-color-scheme: dark)', color: '#14171A' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
