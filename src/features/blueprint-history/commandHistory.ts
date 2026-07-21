import type {
  AnnotationHistoryCommand,
  AnnotationHistoryScope,
  AnnotationSnapshot,
  CommandHistoryState,
  ScopeCommandHistory,
} from './types'
import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'

const EMPTY_SCOPE_HISTORY: ScopeCommandHistory = { past: [], future: [] }

export function getHistoryScopeKey(scope: AnnotationHistoryScope): string {
  return `${scope.blueprintSetId}:${Math.max(1, Math.floor(scope.pageNumber))}`
}

export function createCommandHistory(maxCommandsPerScope = 100): CommandHistoryState {
  return {
    scopes: {},
    maxCommandsPerScope: Math.max(1, Math.floor(maxCommandsPerScope)),
  }
}

export function buildAnnotationMutationCommand(options: {
  transactionId: string
  label: string
  scope: AnnotationHistoryScope
  before: Record<string, AnnotationSnapshot>
  after: Record<string, AnnotationSnapshot>
  selectionBefore?: string | null
  selectionAfter?: string | null
  timestamp?: number
  coalesceKey?: string
}): AnnotationHistoryCommand | null {
  const candidateIds = [...Object.keys(options.before), ...Object.keys(options.after)]
  const affectedAnnotationIds = Array.from(new Set(candidateIds)).filter((id) => (
    !areAnnotationSnapshotsEqual(options.before[id], options.after[id])
  ))
  if (affectedAnnotationIds.length === 0) return null

  const before: Record<string, AnnotationSnapshot> = {}
  const after: Record<string, AnnotationSnapshot> = {}
  for (const id of affectedAnnotationIds) {
    before[id] = cloneAnnotationSnapshot(options.before[id])
    after[id] = cloneAnnotationSnapshot(options.after[id])
  }

  return {
    transactionId: options.transactionId,
    label: options.label,
    scope: options.scope,
    affectedAnnotationIds,
    before,
    after,
    selectionBefore: options.selectionBefore ?? null,
    selectionAfter: options.selectionAfter ?? null,
    timestamp: options.timestamp ?? Date.now(),
    ...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
  }
}

export function getScopeHistory(
  history: CommandHistoryState,
  scope: AnnotationHistoryScope,
): ScopeCommandHistory {
  return history.scopes[getHistoryScopeKey(scope)] ?? EMPTY_SCOPE_HISTORY
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function canCoalesce(previous: AnnotationHistoryCommand, next: AnnotationHistoryCommand): boolean {
  const previousKey = previous.coalesceKey || previous.transactionId
  const nextKey = next.coalesceKey || next.transactionId
  return previousKey === nextKey
    && getHistoryScopeKey(previous.scope) === getHistoryScopeKey(next.scope)
    && sameIds(previous.affectedAnnotationIds, next.affectedAnnotationIds)
}

export function pushCommand(
  history: CommandHistoryState,
  command: AnnotationHistoryCommand,
  options: { coalesce?: boolean } = {},
): CommandHistoryState {
  const key = getHistoryScopeKey(command.scope)
  const current = history.scopes[key] ?? EMPTY_SCOPE_HISTORY
  const previous = current.past[current.past.length - 1]
  let past: AnnotationHistoryCommand[]

  if (options.coalesce && previous && canCoalesce(previous, command)) {
    const merged: AnnotationHistoryCommand = {
      ...previous,
      label: command.label,
      after: command.after,
      selectionAfter: command.selectionAfter,
      timestamp: command.timestamp,
    }
    past = [...current.past.slice(0, -1), merged]
  } else {
    past = [...current.past, command]
  }

  if (past.length > history.maxCommandsPerScope) {
    past = past.slice(past.length - history.maxCommandsPerScope)
  }

  return {
    ...history,
    scopes: {
      ...history.scopes,
      [key]: { past, future: [] },
    },
  }
}

export function peekUndo(
  history: CommandHistoryState,
  scope: AnnotationHistoryScope,
): AnnotationHistoryCommand | null {
  const past = getScopeHistory(history, scope).past
  return past[past.length - 1] ?? null
}

export function peekRedo(
  history: CommandHistoryState,
  scope: AnnotationHistoryScope,
): AnnotationHistoryCommand | null {
  const future = getScopeHistory(history, scope).future
  return future[future.length - 1] ?? null
}

export function commitUndo(
  history: CommandHistoryState,
  scope: AnnotationHistoryScope,
  transactionId: string,
): CommandHistoryState {
  const key = getHistoryScopeKey(scope)
  const current = history.scopes[key] ?? EMPTY_SCOPE_HISTORY
  const command = current.past[current.past.length - 1]
  if (!command || command.transactionId !== transactionId) return history
  return {
    ...history,
    scopes: {
      ...history.scopes,
      [key]: {
        past: current.past.slice(0, -1),
        future: [...current.future, command],
      },
    },
  }
}

export function commitRedo(
  history: CommandHistoryState,
  scope: AnnotationHistoryScope,
  transactionId: string,
): CommandHistoryState {
  const key = getHistoryScopeKey(scope)
  const current = history.scopes[key] ?? EMPTY_SCOPE_HISTORY
  const command = current.future[current.future.length - 1]
  if (!command || command.transactionId !== transactionId) return history
  return {
    ...history,
    scopes: {
      ...history.scopes,
      [key]: {
        past: [...current.past, command],
        future: current.future.slice(0, -1),
      },
    },
  }
}

export function clearHistoryScope(
  history: CommandHistoryState,
  scope: AnnotationHistoryScope,
): CommandHistoryState {
  const key = getHistoryScopeKey(scope)
  if (!history.scopes[key]) return history
  const scopes = { ...history.scopes }
  delete scopes[key]
  return { ...history, scopes }
}

export function clearCommandHistory(history: CommandHistoryState): CommandHistoryState {
  if (Object.keys(history.scopes).length === 0) return history
  return { ...history, scopes: {} }
}

export function cloneAnnotationSnapshot(annotation: BlueprintAnnotation | null | undefined): BlueprintAnnotation | null {
  return annotation ? JSON.parse(JSON.stringify(annotation)) as BlueprintAnnotation : null
}

export function areAnnotationSnapshotsEqual(
  left: BlueprintAnnotation | null | undefined,
  right: BlueprintAnnotation | null | undefined,
): boolean {
  if (!left || !right) return !left && !right
  const leftCopy: any = cloneAnnotationSnapshot(left)
  const rightCopy: any = cloneAnnotationSnapshot(right)
  for (const copy of [leftCopy, rightCopy]) {
    delete copy.updatedAt
    delete copy.deletedAt
    delete copy.deletedBy
  }
  return JSON.stringify(leftCopy) === JSON.stringify(rightCopy)
}

export function buildAnnotationRestorePayload(
  snapshot: BlueprintAnnotation,
  updatedAt: string,
): BlueprintAnnotation {
  const payload: any = {
    ...cloneAnnotationSnapshot(snapshot),
    updatedAt,
  }
  delete payload.deletedAt
  delete payload.deletedBy
  return payload as BlueprintAnnotation
}

export function isHistoryCommandSourceCurrent(
  command: AnnotationHistoryCommand,
  direction: 'undo' | 'redo',
  currentAnnotations: BlueprintAnnotation[],
): boolean {
  const expected = direction === 'undo' ? command.after : command.before
  const currentById = new Map(currentAnnotations.map((annotation) => [annotation.id, annotation]))
  return command.affectedAnnotationIds.every((id) => areAnnotationSnapshotsEqual(currentById.get(id), expected[id]))
}

export function applyAnnotationSnapshotsToList(
  annotations: BlueprintAnnotation[],
  affectedAnnotationIds: string[],
  snapshots: Record<string, BlueprintAnnotation | null>,
): BlueprintAnnotation[] {
  const affected = new Set(affectedAnnotationIds)
  const next = annotations.filter((annotation) => !affected.has(annotation.id))
  for (const id of affectedAnnotationIds) {
    const snapshot = cloneAnnotationSnapshot(snapshots[id])
    if (snapshot) next.push(snapshot)
  }
  return next
}
