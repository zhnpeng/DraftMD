import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD, resolveTestApplication } from '../helpers/electron-app'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('a second Windows launch opens the document and attaches its workspace', async () => {
  test.skip(process.platform !== 'win32', 'Windows single-instance file association')
  const app = await launchDraftMD({
    locale: 'en', documentName: 'first.md',
    prepare: async dir => {
      await writeFile(join(dir, 'first.md'), '# First\n')
      await mkdir(join(dir, 'another folder'))
      await writeFile(join(dir, 'another folder', 'second.md'), '# Second\n')
    },
  })
  try {
    await app.windowMatching(async page => await page.locator('#file-title').textContent().catch(() => '') === 'first.md')
    const launch = resolveTestApplication(app.userDataPath, process.env.DRAFTMD_PACKAGED_APP)
    await promisify(execFile)(launch.executablePath, [...launch.args, join(app.userDataPath, 'another folder', 'second.md')], {
      timeout: 15_000, windowsHide: true,
      env: { ...process.env, NODE_ENV: 'test', DRAFTMD_TEST_USER_DATA: app.userDataPath },
    })
    const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'second.md')
    await expect(page.locator('#editor .ProseMirror')).toContainText('Second')
    if (!await page.locator('#file-list').isVisible()) await page.locator('#file-toggle-btn').click()
    await expect(page.locator('#file-list button[data-path="second.md"]')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.draftmd.listWorkspaceFiles(''))).toEqual([
      { name: 'second.md', path: 'second.md', kind: 'file' },
    ])
  } finally { await app.cleanup() }
})

test('uses the actual desktop platform and opens model settings from the native menu', async () => {
  const app = await launchDraftMD({ locale: 'en', documentName: 'desktop.md', prepare: dir => writeFile(join(dir, 'desktop.md'), '# Desktop\n') })
  try {
    const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'desktop.md')
    await expect(page.locator('html')).toHaveAttribute('data-platform', process.platform)
    const windowId = await (await app.browserWindow(page)).evaluate(win => win.id)
    // Packaged startup can open a changelog; retain the matched window by ID
    // because the native title can change as the renderer loads.
    await app.evaluate(({ BrowserWindow }, windowId) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.id !== windowId) win.destroy()
      }
    }, windowId)
    await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()!
      const section = menu.items.find(item => item.label === (process.platform === 'darwin' ? 'DraftMD' : 'Edit'))!
      section.submenu!.items.find(item => item.label.startsWith('Model Settings'))!.click()
    })
    await expect(page.locator('#provider-settings')).toBeVisible()
    await page.keyboard.press('Escape')
    if (process.platform === 'win32') {
      await expect(page.locator('[data-i18n="files.toggleShortcut"]')).toHaveText(/Ctrl\+Shift\+B/)
      expect((await page.evaluate(() => window.draftmd.listSystemFonts())).length).toBeGreaterThan(0)
    }
    for (const width of [960, 600]) {
      await app.evaluate(({ BrowserWindow }, { windowId, width }) => BrowserWindow.fromId(windowId)!.setContentSize(width, 600), { windowId, width })
      await page.screenshot({ path: test.info().outputPath(`desktop-${process.platform}-${width}.png`) })
      const title = await page.locator('#title-center').boundingBox()
      const tools = await page.locator('#file-toggle-btn').boundingBox()
      expect(title!.x + title!.width).toBeLessThanOrEqual(tools!.x)
    }
  } finally { await app.cleanup() }
})

test('round trips image paths and Unicode documents on the host filesystem', async () => {
  const content = '# 文档\n\n![image](./images/pixel.png)\n'
  const app = await launchDraftMD({
    locale: 'en', documentName: '中文 document.md',
    prepare: async directory => {
      await mkdir(join(directory, 'images'))
      await writeFile(join(directory, 'images/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
      await writeFile(join(directory, '中文 document.md'), content)
    },
  })
  try {
    const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === '中文 document.md')
    const image = page.locator('#editor img[alt="image"]')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    await page.locator('#source-toggle-btn').click()
    const source = page.locator('#source-editor')
    await source.fill(await source.inputValue() + '\nUpdated\n')
    await source.press('ControlOrMeta+s')
    await expect.poll(() => readFile(join(app.userDataPath, '中文 document.md'), 'utf8')).toContain('./images/pixel.png')
    await expect.poll(() => readFile(join(app.userDataPath, '中文 document.md'), 'utf8')).toContain('Updated')
  } finally { await app.cleanup() }
})
