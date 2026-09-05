import { expect, test } from '@playwright/test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startMockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD } from '../helpers/electron-app'

async function runDiffTask(apiMode: 'responses' | 'chat-completions' = 'chat-completions') {
  const server = await startMockProviderServer('agent-diff-task')
  const app = await launchDraftMD({
    locale: 'en', prepare: async (directory) => {
      await writeFile(join(directory, 'a.md'), '# A\nbefore a\n')
      await writeFile(join(directory, 'b.md'), '# B\nbefore b\n')
    }, documentName: 'a.md',
  })
  const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
  const capability = await page.evaluate(async ({ baseUrl, apiMode }) => {
    const saved = await window.draftmd.saveProviderConfig({
      name: 'Diff Mock', kind: 'openai-compatible', preset: 'none', baseUrl, apiMode,
      model: 'mock-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    return window.draftmd.testProviderConfig(saved.id)
  }, { baseUrl: server.baseUrl, apiMode })
  expect(capability.capability).toBe('agent')
  await page.locator('#agent-input').fill('Update both files and create a summary')
  await page.locator('#agent-send-button').click()
  await expect(page.locator('#agent-task-status')).toHaveText('Completed')
  return { app, page, server }
}

for (const apiMode of ['responses', 'chat-completions'] as const) test(`renders accessible per-file Diff and exactly undoes a completed task (${apiMode})`, async () => {
  const { app, page, server } = await runDiffTask(apiMode)
  try {
    const changes = page.locator('.agent-diff-file')
    await expect(changes).toHaveCount(3)
    await expect(changes.filter({ hasText: 'a.md' })).toContainText('Modified')
    await expect(changes.filter({ hasText: 'b.md' })).toContainText('Modified')
    await expect(changes.filter({ hasText: 'new.md' })).toContainText('Created')
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# A\nafter a\n')
    expect(await readFile(join(app.userDataPath, 'b.md'), 'utf8')).toBe('# B\nafter b\n')
    expect(await readFile(join(app.userDataPath, 'new.md'), 'utf8')).toBe('# New\n')
    expect(server.requests.every(request => request.url === (apiMode === 'responses' ? '/v1/responses' : '/v1/chat/completions'))).toBe(true)
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
    if (apiMode === 'responses') {
      await page.locator('#agent-input').fill('Update the same files again')
      await page.locator('#agent-input').press('Enter')
      await expect(page.locator('#agent-task-status')).toHaveText('Completed')
      expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# A\nafter a\n')
      expect(await readFile(join(app.userDataPath, 'b.md'), 'utf8')).toBe('# B\nafter b\n')
      expect(await readFile(join(app.userDataPath, 'new.md'), 'utf8')).toBe('# New\n')
    }
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

for (const saveSucceeds of [true, false]) test(`opening an Undo conflict protects current edits when save ${saveSucceeds ? 'succeeds' : 'fails'}`, async () => {
  const { app, page, server } = await runDiffTask()
  try {
    await expect(page.locator('#editor .ProseMirror')).toContainText('after a')
    const windowIds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id).sort())
    await writeFile(join(app.userDataPath, 'b.md'), '# B\nmanual b\n')
    await page.locator('.agent-undo-task').click()
    const conflict = page.locator('.agent-undo-conflict').filter({ hasText: 'b.md' })
    await conflict.locator('summary').click()
    if (!saveSucceeds) await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('save-file')
      ipcMain.handle('save-file', () => null)
    })
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    await page.locator('#source-toggle-btn').click()
    await page.locator('#source-editor').fill('# A\nUnsaved current edits\n')
    await conflict.getByRole('button', { name: 'Open file', exact: true }).click()
    if (saveSucceeds) {
      await expect(page.locator('#file-title')).toHaveText('b.md')
      expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toContain('Unsaved current edits')
    } else {
      await expect(page.locator('#file-title')).toHaveText('a.md')
      await expect(page.locator('#source-editor')).toHaveValue('# A\nUnsaved current edits\n')
      expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# A\nafter a\n')
    }
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.id).sort())).toEqual(windowIds)
  } finally { await app.cleanup(); await server.close() }
})
