import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAgentProvider } from '../../helpers/agent-provider'
import { launchDraftMD } from '../../helpers/electron-app'
import { startMockProviderServer } from '../../helpers/mock-provider-server'

async function reachApproval(page: import('@playwright/test').Page, server: Awaited<ReturnType<typeof startMockProviderServer>>): Promise<void> {
  await page.locator('#agent-input').fill('Delete the obsolete technical plan')
  await page.locator('#agent-send-button').click()
  await expect.poll(() => server.requests.length).toBeGreaterThanOrEqual(3)
  server.releaseDelete()
  const panel = page.locator('#agent-approval-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('code')).toHaveText('a.md')
  await expect(panel).toContainText('Obsolete a.md')
}

test('keeps a denied deletion, requires explicit approval, and restores an approved deletion with Undo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-acceptance-delete-'))
  const userDataPath = join(root, 'app-data')
  const approveUserDataPath = join(root, 'app-data-approve')
  const workspace = join(root, 'workspace')
  const anchorPath = join(workspace, 'anchor.md')
  const obsoletePath = join(workspace, 'a.md')
  const obsolete = '# Obsolete Technical Plan\n\nOld approach.\n'
  await Promise.all([mkdir(userDataPath), mkdir(approveUserDataPath), mkdir(workspace)])
  await Promise.all([writeFile(anchorPath, '# Current Plan\n'), writeFile(obsoletePath, obsolete)])

  const denyServer = await startMockProviderServer('agent-delete-one')
  const denyApp = await launchDraftMD({ userDataPath, documentPath: anchorPath, locale: 'en' })
  try {
    const page = await denyApp.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'anchor.md')
    await configureAgentProvider(page, denyServer.baseUrl, 'Delete Deny Acceptance')
    await reachApproval(page, denyServer)
    await expect(page.locator('#agent-approval-panel').getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Completed')
    expect(await readFile(obsoletePath, 'utf8')).toBe(obsolete)
    await expect(page.locator('#agent-change-summary')).toBeHidden()
  } finally { await denyApp.cleanup(); await denyServer.close() }

  const approveServer = await startMockProviderServer('agent-delete-one')
  const approveApp = await launchDraftMD({ userDataPath: approveUserDataPath, documentPath: anchorPath, locale: 'en' })
  try {
    const page = await approveApp.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'anchor.md')
    await configureAgentProvider(page, approveServer.baseUrl, 'Delete Approve Acceptance')
    await reachApproval(page, approveServer)
    const approve = page.locator('#agent-approval-panel').getByRole('button', { name: 'Delete file' })
    await approve.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Completed')
    await expect(stat(obsoletePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(page.locator('.agent-diff-file')).toHaveCount(1)
    await expect(page.locator('.agent-diff-file')).toContainText('Deleted')
    await page.locator('.agent-undo-task').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Undone')
    expect(await readFile(obsoletePath, 'utf8')).toBe(obsolete)
  } finally {
    await approveApp.cleanup(); await approveServer.close(); await rm(root, { recursive: true, force: true })
  }
})
