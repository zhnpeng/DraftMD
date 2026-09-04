import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureChatOnlyProvider } from '../../helpers/agent-provider'
import { launchDraftMD } from '../../helpers/electron-app'
import { startMockProviderServer } from '../../helpers/mock-provider-server'

test('keeps chat-only output advisory and never interprets fake tool text as a mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-acceptance-chat-only-'))
  const documentPath = join(root, 'document.md')
  const original = '# Chat Document\n\nPRIVATE_CURRENT_DOCUMENT_SENTINEL\n'
  await writeFile(documentPath, original)
  const server = await startMockProviderServer('chat-only')
  const app = await launchDraftMD({ documentPath, locale: 'en' })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'document.md')
    const provider = await configureChatOnlyProvider(page, server.baseUrl, 'Chat Only Acceptance')
    const configured = await page.evaluate(() => window.draftmd.listProviderConfigs())
    expect(configured.find((item) => item.id === provider.id)?.capability).toBe('chat-only')

    await page.locator('#agent-input').fill('Discuss the current document and suggest an improvement')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Suggestion only')
    const log = page.locator('#agent-message-log')
    await expect(log).toContainText('I can chat.')
    await expect(log).toContainText('cannot directly modify files')
    await expect(log).toContainText('edit_markdown')
    expect(await readFile(documentPath, 'utf8')).toBe(original)
    await expect(page.locator('#agent-change-summary')).toBeHidden()
    await expect(page.locator('.agent-undo-task')).toHaveCount(0)
    await expect(page.locator('#agent-activity-list')).toBeEmpty()
    await expect(stat(join(app.userDataPath, 'snapshots'))).rejects.toMatchObject({ code: 'ENOENT' })

    expect(server.requests).toHaveLength(2)
    const taskBody = server.requests[1].body as { tools?: unknown; messages?: Array<{ content?: string }> }
    expect(taskBody.tools).toEqual([])
    const userPayload = JSON.parse(taskBody.messages?.find((message: { role?: string }) => message.role === 'user')?.content ?? '{}') as {
      instruction?: string
      currentDocument?: string
    }
    expect(userPayload.currentDocument?.replace(/\\_/g, '_')).toContain('PRIVATE_CURRENT_DOCUMENT_SENTINEL')
    expect(userPayload.instruction).toContain('do not claim to modify files')
  } finally {
    await app.cleanup(); await server.close(); await rm(root, { recursive: true, force: true })
  }
})
