/**
 * scopeRegistry.ts — Protected app-data scope registry (Phase 5A scaffolding)
 *
 * Pure TypeScript. No React, no Supabase, no localStorage, no side effects.
 *
 * WHAT THIS IS
 * ------------
 * The app persists ONE whole `BackupData` blob per save (see backupDataService.ts).
 * The Phase 5 audit showed `changedKey` is only a sync/source label — it does NOT
 * scope the write, so any tab can overwrite unrelated branches. This registry is the
 * typed foundation for future phases that will migrate each data branch to a
 * fetch-latest → patch-only-my-scope → guarded-sync merge (the pattern blueprint
 * annotations already use).
 *
 * PHASE 5A INTENTIONALLY DOES NOT:
 *  - enable any scoped merge / tombstone / per-scope write logic
 *  - change any runtime save/stale/baseline behavior
 *  - write `_scopes` (or anything new) into BackupData or the Supabase payload
 *
 * It only provides: the `DataScope` union, descriptors, a legacy `changedKey` → scope
 * map, and resolver helpers. Callers may use these for logging/metadata today.
 */

// ── Scope identity ────────────────────────────────────────────────────────────

export type DataScope =
  | 'blueprint.annotations'
  | 'blueprint.workPackages'
  | 'project.rfis'
  | 'project.changeOrders'
  | 'project.estimate'
  | 'project.payments'
  | 'project.logs'
  | 'project.materials'
  | 'project.schedule'
  | 'project.notes'
  | 'project.files'
  | 'fieldLogs.entries'
  | 'fieldLogs.materials'
  | 'fieldLogs.photos'
  | 'fieldLogs.payments'
  | 'leads.accounts'
  | 'leads.relationships'
  | 'leads.pipeline'
  | 'leads.map'
  | 'leads.cleanup'
  | 'team.members'
  | 'team.roles'
  | 'team.assignments'
  | 'team.time'
  | 'priceBook.items'
  | 'priceBook.categories'
  | 'priceBook.laborRates'
  | 'priceBook.materials'
  | 'service.calls'
  | 'settings'

export type ScopeMergeStrategy =
  | 'id-merge'
  | 'map-merge'
  | 'lww'
  | 'field-lww'
  | 'future'

export type ScopePriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'future'

export interface ScopeDescriptor {
  scope: DataScope
  dataPath: string
  owner: string
  level: 'top-level' | 'nested' | 'external-projection' | 'future'
  identityField?: string
  timestampField?: string
  tombstoneField?: string
  needsTimestamp: boolean
  needsTombstone: boolean
  strategy: ScopeMergeStrategy
  priority: ScopePriority
  notes?: string
}

// ── Registry ──────────────────────────────────────────────────────────────────
// Keyed by every DataScope. Paths reflect the Phase 5 audit of BackupData.

export const SCOPE_REGISTRY: Readonly<Record<DataScope, ScopeDescriptor>> = {
  // ── Blueprint ──
  'blueprint.annotations': {
    scope: 'blueprint.annotations',
    dataPath: 'blueprintSummaries.operationsBlueprintAnnotations[blueprintSetId][]',
    owner: 'OperationsBlueprintPdfViewer / blueprintLibraryService',
    level: 'nested',
    identityField: 'id',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 5E: item-level, delete-safe id-merge implemented (mergeBlueprintAnnotationsById in blueprintLibraryService.ts). Deletes are soft (deletedAt/deletedBy tombstones kept in the raw array; public accessors filter them). Merge runs onto a freshly fetched remote BackupData via the existing remote-baseline save path — Save/stale/baseline behavior unchanged. Winner = newest updatedAt; a tombstone beats an equal-or-older live edit so a stale two-tab save cannot resurrect a delete. LIMITATIONS: timestamps are client-clock based (skew can misorder concurrent edits); tombstones are retained indefinitely — a future phase should add GC.',
  },
  'blueprint.workPackages': {
    scope: 'blueprint.workPackages',
    dataPath: 'blueprintSummaries.operationsBlueprintScopeLayers[blueprintSetId][]',
    owner: 'OperationsBlueprintPdfViewer / blueprintLibraryService',
    level: 'nested',
    identityField: 'id',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Scope layers / work packages, page-aware. Phase 5E: item-level, delete-safe id-merge implemented (mergeBlueprintScopeLayersById in blueprintLibraryService.ts). deleteScopeLayer still filters the array in the UI; saveOperationsBlueprintScopeLayers infers a tombstone for any previously-live id now missing (every caller passes the complete live array). Merge order is incoming-first so a local reorder survives; tombstones are appended and filtered from the UI. Runs onto freshly fetched remote via the existing remote-baseline save path — Save/stale/baseline unchanged. Same client-clock and no-GC limitations as blueprint.annotations.',
  },

  // ── Project inner tabs (all live inside projects[]) ──
  'project.rfis': {
    scope: 'project.rfis',
    dataPath: 'projects[].rfis[]',
    owner: 'V15rRFITab',
    level: 'nested',
    identityField: 'rfiId',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6F: project.rfis has collision-safe nested item-level merge via projectScopeMerge.ts. rfiId is the internal stable identity; rfiNumber is the user-visible number; legacy id is preserved as display/backward-compat data. Creates stamp rfiId/rfiNumber/updatedAt, edits bump updatedAt, deletes write deletedAt/deletedBy tombstones, and live readers filter tombstones. Saves fetch latest remote and patch only projects[id].rfis through the existing remote-baseline path. Save/stale/baseline behavior unchanged.',
  },
  'project.changeOrders': {
    scope: 'project.changeOrders',
    dataPath: 'projects[].changeOrders[]',
    owner: 'V15rChangeOrdersTab',
    level: 'nested',
    identityField: 'id',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6B: project.changeOrders has delete-safe, item-level nested merge via projectScopeMerge.ts. Change Orders carry updatedAt/deletedAt/deletedBy; creates and edits stamp updatedAt, deletes write deletedAt tombstones, raw arrays retain tombstones, and live readers filter them from UI/totals. Saves fetch latest remote and patch only projects[id].changeOrders through the existing remote-baseline path. Other project scopes remain future/unimplemented.',
  },
  'project.estimate': {
    scope: 'project.estimate',
    dataPath: 'projects[].laborRows/ohRows (Phase 6J rows); projects[].contract/mileRT/miDays scalars (Phase 6L)',
    owner: 'V15rEstimateTab',
    level: 'nested',
    identityField: 'laborId/overheadId (rows); project id + field (scalars)',
    timestampField: 'updatedAt (rows); estimateScalarUpdatedAt.<field> (scalars)',
    tombstoneField: 'deletedAt (rows only)',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6J: project.estimate laborRows and ohRows have delete-safe item-level nested merge via projectScopeMerge.ts (laborId/overheadId stable identities; createdAt/updatedAt; deletedAt/deletedBy tombstones; live readers filter tombstones). Phase 6L: the flat estimate scalar fields contract, mileRT, and miDays now use a per-field last-writer-wins merge (mergeProjectEstimateScalarsIntoRemote) keyed by a projects[].estimateScalarUpdatedAt per-field timestamp map. Different scalar fields edited on different devices merge independently; the same field resolves by newest per-field timestamp; an exact tie keeps remote; missing/legacy timestamps compare as -Infinity and never default to now. Both row and scalar saves fetch latest remote and patch only their own keys through the existing remote-baseline path (Save/stale/baseline unchanged). Still future/unimplemented: laborPhaseColors (UI metadata, Phase 6L-B or later) and estimateReference/phaseEstimateRows (legacy/dead). estimateVersions is a separate top-level (backup.estimateVersions[projectId]) future scope, not part of this nested project scope. project.materials is separate and already implemented under project.materials.',
  },
  'project.payments': {
    scope: 'project.payments',
    dataPath: 'logs[] filtered by projId + projects[].finance/billed/paid',
    owner: 'V15rEstimateTab / V15rMoneyPanel / V15rProjectLogsTab',
    level: 'nested',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Collections are source-of-truth in logs[].collected; finance holds manualPaidAdjustment.',
  },
  'project.logs': {
    scope: 'project.logs',
    dataPath: 'logs[] filtered by projId',
    owner: 'V15rProjectLogsTab / V15rFieldLogs',
    level: 'nested',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'critical',
  },
  'project.materials': {
    scope: 'project.materials',
    dataPath: 'projects[].matRows/mtoRows',
    owner: 'V15rMTOTab / V15rEstimateTab',
    level: 'nested',
    identityField: 'materialId/mtoId',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'high',
    notes: 'Phase 6H: project.materials has delete-safe item-level nested merge via projectScopeMerge.ts. mtoRows get materialId/mtoId stable internal identity, createdAt/updatedAt timestamps, and deletedAt/deletedBy tombstones; legacy matRows are supported by the same live filtering/merge helpers when present. V15rMTOTab saves fetch latest remote and patch only projects[id].mtoRows/matRows through the existing remote-baseline path. project.estimate remains future/unimplemented.',
  },
  'project.schedule': {
    scope: 'project.schedule',
    dataPath: 'projects[].phases/plannedStart/plannedEnd/tasks',
    owner: 'V15rProgressTab / V15rPhaseTimelineTab',
    level: 'nested',
    identityField: 'project id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'high',
  },
  'project.notes': {
    scope: 'project.notes',
    dataPath: 'projects[] note fields',
    owner: 'V15rProjectsPanel / V15rProjectInner',
    level: 'nested',
    identityField: 'project id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'medium',
  },
  'project.files': {
    scope: 'project.files',
    dataPath: 'future project attachments/files model',
    owner: '(future)',
    level: 'future',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'future',
    priority: 'future',
    notes: 'No first-class attachments model exists yet; needs a data-model decision.',
  },

  // ── Field Logs ──
  'fieldLogs.entries': {
    scope: 'fieldLogs.entries',
    dataPath: 'logs[] and serviceLogs[]',
    owner: 'V15rFieldLogPanel / V15rFieldLogs',
    level: 'top-level',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'critical',
  },
  'fieldLogs.materials': {
    scope: 'fieldLogs.materials',
    dataPath: 'serviceLogs[].mat/adjustments',
    owner: 'V15rFieldLogPanel',
    level: 'nested',
    identityField: 'service log id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'high',
  },
  'fieldLogs.photos': {
    scope: 'fieldLogs.photos',
    dataPath: 'fieldObservationCards[].photo_ids / future photo model',
    owner: 'Quick Capture / voiceJournalService',
    level: 'future',
    identityField: 'id (when model exists)',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'future',
    priority: 'high',
    notes: 'Photos are only id refs today; no first-class attachment storage.',
  },
  'fieldLogs.payments': {
    scope: 'fieldLogs.payments',
    dataPath: 'serviceLogs[].collected/statusEvents',
    owner: 'V15rFieldLogPanel',
    level: 'nested',
    identityField: 'service log id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'high',
  },

  // ── Leads / CRM ──
  'leads.accounts': {
    scope: 'leads.accounts',
    dataPath: 'gcContacts[] + relationship_accounts projection',
    owner: 'V15rLeadsPanel / relationshipAccountService',
    level: 'top-level',
    identityField: 'id',
    timestampField: 'lastContact',
    tombstoneField: '_deletedRelationshipAccounts',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'gcContacts is a projection of the relationship_accounts Supabase table.',
  },
  'leads.relationships': {
    scope: 'leads.relationships',
    dataPath: 'relationship_accounts Supabase table',
    owner: 'relationshipAccountService',
    level: 'external-projection',
    identityField: 'id',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Row-level table; authoritative source for lead accounts.',
  },
  'leads.pipeline': {
    scope: 'leads.pipeline',
    dataPath: 'gcContacts[].phase/stage + serviceLeads[]',
    owner: 'V15rLeadsPanel',
    level: 'top-level',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'high',
  },
  'leads.map': {
    scope: 'leads.map',
    dataPath: 'gcContacts[].address/lat/lng',
    owner: 'V15rLeadsPanel',
    level: 'nested',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'medium',
  },
  'leads.cleanup': {
    scope: 'leads.cleanup',
    dataPath: '_deletedRelationshipAccounts[] and dedupe/tombstone cleanup',
    owner: 'V15rLeadsPanel / relationshipAccountService',
    level: 'top-level',
    tombstoneField: '_deletedRelationshipAccounts',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'high',
  },

  // ── Team ──
  'team.members': {
    scope: 'team.members',
    dataPath: 'employees[]',
    owner: 'V15rTeamPanel',
    level: 'top-level',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'critical',
  },
  'team.roles': {
    scope: 'team.roles',
    dataPath: 'employees[].role',
    owner: 'V15rTeamPanel',
    level: 'nested',
    identityField: 'employee id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'high',
  },
  'team.assignments': {
    scope: 'team.assignments',
    dataPath: 'employees[] assignment fields',
    owner: 'V15rTeamPanel',
    level: 'nested',
    identityField: 'employee id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'high',
  },
  'team.time': {
    scope: 'team.time',
    dataPath: 'logs[] hours by employee',
    owner: 'V15rTeamPanel / V15rProjectLogsTab',
    level: 'top-level',
    identityField: 'log id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'high',
  },

  // ── Price Book ──
  'priceBook.items': {
    scope: 'priceBook.items',
    dataPath: 'priceBook[]',
    owner: 'V15rPriceBookPanel',
    level: 'top-level',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'high',
  },
  'priceBook.categories': {
    scope: 'priceBook.categories',
    dataPath: 'priceBook[].cat',
    owner: 'V15rPriceBookPanel',
    level: 'nested',
    identityField: 'category name',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'map-merge',
    priority: 'medium',
  },
  'priceBook.laborRates': {
    scope: 'priceBook.laborRates',
    dataPath: 'settings labor rates + priceBook labor items',
    owner: 'V15rPriceBookPanel / V15rSettingsPanel',
    level: 'nested',
    identityField: 'key/id',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'high',
  },
  'priceBook.materials': {
    scope: 'priceBook.materials',
    dataPath: 'priceBook[] material items',
    owner: 'V15rPriceBookPanel',
    level: 'top-level',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'high',
  },

  // ── Service calls ──
  'service.calls': {
    scope: 'service.calls',
    dataPath: 'serviceLogs[] + activeServiceCalls[] + serviceEstimates[]',
    owner: 'V15rServiceCallsV2 / V15rFieldLogPanel',
    level: 'top-level',
    identityField: 'id',
    needsTimestamp: true,
    needsTombstone: true,
    strategy: 'id-merge',
    priority: 'high',
  },

  // ── Settings ──
  settings: {
    scope: 'settings',
    dataPath: 'settings{}',
    owner: 'V15rSettingsPanel',
    level: 'top-level',
    identityField: 'singleton',
    needsTimestamp: true,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'critical',
  },
}

// ── Legacy changedKey → scopes mapping ─────────────────────────────────────────
// Maps the pre-Phase-5 sync `changedKey` labels to the concrete scopes a save under
// that key can touch. Used only for resolution/logging today — NOT for merge.

export const LEGACY_CHANGED_KEY_TO_SCOPES: Readonly<Record<string, DataScope[]>> = {
  projects: [
    'project.rfis',
    'project.changeOrders',
    'project.estimate',
    'project.payments',
    'project.logs',
    'project.materials',
    'project.schedule',
    'project.notes',
  ],
  logs: [
    'project.payments',
    'project.logs',
    'fieldLogs.entries',
    'team.time',
  ],
  serviceLogs: [
    'fieldLogs.entries',
    'fieldLogs.materials',
    'fieldLogs.payments',
    'service.calls',
  ],
  gcContacts: [
    'leads.accounts',
    'leads.pipeline',
    'leads.map',
    'leads.cleanup',
  ],
  serviceLeads: [
    'leads.pipeline',
  ],
  employees: [
    'team.members',
    'team.roles',
    'team.assignments',
  ],
  priceBook: [
    'priceBook.items',
    'priceBook.categories',
    'priceBook.laborRates',
    'priceBook.materials',
  ],
  settings: [
    'settings',
    'priceBook.laborRates',
  ],
  weeklyData: [
    'project.payments',
  ],
  blueprintSummaries: [
    'blueprint.annotations',
    'blueprint.workPackages',
  ],
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const _ALL_SCOPES = Object.keys(SCOPE_REGISTRY) as DataScope[]
const _SCOPE_SET: ReadonlySet<string> = new Set(_ALL_SCOPES)

/** Type guard: is the value one of the known DataScope strings? */
export function isDataScope(value: unknown): value is DataScope {
  return typeof value === 'string' && _SCOPE_SET.has(value)
}

/** Descriptor lookup for a known scope. */
export function getScopeDescriptor(scope: DataScope): ScopeDescriptor {
  return SCOPE_REGISTRY[scope]
}

/** All registered scopes, in registry order. */
export function getAllScopes(): DataScope[] {
  return [..._ALL_SCOPES]
}

/** Coerce a scope/array/nullish into a de-duplicated array of valid DataScopes. */
export function normalizeScopes(input?: DataScope | DataScope[] | null): DataScope[] {
  if (input == null) return []
  const arr = Array.isArray(input) ? input : [input]
  const out: DataScope[] = []
  const seen = new Set<string>()
  for (const s of arr) {
    if (isDataScope(s) && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/** Human-readable summary of a scope list (for logs/metadata). */
export function describeScopes(scopes: DataScope[]): string {
  const norm = normalizeScopes(scopes)
  return norm.length ? norm.join(', ') : '(none)'
}

/** Resolve a legacy `changedKey` string to its mapped scopes (deduped). */
export function resolveScopesFromLegacyChangedKey(changedKey?: string | null): DataScope[] {
  if (!changedKey) return []
  const mapped = LEGACY_CHANGED_KEY_TO_SCOPES[changedKey]
  return mapped ? normalizeScopes(mapped) : []
}

/**
 * Resolve any sync-save input into concrete scopes:
 *  - a valid DataScope string → [that scope]
 *  - an array → its valid DataScope members (deduped)
 *  - a legacy changedKey string → its mapped scopes
 *  - missing/unknown → []
 */
export function resolveScopesForSyncInput(
  input?: string | DataScope | DataScope[] | null,
): DataScope[] {
  if (input == null) return []
  if (Array.isArray(input)) return normalizeScopes(input)
  if (isDataScope(input)) return [input]
  return resolveScopesFromLegacyChangedKey(input)
}
