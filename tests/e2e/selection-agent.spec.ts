import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startMockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD } from '../helpers/electron-app'

test('rejects a stale source selection before contacting the task provider', async () => {
  const server = await startMockProviderServer('agent-task')
  const original = '# Notes\n\nbefore target after\n'
  const external = '# Notes\n\nbefore changed after\n'
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(join(directory, 'notes.md'), original),
    documentName: 'notes.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'notes.md')
    const capability = await page.evaluate(async (baseUrl) => {
      const saved = await window.draftmd.saveProviderConfig({
        name: 'Selection Mock', kind: 'openai-compatible', preset: 'none', baseUrl,
        model: 'mock-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
      }, {})
      return window.draftmd.testProviderConfig(saved.id)
    }, server.baseUrl)
    expect(capability.capability).toBe('agent')

    await page.locator('#source-toggle-btn').click()
    const source = page.locator('#source-editor')
    await expect(source).toBeVisible()
    await source.evaluate((element: HTMLTextAreaElement) => {
      const start = element.value.indexOf('target')
      element.focus()
      element.setSelectionRange(start, start + 'target'.length)
    })
    await page.keyboard.press('ControlOrMeta+Shift+J')
    await expect(page.locator('#agent-selection-chip')).toContainText('target')

    await writeFile(join(app.userDataPath, 'notes.md'), external)
    await page.locator('#agent-input').fill('Improve the selected text')
    await page.locator('#agent-send-button').click()

    await expect(page.locator('#agent-task-status')).toHaveText(/Selection changed|选区已变化/)
    await expect(page.locator('#agent-selection-chip')).toBeHidden()
    await expect(page.locator('#agent-stop-button')).toBeHidden()
    expect(await readFile(join(app.userDataPath, 'notes.md'), 'utf8')).toBe(external)
    expect(server.requests).toHaveLength(1)
  } finally { await app.cleanup(); await server.close() }
})

test('captures exact formatted Markdown from a visual editor selection', async () => {
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(join(directory, 'formatted.md'), '# Product\n\nbefore **target** after\n'),
    documentName: 'formatted.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'formatted.md')
    const strong = page.locator('.ProseMirror strong')
    const box = await strong.boundingBox()
    if (!box) throw new Error('Formatted selection target is not visible')
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('target')
    await page.keyboard.press('ControlOrMeta+Shift+J')
    await expect(page.locator('#agent-selection-chip')).toContainText('**target**')
    await expect(page.locator('#agent-selection-chip')).toContainText('Product')
  } finally { await app.cleanup() }
})
