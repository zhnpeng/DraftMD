import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { internalToSourceOffset, sourceToInternalOffset } from '../../../src/renderer/editor/large-source-view'

describe('large source text model', () => {
  it('preserves exact line endings and UTF-16 offsets', () => {
    const content = '# CRLF\r\n\r\n文档 🙂\r\n'
    const state = EditorState.create({ doc: content, extensions: [EditorState.lineSeparator.of('\r\n')] })
    expect(state.sliceDoc()).toBe(content)
    expect(state.doc.length).toBe(content.replaceAll('\r\n', '\n').length)
    for (const internal of [0, 6, 7, 8, state.doc.length]) {
      const source = internalToSourceOffset(state, internal)
      expect(sourceToInternalOffset(state, source)).toBe(internal)
    }
    expect(internalToSourceOffset(state, state.doc.line(3).from)).toBe(content.indexOf('文档'))
  })
})
