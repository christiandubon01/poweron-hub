export type BlueprintSaveStateKind =
  | 'unsaved'
  | 'saving'
  | 'saved-to-cloud'
  | 'saved-on-this-device'
  | 'sync-failed'

export type BlueprintSaveStateTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

export type BlueprintSaveState = {
  kind: BlueprintSaveStateKind
  label: string
  tone: BlueprintSaveStateTone
  detail?: string
}

export type BlueprintPersistenceResultLike = {
  localSaved?: boolean
  cloudSynced?: boolean
  warning?: string
  error?: string
}

export type BlueprintAnimationPersistenceResultLike = BlueprintPersistenceResultLike & {
  status?: string
}

export function getBlueprintSaveState(kind: BlueprintSaveStateKind, detail?: string): BlueprintSaveState {
  switch (kind) {
    case 'saving':
      return { kind, label: 'Saving...', tone: 'info', detail }
    case 'saved-to-cloud':
      return { kind, label: 'Saved to cloud', tone: 'success', detail }
    case 'saved-on-this-device':
      return { kind, label: 'Saved on this device', tone: 'warning', detail }
    case 'sync-failed':
      return { kind, label: 'Sync failed', tone: 'error', detail }
    case 'unsaved':
    default:
      return { kind: 'unsaved', label: 'Unsaved', tone: 'neutral', detail }
  }
}

export function classifyBlueprintPersistenceResult(
  result: BlueprintPersistenceResultLike,
  options?: { localDetail?: string; failedDetail?: string },
): BlueprintSaveState {
  if (result?.cloudSynced) {
    return getBlueprintSaveState('saved-to-cloud')
  }
  if (result?.localSaved) {
    return getBlueprintSaveState(
      'saved-on-this-device',
      options?.localDetail || result.warning || result.error,
    )
  }
  return getBlueprintSaveState(
    'sync-failed',
    options?.failedDetail || result?.error || result?.warning,
  )
}

export function classifyBlueprintAnimationPersistenceResult(
  result: BlueprintAnimationPersistenceResultLike,
): BlueprintSaveState {
  if (result?.cloudSynced && result?.status === 'verified') {
    return getBlueprintSaveState('saved-to-cloud')
  }
  if (result?.localSaved) {
    return getBlueprintSaveState('saved-on-this-device', result.warning || result.error)
  }
  return getBlueprintSaveState('sync-failed', result?.error || result?.warning || result?.status)
}

export function getBlueprintSaveStateClassName(tone: BlueprintSaveStateTone): string {
  switch (tone) {
    case 'info':
      return 'border-sky-500/40 bg-sky-950/85 text-sky-100'
    case 'success':
      return 'border-emerald-500/40 bg-emerald-950/85 text-emerald-100'
    case 'warning':
      return 'border-amber-500/40 bg-amber-950/90 text-amber-100'
    case 'error':
      return 'border-rose-500/40 bg-rose-950/90 text-rose-100'
    case 'neutral':
    default:
      return 'border-slate-500/30 bg-slate-950/80 text-slate-100'
  }
}
