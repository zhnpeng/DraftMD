import { expect, test } from '@playwright/test'
import { startMockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD } from '../helpers/electron-app'

test('creates, tests, defaults, and reloads a write-only compatible provider config', async () => {
  const server = await startMockProviderServer('agent')
  const app = await launchDraftMD()
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.title().then((title) => title.includes('DraftMD')).catch(() => false))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('open-provider-settings'))
    const dialog = page.locator('#provider-settings')
    await expect(dialog).toBeVisible()

    await dialog.locator('[data-provider-new]').click()
    await dialog.locator('[name=name]').fill('Local Mock')
    await dialog.locator('[name=kind]').selectOption('openai-compatible')
    await dialog.locator('[name=preset]').selectOption('none')
    await dialog.locator('[name=baseUrl]').fill(server.baseUrl)
    await dialog.locator('[name=model]').fill('mock-model')
    await dialog.locator('[name=headerName]').fill('X-Private-Token')
    await dialog.locator('[name=headerValue]').fill('known-e2e-secret')
    await expect(dialog.locator('[data-provider-connection-note]')).toHaveText(/Local connection|本地连接/)
    await dialog.locator('[name=privacyDisclosure]').check()
    await dialog.locator('[data-provider-test]').click()

    await expect(dialog.locator('[data-provider-status]')).toHaveText(/Document Agent|文档 Agent/, { timeout: 10_000 })
    await expect(dialog.locator('[data-provider-list]')).toContainText('Local Mock')
    await dialog.locator('[data-provider-default]').click()
    await dialog.locator('[data-provider-close]').click()
    await expect(dialog).not.toBeVisible()

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('open-provider-settings'))
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[name=name]')).toHaveValue('Local Mock')
    await expect(dialog.locator('[data-api-key-state]')).toHaveText(/Not saved|未保存/)
    await expect(dialog.locator('[name=apiKey]')).toHaveValue('')
    await expect(dialog.locator('[name=headerValue]')).toHaveValue('')
    await expect(dialog.locator('[data-provider-list]')).not.toContainText('known-e2e-secret')
    expect(JSON.stringify(server.requests)).not.toContain('known-e2e-secret')
    expect(await page.evaluate(() => JSON.stringify(window.draftmd.listProviderConfigs()))).not.toContain('credentialRef')
  } finally {
    await app.cleanup()
    await server.close()
  }
})


test('renders the provider settings core flow in Simplified Chinese', async () => {
  const app = await launchDraftMD({ locale: 'zh-CN' })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.title().then((title) => title.includes('DraftMD')).catch(() => false))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('open-provider-settings'))
    const dialog = page.locator('#provider-settings')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#provider-settings-title')).toHaveText('模型设置')
    await expect(dialog.locator('[data-provider-test]')).toHaveText('测试')
    await expect(dialog.locator('[name=privacyDisclosure] + span')).toContainText('任务内容')
  } finally { await app.cleanup() }
})
