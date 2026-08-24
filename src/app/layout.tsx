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
      <head>
        {/*
          The three variable faces are declared with `@font-face` in
          globals.css and each `src` lists a same-origin file first and the
          Google CDN second (DESIGN-SYSTEM Appendix D). Until the six files are
          dropped into `public/fonts/`, the CDN is on the critical path, and a
          handshake to a cold third-party origin is three round trips —
          DNS, TCP, TLS — that otherwise happen *after* the CSS has been parsed
          and the face is already wanted. Preconnect overlaps them with the HTML
          parse instead. On 4G that is most of a 1.5s first-paint budget.

          Both origins, because they are separate hosts: the stylesheet host and
          the file host. `crossOrigin` is required on the font host — font
          fetches are CORS requests, and a preconnect opened without it warms a
          connection the real request cannot reuse. Deleting these two lines is
          the correct move the day the faces are self-hosted, and nothing else
          changes when that happens.
        */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </head>
      {/*
        `data-relay-root` is the element the white-label lock's second mechanism
        anchors to (DESIGN-SYSTEM Appendix B). A tenant sets exactly one
        property, `--brand-agency`, as an inline style here; every protected
        token is declared `!important` on both `:root` **and**
        `[data-relay-root]`, and an `!important` author declaration beats a
        normal inline declaration *on the same element*. Without this attribute
        that second declaration block matches nothing, and an injected
        `style="--breach:#0f0"` on the body would win — the lock would be down
        to one mechanism and a convention. The attribute is the anchor, so it
        belongs in the one layout both surfaces hang off, not in either of them.
      */}
      <body data-relay-root>{children}</body>
    </html>
  );
}
