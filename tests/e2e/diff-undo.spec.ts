import { expect, test } from '@playwright/test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startMockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD } from '../helpers/electron-app'

async function runDiffTask() {
  const server = await startMockProviderServer('agent-diff-task')
  const app = await launchDraftMD({
    locale: 'en', prepare: async (directory) => {
      await writeFile(join(directory, 'a.md'), '# A\nbefore a\n')
      await writeFile(join(directory, 'b.md'), '# B\nbefore b\n')
    }, documentName: 'a.md',
  })
  const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
  const capability = await page.evaluate(async (baseUrl) => {
    const saved = await window.draftmd.saveProviderConfig({
      name: 'Diff Mock', kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'mock-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    return window.draftmd.testProviderConfig(saved.id)
  }, server.baseUrl)
  expect(capability.capability).toBe('agent')
  await page.locator('#agent-input').fill('Update both files and create a summary')
  await page.locator('#agent-send-button').click()
  await expect(page.locator('#agent-task-status')).toHaveText('Completed')
  return { app, page, server }
}

test('renders accessible per-file Diff and exactly undoes a completed task', async () => {
  const { app, page, server } = await runDiffTask()
  try {
    const changes = page.locator('.agent-diff-file')
    await expect(changes).toHaveCount(3)
    await expect(changes.filter({ hasText: 'a.md' })).toContainText('Modified')
    await expect(changes.filter({ hasText: 'b.md' })).toContainText('Modified')
    await expect(changes.filter({ hasText: 'new.md' })).toContainText('Created')
    await changes.filter({ hasText: 'a.md' }).locator('summary').click()
    await expect(changes.filter({ hasText: 'a.md' })).toContainText('−before')
    await expect(changes.filter({ hasText: 'a.md' })).toContainText('+after')
    await expect(changes.filter({ hasText: 'a.md' }).locator('.visually-hidden', { hasText: 'Removed' })).toHaveCount(1)
    await expect(changes.filter({ hasText: 'a.md' }).locator('.visually-hidden', { hasText: 'Added' })).toHaveCount(1)

    const editorText = page.locator('.ProseMirror p').filter({ hasText: 'after a' })
    await editorText.click()
    await page.keyboard.press('End')
    const undo = page.locator('.agent-undo-task')
    await undo.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Undone')
    await expect(page.locator('.ProseMirror')).toContainText('before a')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(false)
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# A\nbefore a\n')
    expect(await readFile(join(app.userDataPath, 'b.md'), 'utf8')).toBe('# B\nbefore b\n')
    await expect(stat(join(app.userDataPath, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(page.locator('.agent-diff-file')).toHaveCount(3)
    await expect(page.locator('.agent-undo-task')).toBeDisabled()
  } finally { await app.cleanup(); await server.close() }
})

test('leaves every file unchanged and shows three versions on Undo conflict', async () => {
  const { app, page, server } = await runDiffTask()
  try {
    await writeFile(join(app.userDataPath, 'b.md'), '# B\nmanual b\n')
    const undo = page.locator('.agent-undo-task')
    await undo.focus()
    await page.keyboard.press('Enter')

    await expect(page.locator('#agent-task-status')).toHaveText('Undo Conflict')
    const conflict = page.locator('.agent-undo-conflict').filter({ hasText: 'b.md' })
    await expect(conflict).toBeVisible()
    await conflict.locator('summary').click()
    await expect(conflict).toContainText('Before task')
    await expect(conflict).toContainText('Task result')
    await expect(conflict).toContainText('Current file')
    await expect(conflict).toContainText('before b')
    await expect(conflict).toContainText('after b')
    await expect(conflict).toContainText('manual b')

    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# A\nafter a\n')
    expect(await readFile(join(app.userDataPath, 'b.md'), 'utf8')).toBe('# B\nmanual b\n')
    expect(await readFile(join(app.userDataPath, 'new.md'), 'utf8')).toBe('# New\n')
    const keep = conflict.getByRole('button', { name: 'Keep current file' })
    await keep.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-recovery-panel')).toBeHidden()
    expect(await readFile(join(app.userDataPath, 'b.md'), 'utf8')).toBe('# B\nmanual b\n')
  } finally { await app.cleanup(); await server.close() }
})
