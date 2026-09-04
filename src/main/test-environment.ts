import { isAbsolute, relative, resolve, sep } from 'node:path'

export interface TestEnvironment {
  userData: string | null
  disableRestore: boolean
  disableUpdates: boolean
}

export function resolveTestEnvironment(input: {
  isPackaged: boolean
  nodeEnv: string | undefined
  requestedUserData: string | undefined
  tempRoot: string
  canonicalize(path: string): string
}): TestEnvironment {
  const disabled: TestEnvironment = { userData: null, disableRestore: false, disableUpdates: false }
  if (input.isPackaged || input.nodeEnv !== 'test') return disabled
  if (!input.requestedUserData) return disabled

  const tempRoot = resolve(input.canonicalize(input.tempRoot))
  const userData = resolve(input.canonicalize(input.requestedUserData))
  const contained = relative(tempRoot, userData)
  if (!contained || contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    throw new Error('DRAFTMD_TEST_USER_DATA must be contained by the canonical temp root')
  }
  return { userData, disableRestore: true, disableUpdates: true }
}
