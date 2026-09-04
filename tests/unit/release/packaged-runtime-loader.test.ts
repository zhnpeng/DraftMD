import { describe, expect, it, vi } from 'vitest'
import { createRuntimeModuleLoader } from '../../../src/main/app/runtime-module-loader'

describe('packaged runtime module loader', () => {
  it('loads from the explicit unpacked runtime root when present', () => {
    const load = vi.fn(() => ({ native: true }))
    const create = vi.fn(() => load)
    const loader = createRuntimeModuleLoader({
      resourcesPath: '/App/Contents/Resources',
      currentFile: '/App/Contents/Resources/app.asar/dist/main/index.js',
      exists: (path) => path === '/App/Contents/Resources/node_modules',
      createRequire: create,
    })
    expect(loader('@napi-rs/keyring')).toEqual({ native: true })
    expect(create).toHaveBeenCalledWith('/App/Contents/Resources/runtime-entry.cjs')
    expect(load).toHaveBeenCalledWith('@napi-rs/keyring')
  })

  it('uses the current module root when no packaged runtime directory exists', () => {
    const load = vi.fn(() => ({ development: true }))
    const create = vi.fn(() => load)
    const loader = createRuntimeModuleLoader({
      resourcesPath: '/Electron/Resources',
      currentFile: '/work/dist/main/index.js',
      exists: () => false,
      createRequire: create,
    })
    expect(loader('better-sqlite3')).toEqual({ development: true })
    expect(create).toHaveBeenCalledWith('/work/dist/main/index.js')
  })
})
