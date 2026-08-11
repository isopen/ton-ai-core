/** @type {import('ts-jest').JestConfigWithTsJest} */

const path = require('path');
const stubPath = path.resolve(__dirname, 'plugins/mtproto/tests/__mocks__');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: [
    '<rootDir>/plugins/mtproto/tests',
    '<rootDir>/packages/core/src/crypton/tests',
    '<rootDir>/plugins/tl-language/tests',
    '<rootDir>/plugins/agent-transport/tests',
    '<rootDir>/plugins/telegram/tests',
    '<rootDir>/plugins/gram-db/tests',
    '<rootDir>/plugins/atom/tests',
    '<rootDir>/plugins/tgs/tests',
    '<rootDir>/plugins/comment-stripper/tests'
  ],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '_test_intercept'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      diagnostics: false,
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
      },
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@ton-ai)/)',
  ],
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
    '^@ton-ai/comment-stripper$': '<rootDir>/plugins/comment-stripper/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
