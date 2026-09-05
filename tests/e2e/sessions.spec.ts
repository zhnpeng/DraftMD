import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD, type DraftMDTestApplication } from '../helpers/electron-app'

async function saveChatProvider(page: import('@playwright/test').Page, baseUrl: string, name: string, model: string) {
  return page.evaluate(async ({ baseUrl, name, model }) => {
    const saved = await window.draftmd.saveProviderConfig({
      name, kind: 'openai-compatible', preset: 'none', baseUrl, model,
      timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    const tested = await window.draftmd.testProviderConfig(saved.id)
    return { id: saved.id, capability: tested.capability }
  }, { baseUrl, name, model })
}

test('persists workspace conversations and model choices across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-sessions-e2e-'))
  const userDataPath = join(root, 'app-data')
  const workspaceA = join(root, 'workspace-a')
  const workspaceB = join(root, 'workspace-b')
  const notesA = join(workspaceA, 'notes.md')
  const notesB = join(workspaceB, 'notes.md')
  await Promise.all([mkdir(userDataPath), mkdir(workspaceA), mkdir(workspaceB)])
  await Promise.all([writeFile(notesA, '# Workspace A\n\nBody A\n'), writeFile(notesB, '# Workspace B\n\nBody B\n')])
  const server = await startMockProviderServer('chat-only')
  let first: DraftMDTestApplication | null = await launchDraftMD({ userDataPath, documentPath: notesA, locale: 'en' })
  try {
    const page = await first.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'notes.md')
    const primary = await saveChatProvider(page, server.baseUrl, 'Primary', 'model-a')
    const secondary = await saveChatProvider(page, server.baseUrl, 'Secondary', 'model-b')
    expect(primary.capability).toBe('chat-only')
    expect(secondary.capability).toBe('chat-only')

    const rendererErrors: string[] = []
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    await page.locator('#agent-input').fill('First conversation')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-message-log')).toContainText('I can chat.')

    await page.locator('#agent-session-button').click()
    await expect(page.locator('#agent-session-menu')).toBeVisible()
    await page.locator('#agent-session-menu').getByRole('button', { name: 'New conversation', exact: true }).click()
    await page.locator('#agent-model-button').click()
    await expect(page.locator('#agent-model-menu')).toBeVisible()
    await page.locator('#agent-model-menu').getByRole('button', { name: /Secondary.*model-b/ }).click()
    await page.locator('#agent-input').fill('Second conversation')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-session-button')).toHaveText('Second conversation')

    await page.locator('#agent-session-button').click()
    const second = page.locator('[data-session-row]').filter({ hasText: 'Second conversation' })
    const secondId = await second.getAttribute('data-session-row')
    if (!secondId) throw new Error('Second conversation row is missing its stable identifier')
    await second.getByRole('button', { name: 'Rename' }).click()
    const editingSecond = page.locator(`[data-session-row="${secondId}"]`)
    await editingSecond.getByRole('textbox').fill('Renamed conversation')
    await editingSecond.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('#agent-session-button')).toHaveText('Renamed conversation')
    await expect(page.locator('#agent-model-button')).toContainText('Secondary')

    await page.locator('#agent-session-button').click()
    await page.locator('[data-session-row]').filter({ hasText: 'First conversation' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('#agent-session-delete-dialog')).toBeVisible()
    await page.locator('#agent-session-delete-confirm').click()
    await expect(page.locator('[data-session-row]').filter({ hasText: 'First conversation' })).toHaveCount(0)
    expect(rendererErrors).toEqual([])
    expect(await readFile(notesA, 'utf8')).toBe('# Workspace A\n\nBody A\n')

    await first.cleanup()
    first = null

    const restarted = await launchDraftMD({ userDataPath, documentPath: notesA, locale: 'en' })
    try {
      const restartedPage = await restarted.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'notes.md')
      await expect(restartedPage.locator('#agent-session-button')).toHaveText('Renamed conversation')
      await expect(restartedPage.locator('#agent-model-button')).toContainText('Secondary')
      await restartedPage.locator('#agent-input').focus()
      await expect(restartedPage.locator('#agent-dock-expanded')).toBeVisible()
      await restartedPage.locator('#agent-session-button').click()
      await expect(restartedPage.locator('#agent-session-menu')).toBeVisible()
      await expect(restartedPage.locator('[data-session-row]')).toHaveCount(1)
      await expect(restartedPage.locator('[data-session-row]')).toContainText('Renamed conversation')
    } finally { await restarted.cleanup() }

    const otherWorkspace = await launchDraftMD({ userDataPath, documentPath: notesB, locale: 'en' })
    try {
      const otherPage = await otherWorkspace.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'notes.md')
      await expect(otherPage.locator('#agent-session-button')).toHaveText('New conversation')
      await otherPage.locator('#agent-input').focus()
      await expect(otherPage.locator('#agent-dock-expanded')).toBeVisible()
      await otherPage.locator('#agent-session-button').click()
      await expect(otherPage.locator('#agent-session-menu')).toBeVisible()
      await expect(otherPage.locator('[data-session-row]')).toHaveCount(0)
      expect(await readFile(notesB, 'utf8')).toBe('# Workspace B\n\nBody B\n')
    } finally { await otherWorkspace.cleanup() }
  } finally {
    if (first) await first.cleanup()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
