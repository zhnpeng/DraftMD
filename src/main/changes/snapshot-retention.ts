import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SafeLogInput } from '../../shared/contracts/diagnostics'
import type { DatabaseRecoveryWarning } from '../persistence/database'
import type { createTaskRepository } from '../persistence/task-repository'
import { SnapshotStore } from './snapshot-store'

interface SnapshotRetentionOptions {
  userDataPath: string
  tasks: Pick<ReturnType<typeof createTaskRepository>, 'listIds'>
  recovery: Promise<unknown>
  databaseWarning: DatabaseRecoveryWarning | null
  log(entry: SafeLogInput): void
  now?: Date
}

export async function cleanupSnapshotsAfterRecovery(options: SnapshotRetentionOptions): Promise<void> {
  const log = (code: string) => {
    try { options.log({ level: 'warn', module: 'snapshots', operation: 'cleanup', code }) }
    catch { /* Background maintenance must also tolerate unavailable diagnostic storage. */ }
  }
  try {
    await options.recovery
    // A rebuilt database cannot account for snapshots referenced by the quarantined original.
    if (options.databaseWarning || (await readdir(options.userDataPath)).some(name => /^draftmd\.corrupt\.\d+\.sqlite$/.test(name))) {
      log('SNAPSHOT_CLEANUP_SKIPPED_DATABASE')
      return
    }
    const referenced = new Set(options.tasks.listIds())
    const cutoff = new Date((options.now ?? new Date()).getTime() - 30 * 86_400_000)
    await new SnapshotStore(join(options.userDataPath, 'snapshots')).cleanup(referenced, cutoff)
  } catch {
    log('SNAPSHOT_CLEANUP_FAILED')
  }
}
