import type {
  BackupHydrationResult,
  SyncToSupabaseResult,
} from './backupDataService'

export interface DeferredHydrationDependencies {
  reconcilePendingLocalSave: () => Promise<SyncToSupabaseResult>
  hasPendingLocalSave: () => boolean
  requestRemoteRefresh: () => Promise<unknown>
}

/**
 * SYNC-08 completion boundary for a bootstrap read deferred by legitimate local work.
 * There is no polling: one guarded reconciliation is awaited, followed by exactly
 * one guarded refresh after the pending markers have genuinely cleared.
 */
export async function completeDeferredHydration(
  initial: BackupHydrationResult,
  dependencies: DeferredHydrationDependencies,
): Promise<BackupHydrationResult> {
  if (initial.status !== 'deferred_pending_local') return initial

  const syncResult = await dependencies.reconcilePendingLocalSave()
  if (!syncResult.success) {
    throw new Error(syncResult.error || 'Pending local changes could not be reconciled')
  }
  if (dependencies.hasPendingLocalSave()) {
    throw new Error('Pending local changes are still waiting for cloud sync')
  }

  await dependencies.requestRemoteRefresh()

  return {
    ...initial,
    success: true,
    merged: true,
    status: 'applied',
    reconciledPendingLocal: true,
  }
}
