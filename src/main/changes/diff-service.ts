import { createTwoFilesPatch, diffLines, structuredPatch } from 'diff'

export interface TextDiff {
  patch: string
  additions: number
  deletions: number
  hunks: ReturnType<typeof structuredPatch>['hunks']
}

export function createTextDiff(oldPath: string, newPath: string, before: string, after: string): TextDiff {
  let additions = 0
  let deletions = 0
  for (const part of diffLines(before, after)) {
    const lines = part.count ?? 0
    if (part.added) additions += lines
    if (part.removed) deletions += lines
  }
  return {
    patch: createTwoFilesPatch(`a/${oldPath}`, `b/${newPath}`, before, after, '', '', { context: 3 }),
    additions,
    deletions,
    hunks: structuredPatch(`a/${oldPath}`, `b/${newPath}`, before, after, '', '', { context: 3 }).hunks,
  }
}
