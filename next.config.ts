import { NextConfig } from 'next';
import type { Configuration } from 'webpack';

const nextConfig: NextConfig = {
  experimental: {
    // Turbopack options are deprecated in the Next types; avoid the unknown 'disable' property
    turbo: {} as any,
  },
  webpack(config: Configuration) {
    config.module?.rules?.push({
      test: /LICENSE$/,
      use: 'ignore-loader',
    });
    return config;
  },
};

export default nextConfig;
