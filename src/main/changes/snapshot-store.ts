import { createHash } from 'node:crypto'
import { mkdir, opendir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface SnapshotWorkspace {
  id: string
  name: string
  canonicalPath: string
}

export interface SnapshotFileMetadata {
  baseline?: string
  final?: string
  baselineVersion?: string
  finalVersion?: string
}

export interface SnapshotMetadata {
  taskId: string
  workspaceId: string
  workspaceRoot: string
  createdAt: string
  finalizedAt?: string
  files: Record<string, SnapshotFileMetadata>
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function logicalPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function isWithin(root: string, path: string): boolean {
  const inside = relative(root, path)
  return inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
}

async function markdownFiles(root: string, excludedRoot?: string): Promise<string[]> {
  const files: string[] = []
  const directories = [root]
  while (directories.length) {
    const directory = directories.pop()!
    const entries = []
    for await (const entry of await opendir(directory)) entries.push(entry)
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      if (excludedRoot && isWithin(excludedRoot, path)) continue
      if (entry.isDirectory()) directories.push(path)
      else if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name)) files.push(path)
    }
  }
  return files.sort()
}

export class SnapshotStore {
  constructor(readonly snapshotsRoot: string) {}

  taskRoot(workspaceId: string, taskId: string): string {
    return join(this.snapshotsRoot, workspaceId, taskId)
  }

  async captureBaseline(taskId: string, workspace: SnapshotWorkspace): Promise<SnapshotMetadata> {
    const taskRoot = this.taskRoot(workspace.id, taskId)
    await mkdir(join(taskRoot, 'baseline'), { recursive: true, mode: 0o700 })
    const metadata: SnapshotMetadata = {
      taskId, workspaceId: workspace.id, workspaceRoot: workspace.canonicalPath,
      createdAt: new Date().toISOString(), files: {},
    }
    for (const path of await markdownFiles(workspace.canonicalPath, resolve(this.snapshotsRoot))) {
      const relativePath = logicalPath(workspace.canonicalPath, path)
      const bytes = await readFile(path)
      const blob = `baseline/${hash(Buffer.from(`baseline\0${relativePath}`))}.md`
      await writeFile(join(taskRoot, blob), bytes, { mode: 0o600 })
      metadata.files[relativePath] = { baseline: blob, baselineVersion: hash(bytes) }
    }
    await this.writeMetadata(metadata)
    return metadata
  }

  async captureFinal(taskId: string): Promise<SnapshotMetadata> {
    const metadata = await this.readMetadata(taskId)
    const taskRoot = this.taskRoot(metadata.workspaceId, taskId)
    await mkdir(join(taskRoot, 'final'), { recursive: true, mode: 0o700 })
    for (const path of await markdownFiles(metadata.workspaceRoot, resolve(this.snapshotsRoot))) {
      const relativePath = logicalPath(metadata.workspaceRoot, path)
      const bytes = await readFile(path)
      const blob = `final/${hash(Buffer.from(`final\0${relativePath}`))}.md`
      await writeFile(join(taskRoot, blob), bytes, { mode: 0o600 })
      const file = metadata.files[relativePath] ?? {}
      file.final = blob
      file.finalVersion = hash(bytes)
      metadata.files[relativePath] = file
    }
    metadata.finalizedAt = new Date().toISOString()
    await this.writeMetadata(metadata)
    return metadata
  }

  async readMetadata(taskId: string, workspaceId?: string): Promise<SnapshotMetadata> {
    if (workspaceId) {
      return JSON.parse(await readFile(join(this.taskRoot(workspaceId, taskId), 'metadata.json'), 'utf8')) as SnapshotMetadata
    }
    for await (const workspace of await opendir(this.snapshotsRoot)) {
      if (!workspace.isDirectory()) continue
      try {
        return await this.readMetadata(taskId, workspace.name)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    throw Object.assign(new Error('Snapshot not found'), { code: 'ENOENT' })
  }

  async readBlob(metadata: SnapshotMetadata, blob: string | undefined): Promise<Buffer | null> {
    return blob ? readFile(join(this.taskRoot(metadata.workspaceId, metadata.taskId), blob)) : null
  }

  async writeMetadata(metadata: SnapshotMetadata): Promise<void> {
    const root = this.taskRoot(metadata.workspaceId, metadata.taskId)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const path = join(root, 'metadata.json')
    const temporary = join(root, '.metadata.json.draftmd-tmp')
    await writeFile(temporary, JSON.stringify(metadata, null, 2), { mode: 0o600 })
    await rename(temporary, path)
  }

  async cleanup(referencedTaskIds: Set<string>, olderThan: Date): Promise<void> {
    try {
      for await (const workspace of await opendir(this.snapshotsRoot)) {
        if (!workspace.isDirectory()) continue
        const workspaceRoot = join(this.snapshotsRoot, workspace.name)
        for await (const task of await opendir(workspaceRoot)) {
          if (!task.isDirectory() || referencedTaskIds.has(task.name)) continue
          const path = join(workspaceRoot, task.name)
          if ((await stat(path)).mtime < olderThan) await import('node:fs/promises').then(({ rm }) => rm(path, { recursive: true, force: true }))
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
