import { beforeAll, describe, expect, it } from 'vitest'
const { buildForTests } = require('../../../scripts/build-for-tests.js')
import { Script } from 'node:vm'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parserAuditViolations,
  type ModuleAudit,
} from '../../../electron.vite.config'

const projectRoot = resolve(import.meta.dirname, '../../..')
let mainAudit: ModuleAudit
let preloadAudit: ModuleAudit
let rendererAudit: ModuleAudit
let mermaidSandboxHTML: string
let rendererHTML: string

function readAudit(target: string): ModuleAudit {
  return JSON.parse(readFileSync(resolve(projectRoot, 'dist', target, 'module-audit.json'), 'utf8')) as ModuleAudit
}

function validMainAudit(): ModuleAudit {
  const source = 'src/main/documents/image-paths.ts'
  const module = {
    resolvedId: 'node_modules/mdast-util-from-markdown/index.js',
    displayId: 'mdast-util-from-markdown/index.js',
    external: false,
    staticImporters: [source],
    dynamicImporters: [],
    roots: [{ importerId: source, displayId: source, kind: 'static' as const }],
  }
  return { target: 'main', modules: [module], entries: [{ name: 'index', modules: [module] }] }
}

beforeAll(() => {
  buildForTests(projectRoot)
  mainAudit = readAudit('main')
  preloadAudit = readAudit('preload')
  rendererAudit = readAudit('renderer')
  mermaidSandboxHTML = readFileSync(resolve(projectRoot, 'dist/renderer/mermaid-sandbox.html'), 'utf8')
  rendererHTML = readFileSync(resolve(projectRoot, 'dist/renderer/index.html'), 'utf8')
}, 30_000)

describe('Packaged Mermaid sandbox', () => {
  it('inlines its complete runtime because an opaque file sandbox cannot load app.asar scripts', () => {
    expect(mermaidSandboxHTML).not.toMatch(/<script\b[^>]*\bsrc=/i)
    expect(mermaidSandboxHTML).not.toMatch(/<link\b[^>]*\brel=["']modulepreload["']/i)
    expect(mermaidSandboxHTML).toContain('mermaidAPI')
    expect(mermaidSandboxHTML).toMatch(/type\s*:\s*["']ready["']/)
    expect(mermaidSandboxHTML).toMatch(/type\s*:\s*["']result["']/)
    const runtime = mermaidSandboxHTML.match(/<script>([\s\S]*)<\/script>/)?.[1]
    expect(runtime).toBeDefined()
    expect(runtime?.toLowerCase()).not.toContain('</script')
    expect(() => new Script(runtime)).not.toThrow()
    const hash = createHash('sha256').update(runtime!).digest('base64')
    expect(rendererHTML).toContain(`script-src 'self' 'sha256-${hash}'`)
    expect(rendererHTML).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  })
})

describe('Markdown parser bundle placement', () => {
  it('records unique physical parser modules and complete edge provenance', () => {
    expect(parserAuditViolations({ main: mainAudit, preload: preloadAudit, renderer: rendererAudit })).toEqual([])
    expect(mainAudit.entries.map((entry) => entry.name)).toEqual(['index'])
    expect(mainAudit.modules.length).toBeGreaterThan(1)
    expect(mainAudit.modules.some((module) => module.displayId === 'mdast-util-from-markdown/index.js')).toBe(true)
    expect(mainAudit.modules.every((module) => !module.external)).toBe(true)
    expect(mainAudit.modules.every((module) => module.roots.length > 0 && module.roots.every(
      (root) => root.importerId === 'src/main/documents/image-paths.ts' && root.kind === 'static',
    ))).toBe(true)
  })

  it('audits the complete parser family without relying on a module count', () => {
    expect(preloadAudit).toEqual({ target: 'preload', modules: [], entries: [{ name: 'index', modules: [] }] })
    expect(rendererAudit.entries.map((entry) => entry.name).sort()).toEqual(['index', 'mermaid-sandbox'])
    expect(rendererAudit.entries.find((entry) => entry.name === 'mermaid-sandbox')?.modules).toEqual([])
    expect(rendererAudit.entries.find((entry) => entry.name === 'index')?.modules).toEqual(rendererAudit.modules)
    expect(rendererAudit.modules.some((module) => module.displayId.startsWith('mdast-util-from-markdown/'))).toBe(true)
    expect(rendererAudit.modules.some((module) => module.displayId.startsWith('micromark'))).toBe(true)
    expect(new Set(rendererAudit.modules.map((module) => module.resolvedId)).size).toBe(rendererAudit.modules.length)
    const approvedRendererRoots = /^(?:remark-(?:parse|gfm|math)|mdast-util-(?:gfm-autolink-literal|gfm-footnote|to-markdown))\//
    expect(rendererAudit.modules.every((module) => module.roots.every(
      (root) => approvedRendererRoots.test(root.displayId),
    ))).toBe(true)
    expect(rendererAudit.modules.flatMap((module) => module.roots).every(
      (root) => root.kind === 'static' || root.kind === 'dynamic',
    )).toBe(true)
  })

  it('rejects a forbidden dynamic source edge even beside an allowed duplicate package copy', () => {
    const allowed = {
      resolvedId: 'node_modules/mdast-util-from-markdown/index.js',
      displayId: 'mdast-util-from-markdown/index.js',
      external: false,
      staticImporters: ['node_modules/remark-parse/lib/index.js'],
      dynamicImporters: [],
      roots: [{
        importerId: 'node_modules/remark-parse/lib/index.js',
        displayId: 'remark-parse/lib/index.js',
        kind: 'static' as const,
      }],
    }
    const forbidden = {
      ...allowed,
      resolvedId: 'node_modules/example/node_modules/mdast-util-from-markdown/index.js',
      staticImporters: [],
      dynamicImporters: ['src/renderer/main.ts'],
      roots: [{ importerId: 'src/renderer/main.ts', displayId: 'src/renderer/main.ts', kind: 'dynamic' as const }],
    }
    const renderer: ModuleAudit = {
      target: 'renderer',
      modules: [allowed, forbidden],
      entries: [
        { name: 'index', modules: [allowed, forbidden] },
        { name: 'mermaid-sandbox', modules: [] },
      ],
    }
    const emptyPreload: ModuleAudit = {
      target: 'preload', modules: [], entries: [{ name: 'index', modules: [] }],
    }

    expect(parserAuditViolations({ main: validMainAudit(), preload: emptyPreload, renderer }))
      .toContain('renderer parser root src/renderer/main.ts uses forbidden dynamic edge')
  })
})
