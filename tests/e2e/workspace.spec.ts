import { expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

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
    await page.locator('#file-toggle-btn').click()
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
