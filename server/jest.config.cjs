module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.js'],

  // We run ESM directly (ensure NODE_OPTIONS=--experimental-vm-modules in scripts)
  transform: {},

  verbose: true,
  testTimeout: 20000,

  // Load env first, then per-test setup
  setupFiles: ['<rootDir>/__tests__/setupEnv.js'],

  // IMPORTANT: this still points at __tests__/jest.setup.js,
  // but that file must now be the LAZY prisma version we just wrote
  setupFilesAfterEnv: ['<rootDir>/__tests__/jest.setup.js'],

  // Ignore non-server code
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/../client/',
    '<rootDir>/dist/',
  ],

  // Coverage
  collectCoverage: true,
  collectCoverageFrom: [
    'routes/**/*.js',
    'services/**/*.js',
    'utils/**/*.js',
    'middleware/**/*.js',
    '!**/__tests__/**',
    '!**/mocks/**',
    '!index.js',  // server bootstrap
    '!app.js',    // mostly wiring; include if you want to count it
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
  },

  moduleNameMapper: {
  'middleware\\/auth\\.js$': '<rootDir>/__tests__/mocks/auth.mock.js',
  'middleware\\/plan\\.js$': '<rootDir>/__tests__/mocks/plan.mock.js',
  '^@sentry/node$': '<rootDir>/__tests__/mocks/sentry.node.mock.js',
  '^@sentry/profiling-node$': '<rootDir>/__tests__/mocks/sentry.profiling.mock.js',

  '^openai$': '<rootDir>/__tests__/mocks/openai.mock.js',
  '^stripe$': '<rootDir>/__tests__/mocks/stripe.mock.js',
  'cloudflare:s3': '<rootDir>/__tests__/mocks/r2.mock.js',

  '^redis$': '<rootDir>/__tests__/mocks/redis.mock.js',
  '^ioredis$': '<rootDir>/__tests__/mocks/ioredis.mock.js',
  '^node-cron$': '<rootDir>/__tests__/mocks/node-cron.mock.js',
  '^ws$': '<rootDir>/__tests__/mocks/ws.mock.js',

  '^@utils/(.*)$': '<rootDir>/utils/$1',

  // 🔥 THIS IS THE CRITICAL ONE
  '^@prismaClient$': '<rootDir>/utils/prismaClient.js',

  // optional, only if you want a stable alias for SMS helpers
  '^@sms$': '<rootDir>/utils/sms.js',
 },
};
