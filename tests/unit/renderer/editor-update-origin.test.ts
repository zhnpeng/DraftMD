import { expect, it } from 'vitest'
import { createEditorUpdateOriginTracker } from '../../../src/renderer/editor/update-origin'

it('keeps internal normalization in a programmatic batch until delayed serialization consumes it', () => {
  const tracker = createEditorUpdateOriginTracker()
  tracker.recordTransaction({ explicitOrigin: 'programmatic', addToHistory: true })
  tracker.recordTransaction({ explicitOrigin: null, addToHistory: false })
  expect(tracker.consumeSerializedOrigin()).toBe('programmatic')
  expect(tracker.consumeSerializedOrigin()).toBe('user')
})

it('lets a real user edit win after programmatic normalization in either transaction order', () => {
  const first = createEditorUpdateOriginTracker()
  first.recordTransaction({ explicitOrigin: 'programmatic', addToHistory: true })
  first.recordTransaction({ explicitOrigin: null, addToHistory: false })
  first.recordTransaction({ explicitOrigin: null, addToHistory: true })
  expect(first.consumeSerializedOrigin()).toBe('user')

  const second = createEditorUpdateOriginTracker()
  second.recordTransaction({ explicitOrigin: null, addToHistory: true })
  second.recordTransaction({ explicitOrigin: 'programmatic', addToHistory: true })
  second.recordTransaction({ explicitOrigin: null, addToHistory: false })
  expect(second.consumeSerializedOrigin()).toBe('user')
})

it('keeps trackers isolated across editor instances and delayed callbacks', () => {
  const oldEditor = createEditorUpdateOriginTracker()
  const newEditor = createEditorUpdateOriginTracker()
  oldEditor.recordTransaction({ explicitOrigin: 'programmatic', addToHistory: true })
  newEditor.recordTransaction({ explicitOrigin: null, addToHistory: true })

  expect(oldEditor.consumeSerializedOrigin()).toBe('programmatic')
  expect(newEditor.consumeSerializedOrigin()).toBe('user')
})

it('tracks a real plugin batch with tagged replace, untagged normalization, and delayed serialization', async () => {
  const { Schema } = await import('@milkdown/kit/prose/model')
  const { EditorState, Plugin } = await import('@milkdown/kit/prose/state')
  const { EDITOR_UPDATE_ORIGIN_META } = await import('../../../src/renderer/editor/update-origin')
  const tracker = createEditorUpdateOriginTracker()
  const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
  let appended = false
  const originPlugin = new Plugin({
    state: {
      init: () => null,
      apply(transaction, value) {
        if (transaction.docChanged) {
          const explicit = transaction.getMeta(EDITOR_UPDATE_ORIGIN_META)
          tracker.recordTransaction({
            explicitOrigin: explicit === 'programmatic' || explicit === 'user' ? explicit : null,
            addToHistory: transaction.getMeta('addToHistory') !== false,
          })
        }
        return value
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (appended || !transactions.some((transaction) => transaction.getMeta(EDITOR_UPDATE_ORIGIN_META) === 'programmatic')) return null
      appended = true
      return newState.tr.insertText('!', newState.doc.content.size).setMeta('addToHistory', false)
    },
  })
  let state = EditorState.create({ schema, plugins: [originPlugin] })
  const replace = state.tr.insertText('programmatic', 0)
    .setMeta(EDITOR_UPDATE_ORIGIN_META, 'programmatic')
  state = state.applyTransaction(replace).state
  expect(state.doc.textContent).toBe('programmatic!')

  const delayedProgrammaticOrigin = await new Promise<'programmatic' | 'user'>((resolve) => {
    setTimeout(() => resolve(tracker.consumeSerializedOrigin()), 1)
  })
  expect(delayedProgrammaticOrigin).toBe('programmatic')

  state = state.apply(state.tr.insertText(' user', state.doc.content.size))
  const delayedUserOrigin = await new Promise<'programmatic' | 'user'>((resolve) => {
    setTimeout(() => resolve(tracker.consumeSerializedOrigin()), 1)
  })
  expect(delayedUserOrigin).toBe('user')
})

it('separates immediate transaction origin from aggregate batch origin in both orders', () => {
  const userThenLoad = createEditorUpdateOriginTracker()
  expect(userThenLoad.recordTransaction({ explicitOrigin: null, addToHistory: true })).toBe('user')
  expect(userThenLoad.recordTransaction({ explicitOrigin: 'programmatic', addToHistory: true })).toBe('programmatic')
  expect(userThenLoad.consumeSerializedOrigin()).toBe('user')

  const loadThenUser = createEditorUpdateOriginTracker()
  expect(loadThenUser.recordTransaction({ explicitOrigin: 'programmatic', addToHistory: true })).toBe('programmatic')
  expect(loadThenUser.recordTransaction({ explicitOrigin: null, addToHistory: true })).toBe('user')
  expect(loadThenUser.consumeSerializedOrigin()).toBe('user')
})

it('reports internal normalization immediately without dirtying while preserving programmatic batch origin', () => {
  const tracker = createEditorUpdateOriginTracker()
  expect(tracker.recordTransaction({ explicitOrigin: 'programmatic', addToHistory: true })).toBe('programmatic')
  expect(tracker.recordTransaction({ explicitOrigin: null, addToHistory: false })).toBe('internal')
  expect(tracker.consumeSerializedOrigin()).toBe('programmatic')
})
