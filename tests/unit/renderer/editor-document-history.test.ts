import { expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { history, undo } from '@milkdown/kit/prose/history'
import { replaceEditorStateDocument } from '../../../src/renderer/editor/document-replacement'

const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
const doc = (text: string) => schema.node('doc', null, text ? [schema.text(text)] : [])

it('resets prior-document history while keeping new-document user edits undoable', () => {
  let state = EditorState.create({ schema, doc: doc('A'), plugins: [history()] })
  state = state.apply(state.tr.insertText(' edited', state.doc.content.size))
  state = replaceEditorStateDocument(state, doc('B'))

  expect(undo(state)).toBe(false)
  expect(state.doc.textContent).toBe('B')

  state = state.apply(state.tr.insertText(' user edit', state.doc.content.size))
  expect(undo(state, (transaction) => { state = state.apply(transaction) })).toBe(true)
  expect(state.doc.textContent).toBe('B')
})

const richSchema = new Schema({ nodes: {
  doc: { content: 'block+' },
  heading: { group: 'block', content: 'text*', attrs: { level: { default: 1 } } },
  paragraph: { group: 'block', content: 'text*' },
  text: {},
} })
const richDoc = (body: string) => richSchema.node('doc', null, [
  richSchema.node('heading', { level: 1 }, richSchema.text('Product')),
  richSchema.node('paragraph', null, richSchema.text(body)),
])

it('preserves a cursor through unique text anchors when replacing the same document', () => {
  const before = richDoc('alpha target omega')
  const targetPosition = 1 + 'Product'.length + 2 + 'alpha '.length
  let state = EditorState.create({ schema: richSchema, doc: before, selection: TextSelection.create(before, targetPosition) })
  const after = richDoc('intro alpha target omega')
  state = replaceEditorStateDocument(state, after, { preserveSelection: true })
  expect(state.doc.textBetween(state.selection.from, state.selection.from + 6)).toBe('target')
})

it('falls back to the same heading when selection anchors disappear', () => {
  const before = richDoc('old paragraph')
  let state = EditorState.create({ schema: richSchema, doc: before, selection: TextSelection.create(before, before.content.size - 2) })
  const after = richDoc('entirely replaced')
  state = replaceEditorStateDocument(state, after, { preserveSelection: true })
  expect(state.selection.from).toBeGreaterThan(0)
  expect(state.doc.resolve(state.selection.from).parent.type.name).toBe('paragraph')
})
