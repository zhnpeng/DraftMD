import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findMatchingWindow, launchDraftMD } from '../helpers/electron-app'

const exec = promisify(execFile)

test('opens and edits a 5 MiB mixed Markdown document without a one-second renderer stall', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'draftmd-large-document-'))
  await exec(process.execPath, ['scripts/generate-performance-fixtures.mjs', '--output', fixture], { cwd: process.cwd() })
  const documentPath = join(fixture, 'large.md')
  const started = performance.now()
  const app = await launchDraftMD({ documentPath })
  try {
    const page = await findMatchingWindow(() => app.windows(), async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'large.md', { deadlineMs: 60_000, attemptTimeoutMs: 2_000 })
    const onboarding = page.locator('#onboarding-dialog')
    if (await onboarding.isVisible().catch(() => false)) await onboarding.getByRole('button', { name: /Skip guide|跳过指南/ }).click()
    const readyMs = performance.now() - started
    const source = page.locator('#source-editor')
    await expect(source).toBeVisible()
    await expect(source).toHaveAttribute('wrap', 'off')
    await expect(page.locator('#reduced-rendering-banner')).toBeVisible()
    await expect(page.locator('#source-toggle-btn')).toBeDisabled()

    const supportsLongTasks = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask'))
    expect(supportsLongTasks).toBe(true)
    await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const durations: number[] = []
      const observer = new PerformanceObserver((list) => {
        durations.push(...list.getEntries().map((entry) => entry.duration))
      })
      observer.observe({ type: 'longtask' })
      Object.assign(window, { __draftmdLongTasks: { durations, observer } })
    })
    const profiler = process.env.DRAFTMD_TRACE_PERFORMANCE === '1' ? await page.context().newCDPSession(page) : null
    const traceEvents: unknown[] = []
    if (profiler) {
      profiler.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value))
      await profiler.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,accessibility', transferMode: 'ReportEvents' })
    }
    const editStarted = performance.now()
    const edited = await source.evaluate((element: HTMLTextAreaElement) => {
      const sentinel = ' DRAFTMD_LARGE_EDIT_42'
      element.setRangeText(sentinel, element.value.length, element.value.length, 'end')
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: sentinel }))
      return element.value.endsWith(sentinel)
    })
    expect(edited).toBe(true)
    const editMs = performance.now() - editStarted
    await page.waitForTimeout(150)
    const saveStarted = performance.now()
    await page.keyboard.press('ControlOrMeta+S')
    await expect.poll(async () => {
      const metadata = await stat(documentPath)
      const handle = await open(documentPath, 'r')
      try {
        const tail = Buffer.alloc(Math.min(64, metadata.size))
        await handle.read(tail, 0, tail.length, metadata.size - tail.length)
        return tail.toString('utf8')
      } finally { await handle.close() }
    }).toContain('DRAFTMD_LARGE_EDIT_42')

    const saveMs = performance.now() - saveStarted
    if (profiler) {
      const complete = new Promise<void>(resolve => profiler.once('Tracing.tracingComplete', () => resolve()))
      await profiler.send('Tracing.end')
      await complete
      await profiler.detach()
      await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
        await mkdir('artifacts/performance', { recursive: true })
        await writeFile('artifacts/performance/large-document-trace.json', JSON.stringify({ traceEvents }))
      })
    }
    const longTasks = await page.evaluate(() => {
      const state = (window as unknown as { __draftmdLongTasks: { durations: number[]; observer: PerformanceObserver } }).__draftmdLongTasks
      state.observer.disconnect()
      return state.durations
    })
    const editBudgetMs = Number(process.env.DRAFTMD_LARGE_DOCUMENT_EDIT_BUDGET_MS ?? 1_000)
    const longTaskBudgetMs = Number(process.env.DRAFTMD_LARGE_DOCUMENT_LONG_TASK_BUDGET_MS ?? 1_000)
    if (!Number.isFinite(editBudgetMs) || editBudgetMs <= 0) throw new Error('Invalid large-document edit budget')
    if (!Number.isFinite(longTaskBudgetMs) || longTaskBudgetMs <= 0) throw new Error('Invalid large-document long-task budget')
    const result = { readyMs, editMs, editBudgetMs, saveMs, longTaskMs: longTasks, maxLongTaskMs: Math.max(0, ...longTasks), longTaskBudgetMs, mermaidNodes: await page.locator('.mermaid-diagram').count(), bytes: (await stat(documentPath)).size }
    console.log(`large-document metrics: ${JSON.stringify(result)}`)
    await import('node:fs/promises').then(({ mkdir, writeFile }) => mkdir('artifacts/performance', { recursive: true }).then(() => writeFile('artifacts/performance/large-document.json', JSON.stringify(result, null, 2))))
    expect(result.editMs).toBeLessThan(result.editBudgetMs)
    expect(result.maxLongTaskMs).toBeLessThan(result.longTaskBudgetMs)
  } finally {
    await app.cleanup()
    await rm(fixture, { recursive: true, force: true })
  }
})
