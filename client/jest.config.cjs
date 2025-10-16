/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'jsdom',
  moduleDirectories: ['node_modules'],

  // Transform JS/TS/JSX/TSX via Babel
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },

  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json'],

  // Runs BEFORE env (polyfills/globals)
  setupFiles: [
    '<rootDir>/src/tests/setup-webcrypto.js',
    '<rootDir>/jest.polyfills.cjs',
    '<rootDir>/src/tests/setup-webrtc.js',
  ],

  // Runs AFTER env (RTL/matchers/mocks)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],

  // 🔑 Correct alias mapping (NO leading/trailing slashes)
  moduleNameMapper: {
    // styles & assets
    '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|svg|webp|mp3|mp4)$': '<rootDir>/__tests__/__mocks__/fileMock.js',

    // aliases
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^@src/config$': '<rootDir>/__tests__/__mocks__/config.js',

    // force a single React copy (from repo root)
    '^react$': '<rootDir>/../node_modules/react',
    '^react-dom$': '<rootDir>/../node_modules/react-dom',
  },

  // Transpile selected ESM deps
  transformIgnorePatterns: [
    '/node_modules/(?!(@mantine|@tabler/icons-react|@floating-ui|use-sync-external-store)/)',
  ],

  testMatch: [
    '<rootDir>/__tests__/**/*.test.js',
    '<rootDir>/__tests__/**/*.test.jsx',
    '<rootDir>/src/**/*.test.js',
    '<rootDir>/src/**/*.test.jsx',
    '<rootDir>/**/*.spec.js',
    '<rootDir>/**/*.spec.jsx',
  ],

  roots: ['<rootDir>'],
};
