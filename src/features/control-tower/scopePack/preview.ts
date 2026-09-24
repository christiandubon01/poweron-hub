/**
 * ATB-5: labeled Preview-only example Scope Pack.
 * Live surfaces must never import or render this fixture as a real pack.
 */

import type { ScopePackContract, ScopePackListItem } from './types'

export const PREVIEW_SCOPE_PACK_LABEL = 'Example Scope Pack · Preview only'

export const PREVIEW_SCOPE_PACK: ScopePackContract = {
  packId: 'preview-scope-pack-qbo',
  orgId: 'preview',
  repoKey: 'preview000000000',
  title: 'PowerOn QuickBooks Online (example)',
  sourceFilename: 'qbo-handoff.example.md',
  sourceHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  importedAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
  historicalCheckpoint: '9f3c2ab',
  intent: 'PowerOn remains the operational and financial source of truth. QuickBooks remains the accounting destination.',
  foundationClaims: [
    {
      claimId: 'claim-1',
      claim: 'PowerOn is the operational/financial source of truth',
      state: 'UNVERIFIED',
      evidenceRefs: [],
      reconciliationSummary: null,
    },
  ],
  lockedRules: ['No silent QuickBooks create/update'],
  doNotTouch: ['Historical Payments', 'src/store/authStore.ts'],
  roadmapPhases: [
    {
      id: 'QBO-4B0',
      title: 'QBO-4B0 — Open Estimates Truth Audit',
      goal: 'NO IMPLEMENTATION. Read-only audit of current estimate truth.',
      status: 'not-started',
      executionIntent: 'audit',
    },
  ],
  currentPhaseId: 'QBO-4B0',
  acceptanceCriteria: ['Owner-visible runtime verification required'],
  runtimeAcceptanceRequired: true,
  ownerDecisions: ['Phased roadmap begins with a READ-ONLY truth audit'],
  supersededDecisions: [],
  knownRisks: ['Historical claims may have drifted'],
  relatedAppAreas: [],
  reconciliationState: 'unverified',
  reconciliationSummary: null,
  lastReconciledAt: null,
  version: 1,
}

export const PREVIEW_SCOPE_PACK_LIST_ITEM: ScopePackListItem = {
  packId: PREVIEW_SCOPE_PACK.packId,
  title: PREVIEW_SCOPE_PACK.title,
  currentPhaseId: PREVIEW_SCOPE_PACK.currentPhaseId,
  currentPhaseTitle: PREVIEW_SCOPE_PACK.roadmapPhases[0]?.title ?? null,
  reconciliationState: PREVIEW_SCOPE_PACK.reconciliationState,
  historicalCheckpoint: PREVIEW_SCOPE_PACK.historicalCheckpoint,
  lastReconciledAt: PREVIEW_SCOPE_PACK.lastReconciledAt,
  version: PREVIEW_SCOPE_PACK.version,
  sourceFilename: PREVIEW_SCOPE_PACK.sourceFilename,
  sourceHash: PREVIEW_SCOPE_PACK.sourceHash,
}

export function isPreviewScopePackId(packId: string): boolean {
  return packId === PREVIEW_SCOPE_PACK.packId || packId.startsWith('preview-scope-pack-')
}
