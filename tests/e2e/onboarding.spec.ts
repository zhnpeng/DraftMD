import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchDraftMD, type DraftMDTestApplication } from '../helpers/electron-app'

test('completes four onboarding steps once and reopens from Help', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-onboarding-e2e-'))
  const userDataPath = join(root, 'app-data')
  const workspace = join(root, 'workspace')
  const documentPath = join(workspace, 'welcome.md')
  await Promise.all([mkdir(userDataPath), mkdir(workspace)])
  await writeFile(documentPath, '# Welcome\n')
  let app: DraftMDTestApplication | null = await launchDraftMD({ userDataPath, documentPath, locale: 'en', onboardingCompleted: false })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'welcome.md')
    const dialog = page.locator('#onboarding-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Step 1 of 4')
    await dialog.getByRole('button', { name: 'English' }).click()

    await expect(dialog).toContainText('Step 2 of 4')
    await expect(dialog).toContainText('current document folder is ready')
    await dialog.getByRole('button', { name: 'Continue' }).click()

    await expect(dialog).toContainText('Step 3 of 4')
    await expect(dialog).toContainText('Connect a model')
    await dialog.getByRole('button', { name: 'Skip for now' }).click()

    await expect(dialog).toContainText('Step 4 of 4')
    await expect(dialog).toContainText('only Markdown files in the current folder')
    await expect(dialog).toContainText('deletion requires your explicit confirmation')
    await expect(dialog).toContainText('no Shell, web, URL, or code-execution tools')
    await dialog.getByRole('button', { name: 'Start writing' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.ProseMirror')).toContainText('Welcome')
    expect(await page.evaluate(() => localStorage.getItem('draftmd-onboarding-complete'))).toBe('1')

    await app.cleanup()
    app = null
    const restarted = await launchDraftMD({ userDataPath, documentPath, locale: 'en' })
    try {
      const restartedPage = await restarted.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'welcome.md')
      await expect(restartedPage.locator('#onboarding-dialog')).toBeHidden()
      await restarted.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('welcome-guide')
        if (!item) throw new Error('Welcome Guide menu item not found')
        item.click()
      })
      await expect(restartedPage.locator('#onboarding-dialog')).toBeVisible()
      await expect(restartedPage.locator('#onboarding-dialog')).toContainText('Step 1 of 4')
    } finally { await restarted.cleanup() }
  } finally {
    if (app) await app.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
