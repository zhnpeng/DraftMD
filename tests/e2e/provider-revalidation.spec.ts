import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'
import { configureAgentProvider } from '../helpers/agent-provider'
import { startMockProviderServer } from '../helpers/mock-provider-server'

test('requires a fresh capability test after switching to a chat-only endpoint', async () => {
  const agent = await startMockProviderServer('agent')
  const chat = await startMockProviderServer('chat-only')
  const app = await launchDraftMD({ locale: 'en', documentName: 'task.md', prepare: dir => writeFile(join(dir, 'task.md'), '# Document\n') })
  try {
    const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
    const saved = await configureAgentProvider(page, agent.baseUrl, 'Changing provider')
    const edited = await page.evaluate(({ id, baseUrl }) => window.draftmd.saveProviderConfig({
      id, name: 'Changing provider', kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'mock-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {}), { id: saved.id, baseUrl: chat.baseUrl })
    expect(edited).toMatchObject({ capability: 'unavailable', lastTestedAt: null, lastTestErrorCode: null })
    expect(chat.requests).toHaveLength(0)
    expect(await page.evaluate(id => window.draftmd.testProviderConfig(id), saved.id)).toMatchObject({ capability: 'chat-only', cancelled: false })
    await page.locator('#agent-input').fill('Suggest an update')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Suggestion only')
    await expect(page.locator('#agent-message-log')).toContainText('I can suggest changes')
  } finally { await app.cleanup(); await agent.close(); await chat.close() }
})

test('a stale timed-out probe cannot overwrite a newer successful configuration', async () => {
  const slow = await startMockProviderServer('timeout')
  const agent = await startMockProviderServer('agent')
  const app = await launchDraftMD({ locale: 'en', documentName: 'task.md', prepare: dir => writeFile(join(dir, 'task.md'), '# Document\n') })
  try {
    const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
    const saved = await page.evaluate(baseUrl => window.draftmd.saveProviderConfig({
      name: 'Probe race', kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'mock-model', timeoutMs: 1000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {}), slow.baseUrl)
    const pending = page.evaluate(id => window.draftmd.testProviderConfig(id), saved.id)
    await expect.poll(() => slow.requests.length).toBe(1)
    await page.evaluate(({ id, baseUrl }) => window.draftmd.saveProviderConfig({
      id, name: 'Probe race', kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'mock-model', timeoutMs: 1000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {}), { id: saved.id, baseUrl: agent.baseUrl })
    expect(await page.evaluate(id => window.draftmd.testProviderConfig(id), saved.id)).toMatchObject({ capability: 'agent' })
    expect(await pending).toMatchObject({ cancelled: true, warning: 'CONFIG_CHANGED', errorCode: null })
    expect((await page.evaluate(() => window.draftmd.listProviderConfigs())).find(config => config.id === saved.id)).toMatchObject({ baseUrl: agent.baseUrl, capability: 'agent', lastTestErrorCode: null })
  } finally { await app.cleanup(); await slow.close(); await agent.close() }
})
