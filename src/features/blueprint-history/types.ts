import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'

export type AnnotationSnapshot = BlueprintAnnotation | null

export type AnnotationHistoryScope = {
  blueprintSetId: string
  projectId: string
  pageNumber: number
}

export type AnnotationHistoryCommand = {
  transactionId: string
  label: string
  scope: AnnotationHistoryScope
  affectedAnnotationIds: string[]
  before: Record<string, AnnotationSnapshot>
  after: Record<string, AnnotationSnapshot>
  selectionBefore: string | null
  selectionAfter: string | null
  timestamp: number
  coalesceKey?: string
}

export type ScopeCommandHistory = {
  past: AnnotationHistoryCommand[]
  future: AnnotationHistoryCommand[]
}

export type CommandHistoryState = {
  scopes: Record<string, ScopeCommandHistory>
  maxCommandsPerScope: number
}
