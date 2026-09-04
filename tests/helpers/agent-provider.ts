import { expect, type Page } from '@playwright/test'

export async function configureAgentProvider(page: Page, baseUrl: string, name: string) {
  const result = await page.evaluate(async ({ baseUrl, name }) => {
    const saved = await window.draftmd.saveProviderConfig({
      name, kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'mock-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    const tested = await window.draftmd.testProviderConfig(saved.id)
    await window.draftmd.setDefaultProvider(saved.id)
    return { saved, tested }
  }, { baseUrl, name })
  expect(result.tested.capability).toBe('agent')
  return result.saved
}

export async function configureChatOnlyProvider(page: Page, baseUrl: string, name: string) {
  const result = await page.evaluate(async ({ baseUrl, name }) => {
    const saved = await window.draftmd.saveProviderConfig({
      name, kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'chat-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    const tested = await window.draftmd.testProviderConfig(saved.id)
    await window.draftmd.setDefaultProvider(saved.id)
    return { saved, tested }
  }, { baseUrl, name })
  expect(result.tested.capability).toBe('chat-only')
  return result.saved
}
