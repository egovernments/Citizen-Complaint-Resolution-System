/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['./utils/setup.ts'],
  testTimeout: 30000,
  verbose: true,
  // Run tests sequentially to avoid race conditions
  maxWorkers: 1,
  // Global variables available in tests
  globals: {
    BASE_URL: process.env.BASE_URL || 'http://0.0.0.0',
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: process.env.DB_PORT || '15432',
    DB_NAME: process.env.DB_NAME || 'egov',
    DB_USER: process.env.DB_USER || 'egov',
    DB_PASSWORD: process.env.DB_PASSWORD || 'egov',
  },
};
