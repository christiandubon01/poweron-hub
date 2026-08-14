import type {
  BackupHydrationResult,
  SyncToSupabaseResult,
} from './backupDataService'

export type DeferredHydrationStage = 'reconcile' | 'refresh'

export class DeferredHydrationError extends Error {
  stage: DeferredHydrationStage
  code: string | null
  cause: unknown

  constructor(stage: DeferredHydrationStage, message: string, cause?: unknown) {
    super(message)
    this.name = 'DeferredHydrationError'
    this.stage = stage
    this.code = typeof (cause as any)?.code === 'string' ? (cause as any).code : null
    this.cause = cause ?? null
  }
}

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
    throw new DeferredHydrationError(
      'reconcile',
      syncResult.error || 'Pending local changes could not be reconciled',
      syncResult,
    )
  }
  if (dependencies.hasPendingLocalSave()) {
    throw new DeferredHydrationError(
      'reconcile',
      'Pending local changes are still waiting for cloud sync',
    )
  }

  try {
    await dependencies.requestRemoteRefresh()
  } catch (error) {
    throw new DeferredHydrationError(
      'refresh',
      error instanceof Error ? error.message : 'Remote refresh failed during deferred hydration',
      error,
    )
  }

  return {
    ...initial,
    success: true,
    merged: true,
    status: 'applied',
    reconciledPendingLocal: true,
  }
}
