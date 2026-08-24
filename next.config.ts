import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  // INV-10: file bytes never traverse the app server. Keep body limits small so
  // an accidental multipart route fails loudly instead of quietly proxying 5 GB.
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
};

export default config;
