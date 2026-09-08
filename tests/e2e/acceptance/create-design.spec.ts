import { expect, test } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAgentProvider } from '../../helpers/agent-provider'
import { launchDraftMD } from '../../helpers/electron-app'
import { startMockProviderServer } from '../../helpers/mock-provider-server'

const fixtures = join(process.cwd(), 'tests/fixtures/acceptance/create-design')

async function runCreate(page: import('@playwright/test').Page, prompt: string): Promise<void> {
  await page.locator('#agent-input').fill(prompt)
  await page.locator('#agent-send-button').click()
  await expect(page.locator('#agent-task-status')).toHaveText('Completed')
}

async function newConversation(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#agent-session-button').click()
  await page.locator('#agent-session-menu').getByRole('button', { name: 'New conversation', exact: true }).click()
}

test('creates safely, rejects collisions, undoes clean creation, and reports manual-edit conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-acceptance-create-'))
  const userDataPath = join(root, 'app-data')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(userDataPath), cp(fixtures, workspace, { recursive: true })])
  const requirementsBefore = await readFile(join(workspace, 'requirements.md'), 'utf8')
  const server = await startMockProviderServer('acceptance-create-design')
  const app = await launchDraftMD({ userDataPath, documentPath: join(workspace, 'requirements.md'), locale: 'en' })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'requirements.md')
    await configureAgentProvider(page, server.baseUrl, 'Create Acceptance')

    await runCreate(page, 'Create a technical design from the requirements')
    const designPath = join(workspace, 'technical-design.md')
    const generated = await readFile(designPath, 'utf8')
    expect(generated).toMatch(/^# Technical Design\n/)
    expect(generated).toContain('## Storage')
    expect(generated).toContain('## Safety')
    expect(await readFile(join(workspace, 'requirements.md'), 'utf8')).toBe(requirementsBefore)
    await expect(page.locator('#file-list')).toBeVisible()
    await expect(page.locator('#file-list')).toContainText('technical-design.md')

    await newConversation(page)
    await runCreate(page, 'Create the same technical design again')
    await expect(page.locator('#agent-activity-list')).toContainText('FILE_ALREADY_EXISTS')
    expect(await readFile(designPath, 'utf8')).toBe(generated)

    await page.locator('#agent-session-button').click()
    const firstSession = page.locator('[data-session-row]').filter({ hasText: 'Create a technical design from the requir' })
    await firstSession.locator('.agent-session-select').click()
    await page.locator('.agent-undo-task').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Undone')
    await expect(stat(designPath)).rejects.toMatchObject({ code: 'ENOENT' })

    await newConversation(page)
    await runCreate(page, 'Create a fresh technical design for conflict testing')
    await writeFile(designPath, `${await readFile(designPath, 'utf8')}\nManual follow-up edit.\n`)
    await page.locator('.agent-undo-task').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#agent-task-status')).toHaveText('Undo Conflict')
    const conflict = page.locator('.agent-undo-conflict').filter({ hasText: 'technical-design.md' })
    await expect(conflict).toBeVisible()
    expect(await readFile(designPath, 'utf8')).toContain('Manual follow-up edit.')
  } finally {
    await app.cleanup(); await server.close(); await rm(root, { recursive: true, force: true })
  }
})
