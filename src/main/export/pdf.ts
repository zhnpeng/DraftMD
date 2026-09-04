import type { BrowserWindow } from 'electron'

export interface PdfExportDeps {
  writeFile(path: string, data: Uint8Array): Promise<unknown>
}

export async function exportPDF(win: BrowserWindow, path: string, deps: PdfExportDeps): Promise<boolean> {
  try {
    const background = await win.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor') as string
    const cssKey = await win.webContents.insertCSS(
      `@page { margin: 0; } html, body, #editor { height: auto !important; overflow: visible !important; background: ${background} !important; } #titlebar, #file-panel, #source-editor, #update-banner, #agent-dock { display: none !important; } #editor { margin-left: 0 !important; padding: 20mm !important; } #editor .ProseMirror { min-height: auto !important; }`,
    )
    try {
      const pdfData = await win.webContents.printToPDF({
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
        pageSize: 'A4',
      })
      await deps.writeFile(path, pdfData)
      return true
    } finally {
      await win.webContents.removeInsertedCSS(cssKey)
    }
  } catch {
    return false
  }
}
