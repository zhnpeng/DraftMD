import { describe, expect, it, vi } from 'vitest'
import { createBundledDocuments } from '../../../src/main/app/bundled-documents'

function setup(readFile = vi.fn().mockResolvedValue('# Bundled')) {
  const createWindow = vi.fn()
  const bundled = createBundledDocuments({
    windowManager: { createWindow } as never,
    readFile,
    writeFile: vi.fn(),
    demoDir: '/resources/demo',
    cheatsheetDir: '/resources/templates',
    releaseNoticePath: '/user/release-notice.json',
    appVersion: () => '1.0.0',
    isPackaged: false,
  })
  return { bundled, createWindow, readFile }
}

describe('bundled document browse directories', () => {
  it('opens cheatsheet content with templates as its initial browse directory', async () => {
    const { bundled, createWindow, readFile } = setup()

    await bundled.openCheatsheet('en')

    expect(readFile).toHaveBeenCalledWith('/resources/templates/cheatsheet-en.md', 'utf-8')
    expect(createWindow).toHaveBeenCalledWith(undefined, '# Bundled', '/resources/templates')
  })

  it('falls back to an untitled templates browser when cheatsheet reading fails', async () => {
    const { bundled, createWindow } = setup(vi.fn().mockRejectedValue(new Error('missing')))

    await bundled.openCheatsheet('zh')

    expect(createWindow).toHaveBeenCalledWith(undefined, undefined, '/resources/templates')
  })

  it('keeps demo documents browsing the demo directory', async () => {
    const { bundled, createWindow } = setup()

    await bundled.open('changelog.md')

    expect(createWindow).toHaveBeenCalledWith(undefined, '# Bundled', '/resources/demo')
  })
})
