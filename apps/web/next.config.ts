import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Pin the workspace root to the monorepo. Without this, a stray lockfile
  // elsewhere on the machine (for example one in the home directory) can make
  // Next infer the wrong root for output file tracing.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  transpilePackages: ['@waos/shared'],
  // The shared package, and this app's own component layer, use
  // NodeNext-style .js extensions in TS/TSX source, so webpack must be told
  // a `.js` specifier may resolve to a `.tsx` or `.ts` file on disk.
  webpack: (config: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.tsx', '.ts', '.js'],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
