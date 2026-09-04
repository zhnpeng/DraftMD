const themes = {
  light: 'theme-light',
  dark: 'theme-dark',
  elegant: 'theme-elegant',
  sepia: 'theme-sepia',
  notion: 'theme-notion',
  bear: 'theme-bear',
  writer: 'theme-writer',
  'solarized-dark': 'theme-solarized-dark',
  nord: 'theme-nord',
  gruvbox: 'theme-gruvbox',
  dracula: 'theme-dracula',
  midnight: 'theme-midnight'
} as const

type Theme = keyof typeof themes

function isTheme(name: string): name is Theme {
  return Object.hasOwn(themes, name)
}

export function applyTheme(name: string): void {
  const body = document.body
  Object.values(themes).forEach(cls => body.classList.remove(cls))
  body.classList.remove('theme-custom')

  const theme: Theme = isTheme(name) ? name : 'elegant'
  body.classList.add(themes[theme])
  localStorage.setItem('colamd-theme', theme)
  window.draftmd?.reportTheme?.(theme)
}

export function loadSavedTheme(): string {
  const saved = localStorage.getItem('colamd-theme')
  return saved && isTheme(saved) ? saved : 'elegant'
}
