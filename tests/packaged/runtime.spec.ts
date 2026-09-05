import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchDraftMD, resolveTestApplication } from '../helpers/electron-app'

test('the production app itself ignores a development renderer URL', async () => {
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'draftmd-production-renderer-')))
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.end('<html><body>Development renderer</body></html>') })
  let app: ElectronApplication | undefined
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const launch = resolveTestApplication(profile, process.env.DRAFTMD_PACKAGED_APP)
    app = await electron.launch({
      ...launch,
      env: Object.fromEntries(Object.entries({ ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    })
    expect(await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }))).toEqual({ packaged: true, profile })
    const page = await app.firstWindow()
    await expect.poll(() => page.url()).toContain('/app.asar/dist/renderer/index.html')
    expect(requests).toBe(0)
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
      await app.close().catch(() => {})
    }
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

test('loads the bundled renderer even when the caller supplies a development URL', async () => {
  const app = await launchDraftMD({
    locale: 'en', documentName: 'packaged.md',
    prepare: directory => writeFile(join(directory, 'packaged.md'), '# Packaged renderer\n'),
    env: { ELECTRON_RENDERER_URL: 'http://127.0.0.1:1' },
  })
  try {
    expect(await app.evaluate(() => process.env.ELECTRON_RENDERER_URL)).toBeUndefined()
    const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'packaged.md')
    expect(new URL(page.url()).protocol).toBe('file:')
    await expect(page.locator('.ProseMirror')).toContainText('Packaged renderer')
  } finally { await app.cleanup() }
})
