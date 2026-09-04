import type { SessionDTO } from '../../shared/contracts/session'
import { msg } from '../../shared/i18n'

export function renderSessionOptions(button: HTMLButtonElement, sessions: SessionDTO[], currentId: string | null): void {
  const current = sessions.find((session) => session.id === currentId)
  button.textContent = current?.title ?? msg('dock.newSession')
  button.title = current?.title ?? msg('dock.newSession')
}

export function renderSessionMenu(input: {
  container: HTMLElement
  sessions: SessionDTO[]
  currentId: string | null
  onNew(): void
  onSelect(id: string): void
  onRename(id: string, title: string): Promise<void>
  onDelete(id: string): void
}): void {
  input.container.replaceChildren()
  const newButton = document.createElement('button')
  newButton.type = 'button'
  newButton.className = 'agent-menu-primary'
  newButton.textContent = msg('dock.newSession')
  newButton.addEventListener('click', input.onNew)
  input.container.append(newButton)

  for (const session of input.sessions) {
    const row = document.createElement('div')
    row.className = 'agent-session-row'
    row.dataset.sessionRow = session.id
    const select = document.createElement('button')
    select.type = 'button'
    select.className = 'agent-session-select'
    select.textContent = session.title
    select.setAttribute('aria-current', session.id === input.currentId ? 'true' : 'false')
    select.addEventListener('click', () => input.onSelect(session.id))
    const rename = document.createElement('button')
    rename.type = 'button'
    rename.className = 'agent-session-action'
    rename.textContent = msg('dock.renameSession')
    rename.setAttribute('aria-label', msg('dock.renameSession'))
    rename.addEventListener('click', () => {
      const editor = document.createElement('form')
      editor.className = 'agent-session-rename'
      const field = document.createElement('input')
      field.type = 'text'
      field.maxLength = 512
      field.value = session.title
      field.setAttribute('aria-label', msg('dock.sessionTitle'))
      const save = document.createElement('button')
      save.type = 'submit'
      save.textContent = msg('common.save')
      editor.append(field, save)
      editor.addEventListener('submit', (event) => {
        event.preventDefault()
        const title = field.value.trim()
        if (title) void input.onRename(session.id, title)
      })
      row.replaceChildren(editor)
      field.focus()
      field.select()
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'agent-session-action danger'
    remove.textContent = msg('dock.deleteSession')
    remove.setAttribute('aria-label', msg('dock.deleteSession'))
    remove.addEventListener('click', () => input.onDelete(session.id))
    row.append(select, rename, remove)
    input.container.append(row)
  }
}
