import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { LargeSourceSurface } from './source-surface'
import { mapTextRange } from './selection-reference'

export function createLargeSourceView(host: HTMLElement, content: string, onInput: () => void): LargeSourceSurface {
  const extensions = [
    history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': host.getAttribute('aria-label') ?? 'Markdown', spellcheck: 'false' }),
    EditorView.updateListener.of(update => { if (update.docChanged && update.transactions.some(transaction => transaction.isUserEvent('input') || transaction.isUserEvent('delete') || transaction.isUserEvent('undo') || transaction.isUserEvent('redo'))) onInput() }),
    EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--bg-color)', color: 'var(--text-color)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--editor-font, monospace)', fontSize: 'var(--editor-font-size, 14px)', lineHeight: '1.7' },
      '.cm-content': { padding: '24px 20px', caretColor: 'var(--text-color)' },
      '.cm-line': { padding: '0' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--search-match-current-bg)' },
      '.cm-cursor': { borderLeftColor: 'var(--text-color)' },
    }),
  ]
  const lineSeparator = (value: string) => value.includes('\r\n') ? '\r\n' : value.includes('\r') ? '\r' : '\n'
  const state = (value: string) => EditorState.create({ doc: value, extensions: [EditorState.lineSeparator.of(lineSeparator(value)), ...extensions] })
  const view = new EditorView({ parent: host, state: state(content) })
  return {
    content: () => view.state.sliceDoc(),
    selection: () => ({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }),
    select(anchor, head) {
      const clamp = (value: number) => Math.max(0, Math.min(view.state.doc.length, value))
      view.dispatch({ selection: EditorSelection.single(clamp(anchor), clamp(head)), effects: EditorView.scrollIntoView(clamp(head)) })
    },
    replaceSelection(text) {
      const { from, to } = view.state.selection.main
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, annotations: Transaction.userEvent.of('input') })
    },
    focus: () => view.focus(),
    setContent(content, preservePosition) {
      if (!preservePosition) { view.setState(state(content)); view.scrollDOM.scrollTop = 0; return }
      const before = view.state.sliceDoc()
      if (before === content) return
      const selected = view.state.selection.main
      const range = mapTextRange(before, content, selected.from, selected.to)
      const scrollTop = view.scrollDOM.scrollTop
      const anchor = view.lineBlockAtHeight(scrollTop)
      const scrollPosition = mapTextRange(before, content, anchor.from, anchor.from).start
      const scrollOffset = anchor.top - scrollTop
      const focused = view.hasFocus
      view.setState(state(content))
      view.dispatch({ selection: EditorSelection.single(selected.anchor > selected.head ? range.end : range.start, selected.anchor > selected.head ? range.start : range.end), effects: EditorView.scrollIntoView(scrollPosition, { y: 'start', yMargin: Math.max(0, Math.min(view.scrollDOM.clientHeight - 1, scrollOffset)) }) })
      if (focused) view.focus()
    },
    destroy: () => view.destroy(),
  }
}
