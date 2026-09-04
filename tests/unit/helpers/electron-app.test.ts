import { expect, it } from 'vitest'
import { resolveTestLaunchDocument } from '../../helpers/electron-app'

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
