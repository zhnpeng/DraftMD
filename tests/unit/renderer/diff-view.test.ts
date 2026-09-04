import { expect, it } from 'vitest'
import { diffRows } from '../../../src/renderer/agent/diff-view'

it('derives color-independent line labels and old/new line numbers from hunks', () => {
  expect(diffRows({
    oldStart: 2, oldLines: 2, newStart: 2, newLines: 2,
    lines: [' context', '-before', '+after'],
  })).toEqual([
    { kind: 'context', prefix: ' ', text: 'context', oldLine: 2, newLine: 2 },
    { kind: 'removed', prefix: '−', text: 'before', oldLine: 3, newLine: null },
    { kind: 'added', prefix: '+', text: 'after', oldLine: null, newLine: 3 },
  ])
})

it('ignores no-newline patch metadata without shifting line numbers', () => {
  expect(diffRows({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '\\ No newline at end of file', '+b'] })).toEqual([
    { kind: 'removed', prefix: '−', text: 'a', oldLine: 1, newLine: null },
    { kind: 'added', prefix: '+', text: 'b', oldLine: null, newLine: 1 },
  ])
})


it('localizes color-independent line semantics', async () => {
  const { setLocale, msg } = await import('../../../src/shared/i18n')
  setLocale('en')
  expect([msg('diff.line.added'), msg('diff.line.removed'), msg('diff.line.context')]).toEqual(['Added', 'Removed', 'Context'])
  setLocale('zh-CN')
  expect([msg('diff.line.added'), msg('diff.line.removed'), msg('diff.line.context')]).toEqual(['新增', '删除', '上下文'])
})
