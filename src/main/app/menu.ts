import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { basename } from 'node:path'
import { t, type Locale } from '../../shared/i18n'
import { IpcEventSchemas } from '../../shared/contracts'

export interface ApplicationMenuDeps {
  locale(): Locale
  platform: NodeJS.Platform
  isPackaged: boolean
  updatesConfigured: boolean
  getFocusedWindow(): BrowserWindow | null
  getAllWindows(): BrowserWindow[]
  recentWorkspaces(): string[]
  openWorkspace(): void
  openRecentWorkspace(path: string): void
  clearRecentWorkspaces(): void
  setAsDefaultApp(): void
  openBundledDocument(fileName: string): void
  openCheatsheet(language: 'zh' | 'en'): void
  checkForUpdates(manual: boolean): void
  downloadUpdate(): void
  latestVersion(): string | null
  currentTheme(): string
}

interface BuiltApplicationMenu {
  menu: Menu
  updateThemeChecks(theme: string): void
}

function sendToFocused(deps: ApplicationMenuDeps, channel: keyof typeof IpcEventSchemas, ...args: unknown[]): void {
  const parsed = IpcEventSchemas[channel].safeParse(args)
  if (!parsed.success) return
  const win = deps.getFocusedWindow() ?? deps.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, ...parsed.data)
}

export function buildApplicationMenu(deps: ApplicationMenuDeps): BuiltApplicationMenu {
  const locale = deps.locale()
  const isMac = deps.platform === 'darwin'
  const labels = {
    file: t(locale, 'menu.file'), edit: t(locale, 'menu.edit'), view: t(locale, 'menu.view'), theme: t(locale, 'menu.theme'), help: t(locale, 'menu.help'),
    openFolder: t(locale, 'menu.openFolder'), save: t(locale, 'menu.save'), saveAs: t(locale, 'menu.saveAs'),
    recentWorkspace: t(locale, 'menu.openRecentWorkspace'), clearRecentWorkspaces: t(locale, 'menu.clearRecentWorkspaces'),
    exportPDF: t(locale, 'menu.exportPDF'), exportHTML: t(locale, 'menu.exportHTML'), find: t(locale, 'menu.find'),
    setDefault: t(locale, 'menu.setDefault'), insertFormula: t(locale, 'menu.insertFormula'), filePanel: t(locale, 'menu.filePanel'), sourceMode: t(locale, 'menu.sourceMode'),
    light: t(locale, 'theme.light'), dark: t(locale, 'theme.dark'), elegant: t(locale, 'theme.elegant'),
    sepia: t(locale, 'theme.sepia'), notion: t(locale, 'theme.notion'), bear: t(locale, 'theme.bear'), writer: t(locale, 'theme.writer'),
    solarizedDark: t(locale, 'theme.solarizedDark'), nord: t(locale, 'theme.nord'), gruvbox: t(locale, 'theme.gruvbox'), dracula: t(locale, 'theme.dracula'), midnight: t(locale, 'theme.midnight'),
    welcomeGuide: t(locale, 'menu.welcomeGuide'), exportDiagnostics: t(locale, 'menu.exportDiagnostics'), whatsNew: t(locale, 'menu.whatsNew'), cheatsheet: t(locale, 'menu.cheatsheet'), about: t(locale, 'menu.about'), checkForUpdates: t(locale, deps.updatesConfigured ? 'menu.checkForUpdates' : 'menu.updatesUnavailable'), close: t(locale, 'menu.closeWindow'),
    undo: t(locale, 'menu.undo'), redo: t(locale, 'menu.redo'), cut: t(locale, 'menu.cut'), copy: t(locale, 'menu.copy'), paste: t(locale, 'menu.paste'), selectAll: t(locale, 'menu.selectAll'),
    actualSize: t(locale, 'menu.actualSize'), zoomIn: t(locale, 'menu.zoomIn'), zoomOut: t(locale, 'menu.zoomOut'), fullscreen: t(locale, 'menu.fullscreen'),
    fontSettings: t(locale, 'menu.fontSettings'), focusDock: t(locale, 'menu.focusDock'), modelSettings: t(locale, 'menu.modelSettings'), hide: t(locale, 'menu.hide'), hideOthers: t(locale, 'menu.hideOthers'), showAll: t(locale, 'menu.showAll'), quit: t(locale, 'menu.quit'),
  }
  const themeItems: Array<[string, string]> = [
    [labels.light, 'light'], [labels.elegant, 'elegant'], [labels.notion, 'notion'], [labels.writer, 'writer'],
    [labels.bear, 'bear'], [labels.sepia, 'sepia'], [labels.dark, 'dark'], [labels.gruvbox, 'gruvbox'],
    [labels.midnight, 'midnight'], [labels.solarizedDark, 'solarized-dark'], [labels.nord, 'nord'], [labels.dracula, 'dracula'],
  ]
  const themeSubmenu: MenuItemConstructorOptions[] = []
  themeItems.forEach(([label, theme], index) => {
    if (index === 6) themeSubmenu.push({ type: 'separator' })
    themeSubmenu.push({
      label, id: `theme-${theme}`, type: 'checkbox', checked: deps.currentTheme() === theme,
      click: () => sendToFocused(deps, 'set-theme', theme),
    })
  })
  const recentWorkspaces = deps.recentWorkspaces()
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: t(locale, 'app.name'), submenu: [
      { label: labels.about, role: 'about' },
      { label: labels.modelSettings, click: () => sendToFocused(deps, 'open-provider-settings') },
      { type: 'separator' }, { label: labels.hide, role: 'hide' },
      { label: labels.hideOthers, role: 'hideOthers' }, { label: labels.showAll, role: 'unhide' },
      { type: 'separator' }, { label: labels.quit, role: 'quit' },
    ] } satisfies MenuItemConstructorOptions] : []),
    { label: labels.file, submenu: [
      { label: labels.openFolder, accelerator: 'CmdOrCtrl+O', click: deps.openWorkspace },
      { label: labels.recentWorkspace, submenu: recentWorkspaces.map((path, index) => ({
        label: `${index + 1}. ${basename(path)}`, click: () => deps.openRecentWorkspace(path),
      })) },
      { label: labels.clearRecentWorkspaces, click: deps.clearRecentWorkspaces }, { type: 'separator' },
      { label: labels.save, accelerator: 'CmdOrCtrl+S', click: () => sendToFocused(deps, 'menu-save') },
      { label: labels.saveAs, accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToFocused(deps, 'menu-save-as') },
      { type: 'separator' },
      { label: labels.exportPDF, click: () => sendToFocused(deps, 'menu-export-pdf') },
      { label: labels.exportHTML, click: () => sendToFocused(deps, 'menu-export-html') },
      { type: 'separator' }, { label: labels.setDefault, click: deps.setAsDefaultApp }, { type: 'separator' },
      isMac ? { label: labels.close, role: 'close' } : { label: labels.quit, role: 'quit' },
    ] },
    { label: labels.edit, submenu: [
      { label: labels.undo, role: 'undo' }, { label: labels.redo, role: 'redo' }, { type: 'separator' },
      { label: labels.cut, role: 'cut' }, { label: labels.copy, role: 'copy' }, { label: labels.paste, role: 'paste' },
      { label: labels.selectAll, role: 'selectAll' }, { type: 'separator' },
      { label: labels.find, accelerator: 'CmdOrCtrl+F', click: () => sendToFocused(deps, 'editor:search') },
      { label: labels.insertFormula, accelerator: 'CmdOrCtrl+Shift+E', click: () => sendToFocused(deps, 'editor:math') },
    ] },
    { label: labels.view, submenu: [
      { label: labels.actualSize, role: 'resetZoom' }, { label: labels.zoomIn, role: 'zoomIn' }, { label: labels.zoomOut, role: 'zoomOut' },
      { type: 'separator' }, { label: labels.filePanel, accelerator: 'CmdOrCtrl+Shift+B', click: () => sendToFocused(deps, 'toggle-file-panel') },
      { label: labels.sourceMode, accelerator: 'CmdOrCtrl+/', click: () => sendToFocused(deps, 'toggle-source-mode') },
      { type: 'separator' }, { label: labels.focusDock, accelerator: 'CmdOrCtrl+J', click: () => sendToFocused(deps, 'focus-agent-dock') },
      { label: labels.fontSettings, click: () => sendToFocused(deps, 'open-font-settings') },
      { type: 'separator' }, { label: labels.fullscreen, role: 'togglefullscreen' },
    ] },
    { label: labels.theme, submenu: themeSubmenu },
    { label: labels.help, submenu: [
      { id: 'welcome-guide', label: labels.welcomeGuide, click: () => sendToFocused(deps, 'open-onboarding') },
      { id: 'export-diagnostics', label: labels.exportDiagnostics, click: () => sendToFocused(deps, 'open-diagnostics') },
      { label: labels.whatsNew, accelerator: 'CmdOrCtrl+Shift+D', click: () => deps.openBundledDocument('changelog.md') },
      { label: labels.cheatsheet, accelerator: 'CmdOrCtrl+Shift+/', click: () => deps.openCheatsheet(locale === 'zh-CN' ? 'zh' : 'en') },
      { label: labels.checkForUpdates, enabled: deps.isPackaged && deps.updatesConfigured, click: () => deps.checkForUpdates(true) },
      ...(deps.updatesConfigured && deps.latestVersion() ? [{ label: t(locale, 'menu.updateAvailable', { version: deps.latestVersion()! }), click: deps.downloadUpdate }] : []),
      { type: 'separator' }, { label: labels.about, role: 'about' },
    ] },
  ]
  const menu = Menu.buildFromTemplate(template)
  return {
    menu,
    updateThemeChecks(theme) {
      for (const [, id] of themeItems) {
        const item = menu.getMenuItemById(`theme-${id}`)
        if (item) item.checked = id === theme
      }
    },
  }
}
