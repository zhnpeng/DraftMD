import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configureAgentProvider } from '../helpers/agent-provider'
import { launchDraftMD } from '../helpers/electron-app'
import { startMockProviderServer } from '../helpers/mock-provider-server'

async function expectInViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1)
}

async function useTheme(app: import('../helpers/electron-app').DraftMDTestApplication, page: Page, theme: 'light' | 'dark'): Promise<void> {
  await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(`theme-${id}`)
    if (!item) throw new Error(`Theme menu item not found: ${id}`)
    item.click()
  }, theme)
  await expect(page.locator('body')).toHaveClass(new RegExp(`theme-${theme}`))
}

test('supports keyboard-only foundation flow without clipping at 800x600 in reduced motion', async ({ browserName: _browserName }) => {
  const app = await launchDraftMD({ locale: 'en', documentName: 'keyboard.md', prepare: (directory) => writeFile(join(directory, 'keyboard.md'), '# Keyboard\n') })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'keyboard.md')
    await page.setViewportSize({ width: 800, height: 600 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await useTheme(app, page, 'light')
    await expect(page.getByRole('button', { name: 'Show / hide file list' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch to Markdown source' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send task' })).toBeVisible()

    await page.getByRole('button', { name: 'Show / hide file list' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tablist', { name: 'Sidebar content' })).toBeVisible()
    await page.getByRole('tab', { name: 'Outline' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('button', { name: 'Switch to Markdown source' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#source-editor')).toBeVisible()
    await page.getByRole('button', { name: 'Switch to visual editor' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.ProseMirror')).toBeVisible()
    await page.locator('#agent-input').focus()
    await expect(page.getByRole('separator', { name: 'Resize AI task dock' })).toBeVisible()
    await page.getByRole('button', { name: 'New conversation', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu').filter({ has: page.getByRole('button', { name: 'New conversation', exact: true }) })).toBeVisible()
    await page.keyboard.press('Escape')

    for (const locator of [page.locator('#titlebar'), page.locator('#file-panel'), page.locator('#agent-dock')]) {
      if (await locator.isVisible()) await expectInViewport(page, locator)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const moving = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((element) => {
      const style = getComputedStyle(element)
      return style.animationDuration !== '0s' || style.transitionDuration !== '0s'
    }).map((element) => ({ id: element.id, className: element.className, transition: getComputedStyle(element).transitionDuration, animation: getComputedStyle(element).animationDuration })).slice(0, 20))
    expect(moving).toEqual([])
  } finally { await app.cleanup() }
})

test('exposes localized deletion approval roles, state, default focus, path, and reason in Chinese dark mode', async () => {
  const server = await startMockProviderServer('agent-delete-one')
  const app = await launchDraftMD({ locale: 'zh-CN', documentName: 'a.md', prepare: (directory) => writeFile(join(directory, 'a.md'), '# 删除保护\n') })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
    await useTheme(app, page, 'dark')
    await configureAgentProvider(page, server.baseUrl, '中文删除审批')
    await page.locator('#agent-input').fill('删除旧文件')
    await page.locator('#agent-send-button').click()
    await expect.poll(() => server.requests.length).toBeGreaterThanOrEqual(3)
    server.releaseDelete()
    const panel = page.locator('#agent-approval-panel')
    await expect(panel).toBeVisible()
    await expect(page.getByRole('alertdialog', { name: '确认删除文件' })).toBeVisible()
    await expect(panel.locator('code')).toHaveText('a.md')
    await expect(panel).toContainText('Obsolete a.md')
    await expect(panel.getByRole('button', { name: '取消' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('已完成')
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# 删除保护\n')
  } finally { await app.cleanup(); await server.close() }
})

test('keeps dark-theme Diff and Undo semantics readable without relying on color', async () => {
  const server = await startMockProviderServer('agent-task')
  const app = await launchDraftMD({ locale: 'en', documentName: 'task.md', prepare: (directory) => writeFile(join(directory, 'task.md'), '# Task\n\nbefore\n') })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
    await useTheme(app, page, 'dark')
    await configureAgentProvider(page, server.baseUrl, 'Accessible Diff')
    await page.locator('#agent-input').fill('Update the task')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Completed')
    await expect(page.getByRole('log')).toContainText('Updated task.md.')
    const diff = page.locator('.agent-diff-file')
    await expect(diff).toHaveCount(1)
    await diff.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(diff.locator('.visually-hidden', { hasText: 'Removed' })).toHaveCount(1)
    await expect(diff.locator('.visually-hidden', { hasText: 'Added' })).toHaveCount(1)
    await expect(diff).toContainText('−before')
    await expect(diff).toContainText('+after')
    await page.getByRole('button', { name: 'Undo task' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Undone')
  } finally { await app.cleanup(); await server.close() }
})
