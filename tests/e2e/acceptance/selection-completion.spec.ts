import { expect, test } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAgentProvider } from '../../helpers/agent-provider'
import { launchDraftMD } from '../../helpers/electron-app'
import { startMockProviderServer } from '../../helpers/mock-provider-server'

const fixtures = join(process.cwd(), 'tests/fixtures/acceptance/selection-completion')

async function captureErrorSelection(page: import('@playwright/test').Page): Promise<void> {
  if (!await page.locator('#source-editor').isVisible()) await page.locator('#source-toggle-btn').click()
  const source = page.locator('#source-editor')
  await source.evaluate((element: HTMLTextAreaElement) => {
    const selected = 'Handle validation errors.'
    const start = element.value.indexOf(selected)
    element.focus()
    element.setSelectionRange(start, start + selected.length)
  })
  await page.keyboard.press('Meta+Shift+J')
  const chip = page.locator('#agent-selection-chip')
  await expect(chip).toContainText('target.md')
  await expect(chip).toContainText('Service Design')
  await expect(chip).toContainText('Error Handling')
  await expect(chip).toContainText('Handle validation errors.')
}

test('completes only the referenced error section using on-demand search and rejects stale reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-acceptance-selection-'))
  const userDataPath = join(root, 'app-data')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(userDataPath), cp(fixtures, workspace, { recursive: true })])
  const targetPath = join(workspace, 'target.md')
  const before = await readFile(targetPath, 'utf8')
  const server = await startMockProviderServer('acceptance-selection-completion')
  const app = await launchDraftMD({ userDataPath, documentPath: targetPath, locale: 'en' })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'target.md')
    await configureAgentProvider(page, server.baseUrl, 'Selection Acceptance')
    await captureErrorSelection(page)
    await page.locator('#agent-input').fill('Complete the selected error scenarios using other workspace documents')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Completed')
    const activity = page.locator('#agent-activity-list')
    await expect(activity).toContainText('search')
    await expect(activity).toContainText('read')
    await expect(activity).toContainText('edit')

    const after = await readFile(targetPath, 'utf8')
    expect(after).toBe(before.replace(
      'Handle validation errors.',
      'Handle validation errors. Retry transient timeouts once and preserve the current draft on failure.',
    ))
    expect(after.match(/## Overview\n\n([\s\S]*?)\n\n## Error Handling/)?.[1]).toBe('The service processes drafts.')
    expect(after.match(/## Observability\n\n([\s\S]*)/)?.[1].trim()).toBe('Record safe metrics.')
    const changes = page.locator('.agent-diff-file')
    await expect(changes).toHaveCount(1)
    await expect(changes).toContainText('target.md')
    await changes.locator('summary').click()
    await expect(changes).toContainText('Handle validation errors.')
    await expect(changes).toContainText('Retry transient timeouts once')

    await captureErrorSelection(page)
    const requestCount = server.requests.length
    await writeFile(targetPath, after.replace('Record safe metrics.', 'Record safe metrics and traces.'))
    await page.locator('#agent-input').fill('Reuse the selected reference')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText(/Selection changed/)
    expect(server.requests).toHaveLength(requestCount)
    expect(await readFile(targetPath, 'utf8')).toContain('Record safe metrics and traces.')
  } finally {
    await app.cleanup(); await server.close(); await rm(root, { recursive: true, force: true })
  }
})
