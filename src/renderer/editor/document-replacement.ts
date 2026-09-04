import type { Node } from '@milkdown/kit/prose/model'
import type { EditorState } from '@milkdown/kit/prose/state'
import { EditorState as ProseEditorState, TextSelection } from '@milkdown/kit/prose/state'

interface SelectionAnchor {
  before: string
  after: string
  heading: { level: number; text: string } | null
  fallback: number
}

function captureAnchor(state: EditorState): SelectionAnchor {
  const position = state.selection.from
  const resolved = state.doc.resolve(position)
  const parentOffset = resolved.parentOffset
  const text = resolved.parent.textContent
  let heading: SelectionAnchor['heading'] = null
  state.doc.descendants((node, offset) => {
    if (offset >= position) return false
    if (node.type.name === 'heading') heading = { level: Number(node.attrs.level), text: node.textContent }
    return node.type.name !== 'heading'
  })
  return {
    before: text.slice(Math.max(0, parentOffset - 32), parentOffset),
    after: text.slice(parentOffset, parentOffset + 32),
    heading,
    fallback: position,
  }
}

function mappedPosition(doc: Node, anchor: SelectionAnchor): number {
  const matches: number[] = []
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true
    const needle = `${anchor.before}${anchor.after}`
    if (!needle) return true
    let offset = 0
    while (true) {
      const found = node.text.indexOf(needle, offset)
      if (found < 0) break
      matches.push(position + found + anchor.before.length)
      offset = found + Math.max(needle.length, 1)
    }
    return true
  })
  if (matches.length === 1) return matches[0]

  if (anchor.heading) {
    let matchedHeading = false
    let positionAfterHeading: number | null = null
    doc.descendants((node, position) => {
      if (node.type.name === 'heading') {
        matchedHeading = Number(node.attrs.level) === anchor.heading?.level && node.textContent === anchor.heading.text
        return false
      }
      if (matchedHeading && node.isTextblock) {
        positionAfterHeading = position + 1
        return false
      }
      return positionAfterHeading === null
    })
    if (positionAfterHeading !== null) return positionAfterHeading
  }
  return Math.max(0, Math.min(doc.content.size, anchor.fallback))
}

export function replaceEditorStateDocument(
  state: EditorState,
  doc: Node,
  options: { preserveSelection?: boolean } = {},
): EditorState {
  const position = options.preserveSelection ? mappedPosition(doc, captureAnchor(state)) : null
  return ProseEditorState.create({
    schema: state.schema,
    doc,
    selection: position === null ? undefined : TextSelection.near(doc.resolve(position)),
    storedMarks: null,
    plugins: state.plugins,
  })
}
