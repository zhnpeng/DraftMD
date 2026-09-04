import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startMockProviderServer, type MockProviderServer } from '../helpers/mock-provider-server'
import { launchDraftMD } from '../helpers/electron-app'

async function configureProvider(page: import('@playwright/test').Page, server: MockProviderServer) {
  const result = await page.evaluate(async (baseUrl) => {
    const saved = await window.draftmd.saveProviderConfig({
      name: 'Delete Mock', kind: 'openai-compatible', preset: 'none', baseUrl,
      model: 'mock-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    return window.draftmd.testProviderConfig(saved.id)
  }, server.baseUrl)
  expect(result.capability).toBe('agent')
}

async function waitForDeleteBarrier(server: MockProviderServer): Promise<void> {
  await expect.poll(() => server.requests.length).toBeGreaterThanOrEqual(3)
}

test('auto-expands a collapsed dock and defaults deletion approval to cancel', async () => {
  const server = await startMockProviderServer('agent-delete-one')
  const app = await launchDraftMD({
    locale: 'en', prepare: (directory) => writeFile(join(directory, 'a.md'), '# Keep\n'), documentName: 'a.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
    await configureProvider(page, server)
    await page.locator('#agent-input').fill('Remove obsolete file')
    await page.locator('#agent-send-button').click()
    await waitForDeleteBarrier(server)
    await page.locator('#agent-collapse-button').click()
    await expect(page.locator('#agent-dock-expanded')).toBeHidden()

    server.releaseDelete()
    await expect(page.locator('#agent-approval-panel')).toBeVisible()
    await expect(page.locator('#agent-dock-expanded')).toBeVisible()
    await expect(page.locator('#agent-approval-panel code')).toHaveText('a.md')
    const cancel = page.locator('#agent-approval-panel').getByRole('button', { name: 'Cancel' })
    await expect(cancel).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.locator('#agent-approval-panel')).toBeHidden()
    await expect(page.locator('#agent-task-status')).toHaveText(/Completed|已完成/)
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# Keep\n')
  } finally { await app.cleanup(); await server.close() }
})

test('deletes only after explicit approval and reports the change', async () => {
  const server = await startMockProviderServer('agent-delete-one')
  const app = await launchDraftMD({
    locale: 'en', prepare: (directory) => writeFile(join(directory, 'a.md'), '# Delete\n'), documentName: 'a.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
    await configureProvider(page, server)
    await page.locator('#agent-input').fill('Delete the file')
    await page.locator('#agent-send-button').click()
    await waitForDeleteBarrier(server)
    server.releaseDelete()
    const panel = page.locator('#agent-approval-panel')
    await expect(panel).toBeVisible()
    const approve = panel.getByRole('button', { name: 'Delete file' })
    await approve.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText(/Completed|已完成/)
    await expect(page.locator('#agent-change-summary')).toContainText('a.md')
    await expect(readFile(join(app.userDataPath, 'a.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await app.cleanup(); await server.close() }
})

test('applies independent mixed decisions to two deletion requests', async () => {
  const server = await startMockProviderServer('agent-delete-two')
  const app = await launchDraftMD({
    locale: 'en', prepare: async (directory) => {
      await writeFile(join(directory, 'a.md'), '# Keep\n')
      await writeFile(join(directory, 'b.md'), '# Delete\n')
    },
    documentName: 'a.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
    await configureProvider(page, server)
    await page.locator('#agent-input').fill('Remove both obsolete files')
    await page.locator('#agent-send-button').click()
    await waitForDeleteBarrier(server)
    server.releaseDelete()
    const panel = page.locator('#agent-approval-panel')
    await expect(panel.locator('code')).toHaveText('a.md')
    const firstCancel = panel.getByRole('button', { name: 'Cancel' })
    await firstCancel.focus()
    await page.keyboard.press('Enter')
    await expect(panel.locator('code')).toHaveText('b.md')
    const secondApprove = panel.getByRole('button', { name: 'Delete file' })
    await secondApprove.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText(/Completed|已完成/)
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# Keep\n')
    await expect(readFile(join(app.userDataPath, 'b.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await app.cleanup(); await server.close() }
})

test('warns on a stale deletion and rejects it even after approval', async () => {
  const server = await startMockProviderServer('agent-delete-stale')
  const app = await launchDraftMD({
    locale: 'en', prepare: async (directory) => {
      await writeFile(join(directory, 'anchor.md'), '# Anchor\n')
      await writeFile(join(directory, 'a.md'), '# Original\n')
    }, documentName: 'anchor.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'anchor.md')
    await configureProvider(page, server)
    await page.locator('#agent-input').fill('Delete if obsolete')
    await page.locator('#agent-send-button').click()
    await waitForDeleteBarrier(server)
    await writeFile(join(app.userDataPath, 'a.md'), '# Changed externally\n')
    server.releaseDelete()
    const panel = page.locator('#agent-approval-panel')
    await expect(panel.locator('.agent-approval-warning')).toBeVisible()
    await expect(panel.locator('.agent-approval-warning')).toContainText('changed')
    const staleApprove = panel.getByRole('button', { name: 'Delete file' })
    await staleApprove.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-activity-list')).toContainText('VERSION_CONFLICT')
    await expect(page.locator('#agent-task-status')).toHaveText(/Completed|已完成/)
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# Changed externally\n')
  } finally { await app.cleanup(); await server.close() }
})

test('closing the task window cancels pending deletion without touching the file', async () => {
  const server = await startMockProviderServer('agent-delete-one')
  const app = await launchDraftMD({
    locale: 'en', prepare: (directory) => writeFile(join(directory, 'a.md'), '# Keep on close\n'), documentName: 'a.md',
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
    await configureProvider(page, server)
    await page.locator('#agent-input').fill('Delete after approval')
    await page.locator('#agent-send-button').click()
    await waitForDeleteBarrier(server)
    server.releaseDelete()
    await expect(page.locator('#agent-approval-panel')).toBeVisible()
    await page.close()
    await expect.poll(() => app.windows().length).toBe(0)
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# Keep on close\n')
  } finally { await app.cleanup(); await server.close() }
})
