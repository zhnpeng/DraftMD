import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { expect, test } from '@playwright/test'
import { findMatchingWindow, launchDraftMD } from '../helpers/electron-app'

for (const mode of ['transaction', 'keyboard'] as const) {
  test(`validates viewport source editing with the original fixture (${mode})`, async () => {
    test.skip(process.env.DRAFTMD_LAYOUT_ATTRIBUTION !== '1', 'Cloud-only editor proof')
    test.setTimeout(120_000)
    const root = await mkdtemp(join(tmpdir(), 'draftmd-virtual-proof-'))
    const report: Record<string, unknown> = { mode }
    let app: Awaited<ReturnType<typeof launchDraftMD>> | undefined
    try {
      await promisify(execFile)(process.execPath, ['scripts/generate-performance-fixtures.mjs', '--output', root])
      const content = await readFile(join(root, 'large.md'), 'utf8')
      await build({
        stdin: { contents: `
          import {EditorState} from '@codemirror/state';
          import {EditorView} from '@codemirror/view';
          const content = ${JSON.stringify(content)};
          const view = new EditorView({parent:document.querySelector('#surface'), state:EditorState.create({doc:content, extensions:[
            EditorView.lineWrapping,
            EditorView.theme({'&':{height:'100%'}, '.cm-scroller':{overflow:'auto',fontFamily:'monospace',fontSize:'14px',lineHeight:'1.7'}})
          ]})});
          window.proof = {
            insert: text => view.dispatch({changes:{from:view.state.selection.main.from,to:view.state.selection.main.to,insert:text},selection:{anchor:view.state.selection.main.from+text.length}}),
            end: () => {view.dispatch({selection:{anchor:view.state.doc.length},effects:EditorView.scrollIntoView(view.state.doc.length)});view.focus()},
            text: () => view.state.doc.toString(),
          };
        `, resolveDir: process.cwd(), loader: 'js' },
        bundle: true, format: 'iife', outfile: join(root, 'proof.js'), logLevel: 'silent',
      })
      await writeFile(join(root, 'proof.html'), '<title>Virtual source proof</title><style>html,body,#surface{height:100%;margin:0}body{width:600px}</style><div id="surface"></div><script src="./proof.js"></script>')
      app = await launchDraftMD({ locale: 'en' })
      await app.evaluate(async ({ BrowserWindow }, path) => {
        const win = new BrowserWindow({ width: 960, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
        await win.loadFile(path)
      }, join(root, 'proof.html'))
      const page = await findMatchingWindow(() => app!.windows(), async candidate => (await candidate.title()) === 'Virtual source proof')
      await page.evaluate(() => (window as any).proof.end())
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      report.domBefore = await page.locator('*').count()
      await page.evaluate(() => {
        const durations: number[] = []
        const observer = new PerformanceObserver(list => durations.push(...list.getEntries().map(entry => entry.duration)))
        observer.observe({ type: 'longtask' })
        Object.assign(window, { measurement: { durations, observer } })
      })
      const started = performance.now()
      if (mode === 'keyboard') await page.keyboard.insertText(' DRAFTMD_LARGE_EDIT_42')
      else await page.evaluate(() => (window as any).proof.insert(' DRAFTMD_LARGE_EDIT_42'))
      report.editMs = performance.now() - started
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      report.renderedMs = performance.now() - started
      expect(await page.evaluate(() => (window as any).proof.text())).toBe(content + ' DRAFTMD_LARGE_EDIT_42')
      await page.waitForTimeout(800)
      report.domAfter = await page.locator('*').count()
      report.longTasks = await page.evaluate(() => {
        const { durations, observer } = (window as any).measurement
        durations.push(...observer.takeRecords().map((entry: PerformanceEntry) => entry.duration))
        observer.disconnect()
        return durations
      })
      expect(report.domAfter).toBeLessThan(2000)
      expect(report.editMs).toBeLessThan(2000)
      expect(Math.max(0, ...(report.longTasks as number[]))).toBeLessThan(3000)
    } catch (error) {
      report.error = String(error)
      throw error
    } finally {
      await mkdir('artifacts/performance', { recursive: true })
      await writeFile(`artifacts/performance/virtual-proof-${mode}.json`, JSON.stringify(report, null, 2))
      console.log('Virtual source proof:', JSON.stringify(report))
      await app?.cleanup()
      await rm(root, { recursive: true, force: true })
    }
  })
}
