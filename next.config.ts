import type { NextConfig } from 'next';

/**
 * Static export so the build output (`out/`) deploys as-is to GitHub Pages, Vercel or Netlify.
 *
 * GitHub Pages project sites live under a sub-path (https://user.github.io/<repo>/). Set
 * NEXT_PUBLIC_BASE_PATH=/<repo> at build time for that case (the included GitHub Actions
 * workflow does this automatically). Vercel/Netlify/user-pages need no base path.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'export',
  // Lets several dev servers run side by side during development (NEXT_DIST_DIR=.next-foo next dev -p 4400).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  basePath: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  productionBrowserSourceMaps: false,
};

export default nextConfig;
