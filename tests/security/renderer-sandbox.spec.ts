import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

test('runs the renderer sandboxed with a redacted bridge and inert model text', async () => {
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(join(directory, 'security.md'), '# Security\n'), documentName: 'security.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'security.md')
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences())
    expect(preferences?.sandbox).toBe(true)
    await expect(page.evaluate(() => ({
      requireType: typeof (globalThis as { require?: unknown }).require,
      processType: typeof (globalThis as { process?: unknown }).process,
    }))).resolves.toEqual({ requireType: 'undefined', processType: 'undefined' })

    const providerDTOs = await page.evaluate(() => window.draftmd.listProviderConfigs())
    expect(JSON.stringify(providerDTOs)).not.toMatch(/credentialRef|headerCredentialRefs|apiKey|secret/i)

    const injection = '<img src=x onerror="window.__draftmdPwned=true"><script>window.__draftmdPwned=true</script>'
    await page.evaluate((text) => {
      const container = document.getElementById('agent-message-log')!
      const article = document.createElement('article')
      article.className = 'agent-message assistant'
      article.textContent = text
      container.append(article)
    }, injection)
    await expect(page.locator('#agent-message-log .assistant')).toHaveText(injection)
    expect(await page.evaluate(() => ({
      pwned: (window as unknown as { __draftmdPwned?: boolean }).__draftmdPwned ?? false,
      scripts: document.querySelectorAll('#agent-message-log script').length,
      handlers: document.querySelectorAll('#agent-message-log [onerror]').length,
    }))).toEqual({ pwned: false, scripts: 0, handlers: 0 })

    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("'unsafe-eval'")
  } finally { await app.cleanup() }
})

test('keeps Mermaid execution in a sandboxed iframe', async () => {
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(join(directory, 'diagram.md'), '# Diagram\n\n```mermaid\ngraph TD\nA-->B\n```\n'),
    documentName: 'diagram.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'diagram.md')
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1)
    const sandbox = await page.locator('iframe[sandbox="allow-scripts"]').getAttribute('sandbox')
    expect(sandbox).toBe('allow-scripts')
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveAttribute('title', /Mermaid renderer|Mermaid 渲染器/)
  } finally { await app.cleanup() }
})
