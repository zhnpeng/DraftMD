import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'
import { configureAgentProvider, configureChatOnlyProvider } from '../helpers/agent-provider'
import { startMockProviderServer } from '../helpers/mock-provider-server'

async function selectSession(page: Page, title: string) {
  await page.locator('#agent-session-button').click()
  await page.locator('#agent-session-menu').getByRole('button', { name: title, exact: true }).click()
}

test('keeps Stop working after navigating away from and back to a running session', async () => {
  const server = await startMockProviderServer('agent-stop-before')
  const app = await launchDraftMD({ locale: 'en', documentName: 'task.md', prepare: dir => writeFile(join(dir, 'task.md'), '# Task\n\nbefore\n') })
  try {
    const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'task.md')
    await configureAgentProvider(page, server.baseUrl, 'Slow Agent')
    await page.locator('#agent-input').fill('Waiting task')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Running')
    await selectSession(page, 'New conversation')
    await selectSession(page, 'Waiting task')
    await expect(page.locator('#agent-task-status')).toHaveText('Running')
    await page.locator('#agent-stop-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Stopped')
    await expect(page.locator('#agent-stop-button')).toBeHidden()
  } finally { await app.cleanup(); await server.close() }
})

test('refuses active conversation deletion and restores its pending file approval after navigation', async ({}, testInfo) => {
  const server = await startMockProviderServer('agent-delete-one')
  server.releaseDelete()
  const app = await launchDraftMD({ locale: 'en', documentName: 'a.md', prepare: dir => writeFile(join(dir, 'a.md'), '# Task\n\nbefore\n') })
  try {
    const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'a.md')
    await configureAgentProvider(page, server.baseUrl, 'Delete Agent')
    await page.locator('#agent-input').fill('Delete task')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-approval-panel')).toBeVisible()
    await page.locator('#agent-session-button').click()
    const row = page.locator('[data-session-row]').filter({ hasText: 'Delete task' })
    const sessionId = await row.getAttribute('data-session-row')
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.locator('#agent-session-delete-confirm').click()
    await expect(page.locator('#agent-session-delete-dialog')).toContainText('Stop the running task before deleting this conversation.')
    await page.locator('#agent-session-delete-cancel').click()
    expect(await page.evaluate(id => window.draftmd.deleteSession(id!), sessionId)).toBe(false)
    await selectSession(page, 'New conversation')
    await selectSession(page, 'Delete task')
    await expect(page.locator('#agent-approval-panel')).toBeVisible()
    const bounds = await page.evaluate(() => ({
      panel: document.getElementById('agent-approval-panel')!.getBoundingClientRect().bottom,
      dock: document.getElementById('agent-dock-expanded')!.getBoundingClientRect().bottom,
    }))
    expect(bounds.panel).toBeLessThanOrEqual(bounds.dock)
    await page.screenshot({ path: testInfo.outputPath('restored-approval.png') })
    const taskWindow = await app.browserWindow(page)
    await taskWindow.evaluate(win => win.setContentSize(800, 600))
    await expect.poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 800, height: 600 })
    await expect(page.locator('#agent-approval-panel').getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('restored-approval-small.png') })
    await page.locator('#agent-approval-panel').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('#agent-stop-button')).toBeHidden()
    expect(await readFile(join(app.userDataPath, 'a.md'), 'utf8')).toBe('# Task\n\nbefore\n')
    expect(await page.evaluate(id => window.draftmd.deleteSession(id!), sessionId)).toBe(true)
  } finally { await app.cleanup(); await server.close() }
})

async function slowChatServer() {
  let cancelled = 0
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const probe = body.tools?.some((tool: any) => tool.function?.name === 'draftmd_capability_echo')
    const base = { id: 'chatcmpl-slow', object: 'chat.completion.chunk', created: 1, model: 'chat-model' }
    const emit = (text: string, done: boolean) => response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: done ? 'stop' : null }] })}\n\n`)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (probe) { emit('I can chat.', true); response.end('data: [DONE]\n\n'); return }
    response.on('close', () => { if (!response.writableEnded) cancelled++ })
    emit('First streamed words.', false)
    await Promise.race([finished, once(response, 'close')])
    if (response.destroyed) return
    emit(' Final words.', true)
    response.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, finish,
    cancelled: () => cancelled,
    close: async () => { finish(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}

test('streams chat before completion, restores it once, cancels it, and permits the next request', async () => {
  const server = await slowChatServer()
  const app = await launchDraftMD({ locale: 'en', documentName: 'task.md', prepare: dir => writeFile(join(dir, 'task.md'), '# Task\n') })
  try {
    const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'task.md')
    await configureChatOnlyProvider(page, server.baseUrl, 'Slow Chat')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('#agent-input').fill('Chat in progress')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Running')
    await expect(page.locator('#agent-message-log')).toContainText('First streamed words.')
    await expect(page.locator('#agent-send-button')).toBeDisabled()
    await selectSession(page, 'New conversation')
    await selectSession(page, 'Chat in progress')
    await expect(page.locator('#agent-message-log .assistant')).toHaveCount(1)
    await expect(page.locator('#agent-message-log .assistant')).toHaveText('First streamed words.')
    await page.locator('#agent-stop-button').click()
    await expect(page.locator('#agent-task-status')).toHaveText('Stopped')
    await expect.poll(server.cancelled).toBe(1)
    await expect(stat(join(app.userDataPath, 'snapshots'))).rejects.toMatchObject({ code: 'ENOENT' })
    await selectSession(page, 'Chat in progress')
    await expect(page.locator('#agent-message-log .assistant')).toHaveText('First streamed words.')
    await page.locator('#agent-input').fill('Second request')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-message-log .assistant')).toHaveCount(2)
    server.finish()
    await expect(page.locator('#agent-task-status')).toHaveText('Suggestion only')
    await expect(page.locator('#agent-message-log .assistant').last()).toHaveText('First streamed words. Final words.')
    await expect(page.locator('#agent-change-summary')).toBeHidden()
    expect(errors).toEqual([])
  } finally { await app.cleanup(); await server.close() }
})

test('closing a chat task window aborts its provider request', async () => {
  const server = await slowChatServer()
  const app = await launchDraftMD({ locale: 'en', documentName: 'task.md', prepare: dir => writeFile(join(dir, 'task.md'), '# Task\n') })
  try {
    const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'task.md')
    await configureChatOnlyProvider(page, server.baseUrl, 'Slow Chat')
    await page.locator('#agent-input').fill('Close during chat')
    await page.locator('#agent-send-button').click()
    await expect(page.locator('#agent-message-log')).toContainText('First streamed words.')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.close()))
    await expect.poll(server.cancelled).toBe(1)
  } finally { await app.cleanup(); await server.close() }
})
