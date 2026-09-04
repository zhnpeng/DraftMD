import { expect, test } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

interface StartupTrace {
  platform: string
  electron: string
  'main-loaded': number
  'renderer-ready': number
}

async function measureStartup(): Promise<{ trace: StartupTrace; loadedProviderModules: string[] }> {
  const app = await launchDraftMD({ env: { DRAFTMD_STARTUP_TRACE: '1' } })
  try {
    await app.windowMatching(async (page) => await page.title().catch(() => '') === 'DraftMD')
    await expect.poll(async () => readFile(join(app.userDataPath, 'startup-trace.jsonl'), 'utf8').then(Boolean).catch(() => false)).toBe(true)
    const traceLines = (await readFile(join(app.userDataPath, 'startup-trace.jsonl'), 'utf8')).trim().split('\n')
    const trace = JSON.parse(traceLines.at(-1)!) as StartupTrace
    const loadedProviderModules = await app.evaluate(() => {
      const nodeProcess = process as NodeJS.Process & { getBuiltinModule(name: string): { _cache?: Record<string, unknown> } }
      const cache = nodeProcess.getBuiltinModule('module')._cache ?? {}
      return Object.keys(cache).filter((path) =>
        /node_modules\/(?:@anthropic-ai\/sdk|openai)\//.test(path)
        || /dist\/main\/chunks\/(?:anthropic|openai(?:-compatible)?)-adapter\.js$/.test(path))
    })
    return { trace, loadedProviderModules }
  } finally { await app.cleanup() }
}

test('keeps provider SDK code in dynamic chunks and unloaded during cold editor startup', async () => {
  const mainEntry = await readFile('dist/main/index.js', 'utf8')
  const chunks = (await readdir('dist/main/chunks')).filter((name) => /^(?:anthropic|openai(?:-compatible)?)-adapter\.js$/.test(name)).sort()
  expect(chunks).toEqual(['anthropic-adapter.js', 'openai-adapter.js', 'openai-compatible-adapter.js'])
  for (const chunk of chunks) expect(mainEntry).toContain(`require("./chunks/${chunk}")`)
  expect(mainEntry).not.toContain('node_modules/@anthropic-ai/sdk')
  expect(mainEntry).not.toContain('node_modules/openai/')
  const warmup = await measureStartup()
  const measured = []
  for (let index = 0; index < 3; index += 1) measured.push(await measureStartup())
  const rendererReadyMs = measured.map(({ trace }) => trace['renderer-ready'])
  const sorted = [...rendererReadyMs].sort((a, b) => a - b)
  const medianMs = sorted[1]
  const foundationBaselineMs = Number(process.env.DRAFTMD_FOUNDATION_STARTUP_BASELINE_MS ?? 450)
  if (!Number.isFinite(foundationBaselineMs) || foundationBaselineMs <= 0) throw new Error('Invalid Foundation startup baseline')
  const maximumRegression = 0.15
  const result = {
    warmupMs: warmup.trace['renderer-ready'], rendererReadyMs, medianMs,
    foundationBaselineMs, maximumRegression,
    budgetMs: foundationBaselineMs * (1 + maximumRegression),
    loadedProviderModules: measured.flatMap((item) => item.loadedProviderModules),
  }
  console.log(`startup metrics: ${JSON.stringify(result)}`)
  await import('node:fs/promises').then(({ mkdir, writeFile }) => mkdir('artifacts/performance', { recursive: true }).then(() => writeFile('artifacts/performance/startup.json', JSON.stringify(result, null, 2))))
  expect(result.loadedProviderModules).toEqual([])
  expect(medianMs).toBeLessThanOrEqual(result.budgetMs)
})
