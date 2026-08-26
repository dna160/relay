import type { NextConfig } from 'next';

/**
 * DEFECT-17 — two `next build` runs in one working tree corrupt each other's
 * output directory. It surfaced twice during Phase 7 as `PageNotFoundError`
 * and a missing turbopack runtime chunk, with **the missing pages changing
 * between runs** — `/_not-found` among them, which has no source and therefore
 * cannot be missing for any reason in `src/`.
 *
 * Both agents who hit it read it as a transient race and retried, which worked,
 * which is the problem: it presents as unrelated failures in someone else's
 * work and the retry is indistinguishable from flake. Same family as the shared
 * test database and the reused dev server.
 *
 * `.next` stays the default so `next dev`, `next start` and CI are unchanged.
 * A concurrent run exports `NEXT_DIST_DIR` and gets its own directory.
 */
const distDir = process.env.NEXT_DIST_DIR ?? '.next';

const config: NextConfig = {
  distDir,
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  // INV-10: file bytes never traverse the app server. Keep body limits small so
  // an accidental multipart route fails loudly instead of quietly proxying 5 GB.
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
};

export default config;
