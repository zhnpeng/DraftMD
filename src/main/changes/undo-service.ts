import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { merge } from 'node-diff3'
import { fileVersion } from '../workspace/file-version'
import { resolveMarkdownPath, createWorkspaceRoot } from '../workspace/path-guard'
import { SnapshotStore, type SnapshotFileMetadata, type SnapshotMetadata, type SnapshotWorkspace } from './snapshot-store'

export interface UndoConflict {
  path: string
  base: string
  taskFinal: string
  current: string
}
export type UndoResult =
  | { status: 'undone'; files: string[] }
  | { status: 'conflict'; files: UndoConflict[] }

async function existingBytes(path: string): Promise<Buffer | null> {
  try { return await readFile(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function atomicWrite(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.undo.draftmd-tmp`
  await writeFile(temporary, bytes, { mode: 0o600 })
  await rename(temporary, path)
}

export function createUndoService(snapshotsRoot: string) {
  const snapshots = new SnapshotStore(snapshotsRoot)
  return {
    async undo(workspace: SnapshotWorkspace, taskId: string): Promise<UndoResult> {
      const metadata = await snapshots.readMetadata(taskId, workspace.id)
      const root = await createWorkspaceRoot(workspace.canonicalPath)
      const conflicts: UndoConflict[] = []
      const operations: Array<() => Promise<void>> = []
      const files: string[] = []
      const entries = Object.entries(metadata.files)
      const contentMap = new Map<string, string[]>()
      for (const [path, file] of entries) {
        if (file.finalVersion && !file.baselineVersion) {
          const paths = contentMap.get(file.finalVersion) ?? []
          paths.push(path)
          contentMap.set(file.finalVersion, paths)
        }
      }
      const renamedTargets = new Set<string>()

      for (const [path, file] of entries) {
        const baseline = await snapshots.readBlob(metadata, file.baseline)
        const final = await snapshots.readBlob(metadata, file.final)
        if (baseline && !final && file.baselineVersion) {
          const target = (contentMap.get(file.baselineVersion) ?? []).find((candidate) => !renamedTargets.has(candidate))
          if (target) {
            renamedTargets.add(target)
            const currentTarget = await existingBytes((await resolveMarkdownPath(root, target, 'existing')).absolutePath)
            const currentSource = await existingBytes((await resolveMarkdownPath(root, path, 'new')).absolutePath)
            if (currentTarget?.equals(baseline) && currentSource === null) {
              operations.push(async () => {
                const source = (await resolveMarkdownPath(root, target, 'existing')).absolutePath
                const destination = (await resolveMarkdownPath(root, path, 'new')).absolutePath
                await mkdir(dirname(destination), { recursive: true })
                await rename(source, destination)
              })
              files.push(target)
            } else {
              conflicts.push({ path: target, base: baseline.toString('utf8'), taskFinal: baseline.toString('utf8'), current: currentTarget?.toString('utf8') ?? '' })
            }
            continue
          }
        }
        if (!baseline && final && !renamedTargets.has(path)) {
          const absolute = (await resolveMarkdownPath(root, path, 'existing')).absolutePath
          const current = await existingBytes(absolute)
          if (current?.equals(final)) {
            operations.push(() => unlink(absolute))
            files.push(path)
          } else {
            conflicts.push({ path, base: '', taskFinal: final.toString('utf8'), current: current?.toString('utf8') ?? '' })
          }
          continue
        }
        if (baseline && final) {
          const absolute = (await resolveMarkdownPath(root, path, 'existing')).absolutePath
          const current = await existingBytes(absolute)
          if (!current) {
            conflicts.push({ path, base: baseline.toString('utf8'), taskFinal: final.toString('utf8'), current: '' })
          } else if (current.equals(final)) {
            operations.push(() => atomicWrite(absolute, baseline))
            files.push(path)
          } else {
            const merged = merge(
              baseline.toString('utf8'),
              final.toString('utf8'),
              current.toString('utf8'),
            )
            if (merged.conflict) {
              conflicts.push({ path, base: baseline.toString('utf8'), taskFinal: final.toString('utf8'), current: current.toString('utf8') })
            } else {
              const content = Buffer.from(merged.result.join('\n'), 'utf8')
              operations.push(() => atomicWrite(absolute, content))
              files.push(path)
            }
          }
          continue
        }
        if (baseline && !final) {
          const absolute = (await resolveMarkdownPath(root, path, 'new')).absolutePath
          const current = await existingBytes(absolute)
          if (current === null) {
            operations.push(() => atomicWrite(absolute, baseline))
            files.push(path)
          } else {
            conflicts.push({ path, base: baseline.toString('utf8'), taskFinal: '', current: current.toString('utf8') })
          }
        }
      }

      if (conflicts.length) return { status: 'conflict', files: conflicts }
      for (const operation of operations) await operation()
      return { status: 'undone', files: files.sort() }
    },
  }
}
