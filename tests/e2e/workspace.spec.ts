import { expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

test('the Open Folder menu creates a window after all windows were closed', async () => {
  test.skip(process.platform !== 'darwin', 'Only macOS keeps the application running after closing its last window')
  const app = await launchDraftMD({ locale: 'en', prepare: dir => writeFile(join(dir, 'reopened.md'), '# Reopened\n') })
  try {
    await app.windowMatching(async p => (await p.title()).includes('DraftMD'))
    await app.evaluate(({ BrowserWindow, dialog, Menu }, directory) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy()
      dialog.showOpenDialog = async (win: any) => {
        if (win.webContents.isLoading()) await new Promise<void>(resolve => win.webContents.once('did-finish-load', resolve))
        return { canceled: false, filePaths: [directory] }
      }
      const item = Menu.getApplicationMenu()!.items.find(item => item.label === 'File')!.submenu!.items[0]
      item.click()
    }, app.userDataPath)
    const page = await app.windowMatching(async p => (await p.title()).includes('DraftMD'))
    await expect(page.locator('#file-list button[data-path="reopened.md"]')).toBeVisible()
  } finally { await app.cleanup() }
})

test('opening a folder reveals its files and resets browsing even after hiding the outline', async () => {
  const app = await launchDraftMD({
    locale: 'en',
    prepare: async directory => {
      await mkdir(join(directory, 'first', 'nested'), { recursive: true })
      await mkdir(join(directory, 'second'))
      await writeFile(join(directory, 'first', 'nested', 'old.md'), '# Old\n')
      await writeFile(join(directory, 'second', 'new.md'), '# New\n')
    },
  })
  try {
    const page = await app.windowMatching(async candidate => (await candidate.title()).includes('DraftMD'))
    const openFolder = async (folder: string) => {
      await app.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
      }, join(app.userDataPath, folder))
      await page.evaluate(() => window.draftmd.openWorkspace())
    }
    await openFolder('first')
    const files = page.locator('#file-list')
    await expect(files).toBeVisible()
    await files.locator('button[data-path="nested"]').click()
    await expect(files.locator('button[data-path="nested/old.md"]')).toBeVisible()
    await page.locator('#file-panel-outline').click()
    await page.locator('#file-toggle-btn').click()
    await expect(page.locator('#file-panel')).toBeHidden()
    await openFolder('second')
    await expect(files.locator('button[data-path="new.md"]')).toBeVisible()
    await expect(files.locator('button[data-kind="parent"]')).toHaveCount(0)
    await files.locator('button[data-path="new.md"]').click()
    await expect(page.locator('#editor .ProseMirror')).toContainText('New')
    await page.locator('#file-toggle-btn').click()
    await writeFile(join(app.userDataPath, 'second', 'added.md'), '# Added\n')
    await expect(files.locator('button[data-path="added.md"]')).toHaveCount(1)
    await expect(page.locator('#file-panel')).toBeHidden()
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await page.evaluate(() => window.draftmd.openWorkspace())
    await expect(page.locator('#file-panel')).toBeHidden()
  } finally { await app.cleanup() }
})

test('keeps file browsing inside the attached workspace and tracks external Markdown changes', async () => {
  const app = await launchDraftMD({
    prepare: async (workspace) => {
      await mkdir(join(workspace, 'docs'))
      await writeFile(join(workspace, 'README.md'), '# Root\n')
      await writeFile(join(workspace, 'docs', 'spec.md'), '# Spec\n')
      await writeFile(join(workspace, 'private.txt'), 'not visible\n')
    },
    documentName: 'README.md',
  })

  try {
    const page = await app.windowMatching(async (candidate) =>
      await candidate.locator('#file-title').textContent().catch(() => '') === 'README.md')
    const fileList = page.locator('#file-list')

    await expect(fileList.locator('button[data-path="docs"]')).toBeVisible()
    await expect(fileList.locator('button[data-path="README.md"]')).toBeVisible()
    await expect(fileList.locator('button[data-kind="parent"]')).toHaveCount(0)
    await expect(fileList).not.toContainText('private.txt')

    await fileList.locator('button[data-path="docs"]').click()
    await expect(fileList.locator('button[data-path=""]')).toBeVisible()
    await expect(fileList.locator('button[data-path="docs/spec.md"]')).toBeVisible()

    await writeFile(join(app.userDataPath, 'docs', 'added.md'), '# Added\n')
    await expect(fileList.locator('button[data-path="docs/added.md"]')).toBeVisible({ timeout: 5_000 })

    await rm(join(app.userDataPath, 'docs', 'added.md'))
    await expect(fileList.locator('button[data-path="docs/added.md"]')).toHaveCount(0, { timeout: 5_000 })
  } finally {
    await app.cleanup()
  }
})
