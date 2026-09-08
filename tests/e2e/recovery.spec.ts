import { expect, test } from '@playwright/test'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkspaceRepository } from '../../src/main/persistence/workspace-repository'
import { createSessionRepository } from '../../src/main/persistence/session-repository'
import { createTaskRepository } from '../../src/main/persistence/task-repository'
import { createChangeSetService } from '../../src/main/changes/change-set-service'
import { launchDraftMD } from '../helpers/electron-app'

const sessionId = '01991d5a-1c00-7000-8000-000000000041'
const taskId = '01991d5a-1c00-7000-8000-000000000042'
const now = '2026-09-01T12:00:00.000Z'

test('recovers a partial task without a provider and allows viewing and undoing it', async () => {
  const app = await launchDraftMD({
    locale: 'en', documentName: 'spec.md',
    prepare: async (directory) => {
      const canonicalPath = await realpath(directory)
      const workspaceId = createHash('sha256').update(`draftmd-workspace\0${canonicalPath}`).digest('hex')
      await writeFile(join(directory, 'spec.md'), '# Before\n')
      const database = new Database(join(directory, 'draftmd.sqlite'))
      database.pragma('foreign_keys = ON')
      for (const name of ['001_initial.sql', '002_provider_configs.sql', '003_provider_test_metadata.sql']) {
        database.exec(await readFile(join(process.cwd(), 'src/main/persistence/migrations', name), 'utf8'))
      }
      database.exec('create table schema_migrations (version integer primary key, name text not null, applied_at text not null)')
      const migration = database.prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
      ;[[1, 'initial'], [2, 'provider-configs'], [3, 'provider-test-metadata']].forEach(([version, name]) => migration.run(version, name, now))
      try {
        createWorkspaceRepository(database).upsert({ id: workspaceId, name: 'Recovery', canonicalPath, updatedAt: now })
        createSessionRepository(database).create({ id: sessionId, workspaceId, title: 'Interrupted', createdAt: now, updatedAt: now })
        createTaskRepository(database).create({ id: taskId, sessionId, status: 'running', createdAt: now, updatedAt: now })
      } finally { database.close() }
      const changes = createChangeSetService(join(directory, 'snapshots'))
      await changes.begin(taskId, { id: workspaceId, name: 'Recovery', canonicalPath })
      await writeFile(join(directory, 'spec.md'), '# Partial\n')
    },
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'spec.md')
    await expect(page.locator('#agent-dock-expanded')).toBeVisible()
    await expect(page.locator('#agent-recovery-panel')).toContainText('Previous task interrupted')
    await expect(page.locator('#agent-approval-panel')).toBeHidden()
    await page.locator('#agent-recovery-panel').getByRole('button', { name: 'View changes' }).click()
    await expect(page.locator('#agent-change-summary')).toContainText('spec.md')
    const undo = page.locator('#agent-change-summary').getByRole('button', { name: 'Undo task' })
    await undo.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.ProseMirror')).toContainText('Before')
    expect(await page.evaluate(() => document.querySelector('#provider-settings[open]') !== null)).toBe(false)
  } finally { await app.cleanup() }
})
