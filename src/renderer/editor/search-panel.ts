import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { getEditorView, searchPluginKey } from './editor'
import { getActiveSourceSurface, type SourceSurface } from './source-surface'
import { msg } from '../../shared/i18n'
import { isPrimaryModifier } from '../../shared/platform'

export class SearchPanel {
  private container: HTMLDivElement
  private input: HTMLInputElement
  private countEl: HTMLSpanElement
  private matches: { from: number; to: number }[] = []
  private currentIndex = -1
  private visible = false
  private readonly documentKeydown = (e: KeyboardEvent): void => {
    if (isPrimaryModifier(e, document.documentElement.dataset.platform ?? 'darwin') && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      this.show()
      return
    }
    if (this.visible && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.hide()
    }
  }

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'search-panel'
    this.container.style.display = 'none'

    this.input = document.createElement('input')
    this.input.type = 'text'
    this.input.placeholder = msg('search.placeholder')
    this.input.className = 'search-input'

    this.countEl = document.createElement('span')
    this.countEl.className = 'search-count'

    const prevBtn = this.btn('\u2039', 'search-btn', msg('search.previous'), () => this.prev())
    const nextBtn = this.btn('\u203A', 'search-btn', msg('search.next'), () => this.next())
    const closeBtn = this.btn('\u00D7', 'search-btn search-close', msg('search.close'), () => this.hide())

    this.container.append(this.input, this.countEl, prevBtn, nextBtn, closeBtn)

    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) this.prev()
        else this.next()
      }
    })

    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.hide()
      } else {
        e.stopPropagation()
      }
    })

    document.addEventListener('keydown', this.documentKeydown, true)

    document.body.appendChild(this.container)
  }

  dispose(): void {
    this.visible = false
    this.clearDecorations()
    document.removeEventListener('keydown', this.documentKeydown, true)
    this.container.remove()
  }

  show(): void {
    this.container.style.display = 'flex'
    this.visible = true
    this.input.focus()
    this.input.select()
    if (this.input.value) this.search()
  }

  hide(): void {
    this.container.style.display = 'none'
    this.visible = false
    this.clearDecorations()
    this.matches = []
    this.currentIndex = -1
    this.countEl.textContent = ''
    const sourceEditor = this.getSourceEditor()
    if (sourceEditor) {
      sourceEditor.focus()
      return
    }
    const view = getEditorView()
    if (view) view.focus()
  }

  private btn(text: string, className: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text
    button.className = className
    button.title = label
    button.setAttribute('aria-label', label)
    button.addEventListener('click', onClick)
    return button
  }

  private search(): void {
    const query = this.input.value
    const sourceEditor = this.getSourceEditor()
    if (sourceEditor) {
      this.searchSourceEditor(query, sourceEditor)
      return
    }

    const view = getEditorView()
    if (!view) return

    this.matches = []
    this.currentIndex = -1

    if (!query) {
      this.clearDecorations()
      this.updateCount()
      return
    }

    const lowerQuery = query.toLowerCase()
    view.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      const text = node.text.toLowerCase()
      let idx = 0
      while ((idx = text.indexOf(lowerQuery, idx)) !== -1) {
        this.matches.push({ from: pos + idx, to: pos + idx + query.length })
        idx += 1
      }
    })

    if (this.matches.length > 0) {
      this.currentIndex = 0
      this.highlight(view)
      this.scrollToCurrent(view)
    } else {
      this.clearDecorations()
    }
    this.updateCount()
  }

  private getSourceEditor(): SourceSurface | null {
    const active = getActiveSourceSurface()
    if (active) return active
    const sourceEditor = document.getElementById('source-editor') as HTMLTextAreaElement | null
    if (!sourceEditor?.classList.contains('visible')) return null
    return { content: () => sourceEditor.value, selection: () => ({ anchor: sourceEditor.selectionStart, head: sourceEditor.selectionEnd }), select: (a, h) => sourceEditor.setSelectionRange(a, h), replaceSelection: text => { sourceEditor.setRangeText(text); sourceEditor.dispatchEvent(new Event('input', { bubbles: true })) }, focus: () => sourceEditor.focus() }
  }

  private searchSourceEditor(query: string, sourceEditor: SourceSurface): void {
    this.clearDecorations()
    this.matches = []
    this.currentIndex = -1

    if (!query) {
      this.updateCount()
      return
    }

    const lowerQuery = query.toLowerCase()
    const text = sourceEditor.content().toLowerCase()
    let idx = 0
    while ((idx = text.indexOf(lowerQuery, idx)) !== -1) {
      this.matches.push({ from: idx, to: idx + query.length })
      idx += 1
    }

    if (this.matches.length > 0) {
      this.currentIndex = 0
      this.selectSourceMatch(sourceEditor)
    }
    this.updateCount()
  }

  private highlight(view: NonNullable<ReturnType<typeof getEditorView>>): void {
    const decorations = this.matches.map((match, index) => {
      const className = index === this.currentIndex ? 'search-match-current' : 'search-match'
      return Decoration.inline(match.from, match.to, { class: className })
    })
    view.dispatch(view.state.tr.setMeta(searchPluginKey, DecorationSet.create(view.state.doc, decorations)))
  }

  private clearDecorations(): void {
    const view = getEditorView()
    if (!view) return
    view.dispatch(view.state.tr.setMeta(searchPluginKey, DecorationSet.empty))
  }

  private scrollToCurrent(view: NonNullable<ReturnType<typeof getEditorView>>): void {
    if (this.currentIndex < 0 || this.currentIndex >= this.matches.length) return
    const match = this.matches[this.currentIndex]
    const coords = view.coordsAtPos(match.from)
    const editorEl = document.getElementById('editor')
    if (!editorEl) return

    const rect = editorEl.getBoundingClientRect()
    const targetTop = editorEl.scrollTop + coords.top - rect.top - rect.height / 3
    editorEl.scrollTo({ top: targetTop, behavior: 'smooth' })
  }

  private next(): void {
    if (this.matches.length === 0) return
    this.currentIndex = (this.currentIndex + 1) % this.matches.length
    const sourceEditor = this.getSourceEditor()
    if (sourceEditor) {
      this.selectSourceMatch(sourceEditor)
      this.updateCount()
      return
    }

    const view = getEditorView()
    if (view) {
      this.highlight(view)
      this.scrollToCurrent(view)
    }
    this.updateCount()
  }

  private prev(): void {
    if (this.matches.length === 0) return
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length
    const sourceEditor = this.getSourceEditor()
    if (sourceEditor) {
      this.selectSourceMatch(sourceEditor)
      this.updateCount()
      return
    }

    const view = getEditorView()
    if (view) {
      this.highlight(view)
      this.scrollToCurrent(view)
    }
    this.updateCount()
  }

  private updateCount(): void {
    if (this.matches.length === 0) {
      this.countEl.textContent = this.input.value ? '0/0' : ''
    } else {
      this.countEl.textContent = `${this.currentIndex + 1}/${this.matches.length}`
    }
  }

  private selectSourceMatch(sourceEditor: SourceSurface): void {
    if (this.currentIndex < 0 || this.currentIndex >= this.matches.length) return
    const match = this.matches[this.currentIndex]
    sourceEditor.focus()
    sourceEditor.select(match.from, match.to)
    this.input.focus()
  }
}
