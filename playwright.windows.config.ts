import { defineConfig } from '@playwright/test'

if (!process.env.DRAFTMD_PACKAGED_APP) throw new Error('Set DRAFTMD_PACKAGED_APP to the unpacked DraftMD.exe')

export default defineConfig({
  testDir: './tests',
  testMatch: [
    '**/e2e/foundation.spec.ts', '**/e2e/workspace.spec.ts', '**/e2e/desktop-platform.spec.ts',
    '**/e2e/provider-settings.spec.ts', '**/e2e/provider-revalidation.spec.ts',
    '**/e2e/selection-agent.spec.ts', '**/e2e/agent-input.spec.ts',
    '**/packaged/runtime.spec.ts',
  ],
  workers: 1,
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results/windows',
})
