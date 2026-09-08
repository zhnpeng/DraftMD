import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`lays out a resizable right Agent sidebar at ${viewport.width}x${viewport.height}`, async ({}, testInfo) => {
    const app = await launchDraftMD({ locale: 'en', documentName: 'notes.md', prepare: directory => writeFile(join(directory, 'notes.md'), '# Project Notes\n\nA document with room for editing alongside the Agent.\n\n## Decisions\n\nKeep changes local and reviewable.\n') })
    try {
      const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'notes.md')
      const win = await app.browserWindow(page)
      await win.evaluate((w, size) => w.setContentSize(size.width, size.height), viewport)
      // Hosted macOS displays can clamp native windows below the requested height.
      // Set the renderer viewport explicitly so both layout sizes are exercised.
      await page.setViewportSize(viewport)
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(viewport)
      if (!await page.locator('#file-list').isVisible()) await page.locator('#file-toggle-btn').click()
      const input = page.locator('#agent-input')
      const editor = page.locator('#editor')
      const dock = page.locator('#agent-dock')
      await expect(input).toBeVisible()
      const before = (await editor.boundingBox())!
      const bounds = (await dock.boundingBox())!
      expect(bounds.x).toBeGreaterThan(viewport.width / 2 - 1)
      expect(bounds.y).toBe(40)
      expect(bounds.y + bounds.height).toBe(viewport.height)
      expect(before.y + before.height).toBe(viewport.height)
      expect(before.x + before.width).toBeLessThanOrEqual(bounds.x)
      const resize = page.locator('#agent-dock-resize')
      await expect(resize).toHaveAttribute('aria-orientation', 'vertical')
      await resize.focus()
      await page.keyboard.press('ArrowLeft')
      const wider = (await dock.boundingBox())!
      expect(wider.width).toBe(bounds.width + 16)
      expect(wider.width).toBeLessThanOrEqual(viewport.width / 2)
      expect((await editor.boundingBox())!.height).toBe(before.height)
      expect(await page.evaluate(() => localStorage.getItem('agent-dock-width'))).toBe(String(wider.width))
      const handle = (await resize.boundingBox())!
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
      await page.mouse.down()
      await page.mouse.move(handle.x + 20, handle.y + 100)
      await page.mouse.up()
      expect((await dock.boundingBox())!.width).toBeLessThan(wider.width)
      await page.locator('#agent-model-button').click()
      const menu = (await page.locator('#agent-model-menu').boundingBox())!
      expect(menu.x).toBeGreaterThanOrEqual(0)
      expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width)
      await page.keyboard.press('Escape')
      await input.fill('draft')
      await page.keyboard.press('Escape')
      await expect(page.locator('#agent-dock-expanded')).toBeVisible()
      await input.fill('')
      await page.keyboard.press('Escape')
      await expect(page.locator('#agent-dock-expanded')).toBeHidden()
      expect((await dock.boundingBox())!.width).toBe(44)
      expect((await editor.boundingBox())!.width).toBeGreaterThan(before.width)
      await page.locator('#agent-expand-button').click()
      await expect(input).toBeFocused()
      await input.fill('Summarize the decisions in this document.')
      await expect(page.locator('#agent-send-button')).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('agent-right-sidebar.png') })
      await page.locator('#source-toggle-btn').click()
      const source = (await page.locator('#source-editor').boundingBox())!
      expect(source.x + source.width).toBeLessThanOrEqual((await dock.boundingBox())!.x)
      expect(source.y + source.height).toBe(viewport.height)
    } finally { await app.cleanup() }
  })
}
