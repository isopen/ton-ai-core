/** @type {import('ts-jest').JestConfigWithTsJest} */

const path = require('path');
const stubPath = path.resolve(__dirname, 'plugins/mtproto/tests/__mocks__');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/plugins/mtproto/tests', '<rootDir>/packages/core/src/crypton/tests'],
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
  },
};
