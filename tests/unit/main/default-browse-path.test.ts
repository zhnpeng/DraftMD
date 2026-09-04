import { expect, it, vi } from 'vitest'
import { createDefaultBrowsePathResolver, resolveDefaultBrowsePath } from '../../../src/main/app/default-browse-path'

it('prefers macOS Documents when it is available', () => {
  expect(resolveDefaultBrowsePath({
    documents: '/Users/test/Documents', desktop: '/Users/test/Desktop', existsSync: vi.fn(() => true),
  })).toBe('/Users/test/Documents')
})

it('falls back to macOS Desktop when Documents is unavailable', () => {
  expect(resolveDefaultBrowsePath({
    documents: '/Users/test/Documents', desktop: '/Users/test/Desktop',
    existsSync: (path) => path === '/Users/test/Desktop',
  })).toBe('/Users/test/Desktop')
})


it('keeps an explicit workspace or browse path ahead of defaults', () => {
  const existsSync = vi.fn(() => true)
  expect(resolveDefaultBrowsePath({
    explicitPath: '/workspace', documents: '/Users/test/Documents', desktop: '/Users/test/Desktop', existsSync,
  })).toBe('/workspace')
  expect(existsSync).not.toHaveBeenCalled()
})


it('does not query macOS folders until the default is requested', () => {
  const getPath = vi.fn((name: 'documents' | 'desktop') => `/Users/test/${name}`)
  const resolve = createDefaultBrowsePathResolver({ getPath, existsSync: () => true })
  expect(getPath).not.toHaveBeenCalled()
  expect(resolve()).toBe('/Users/test/documents')
  expect(getPath).toHaveBeenCalledOnce()
  expect(getPath).toHaveBeenCalledWith('documents')
})

it('does not resolve Documents or Desktop outside macOS', () => {
  const getPath = vi.fn()
  const resolve = createDefaultBrowsePathResolver({ platform: 'linux', getPath, existsSync: () => true })
  expect(resolve()).toBeNull()
  expect(getPath).not.toHaveBeenCalled()
})
