const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const dotenv = require('dotenv');

const env = dotenv.config({ path: path.resolve(__dirname, '.env.local') }).parsed || {};

const envKeys = Object.keys(env).reduce((acc, key) => {
  acc[`process.env.${key}`] = JSON.stringify(env[key]);
  return acc;
}, {});

module.exports = {
  mode: 'production',
  entry: {
    main: './src/main.ts',
    'shared-worker': './src/worker/shared-worker.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'static/[name].[contenthash:8].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js', '.mjs'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    fallback: {
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
      events: require.resolve('events/'),
      crypto: false,
      'utf-8-validate': false,
      bufferutil: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true },
        },
        exclude: /node_modules/,
      },
      {
        test: /@ton\/crypto-primitives\/dist\/browser\/.*\.js$/,
        loader: path.resolve(__dirname, 'src/loader/replace-window.js'),
      },
    ],
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
    new webpack.DefinePlugin({
      ...envKeys,
      'process.env.TELEGRAM_API_ID': JSON.stringify(env.TELEGRAM_API_ID),
      'process.env.TELEGRAM_API_HASH': JSON.stringify(env.TELEGRAM_API_HASH),
    }),
    new webpack.NormalModuleReplacementPlugin(
      /^@ton-ai\/core$/,
      path.resolve(__dirname, 'src/polyfill/core-stub.ts'),
    ),
    new HtmlWebpackPlugin({
      template: './src/index.html',
      filename: 'index.html',
      chunks: ['main'],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'public'),
          to: path.resolve(__dirname, 'dist'),
          globOptions: { ignore: ['**/fonts/**'] },
        },
        {
          from: path.resolve(__dirname, 'public/fonts'),
          to: path.resolve(__dirname, 'dist/fonts'),
        },
      ],
    }),
  ],
  target: 'web',
};
