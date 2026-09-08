import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'
import { configureChatOnlyProvider } from '../helpers/agent-provider'
import { startMockProviderServer } from '../helpers/mock-provider-server'

for (const locale of ['en', 'zh-CN'] as const) {
  test(`explains missing model configuration and preserves the draft (${locale})`, async ({}, testInfo) => {
    const app = await launchDraftMD({ locale, documentName: 'draft.md', prepare: dir => writeFile(join(dir, 'draft.md'), '# Draft\n') })
    try {
      const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'draft.md')
      const input = page.locator('#agent-input')
      const prompt = locale === 'en' ? 'Help with this document' : '帮我整理这篇文档'
      await input.fill(prompt)
      await page.locator('#agent-send-button').click()
      const feedback = page.locator('.agent-send-feedback')
      await expect(feedback).toContainText(locale === 'en' ? 'Configure a model before sending a message.' : '请先配置模型，再发送消息。')
      await expect(input).toHaveValue(prompt)
      await expect(page.locator('#agent-message-log .user')).toHaveCount(0)
      await feedback.getByRole('button', { name: locale === 'en' ? 'Configure model' : '配置模型', exact: true }).click()
      await expect(page.locator('#provider-settings')).toBeVisible()
      await page.locator('[data-provider-close]').click()
      await input.press('Enter')
      await expect(feedback).toHaveCount(1)
      await expect(feedback).toBeVisible()
      await expect(input).toHaveValue(prompt)
      const taskWindow = await app.browserWindow(page)
      await taskWindow.evaluate(win => win.setContentSize(800, 600))
      await expect(feedback.getByRole('button')).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath(`missing-model-${locale}.png`) })
    } finally { await app.cleanup() }
  })
}

test('Enter sends once, Shift+Enter inserts a newline, and composition does not send', async () => {
  const server = await startMockProviderServer('chat-only')
  const app = await launchDraftMD({ locale: 'en', documentName: 'draft.md', prepare: dir => writeFile(join(dir, 'draft.md'), '# Draft\n') })
  try {
    const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'draft.md')
    await configureChatOnlyProvider(page, server.baseUrl, 'Input Test')
    const input = page.locator('#agent-input')
    await input.fill('First line')
    await input.press('Shift+Enter')
    await input.press('End')
    await input.press('x')
    await expect(input).toHaveValue('First line\nx')
    await expect(page.locator('#agent-message-log .user')).toHaveCount(0)
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, bubbles: true })
    await expect(input).toHaveValue('First line\nx')
    await expect(page.locator('#agent-message-log .user')).toHaveCount(0)
    expect(server.requests).toHaveLength(1)
    await input.press('Enter')
    await expect(page.locator('#agent-message-log .user')).toHaveText('First line\nx')
    await expect(page.locator('#agent-task-status')).toHaveText('Suggestion only')
    await expect(input).toHaveValue('')
    expect(server.requests).toHaveLength(2)
    await input.fill('Existing shortcut')
    await input.press('ControlOrMeta+Enter')
    await expect(page.locator('#agent-message-log .user')).toHaveCount(2)
    await expect(page.locator('#agent-task-status')).toHaveText('Suggestion only')
    expect(server.requests).toHaveLength(3)
  } finally { await app.cleanup(); await server.close() }
})
