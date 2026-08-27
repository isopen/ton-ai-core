/** @type {import('ts-jest').JestConfigWithTsJest} */

const path = require('path');
const stubPath = path.resolve(__dirname, 'plugins/mtproto/tests/__mocks__');

const tsOpts = {
  diagnostics: false,
  isolatedConfig: true,
  tsconfig: {
    target: 'ES2022',
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
    strict: false,
    skipLibCheck: true,
    resolveJsonModule: true,
    noEmit: true,
    types: ['node', 'jest'],
    jsx: 'react',
    jsxFactory: 'h',
    jsxFragmentFactory: 'Fragment',
  },
};

const distJsOpts = {
  diagnostics: false,
  isolatedConfig: true,
  tsconfig: {
    target: 'ES2022',
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
    strict: false,
    skipLibCheck: true,
    allowJs: true,
    types: ['node', 'jest'],
    jsx: 'react',
    jsxFactory: 'h',
    jsxFragmentFactory: 'Fragment',
    outDir: 'dist_ts_jest',
  },
};

module.exports = {
  roots: [
    '<rootDir>/plugins/mtproto/tests',
    '<rootDir>/packages/core/src/crypton/tests',
    '<rootDir>/plugins/tl-language/tests',
    '<rootDir>/plugins/agent-transport/tests',
    '<rootDir>/plugins/telegram/tests',
    '<rootDir>/plugins/gram-db/tests',
    '<rootDir>/plugins/atom/tests',
    '<rootDir>/plugins/tgs/tests',
    '<rootDir>/plugins/comment-stripper/tests',
    '<rootDir>/plugins/gram-media/tests',
    '<rootDir>/plugins/gram-debug/tests',
    '<rootDir>/plugins/tmd/tests',
    '<rootDir>/plugins/gram-ui/tests'
  ],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '_test_intercept'],
  transform: {
    '^.+\\.tsx$': ['ts-jest', tsOpts],
    '^.+\\.ts$': ['ts-jest', tsOpts],
    'gram-ui/dist/.+\\.js$': '<rootDir>/jest.esm-transformer.cjs',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@ton-ai)/)'],
  moduleNameMapper: {
    '^@ton/walletkit$': stubPath + '/@ton/walletkit.js',
    '^@ton/mcp$': stubPath + '/@ton/mcp.js',
    '^@ton/core$': stubPath + '/@ton/core.js',
    '^@ton-ai/core$': '<rootDir>/packages/core/src/index.ts',
    '^@ton-ai/tl-language$': '<rootDir>/plugins/tl-language/src/index.ts',
    '^@ton-ai/agent-transport$': '<rootDir>/plugins/agent-transport/src/index.ts',
    '^@ton-ai/telegram$': '<rootDir>/plugins/telegram/src/index.ts',
    '^@ton-ai/mtproto$': '<rootDir>/plugins/mtproto/src/index.ts',
    '^@ton-ai/atom$': '<rootDir>/plugins/atom/src/index.ts',
    '^@ton-ai/atom/(.*)$': '<rootDir>/plugins/atom/src/$1',
    '^@ton-ai/tgs$': '<rootDir>/plugins/tgs/src/index.ts',
    '^@ton-ai/tmd$': '<rootDir>/plugins/tmd/src/index.ts',
    '^@ton-ai/tmd/(.*)$': '<rootDir>/plugins/tmd/src/$1',
    '^@ton-ai/comment-stripper$': '<rootDir>/plugins/comment-stripper/src/index.ts',
    '^@ton-ai/gram-debug$': '<rootDir>/plugins/gram-debug/src/index.ts',
    '^@ton-ai/gram-media$': '<rootDir>/plugins/gram-media/src/index.ts',
    '^@ton-ai/gram-db$': '<rootDir>/plugins/gram-db/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
