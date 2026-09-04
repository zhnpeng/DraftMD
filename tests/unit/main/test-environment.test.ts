import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveTestEnvironment } from '../../../src/main/test-environment'

const tempUserData = join(tmpdir(), 'draftmd-e2e-safe')

describe('main-process test environment', () => {
  it('accepts contained temp userData only for unpackaged test execution', () => {
    expect(resolveTestEnvironment({
      isPackaged: false,
      nodeEnv: 'test',
      requestedUserData: tempUserData,
      tempRoot: tmpdir(),
      canonicalize: (path) => path,
    })).toEqual({ userData: tempUserData, disableRestore: true, disableUpdates: true })
  })

  it.each([
    { isPackaged: true, nodeEnv: 'test' },
    { isPackaged: false, nodeEnv: 'production' },
  ])('ignores test env in $isPackaged/$nodeEnv execution', ({ isPackaged, nodeEnv }) => {
    expect(resolveTestEnvironment({
      isPackaged, nodeEnv, requestedUserData: tempUserData, tempRoot: tmpdir(), canonicalize: (path) => path,
    })).toEqual({ userData: null, disableRestore: false, disableUpdates: false })
  })

  it.each(['/Users/example/Documents', join(tmpdir(), '..', 'escape')])('rejects userData outside canonical temp root: %s', (requestedUserData) => {
    expect(() => resolveTestEnvironment({
      isPackaged: false, nodeEnv: 'test', requestedUserData, tempRoot: tmpdir(), canonicalize: (path) => path,
    })).toThrow()
  })
})
