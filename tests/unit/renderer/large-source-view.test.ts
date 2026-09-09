import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'

describe('large source text model', () => {
  it('preserves exact line endings and UTF-16 offsets', () => {
    const content = '# CRLF\r\n\r\n文档 🙂\r\n'
    const state = EditorState.create({ doc: content, extensions: [EditorState.lineSeparator.of('\r\n')] })
    expect(state.sliceDoc()).toBe(content)
    expect(state.doc.length).toBe(content.replaceAll('\r\n', '\n').length)
  })
})
