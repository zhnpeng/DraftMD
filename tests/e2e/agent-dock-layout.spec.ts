import { expect, test } from '@playwright/test'
import { launchDraftMD } from '../helpers/electron-app'

for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`keeps editor geometry stable with a resizable dock at ${viewport.width}x${viewport.height}`, async () => {
    const app = await launchDraftMD()
    try {
      const page = await app.windowMatching(async (candidate) => await candidate.title().then((title) => title.includes('DraftMD')).catch(() => false))
      await page.setViewportSize(viewport)
      const input = page.locator('#agent-input')
      const editor = page.locator('#editor')
      await expect(input).toBeVisible()
      const before = await editor.boundingBox()
      await input.focus()
      await page.keyboard.press('Meta+j')
      const after = await editor.boundingBox()
      expect(after?.x).toBe(before?.x)
      expect(after?.width).toBe(before?.width)

      const resize = page.locator('#agent-dock-resize')
      await expect(resize).toBeVisible()
      await resize.evaluate((element) => {
        for (let step = 0; step < 5; step += 1) element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      })
      const height = await page.locator('#agent-dock').evaluate((element) => element.getBoundingClientRect().height)
      expect(height).toBeGreaterThan(320)
      expect(height).toBeLessThanOrEqual(Math.floor(viewport.height * 0.65) + 1)

      await input.fill('draft')
      await page.keyboard.press('Escape')
      await expect(page.locator('#agent-dock-expanded')).toBeVisible()
      await input.fill('')
      await page.keyboard.press('Escape')
      await expect(page.locator('#agent-dock-expanded')).toBeHidden()
    } finally { await app.cleanup() }
  })
}

test('collapse leaves a fake running task alive', async () => {
  const app = await launchDraftMD()
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.title().then((title) => title.includes('DraftMD')).catch(() => false))
    await page.locator('#agent-input').focus()
    await page.keyboard.press('Meta+j')
    await page.evaluate(() => {
      const stop = document.querySelector<HTMLButtonElement>('#agent-stop-button')!
      stop.hidden = false
      stop.dataset.running = 'true'
    })
    const collapse = page.locator('#agent-collapse-button')
    await collapse.evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.locator('#agent-dock-expanded')).toBeHidden()
    expect(await page.locator('#agent-stop-button').getAttribute('data-running')).toBe('true')
  } finally { await app.cleanup() }
})
