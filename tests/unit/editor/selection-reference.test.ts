import { describe, expect, it } from 'vitest'
import {
  captureSourceSelection,
  captureVisualSelection,
  headingPathAtOffset,
} from '../../../src/renderer/editor/selection-reference'

const base = { workspaceId: 'a'.repeat(64), path: 'docs/spec.md', version: 'b'.repeat(64) }

it('captures exact source Markdown with CJK headings and 200-character anchors', () => {
  const before = 'x'.repeat(250)
  const content = `# 产品\n\n${before}目标文本 after\n`
  const start = content.indexOf('目标文本')
  const result = captureSourceSelection({ ...base, content, start, end: start + 4 })
  expect(result).toMatchObject({
    ...base, headingPath: ['产品'], selectedText: '目标文本', sourceMode: true,
    beforeAnchor: 'x'.repeat(200), afterAnchor: ' after\n',
  })
})

it('computes nested heading paths at a source offset', () => {
  const content = '# Product\n## Errors\n### Timeout\nbody\n## Other\n'
  expect(headingPathAtOffset(content, content.indexOf('body'))).toEqual(['Product', 'Errors', 'Timeout'])
  expect(headingPathAtOffset(content, content.indexOf('Other'))).toEqual(['Product', 'Other'])
})

it('returns null for empty selection and rejects selections above 20KiB', () => {
  expect(captureSourceSelection({ ...base, content: 'text', start: 2, end: 2 })).toBeNull()
  expect(() => captureSourceSelection({ ...base, content: 'x'.repeat(20 * 1024 + 1), start: 0, end: 20 * 1024 + 1 })).toThrowError(expect.objectContaining({ code: 'SELECTION_TOO_LARGE' }))
})

it('anchors duplicate selected text to its exact occurrence', () => {
  const content = '# A\nbefore target after\n# B\nother target ending\n'
  const start = content.lastIndexOf('target')
  expect(captureSourceSelection({ ...base, content, start, end: start + 6 })).toMatchObject({
    headingPath: ['B'], beforeAnchor: '# A\nbefore target after\n# B\nother ', afterAnchor: ' ending\n',
  })
})


it('uses the visual heading path to disambiguate repeated text', () => {
  const markdown = '# Alpha\n\nshared target text\n\n# Beta\n\nshared target text\n'
  expect(captureVisualSelection({
    ...base, markdown, selectedText: 'shared target text', headingPath: ['Beta'],
  })).toMatchObject({
    headingPath: ['Beta'], selectedText: 'shared target text', sourceMode: false,
    beforeAnchor: '# Alpha\n\nshared target text\n\n# Beta\n\n', afterAnchor: '\n',
  })
})

it('returns null when visual text remains ambiguous within one heading', () => {
  const markdown = '# Alpha\n\ntarget and target\n'
  expect(captureVisualSelection({
    ...base, markdown, selectedText: 'target', headingPath: ['Alpha'],
  })).toBeNull()
})

import { Schema } from '@milkdown/kit/prose/model'
import { captureVisualEditorSelection } from '../../../src/renderer/editor/selection-reference'

it('serializes a visual selection with Markdown marks and derives headings from the document tree', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
      text: { group: 'inline' },
    },
    marks: { strong: {} },
  })
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 1 }, schema.text('Product')),
    schema.node('heading', { level: 2 }, schema.text('Errors')),
    schema.node('paragraph', null, [schema.text('before '), schema.text('target', [schema.mark('strong')]), schema.text(' after')]),
  ])
  let from = -1
  doc.descendants((node, position) => {
    if (node.isText && node.text === 'target') from = position
  })
  const result = captureVisualEditorSelection({
    doc, from, to: from + 'target'.length,
    serialize: (selectedDoc) => {
      let text = ''
      selectedDoc.descendants((node) => {
        if (node.isText) text += node.marks.some((mark) => mark.type.name === 'strong') ? `**${node.text}**` : node.text
      })
      return `${text}\n`
    },
  })
  expect(result).toEqual({ selectedText: '**target**', headingPath: ['Product', 'Errors'] })
})

import { mapTextRange } from '../../../src/renderer/editor/selection-reference'

it('maps a source range through unique surrounding anchors', () => {
  expect(mapTextRange('alpha target omega', 'intro alpha target omega', 6, 12)).toEqual({ start: 12, end: 18 })
})

it('clamps a source range when its anchors no longer exist', () => {
  expect(mapTextRange('long old content', 'short', 10, 15)).toEqual({ start: 5, end: 5 })
})
