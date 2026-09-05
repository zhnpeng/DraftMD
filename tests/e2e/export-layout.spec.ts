import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildHTMLDocument } from '../../src/main/export/html'
import { exportPDF } from '../../src/main/export/pdf'
import { launchDraftMD } from '../helpers/electron-app'

test('HTML and PDF use the full document width without sidebar space', async () => {
  const app = await launchDraftMD({
    locale: 'en', documentName: 'export.md',
    prepare: directory => writeFile(join(directory, 'export.md'), '# Exported document\n\nDocument body.\n'),
  })
  try {
    const page = await app.windowMatching(async p => await p.locator('#file-title').textContent().catch(() => '') === 'export.md')
    const snapshot = await page.evaluate(() => ({
      content: '# Exported document', html: document.querySelector('#editor .ProseMirror')!.innerHTML,
      styles: Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText)).join('\n'),
      bodyClass: document.body.className, background: 'white',
    }))
    let printCss = ''
    await exportPDF({ webContents: {
      executeJavaScript: async () => 'white',
      insertCSS: async (css: string) => { printCss = css; return 'print' },
      printToPDF: async () => new Uint8Array(), removeInsertedCSS: async () => {},
    } } as never, '/unused.pdf', { writeFile: async () => {} })
    for (const expanded of [true, false]) {
      for (const format of ['html', 'pdf']) {
        const bodyClass = `${expanded ? 'agent-dock-expanded' : ''} show-file-panel`
        const exported = format === 'html'
          ? buildHTMLDocument({ ...snapshot, bodyClass }, { title: 'Export', locale: 'en' })
          : `<html><head><style>${snapshot.styles}\n${printCss}</style></head><body class="${bodyClass}"><div id="editor"><div class="ProseMirror">${snapshot.html}</div></div></body></html>`
        await page.setContent(exported)
        const bounds = await page.evaluate(() => ({
          padding: getComputedStyle(document.body).paddingRight,
          width: document.documentElement.clientWidth,
          editor: document.querySelector('#editor')!.getBoundingClientRect().toJSON(),
        }))
        expect(bounds.padding, `${format}, expanded=${expanded}`).toBe('0px')
        expect(bounds.editor.x).toBe(0)
        expect(bounds.editor.width).toBe(bounds.width)
      }
    }
  } finally { await app.cleanup() }
})
