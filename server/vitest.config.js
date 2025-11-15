import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Point '@' to your client source so imports like '@/api/esim' work in tests
    alias: { '@': path.resolve(__dirname, 'client/src') },
  },
  test: {
    environment: 'node',        // default for server-side tests
    globals: true,
    include: [
      'tests/**/*.{test,spec}.js',                          // server tests
      'client/src/**/*.{test,spec}.{js,jsx,ts,tsx}',        // client tests
    ],
    setupFiles: [
      'tests/setup-env.js',                 // server/global setup
      'client/src/test/setup.ts',           // client/jsdom setup (e.g., jest-dom)
    ],
    // Use jsdom for anything under client/src/*
    environmentMatchGlobs: [
      ['client/src/**', 'jsdom'],
    ],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
