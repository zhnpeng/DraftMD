import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { buildSync } from 'esbuild'
import type { ModuleInfo, Plugin } from 'vite'
import type { PluginContext } from 'rollup'

const projectRoot = __dirname.replaceAll('\\', '/')
const requireFromProject = createRequire(resolve(__dirname, 'package.json'))
const PARSER_MODULE = /(?:^|\/)(?:mdast-util-from-markdown|micromark(?:-[^/]*)?)(?:\/|$)/
const APPROVED_RENDERER_ROOT = /^(?:remark-(?:parse|gfm|math)|mdast-util-(?:gfm-autolink-literal|gfm-footnote|to-markdown))\//

export type AuditEdge = {
  importerId: string
  displayId: string
  kind: 'static' | 'dynamic'
}

export type AuditModule = {
  resolvedId: string
  displayId: string
  external: boolean
  staticImporters: string[]
  dynamicImporters: string[]
  roots: AuditEdge[]
}

export type AuditEntry = { name: string; modules: AuditModule[] }
export type ModuleAudit = { target: string; modules: AuditModule[]; entries: AuditEntry[] }

type AuditSet = { main: ModuleAudit; preload: ModuleAudit; renderer: ModuleAudit }

function normalizedId(id: string): string {
  return id.split('?')[0].replaceAll('\\', '/')
}

function resolvedModuleId(id: string, external: boolean): string {
  let physical = normalizedId(id)
  if (external && !physical.startsWith('/') && !physical.match(/^[A-Za-z]:\//)) {
    try { physical = normalizedId(requireFromProject.resolve(physical)) } catch { /* keep unresolved external ID */ }
  }
  if (physical.startsWith(`${projectRoot}/`)) return physical.slice(projectRoot.length + 1)
  return physical
}

function displayModuleId(id: string): string {
  const physical = normalizedId(id)
  const dependency = physical.lastIndexOf('/node_modules/')
  return dependency < 0 ? physical : physical.slice(dependency + '/node_modules/'.length)
}

function isParserModule(id: string): boolean {
  return PARSER_MODULE.test(displayModuleId(id))
}

function importerIds(info: ModuleInfo, kind: 'static' | 'dynamic'): string[] {
  return kind === 'static' ? info.importers : info.dynamicImporters
}

function mergedValues<T>(left: T[], right: T[], key: (value: T) => string): T[] {
  return [...new Map([...left, ...right].map((value) => [key(value), value])).values()]
}

function mergeAuditModule(existing: AuditModule | undefined, next: AuditModule): AuditModule {
  if (!existing) return next
  return {
    ...next,
    external: existing.external && next.external,
    staticImporters: mergedValues(existing.staticImporters, next.staticImporters, String).sort(),
    dynamicImporters: mergedValues(existing.dynamicImporters, next.dynamicImporters, String).sort(),
    roots: mergedValues(existing.roots, next.roots, (edge) => `${edge.importerId}\0${edge.kind}`)
      .sort((a, b) => a.importerId.localeCompare(b.importerId) || a.kind.localeCompare(b.kind)),
  }
}

function parserRoots(context: PluginContext, id: string): AuditEdge[] {
  const roots = new Map<string, AuditEdge>()
  const visited = new Set<string>()
  const visit = (moduleId: string) => {
    if (visited.has(moduleId)) return
    visited.add(moduleId)
    const info = context.getModuleInfo(moduleId) as ModuleInfo | null
    if (!info) return
    for (const kind of ['static', 'dynamic'] as const) {
      for (const importer of importerIds(info, kind)) {
        const importerInfo = context.getModuleInfo(importer) as ModuleInfo | null
        if (isParserModule(importer)) visit(importer)
        else {
          const edge = {
            importerId: resolvedModuleId(importer, importerInfo?.isExternal ?? false),
            displayId: displayModuleId(importer),
            kind,
          }
          roots.set(`${edge.importerId}\0${kind}`, edge)
        }
      }
    }
  }
  visit(id)
  return [...roots.values()].sort((a, b) => a.importerId.localeCompare(b.importerId) || a.kind.localeCompare(b.kind))
}

function moduleAudit(target: string): Plugin {
  return {
    name: `draftmd-${target}-module-audit`,
    generateBundle(_options, bundle) {
      const collect = (id: string, modules: Map<string, AuditModule>, visited: Set<string>) => {
        if (visited.has(id)) return
        visited.add(id)
        const info = this.getModuleInfo(id)
        if (!info) return
        if (isParserModule(id)) {
          const resolvedId = resolvedModuleId(id, info.isExternal)
          const auditModule = {
            resolvedId,
            displayId: displayModuleId(id),
            external: info.isExternal,
            staticImporters: info.importers.map((importer) => resolvedModuleId(
              importer,
              this.getModuleInfo(importer)?.isExternal ?? false,
            )).sort(),
            dynamicImporters: info.dynamicImporters.map((importer) => resolvedModuleId(
              importer,
              this.getModuleInfo(importer)?.isExternal ?? false,
            )).sort(),
            roots: parserRoots(this, id),
          }
          modules.set(resolvedId, mergeAuditModule(modules.get(resolvedId), auditModule))
        }
        for (const imported of [...info.importedIds, ...info.dynamicallyImportedIds]) {
          collect(imported, modules, visited)
        }
      }

      const entries = Object.values(bundle)
        .filter((output) => output.type === 'chunk' && output.isEntry && output.facadeModuleId)
        .map((output) => {
          const modules = new Map<string, AuditModule>()
          collect(output.facadeModuleId!, modules, new Set())
          return { name: output.name, modules: [...modules.values()].sort((a, b) => a.resolvedId.localeCompare(b.resolvedId)) }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      const modules = new Map<string, AuditModule>()
      for (const module of entries.flatMap((entry) => entry.modules)) {
        modules.set(module.resolvedId, mergeAuditModule(modules.get(module.resolvedId), module))
      }
      this.emitFile({
        type: 'asset',
        fileName: 'module-audit.json',
        source: `${JSON.stringify({ target, modules: [...modules.values()], entries }, null, 2)}\n`,
      })
    },
  }
}

export function parserAuditViolations(audits: AuditSet): string[] {
  const violations: string[] = []
  const expectedMainSource = 'src/main/documents/image-paths.ts'
  if (!audits.main.modules.some((module) => module.displayId === 'mdast-util-from-markdown/index.js')) {
    violations.push('main must contain the Markdown parser entry')
  }
  for (const module of audits.main.modules) {
    if (module.external) violations.push(`main parser ${module.displayId} must be bundled`)
    if (!module.roots.length) violations.push(`main parser ${module.displayId} has no provenance root`)
    for (const root of module.roots) {
      if (root.importerId !== expectedMainSource || root.kind !== 'static') {
        violations.push(`main parser root ${root.importerId} uses forbidden ${root.kind} edge`)
      }
    }
  }
  if (audits.preload.modules.length) violations.push('preload must not contain parser modules')

  const rendererEntries = new Map(audits.renderer.entries.map((entry) => [entry.name, entry]))
  if ((rendererEntries.get('mermaid-sandbox')?.modules.length ?? -1) !== 0) {
    violations.push('mermaid-sandbox must not contain parser modules')
  }
  for (const module of audits.renderer.modules) {
    for (const importer of [...module.staticImporters, ...module.dynamicImporters]) {
      if (/^(?:src\/|.*\/src\/)(?:main|preload|renderer)\//.test(importer)) {
        violations.push(`renderer parser ${module.displayId} has forbidden direct source importer ${importer}`)
      }
    }
    if (!module.roots.length) violations.push(`renderer parser ${module.displayId} has no provenance root`)
    for (const root of module.roots) {
      if (!APPROVED_RENDERER_ROOT.test(root.displayId)) {
        violations.push(`renderer parser root ${root.displayId} uses forbidden ${root.kind} edge`)
      }
    }
  }
  return violations
}

export function inlineMermaidSandboxHTML(html: string, runtime: string): string {
  if (runtime.includes('</script')) throw new Error('Mermaid sandbox runtime contains a closing script tag')
  const withoutExternalScripts = html
    .replace(/\s*<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/gi, '')
    .replace(/\s*<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi, '')
  if (withoutExternalScripts === html) throw new Error('Mermaid sandbox HTML has no generated external runtime')
  return withoutExternalScripts.replace('</body>', () => `    <script>${runtime}</script>\n  </body>`)
}

function inlineMermaidSandbox(): Plugin {
  let runtime: string | null = null
  const getRuntime = () => runtime ??= buildSync({
    entryPoints: [resolve(__dirname, 'src/renderer/sandbox/mermaid-sandbox.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
  }).outputFiles[0].text
  return {
    name: 'draftmd-inline-mermaid-sandbox',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const filename = context.filename.replaceAll('\\', '/')
        const sandboxRuntime = getRuntime()
        if (filename.endsWith('/mermaid-sandbox.html')) {
          return inlineMermaidSandboxHTML(html, sandboxRuntime)
        }
        if (!filename.endsWith('/index.html')) return html
        const hash = createHash('sha256').update(sandboxRuntime).digest('base64')
        return html.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`)
      },
    },
  }
}

function safeLodashRoot(): Plugin {
  const target = resolve(__dirname, 'node_modules/lodash-es/_root.js').replaceAll('\\', '/')
  return {
    name: 'draftmd-safe-lodash-root',
    enforce: 'pre',
    transform(_code, id) {
      const normalized = id.split('?')[0].replaceAll('\\', '/')
      return normalized === target ? { code: 'export default globalThis', map: null } : null
    },
  }
}

export default defineConfig({
  main: {
    plugins: [moduleAudit('main')],
    build: {
      outDir: 'dist/main',
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron', 'better-sqlite3', '@napi-rs/keyring'],
        input: resolve(__dirname, 'src/main/index.ts'),
        output: { chunkFileNames: 'chunks/[name].js' }
      }
    }
  },
  preload: {
    plugins: [moduleAudit('preload')],
    build: {
      outDir: 'dist/preload',
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    plugins: [safeLodashRoot(), inlineMermaidSandbox(), moduleAudit('renderer')],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'mermaid-sandbox': resolve(__dirname, 'src/renderer/mermaid-sandbox.html')
        }
      }
    }
  }
})
