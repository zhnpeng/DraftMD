import { expect, test } from '@playwright/test'
import { mkdir, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

for (const quarantined of [false, true]) {
  test(`startup ${quarantined ? 'preserves snapshots with a quarantined database' : 'removes expired orphan snapshots'}`, async () => {
    const app = await launchDraftMD({
      locale: 'en', documentName: 'document.md',
      prepare: async dir => {
        await writeFile(join(dir, 'document.md'), '# Original document\n')
        const root = join(dir, 'snapshots', 'workspace', 'expired')
        await mkdir(root, { recursive: true })
        await writeFile(join(root, 'baseline.md'), '# Recoverable bytes\n')
        const old = new Date(Date.now() - 60 * 86_400_000)
        await utimes(root, old, old)
        if (quarantined) await writeFile(join(dir, 'draftmd.corrupt.123.sqlite'), 'quarantined')
      },
    })
    try {
      const expired = join(app.userDataPath, 'snapshots', 'workspace', 'expired')
      if (quarantined) {
        const { readFile } = await import('node:fs/promises')
        await expect.poll(async () => {
          const { readdir } = await import('node:fs/promises')
          const logs = await readdir(join(app.userDataPath, 'logs'))
          return (await Promise.all(logs.map(name => readFile(join(app.userDataPath, 'logs', name), 'utf8')))).join('\n')
        }).toContain('SNAPSHOT_CLEANUP_SKIPPED_DATABASE')
        await expect(stat(expired)).resolves.toBeDefined()
      } else {
        await expect.poll(() => stat(expired).then(() => true, error => {
          if (error.code === 'ENOENT') return false
          throw error
        })).toBe(false)
      }
      const { readFile } = await import('node:fs/promises')
      expect(await readFile(join(app.userDataPath, 'document.md'), 'utf8')).toBe('# Original document\n')
    } finally { await app.cleanup() }
  })
}
