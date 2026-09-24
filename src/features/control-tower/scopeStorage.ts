export type ScopeStorageState = 'ready' | 'pending' | 'unknown'

export const SCOPE_STORAGE_PENDING_MESSAGE =
  'Scope Pack storage is not activated in this environment. Migration 136 is pending.'

export function isScopeStoragePendingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /agent_scope_packs|import_scope_pack|schema cache|does not exist|42P01|PGRST205|PGRST204/i.test(message)
}

export function scopeStorageFromError(error: unknown): ScopeStorageState {
  return isScopeStoragePendingError(error) ? 'pending' : 'unknown'
}
