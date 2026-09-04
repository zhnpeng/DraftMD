import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/performance',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  globalSetup: './tests/helpers/global-setup.ts',
})
