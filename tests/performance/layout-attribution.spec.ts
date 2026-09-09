import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDraftMD } from '../helpers/electron-app'

// Diagnostic controls, not replacements for the normal performance gate.
for (const surface of ['application', 'bare'] as const) {
  for (const input of ['synthetic', 'keyboard'] as const) {
    test(`attributes large document layout (${surface}, ${input})`, async () => {
      test.skip(process.env.DRAFTMD_LAYOUT_ATTRIBUTION !== '1', 'Cloud-only attribution')
      test.setTimeout(120_000)
      const directory = await mkdtemp(join(tmpdir(), 'draftmd-layout-'))
      const report: Record<string, unknown> = { surface, input }
      let app: Awaited<ReturnType<typeof launchDraftMD>> | undefined
      try {
        await promisify(execFile)(process.execPath, ['scripts/generate-performance-fixtures.mjs', '--output', directory])
        const path = join(directory, 'large.md')
        app = await launchDraftMD({ documentPath: path, locale: 'en' })
        const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'large.md')
        const original = await readFile(path, 'utf8')
        if (surface === 'bare') {
          await page.evaluate(() => {
            const source = document.querySelector<HTMLTextAreaElement>('#source-editor')!
            const style = getComputedStyle(source)
            const bounds = source.getBoundingClientRect()
            const replacement = document.createElement('textarea')
            replacement.id = 'diagnostic-source'
            replacement.spellcheck = false
            replacement.value = source.value
            for (const name of ['font-family', 'font-size', 'line-height', 'padding', 'box-sizing', 'tab-size', 'white-space', 'overflow-wrap']) {
              replacement.style.setProperty(name, style.getPropertyValue(name))
            }
            Object.assign(replacement.style, { position: 'fixed', left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` })
            document.querySelectorAll('style, link[rel="stylesheet"]').forEach(element => element.remove())
            document.body.replaceChildren(replacement)
          })
        }
        const source = page.locator(surface === 'bare' ? '#diagnostic-source' : '#source-editor')
        await expect(source).toBeVisible()
        report.open = await page.evaluate(() => ({
          dom: document.querySelectorAll('*').length,
          visualNodes: document.querySelector('#editor .ProseMirror')?.querySelectorAll('*').length ?? 0,
          visualCharacters: document.querySelector('#editor .ProseMirror')?.textContent?.length ?? 0,
          visualDisplay: document.querySelector('#editor') ? getComputedStyle(document.querySelector('#editor')!).display : null,
        }))
        // Focus and initial layout settle before the measured edit, equally in both controls.
        await source.evaluate((element: HTMLTextAreaElement) => {
          element.focus()
          element.setSelectionRange(element.value.length, element.value.length)
        })
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        const cdp = await page.context().newCDPSession(page)
        report.domBefore = await cdp.send('Memory.getDOMCounters')
        await page.evaluate(() => {
          const tasks: Array<{ start: number; duration: number }> = []
          const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))))
          observer.observe({ type: 'longtask' })
          Object.assign(window, { __layoutDiagnostic: { tasks, observer } })
          performance.mark('diagnostic-edit-start')
        })
        const started = performance.now()
        if (input === 'keyboard') await page.keyboard.insertText(' DRAFTMD_LAYOUT_EDIT')
        else await source.evaluate((element: HTMLTextAreaElement) => {
          element.setRangeText(' DRAFTMD_LAYOUT_EDIT', element.value.length, element.value.length, 'end')
          element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' DRAFTMD_LAYOUT_EDIT' }))
        })
        report.inputMs = performance.now() - started
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { performance.mark('diagnostic-edit-rendered'); resolve() }))))
        report.renderedMs = performance.now() - started
        if (surface === 'application') {
          await page.evaluate(() => performance.mark('diagnostic-save-start'))
          await page.keyboard.press('ControlOrMeta+s')
          await expect.poll(() => readFile(path, 'utf8')).toBe(original + ' DRAFTMD_LAYOUT_EDIT')
        }
        await page.waitForTimeout(800)
        report.observation = await page.evaluate(() => {
          const state = (window as any).__layoutDiagnostic
          state.tasks.push(...state.observer.takeRecords().map((entry: PerformanceEntry) => ({ start: entry.startTime, duration: entry.duration })))
          state.observer.disconnect()
          return { tasks: state.tasks, marks: performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('diagnostic-')).map(entry => ({ name: entry.name, start: entry.startTime })) }
        })
        report.domAfter = await cdp.send('Memory.getDOMCounters')
        // Aggregate UA-shadow ownership outside the measured interval. Never persist text.
        const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: false, includePaintOrder: false })
        report.subtrees = snapshot.documents.map(document => {
          const { nodes } = document
          const groups: Record<string, { nodes: number; layouts: number }> = {}
          const owners: string[] = []
          const layouts = new Set(document.layout.nodeIndex)
          for (let i = 0; i < nodes.nodeName.length; i++) {
            const attributes = nodes.attributes?.[i] ?? []
            let id = ''
            for (let j = 0; j < attributes.length; j += 2) if (snapshot.strings[attributes[j]] === 'id') id = snapshot.strings[attributes[j + 1]]
            const own = ['source-editor', 'diagnostic-source', 'editor', 'file-panel', 'agent-dock'].includes(id)
            const owner = own ? id : owners[nodes.parentIndex[i]] ?? 'other'
            owners.push(owner)
            const group = groups[owner] ??= { nodes: 0, layouts: 0 }
            group.nodes++
            if (layouts.has(i)) group.layouts++
          }
          return groups
        })
        await cdp.detach()
      } catch (error) {
        report.error = String(error)
        throw error
      } finally {
        await mkdir('artifacts/performance', { recursive: true })
        await writeFile(`artifacts/performance/attribution-${surface}-${input}.json`, JSON.stringify(report, null, 2))
        console.log('Layout attribution:', JSON.stringify(report))
        await app?.cleanup()
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
}
