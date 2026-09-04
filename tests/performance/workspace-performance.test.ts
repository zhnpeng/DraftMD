import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWorkspaceRoot } from '../../src/main/workspace/path-guard'
import { createWorkspaceService } from '../../src/main/workspace/workspace-service'

const exec = promisify(execFile)
const output = join(tmpdir(), `draftmd-performance-${process.pid}`)
const resultPath = process.env.DRAFTMD_PERFORMANCE_OUTPUT ?? join(output, 'workspace-results.json')
let manifest: { files: number; largeBytes: number; workspaceSha256: string; largeSha256: string }

const p95 = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
async function timed<T>(operation: () => Promise<T>): Promise<{ durationMs: number; value: T }> {
  const started = performance.now()
  const value = await operation()
  return { durationMs: performance.now() - started, value }
}

beforeAll(async () => {
  await rm(output, { recursive: true, force: true })
  await exec(process.execPath, ['scripts/generate-performance-fixtures.mjs', '--output', output], { cwd: process.cwd() })
  manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
})
afterAll(() => rm(output, { recursive: true, force: true }))

describe('deterministic performance fixtures', () => {
  it('creates exactly 1,000 workspace Markdown files and one 5 MiB mixed document', async () => {
    expect(manifest.files).toBe(1_000)
    expect(manifest.largeBytes).toBe(5 * 1024 * 1024)
    expect((await stat(join(output, 'large.md'))).size).toBe(5 * 1024 * 1024)
    const large = await readFile(join(output, 'large.md'), 'utf8')
    expect(large).toContain('# Large DraftMD Fixture')
    expect(large).toContain('| Column A | Column B |')
    expect(large).toContain('```mermaid')
    expect(large).toContain('```typescript')
    expect(large).toContain('$$')
  })

  it('generates byte-identical manifests and content in a second directory', async () => {
    const second = await mkdtemp(join(tmpdir(), 'draftmd-performance-copy-'))
    try {
      await exec(process.execPath, ['scripts/generate-performance-fixtures.mjs', '--output', second], { cwd: process.cwd() })
      const other = JSON.parse(await readFile(join(second, 'manifest.json'), 'utf8'))
      expect(other).toEqual(manifest)
    } finally { await rm(second, { recursive: true, force: true }) }
  })
})

describe('workspace performance budgets', () => {
  it('lists and searches 1,000 Markdown files within machine-tolerant p95 budgets', async () => {
    const service = createWorkspaceService(await createWorkspaceRoot(join(output, 'workspace')))
    await service.list()
    await service.search('DRAFTMD_NEEDLE_0999', 10)
    const listRuns: number[] = []
    const searchRuns: number[] = []
    let listed = 0
    let matches = 0
    for (let index = 0; index < 3; index += 1) {
      const list = await timed(() => service.list())
      const search = await timed(() => service.search('DRAFTMD_NEEDLE_0999', 10))
      listRuns.push(list.durationMs); searchRuns.push(search.durationMs)
      listed = list.value.length; matches = search.value.length
    }
    const result = {
      fixture: { files: manifest.files, workspaceSha256: manifest.workspaceSha256 },
      runs: { listMs: listRuns, searchMs: searchRuns },
      p95: { listMs: p95(listRuns), searchMs: p95(searchRuns) },
      budgets: { listMs: 2_000, searchMs: 3_000 },
    }
    await mkdir(dirname(resultPath), { recursive: true })
    await import('node:fs/promises').then(({ writeFile }) => writeFile(resultPath, JSON.stringify(result, null, 2)))
    expect(listed).toBe(1_000)
    expect(matches).toBe(1)
    expect(result.p95.listMs).toBeLessThan(2_000)
    expect(result.p95.searchMs).toBeLessThan(3_000)
  })
})
