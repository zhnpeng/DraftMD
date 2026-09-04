import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { startMockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD, type DraftMDTestApplication } from '../helpers/electron-app'


async function configureTaskProvider(page: import('@playwright/test').Page, baseUrl: string, name: string) {
  const provider = await page.evaluate(async ({ baseUrl, name }) => {
    const saved = await window.draftmd.saveProviderConfig({
      name, kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'mock-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    return { saved, tested: await window.draftmd.testProviderConfig(saved.id) }
  }, { baseUrl, name })
  expect(provider.tested.capability).toBe('agent')
  return provider.saved
}

test('runs a real Dock to Agent Runtime cross-document task through a loopback provider', async () => {
  const server = await startMockProviderServer('agent-task')
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(join(directory, 'task.md'), '# Task\n\nbefore\n'),
    documentName: 'task.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
    await configureTaskProvider(page, server.baseUrl, 'Task Mock')

    const input = page.locator('#agent-input')
    await input.fill('Update task.md from before to after')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-dock-expanded')).toBeVisible()
    await expect(page.locator('#agent-task-status')).toHaveText(/Completed|已完成/, { timeout: 15_000 })
    await expect(page.locator('#agent-message-log')).toContainText('Updated task.md.')
    await expect(page.locator('#agent-activity-list')).toContainText('read')
    await expect(page.locator('#agent-activity-list')).toContainText('edit')
    await expect(page.locator('#agent-change-summary')).toContainText('task.md')
    expect(await readFile(join(app.userDataPath, 'task.md'), 'utf8')).toBe('# Task\n\nafter\n')

    const workspaceId = createHash('sha256').update(`draftmd-workspace\0${app.userDataPath}`).digest('hex')
    const sessions = await page.evaluate((id) => window.draftmd.listSessions(id), workspaceId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('Update task.md from before to after')
  } finally { await app.cleanup(); await server.close() }
})

test('stops before mutation without showing a diff', async () => {
  const server = await startMockProviderServer('agent-stop-before')
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(join(directory, 'task.md'), '# Task\n\nbefore\n'),
    documentName: 'task.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
    await configureTaskProvider(page, server.baseUrl, 'Stop Before')
    await page.locator('#agent-input').fill('Wait before editing')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-stop-button')).toBeVisible()
    await page.locator('#agent-stop-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText(/Stopped|已停止/)
    await expect(page.locator('#agent-change-summary')).toBeHidden()
    expect(await readFile(join(app.userDataPath, 'task.md'), 'utf8')).toBe('# Task\n\nbefore\n')
  } finally { await app.cleanup(); await server.close() }
})

test('stops after one mutation as partial-complete and restores that state after restart', async () => {
  const server = await startMockProviderServer('agent-stop-after')
  const root = await mkdtemp(join(tmpdir(), 'draftmd-agent-stop-e2e-'))
  const userDataPath = join(root, 'app-data')
  const workspace = join(root, 'workspace')
  const documentPath = join(workspace, 'task.md')
  await Promise.all([mkdir(userDataPath), mkdir(workspace)])
  await writeFile(documentPath, '# Task\n\nbefore\n')
  let app: DraftMDTestApplication | null = await launchDraftMD({ userDataPath, documentPath })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
    await configureTaskProvider(page, server.baseUrl, 'Stop After')
    await page.locator('#agent-input').fill('Edit once, then wait')
    await page.locator('#agent-send-button').click()
    await expect.poll(() => readFile(documentPath, 'utf8')).toBe('# Task\n\nafter\n')
    await page.locator('#agent-stop-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText(/Partial Complete|部分完成/)
    await expect(page.locator('#agent-change-summary')).toContainText('task.md')

    await app.cleanup()
    app = null
    const restarted = await launchDraftMD({ userDataPath, documentPath })
    try {
      const restartedPage = await restarted.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
      await expect(restartedPage.locator('#agent-task-status')).toHaveText(/Partial Complete|部分完成/)
      await expect(restartedPage.locator('#agent-message-log')).toContainText('Edit once, then wait')
      await expect(restartedPage.locator('#agent-activity-list')).toContainText('edit')
    } finally { await restarted.cleanup() }
  } finally {
    if (app) await app.cleanup()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
