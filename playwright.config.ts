import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173' },
  // If you can start FE/BE in one command, add a webServer block here.
});
