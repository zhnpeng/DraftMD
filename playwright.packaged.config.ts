import { defineConfig } from '@playwright/test'

if (!process.env.DRAFTMD_PACKAGED_APP) {
  throw new Error('Set DRAFTMD_PACKAGED_APP to the built DraftMD.app bundle before running packaged acceptance')
}

export default defineConfig({
  testDir: './tests',
  testMatch: [
    '**/e2e/foundation.spec.ts',
    '**/e2e/agent-input.spec.ts',
    '**/e2e/agent-dock-layout.spec.ts',
    '**/e2e/export-layout.spec.ts',
    '**/e2e/diff-undo.spec.ts',
    '**/e2e/task-lifecycle.spec.ts',
    '**/e2e/snapshot-retention.spec.ts',
    '**/e2e/provider-revalidation.spec.ts',
    '**/e2e/provider-settings.spec.ts',
    '**/packaged/*.spec.ts',
  ],
  outputDir: './test-results/packaged',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
})
