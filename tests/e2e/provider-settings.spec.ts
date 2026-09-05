import { expect, test } from '@playwright/test'
import { startMockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD } from '../helpers/electron-app'
import { createServer } from 'node:http'
import { once } from 'node:events'

test('creates, tests, defaults, and reloads a write-only compatible provider config', async ({}, testInfo) => {
  const server = await startMockProviderServer('agent')
  const app = await launchDraftMD()
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.title().then((title) => title.includes('DraftMD')).catch(() => false))
    await page.locator('#agent-model-button').click()
    await page.locator('#agent-model-menu .agent-menu-configure').click()
    const dialog = page.locator('#provider-settings')
    await expect(dialog).toBeVisible()

    await dialog.locator('[data-provider-new]').click()
    await dialog.locator('[name=name]').fill('Local Mock')
    await dialog.locator('[name=kind]').selectOption('openai-compatible')
    await expect(dialog.locator('[name=apiMode]')).toHaveValue('responses')
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

    await page.locator('#agent-model-button').click()
    await page.locator('#agent-model-menu .agent-menu-configure').click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[name=name]')).toHaveValue('Local Mock')
    await expect(dialog.locator('[name=apiMode]')).toHaveValue('responses')
    expect(server.requests.map(request => request.url)).toContain('/v1/responses')
    await page.screenshot({ path: testInfo.outputPath('responses-settings.png') })
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.setContentSize(800, 600))
    await dialog.locator('[name=apiMode]').scrollIntoViewIfNeeded()
    await expect(dialog.locator('[name=apiMode]')).toBeInViewport()
    await expect(dialog.locator('button[type=submit]')).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('responses-settings-small.png') })
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
    await page.locator('#agent-model-button').click()
    await page.locator('#agent-model-menu .agent-menu-configure').click()
    const dialog = page.locator('#provider-settings')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#provider-settings-title')).toHaveText('模型设置')
    await expect(dialog.locator('[name=apiMode]')).toBeHidden()
    await expect(dialog.locator('[data-provider-test]')).toHaveText('测试')
    await expect(dialog.locator('[name=privacyDisclosure] + span')).toContainText('任务内容')
  } finally { await app.cleanup() }
})

test('resets provider defaults and synchronizes draft models without saving credentials', async ({}, testInfo) => {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url!)
    expect(req.headers.authorization).toBe('Bearer draft-model-list-key')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'vendor-chat-latest' }, { id: 'vendor-claude-model' }] }))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const app = await launchDraftMD({ locale: 'zh-CN' })
  try {
    const page = await app.windowMatching(async p => (await p.title()).includes('DraftMD'))
    const win = await app.browserWindow(page)
    await win.evaluate(w => { w.setContentSize(800, 600); w.webContents.send('open-provider-settings') })
    const dialog = page.locator('#provider-settings')
    await expect(dialog).toBeVisible()
    await dialog.locator('[name=kind]').selectOption('openai')
    await expect(dialog.locator('[name=model]')).toHaveValue('gpt-5.6-terra')
    await expect(dialog.locator('[name=baseUrl]')).toHaveValue('https://api.openai.com/v1')
    await dialog.locator('[name=kind]').selectOption('openai-compatible')
    await expect(dialog.locator('[name=model]')).toHaveValue('')
    await expect(dialog.locator('[name=baseUrl]')).toHaveValue('')
    expect(await dialog.locator('#provider-model-options option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))).toContain('gpt-6-astra')
    await expect(dialog.locator('[data-model-status]')).toHaveText('内置预设 · 2026-09-05')
    await dialog.locator('[name=baseUrl]').fill(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`)
    await dialog.locator('[name=apiKey]').fill('draft-model-list-key')
    await dialog.locator('[data-provider-sync-models]').click()
    await expect(dialog.locator('[data-model-status]')).toHaveText('已同步 2 个模型。')
    expect(await dialog.locator('#provider-model-options option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))).toEqual(['vendor-chat-latest', 'vendor-claude-model'])
    await expect(dialog.locator('[name=model]')).toHaveValue('')
    await expect(dialog.locator('[name=apiKey]')).toHaveValue('draft-model-list-key')
    expect(await page.evaluate(() => window.draftmd.listProviderConfigs())).toEqual([])
    await dialog.locator('[name=model]').fill('vendor-chat-latest')
    await expect(dialog.locator('[name=model]')).toHaveValue('vendor-chat-latest')
    await expect(dialog.locator('button[type=submit]')).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('models-synchronized-zh.png') })
    await dialog.locator('[name=preset]').selectOption('ollama')
    await expect(dialog.locator('[name=apiMode]')).toHaveValue('chat-completions')
    await expect(dialog.locator('[name=model]')).toHaveValue('')
    await expect(dialog.locator('[name=baseUrl]')).toHaveValue('http://127.0.0.1:11434/v1')
    await expect(dialog.locator('[data-model-status]')).toBeHidden()
    expect(requests).toEqual(['/v1/models'])
  } finally {
    await app.cleanup(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('shows synchronization errors, preserves custom models, and ignores stale endpoint results', async () => {
  let release!: () => void
  const released = new Promise<void>(resolve => { release = resolve })
  let started = false
  let completed = false
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/slow/')) {
      started = true
      await released
      res.setHeader('content-type', 'application/json')
      res.end('{"data":[{"id":"stale-model"}]}')
      completed = true
    } else {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"do-not-show-server-secret"}}')
    }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const app = await launchDraftMD({ locale: 'en' })
  try {
    const page = await app.windowMatching(async p => (await p.title()).includes('DraftMD'))
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.webContents.send('open-provider-settings'))
    const dialog = page.locator('#provider-settings')
    await expect(dialog).toBeVisible()
    await dialog.locator('[name=kind]').selectOption('openai-compatible')
    await dialog.locator('[name=model]').fill('custom-model')
    await dialog.locator('[name=baseUrl]').fill(`${origin}/slow/v1`)
    await dialog.locator('[data-provider-sync-models]').click()
    await expect(dialog.locator('[data-model-status]')).toHaveText('Syncing models...')
    await expect(dialog.locator('[data-provider-sync-models]')).toBeDisabled()
    await expect.poll(() => started).toBe(true)
    await dialog.locator('[name=baseUrl]').fill(`${origin}/unsupported/v1`)
    await dialog.locator('[data-provider-sync-models]').click()
    await expect(dialog.locator('[data-model-status]')).toHaveText('This endpoint does not support model listing.')
    release()
    await expect.poll(() => completed).toBe(true)
    // Flush the renderer's pending IPC responses before checking stale state.
    await page.evaluate(() => window.draftmd.listProviderConfigs())
    await expect(dialog.locator('[data-model-status]')).toHaveText('This endpoint does not support model listing.')
    await expect(dialog.locator('#provider-model-options option[value="stale-model"]')).toHaveCount(0)
    await expect(dialog.locator('[name=model]')).toHaveValue('custom-model')
    await expect(dialog).not.toContainText('do-not-show-server-secret')
    await expect(dialog.locator('[data-provider-sync-models]')).toBeEnabled()
  } finally {
    release(); await app.cleanup(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('replaces saved credentials when switching vendors before saving and syncing', async () => {
  let received = {}
  const server = createServer((req, res) => {
    received = req.headers
    res.setHeader('content-type', 'application/json'); res.end('{"data":[{"id":"new-vendor-model"}]}')
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const app = await launchDraftMD({ locale: 'en' })
  try {
    const page = await app.windowMatching(async p => (await p.title()).includes('DraftMD'))
    await page.evaluate(() => window.draftmd.saveProviderConfig({
      name: 'Saved Vendor', kind: 'anthropic', preset: 'none', baseUrl: 'https://api.anthropic.com', model: 'original-model',
      timeoutMs: 1000, insecureHttpApproved: false, streamEnabled: true, toolsEnabled: true,
    }, { apiKey: 'old-vendor-key', headers: { 'X-Old-Vendor': 'old-vendor-header' } }))
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.webContents.send('open-provider-settings'))
    const dialog = page.locator('#provider-settings')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[name=apiKey]')).toBeHidden()
    await dialog.locator('[name=kind]').selectOption('openai-compatible')
    await expect(dialog.locator('[name=apiKey]')).toBeVisible()
    await expect(dialog.locator('[name=apiKey]')).toHaveValue('')
    await expect(dialog.locator('[data-api-key-state]')).toHaveText('Not saved')
    await dialog.locator('[name=baseUrl]').fill(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`)
    await dialog.locator('[name=apiKey]').fill('new-vendor-key')
    await dialog.locator('[name=model]').fill('new-vendor-model')
    await dialog.locator('[name=privacyDisclosure]').check()
    await dialog.locator('button[type=submit]').click()
    await expect(dialog.locator('[data-api-key-state]')).toHaveText('Saved in Keychain')
    const configs = await page.evaluate(() => window.draftmd.listProviderConfigs())
    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({ kind: 'openai-compatible', headerNames: [], hasCredential: true })
    await dialog.locator('[data-provider-sync-models]').click()
    await expect(dialog.locator('[data-model-status]')).toHaveText('Models synced: 1.')
    expect(received).toMatchObject({ authorization: 'Bearer new-vendor-key' })
    expect(JSON.stringify(received)).not.toContain('old-vendor')
  } finally {
    await app.cleanup(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
