import { expect, test } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAgentProvider } from '../../helpers/agent-provider'
import { launchDraftMD } from '../../helpers/electron-app'
import { startMockProviderServer } from '../../helpers/mock-provider-server'

const fixtures = join(process.cwd(), 'tests/fixtures/acceptance/meeting-sync')

test('synchronizes only confirmed offline sections and undoes all files byte-for-byte', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-acceptance-meeting-'))
  const userDataPath = join(root, 'app-data')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(userDataPath), cp(fixtures, workspace, { recursive: true })])
  const paths = ['requirements.md', 'design.md', 'meeting.md'] as const
  const before = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(join(workspace, path), 'utf8')])))
  const server = await startMockProviderServer('acceptance-meeting-sync')
  const app = await launchDraftMD({ userDataPath, documentPath: join(workspace, 'meeting.md'), locale: 'en' })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'meeting.md')
    await configureAgentProvider(page, server.baseUrl, 'Meeting Acceptance')
    await page.locator('#agent-input').fill('Synchronize the confirmed offline decision to requirements and design')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Completed')
    await expect(page.locator('#agent-message-log')).toContainText('Synchronized the confirmed offline decision')
    const activity = page.locator('#agent-activity-list')
    await expect(activity.locator('.agent-activity.success')).toHaveCount(5)
    await expect(activity.locator('.agent-activity.error')).toHaveCount(0)
    await expect(activity).toContainText('read')
    await expect(activity).toContainText('edit')

    expect(await readFile(join(workspace, 'meeting.md'), 'utf8')).toBe(before['meeting.md'])
    expect(await readFile(join(workspace, 'requirements.md'), 'utf8')).toBe(before['requirements.md'].replace('Status: pending decision.', 'Status: required.'))
    expect(await readFile(join(workspace, 'design.md'), 'utf8')).toBe(before['design.md'].replace('Status: pending decision.', 'Status: local-first with no network dependency.'))
    const changes = page.locator('.agent-diff-file')
    await expect(changes).toHaveCount(2)
    await expect(changes.filter({ hasText: 'requirements.md' })).toContainText('Modified')
    await expect(changes.filter({ hasText: 'design.md' })).toContainText('Modified')
    await expect(changes.filter({ hasText: 'meeting.md' })).toHaveCount(0)

    await page.locator('.agent-undo-task').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Undone')
    for (const path of paths) expect(await readFile(join(workspace, path), 'utf8')).toBe(before[path])
  } finally {
    await app.cleanup(); await server.close(); await rm(root, { recursive: true, force: true })
  }
})
