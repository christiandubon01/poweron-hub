/**
 * ATB-5: durable Scope Pack contract (browser-side).
 *
 * This is a structured, bounded handoff contract — not a saved prompt and not
 * a raw document store. Raw file text and local filesystem paths are never
 * part of this type.
 */

export type ScopePackReconciliationState = 'unverified' | 'current' | 'stale' | 'conflict'

export type FoundationClaimState = 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIED'

export type ScopePackPhaseStatus = 'not-started' | 'active' | 'complete' | 'blocked' | 'deferred'

export type ScopePackPhaseIntent = 'audit' | 'implementation' | 'verification' | 'research'

export interface FoundationClaim {
  claimId: string
  claim: string
  state: FoundationClaimState
  evidenceRefs: string[]
  reconciliationSummary: string | null
}

export interface ScopePackPhase {
  id: string
  title: string
  goal: string
  status: ScopePackPhaseStatus
  executionIntent: ScopePackPhaseIntent
}

export interface ScopePackContract {
  packId: string
  orgId: string
  repoKey: string
  title: string
  sourceFilename: string
  sourceHash: string
  importedAt: string
  updatedAt: string
  historicalCheckpoint: string | null
  intent: string
  foundationClaims: FoundationClaim[]
  lockedRules: string[]
  doNotTouch: string[]
  roadmapPhases: ScopePackPhase[]
  currentPhaseId: string | null
  acceptanceCriteria: string[]
  runtimeAcceptanceRequired: boolean
  ownerDecisions: string[]
  supersededDecisions: string[]
  knownRisks: string[]
  relatedAppAreas: string[]
  reconciliationState: ScopePackReconciliationState
  reconciliationSummary: string | null
  lastReconciledAt: string | null
  version: number
}

export interface ScopePackImportDraft {
  title: string
  sourceFilename: string
  sourceHash: string
  historicalCheckpoint: string | null
  intent: string
  foundationClaims: string[]
  lockedRules: string[]
  doNotTouch: string[]
  roadmapPhases: Array<{
    id: string
    title: string
    goal: string
    executionIntent?: ScopePackPhaseIntent
  }>
  currentPhaseId: string | null
  acceptanceCriteria: string[]
  runtimeAcceptanceRequired: boolean
  ownerDecisions: string[]
  supersededDecisions: string[]
  knownRisks: string[]
  relatedAppAreas: string[]
  forceNewVersion?: boolean
}

export interface HandoffParseWarning {
  code:
    | 'TRUNCATED_STRING'
    | 'TRUNCATED_LIST'
    | 'UNMAPPED_SECTION'
    | 'DUPLICATE_HEADING'
    | 'EMPTY_SECTION'
  message: string
  section?: string
}

export interface HandoffParseResult {
  ok: true
  draft: ScopePackImportDraft
  unmappedSectionNames: string[]
  warnings: HandoffParseWarning[]
}

export interface HandoffParseFailure {
  ok: false
  code:
    | 'UNSUPPORTED_TYPE'
    | 'FILE_TOO_LARGE'
    | 'EMPTY_SOURCE'
    | 'INVALID_FILENAME'
    | 'INVALID_HASH'
  message: string
}

export type HandoffParseOutcome = HandoffParseResult | HandoffParseFailure

export interface ScopePackListItem {
  packId: string
  title: string
  currentPhaseId: string | null
  currentPhaseTitle: string | null
  reconciliationState: ScopePackReconciliationState
  historicalCheckpoint: string | null
  lastReconciledAt: string | null
  version: number
  sourceFilename: string
  sourceHash: string
}

export interface ScopePackArchitectVerdict {
  state: 'CONTINUE' | 'WATCH' | 'NEEDS_OWNER'
  summary: string
}

export const SCOPE_PACK_FORBIDDEN_PERSIST_KEYS = [
  'raw',
  'rawText',
  'sourceText',
  'sourceContents',
  'filePath',
  'localPath',
  'absolutePath',
  'contents',
] as const
