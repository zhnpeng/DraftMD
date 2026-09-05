import { expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD, resolveTestApplication, resolveTestLaunchDocument } from '../../helpers/electron-app'

it.each([process.cwd(), tmpdir()])('rejects unsafe test user data before prepare or launch: %s', async userDataPath => {
  const prepare = vi.fn(async () => { throw new Error('prepare must not run') })
  await expect(launchDraftMD({ userDataPath, prepare })).rejects.toThrow(/canonical temp root/)
  expect(prepare).not.toHaveBeenCalled()
})

it('rejects a temporary symlink that leads to a non-temporary profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-profile-link-'))
  try {
    const userDataPath = join(root, 'linked-profile')
    await symlink(process.cwd(), userDataPath)
    const prepare = vi.fn(async () => { throw new Error('prepare must not run') })
    await expect(launchDraftMD({ userDataPath, prepare })).rejects.toThrow(/canonical temp root/)
    expect(prepare).not.toHaveBeenCalled()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('launches a packaged app using its executable and an isolated Chromium profile', () => {
  expect(resolveTestApplication('/private/tmp/profile', '/release/current/DraftMD.app')).toEqual({
    executablePath: '/release/current/DraftMD.app/Contents/MacOS/DraftMD',
    args: ['--user-data-dir=/private/tmp/profile'],
  })
  expect(() => resolveTestApplication('/private/tmp/profile', '/release/index.js')).toThrow(/\.app/)
})

it('accepts one Markdown launch path inside the canonical temp root', () => {
  expect(resolveTestLaunchDocument('/private/tmp/app', {
    documentPath: '/private/tmp/workspace-b/notes.md', tempRoot: '/private/tmp',
  })).toBe('/private/tmp/workspace-b/notes.md')
})

it('rejects ambiguous, non-Markdown, and out-of-temp launch paths', () => {
  expect(() => resolveTestLaunchDocument('/private/tmp/app', {
    documentName: 'a.md', documentPath: '/private/tmp/b.md', tempRoot: '/private/tmp',
  })).toThrow()
  expect(() => resolveTestLaunchDocument('/private/tmp/app', {
    documentPath: '/private/tmp/workspace/secret.txt', tempRoot: '/private/tmp',
  })).toThrow()
  expect(() => resolveTestLaunchDocument('/private/tmp/app', {
    documentPath: '/Users/example/notes.md', tempRoot: '/private/tmp',
  })).toThrow()
})

it('imports pure path helpers without loading the Electron binary package', () => {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  const { resolve } = require('node:path') as typeof import('node:path')
  const script = `
    const Module = require('node:module')
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') throw new Error('electron package loaded during pure helper import')
      return originalLoad.call(this, request, parent, isMain)
    }
    import(${JSON.stringify(resolve('tests/helpers/electron-app.ts'))})
      .then((helper) => {
        if (helper.resolveTestDocumentPath('/tmp/app', 'a.md') !== '/tmp/app/a.md') process.exit(2)
      })
      .catch((error) => { console.error(error.message); process.exit(1) })
  `
  expect(() => execFileSync(process.execPath, ['--eval', script], { stdio: 'pipe' })).not.toThrow()
})
