import type { ChangeSet, FileChange } from '../../shared/contracts/changes'
import { createTextDiff } from './diff-service'
import { SnapshotStore, type SnapshotMetadata, type SnapshotWorkspace } from './snapshot-store'

function contentKey(bytes: Buffer | null): string | null {
  return bytes?.toString('base64') ?? null
}

export interface ChangeSetService {
  begin(taskId: string, workspace: SnapshotWorkspace): Promise<SnapshotMetadata>
  finalize(taskId: string): Promise<ChangeSet>
  readFinalized(taskId: string): Promise<ChangeSet>
}

export function createChangeSetService(snapshotsRoot: string): ChangeSetService {
  const snapshots = new SnapshotStore(snapshotsRoot)
  const materialize = async (metadata: SnapshotMetadata): Promise<ChangeSet> => {
      const changes: FileChange[] = []
      const baselineOnly: Array<{ path: string; bytes: Buffer }> = []
      const finalOnly: Array<{ path: string; bytes: Buffer }> = []

      for (const [path, file] of Object.entries(metadata.files)) {
        const baseline = await snapshots.readBlob(metadata, file.baseline)
        const final = await snapshots.readBlob(metadata, file.final)
        if (baseline && !final) baselineOnly.push({ path, bytes: baseline })
        else if (!baseline && final) finalOnly.push({ path, bytes: final })
        else if (baseline && final && !baseline.equals(final)) {
          const diff = createTextDiff(path, path, baseline.toString('utf8'), final.toString('utf8'))
          changes.push({
            kind: 'modified', path, oldVersion: file.baselineVersion ?? null,
            newVersion: file.finalVersion ?? null, ...diff,
          })
        }
      }

      const finalByContent = new Map<string, Array<{ path: string; bytes: Buffer }>>()
      for (const file of finalOnly) {
        const key = contentKey(file.bytes)!
        const entries = finalByContent.get(key) ?? []
        entries.push(file)
        finalByContent.set(key, entries)
      }
      const renamedFinal = new Set<string>()
      for (const before of baselineOnly) {
        const matches = finalByContent.get(contentKey(before.bytes)!) ?? []
        const after = matches.find((candidate) => !renamedFinal.has(candidate.path))
        if (!after) continue
        renamedFinal.add(after.path)
        const oldMetadata = metadata.files[before.path]
        const newMetadata = metadata.files[after.path]
        const diff = createTextDiff(before.path, after.path, before.bytes.toString('utf8'), after.bytes.toString('utf8'))
        changes.push({
          kind: 'renamed', oldPath: before.path, path: after.path,
          oldVersion: oldMetadata.baselineVersion ?? null, newVersion: newMetadata.finalVersion ?? null, ...diff,
        })
      }
      for (const before of baselineOnly) {
        if (changes.some((change) => change.kind === 'renamed' && change.oldPath === before.path)) continue
        const file = metadata.files[before.path]
        const diff = createTextDiff(before.path, before.path, before.bytes.toString('utf8'), '')
        changes.push({ kind: 'deleted', path: before.path, oldVersion: file.baselineVersion ?? null, newVersion: null, ...diff })
      }
      for (const after of finalOnly) {
        if (renamedFinal.has(after.path)) continue
        const file = metadata.files[after.path]
        const diff = createTextDiff(after.path, after.path, '', after.bytes.toString('utf8'))
        changes.push({ kind: 'created', path: after.path, oldVersion: null, newVersion: file.finalVersion ?? null, ...diff })
      }

      const rank: Record<FileChange['kind'], number> = { created: 0, deleted: 1, modified: 2, renamed: 3 }
      changes.sort((left, right) => rank[left.kind] - rank[right.kind] || left.path.localeCompare(right.path))
      return { taskId: metadata.taskId, workspaceId: metadata.workspaceId, changes }
  }
  return {
    begin: (taskId, workspace) => snapshots.captureBaseline(taskId, workspace),
    async finalize(taskId) { return materialize(await snapshots.captureFinal(taskId)) },
    async readFinalized(taskId) {
      const metadata = await snapshots.readMetadata(taskId)
      if (!metadata.finalizedAt) throw Object.assign(new Error('Task snapshots are not finalized'), { code: 'TASK_NOT_FINALIZED' })
      return materialize(metadata)
    },
  }
}
