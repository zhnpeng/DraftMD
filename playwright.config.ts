import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  retries: 1,
  trace: 'retain-on-first-failure',
  timeout: 30_000,
  globalSetup: './tests/helpers/global-setup.ts',
})
