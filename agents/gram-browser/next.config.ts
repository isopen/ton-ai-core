import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'export',
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
      'utf-8-validate': false,
      bufferutil: false,
    };

    if (!isServer) {
      // Client-side only: redirect @ton-ai/core to stub (avoids undici node deps)
      config.resolve.fallback.events = path.resolve(__dirname, 'src/polyfill/events.ts');

      const { NormalModuleReplacementPlugin } = require('webpack');
      config.plugins = config.plugins || [];
      config.plugins.push(
        new NormalModuleReplacementPlugin(/^@ton-ai\/core$/, (resource: any) => {
          resource.request = path.resolve(__dirname, 'src/polyfill/core-stub.ts');
        })
      );
      // Patch @ton/crypto-primitives to use globalThis instead of window (works in SharedWorker)
      const replaceWindowLoader = path.resolve(__dirname, 'src/loader/replace-window.js');
      config.module.rules.push({
        test: /@ton\/crypto-primitives\/dist\/browser\/.*\.js$/,
        loader: replaceWindowLoader,
      });
    }

    return config;
  },
};

export default nextConfig;
