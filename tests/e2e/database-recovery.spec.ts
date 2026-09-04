import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

test('keeps editing and local sessions usable after malformed SQLite recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-database-recovery-e2e-'))
  const userDataPath = join(root, 'app-data')
  const workspace = join(root, 'workspace')
  const documentPath = join(workspace, 'recovery.md')
  const malformed = 'DRAFTMD malformed SQLite sentinel'
  await Promise.all([mkdir(userDataPath), mkdir(workspace)])
  await Promise.all([writeFile(join(userDataPath, 'draftmd.sqlite'), malformed), writeFile(documentPath, '# Before\n')])
  const app = await launchDraftMD({ userDataPath, documentPath, locale: 'zh-CN' })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'recovery.md')
    const warning = page.locator('#database-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('数据库损坏后已恢复')
    await expect(warning).not.toContainText(userDataPath)

    const editor = page.locator('.ProseMirror')
    await editor.click()
    await page.keyboard.press('Meta+A')
    await page.keyboard.type('Recovered Markdown')
    await page.keyboard.press('Meta+S')
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Recovered Markdown')

    const workspaceId = createHash('sha256').update(`draftmd-workspace\0${await realpath(workspace)}`).digest('hex')
    const session = await page.evaluate((id) => window.draftmd.createSession({ workspaceId: id, title: 'Fresh database session' }), workspaceId)
    const sessions = await page.evaluate((id) => window.draftmd.listSessions(id), workspaceId)
    expect(sessions.map((item) => item.id)).toContain(session.id)

    const files = await readdir(userDataPath)
    const isolated = files.find((name) => /^draftmd\.corrupt\.\d+\.sqlite$/.test(name))
    expect(isolated).toBeTruthy()
    expect(await readFile(join(userDataPath, isolated!), 'utf8')).toBe(malformed)
  } finally {
    await app.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
