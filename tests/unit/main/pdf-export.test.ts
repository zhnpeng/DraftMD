import { describe, expect, it, vi } from 'vitest'
import { exportPDF } from '../../../src/main/export/pdf'

describe('PDF export document isolation', () => {
  it('hides all application chrome before printing the rendered document', async () => {
    let printCss = ''
    const win = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue('rgb(255, 255, 255)'),
        insertCSS: vi.fn(async (css: string) => { printCss = css; return 'css-key' }),
        printToPDF: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        removeInsertedCSS: vi.fn().mockResolvedValue(undefined),
      },
    }

    await expect(exportPDF(win as never, '/tmp/out.pdf', { writeFile: vi.fn() })).resolves.toBe(true)

    for (const selector of ['#titlebar', '#file-panel', '#source-editor', '#update-banner', '#agent-dock']) {
      expect(printCss).toMatch(new RegExp(`${selector.replace('#', '\\#')}[^}]*display: none`))
    }
    expect(printCss).toMatch(/#editor\s*\{[^}]*margin-left:\s*0\s*!important/)
    expect(printCss).toMatch(/#editor\s*\{[^}]*padding:\s*20mm\s*!important/)
    expect(win.webContents.printToPDF).toHaveBeenCalledOnce()
  })
})
