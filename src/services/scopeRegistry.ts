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
  | 'blueprint.wireProfiles'
  | 'project.rfis'
  | 'project.changeOrders'
  | 'project.estimate'
  | 'project.estimateVersions'
  | 'project.payments'
  | 'project.logs'
  | 'project.materials'
  | 'project.coordination'
  | 'project.schedule'
  | 'project.progress'
  | 'project.timeline'
  | 'project.notes'
  | 'project.files'
  | 'project.lifecycle'
  | 'project.finance'
  | 'finance.weeklyData'
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
  | 'service.multiDayCalls'
  | 'home.agendaAlerts'
  | 'settings'

export type ScopeMergeStrategy =
  | 'id-merge'
  | 'map-merge'
  | 'lww'
  | 'field-lww'
  | 'mixed'
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
  'blueprint.wireProfiles': {
    scope: 'blueprint.wireProfiles',
    dataPath: 'blueprintSummaries.operationsBlueprintWireProfiles[projectId][]',
    owner: 'blueprint-wire-profiles / blueprintLibraryService',
    level: 'nested',
    identityField: 'id',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'EST-1A: project-scoped WireProfile library stored inside BackupData JSON. Profiles merge by stable id; newer updatedAt wins; archived and tombstoned records remain readable/resolvable; omission is never deletion.',
  },
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
    dataPath: 'projects[].laborRows/ohRows (Phase 6J rows); projects[].contract/mileRT/miDays scalars (Phase 6L); projects[].laborPhaseColors (Phase 6L-B)',
    owner: 'V15rEstimateTab',
    level: 'nested',
    identityField: 'laborId/overheadId (rows); project id + field (scalars); phase key (laborPhaseColors)',
    timestampField: 'updatedAt (rows); estimateScalarUpdatedAt.<field> (scalars); laborPhaseColorUpdatedAt[phaseKey] (laborPhaseColors)',
    tombstoneField: 'deletedAt (rows only)',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6J: project.estimate laborRows and ohRows have delete-safe item-level nested merge via projectScopeMerge.ts (laborId/overheadId stable identities; createdAt/updatedAt; deletedAt/deletedBy tombstones; live readers filter tombstones). Phase 6L: the flat estimate scalar fields contract, mileRT, and miDays use per-field LWW merge (mergeProjectEstimateScalarsIntoRemote) keyed by projects[].estimateScalarUpdatedAt. Phase 6L-B / 6S-E: projects[].laborPhaseColors is UI metadata for Estimate labor phase headers — per-phase LWW map merge (mergeProjectLaborPhaseColorsIntoRemote / mergeRemoteLaborPhaseColorsIntoOutgoing) keyed by projects[].laborPhaseColorUpdatedAt[phaseKey]; belongs under project.estimate, NOT project.progress and NOT global settings. progressPhaseColors is already protected by project.progress (6S-D2). settings.phaseWeights / settings.mtoPhases are deferred. Row and scalar saves fetch latest remote and patch only their own keys through the existing remote-baseline path (Save/stale/baseline unchanged). estimateReference/phaseEstimateRows (legacy/dead) remain unimplemented. project.materials is separate under project.materials.',
  },
  'project.estimateVersions': {
    scope: 'project.estimateVersions',
    dataPath: 'BackupData.estimateVersions[projectId][]',
    owner: 'V15rEstimateTab',
    level: 'top-level',
    identityField: 'versionId (fallback: ts + laborCount + ohCount + total)',
    timestampField: 'createdAt / updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'high',
    notes: 'Phase 6S-F: top-level saved estimate version history (immutable laborRows/ohRows copies per snapshot). Metadata fields name/notes editable via scoped save; mergeEstimateVersionPair preserves payload and LWW-merges metadata by updatedAt. restoreEstimateVersion is authoritative live row rollback under project.estimate (tombstones rows not in selected snapshot). mergeEstimateVersionsIntoRemote / mergeRemoteEstimateVersionsIntoOutgoing in projectScopeMerge.ts. saveEstimateVersion / saveEstimateVersionsScoped fetch latest remote and patch only estimateVersions[projectId]. Max 5 visible non-deleted versions per project. SnapshotPanel full restore intentionally unchanged.',
  },
  'project.payments': {
    scope: 'project.payments',
    dataPath: 'logs[].collected filtered by projId (payment is a FIELD on the log row)',
    owner: 'V15rProjectLogsTab / V15rFieldLogPanel',
    level: 'nested',
    identityField: 'logId',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6N: NOT a separate entity — a project "payment" is the `collected` field on a BackupData.logs[] row, so it is protected together with project.logs by one combined row-level merge (mergeProjectLogsIntoRemote). collected travels with the whole log row; deletes are deletedAt/deletedBy tombstones; getProjectFinancials/projectLogsFor/getLiveProjectLogs exclude tombstoned+archived logs so paid/collected/ar/risk cannot count deleted payments. manualPaidAdjustment (projects[].finance) remains a separate future concern.',
  },
  'project.logs': {
    scope: 'project.logs',
    dataPath: 'top-level BackupData.logs[] rows filtered by projId',
    owner: 'V15rProjectLogsTab / V15rFieldLogPanel',
    level: 'nested',
    identityField: 'logId',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6N: delete-safe row-level scoped merge over the top-level logs[] array, sliced by projId (mergeProjectLogsIntoRemote merges only the target project slice onto freshly-fetched remote and preserves every other project\'s logs untouched). logId is the internal stable identity; legacy id preserved for display/back-compat. Creates stamp logId/createdAt/updatedAt; edits bump updatedAt; deletes write deletedAt/deletedBy tombstones; live readers filter tombstones+archived from UI and financials. Save scopes: ["project.logs","project.payments"] via the existing remote-baseline path (Save/stale/baseline unchanged). fieldLogs.entries (serviceLogs) and team.time remain separate future logical scopes over the same/other arrays.',
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
  'project.coordination': {
    scope: 'project.coordination',
    dataPath: 'projects[].coord[section][]',
    owner: 'V15rCoordinationTab',
    level: 'nested',
    identityField: 'project id + coord section key + coord item id',
    timestampField: 'coord item updatedAt',
    tombstoneField: 'coord item deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'high',
    notes: 'Phase 6S-D4: project.coordination protects workflow/planning coordination data in projects[].coord. Section buckets merge by normalized section key; rows merge by stable item id with createdAt/updatedAt metadata, and deletes are tombstones (deletedAt/deletedBy/status="deleted") retained in raw backup data while the Coordination UI filters them from active views/counts. Separate from project.timeline (6S-D1), project.progress (6S-D2), and project.schedule (6S-D3). Coordination is not the payment/log source of truth; project payments/logs remain logs[]. A narrow pre-sync fold preserves newer remote coordination rows on any non-project.coordination save.',
  },
  'project.schedule': {
    scope: 'project.schedule',
    dataPath: 'projects[].plannedStart / projects[].plannedEnd / projects[].lastMove',
    owner: 'V15rProjectsPanel / V15rProgressTab',
    level: 'nested',
    identityField: 'project id + schedule field name',
    timestampField: 'scheduleUpdatedAt.plannedStart / scheduleUpdatedAt.plannedEnd / scheduleUpdatedAt.lastMove',
    tombstoneField: undefined,
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'high',
    notes: 'Phase 6S-D3: protects workflow-critical project schedule scalars plannedStart, plannedEnd, and lastMove via per-field LWW timestamps in projects[].scheduleUpdatedAt. Separate from project.timeline (phase_timeline/deposit fields) and project.progress (phases/tasks/custom phase maps). V15rProjectsPanel stamps plannedStart/plannedEnd/lastMove writers and broad mixed project saves resolve schedule fields with mergeAllProjectScheduleIntoRemote; V15rProgressTab stamps lastMove when phase override movement changes and saves progress+schedule together. A narrow pre-sync fold preserves newer remote schedule fields on any non-project.schedule save. project.coordination and project status/lifecycle remain separate/deferred.',
  },
  'project.progress': {
    scope: 'project.progress',
    dataPath: 'projects[].phases / projects[].tasks / projects[].customPhases / projects[].progressPhaseColors / projects[].progressPhaseOverrideEnabled',
    owner: 'V15rProgressTab',
    level: 'nested',
    identityField: 'project id; phase key for maps; task id for task rows',
    timestampField: 'task.updatedAt; progressUpdatedAt.<mapName>[phaseKey]',
    tombstoneField: 'task.deletedAt; progressDeletedAt.customPhases[phaseKey]',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'mixed',
    priority: 'high',
    notes: 'Phase 6S-D2: project.progress is separate from project.timeline and deferred project.schedule date handling. Tasks merge by stable id with deletedAt/deletedBy tombstones and UI live filtering. phases/customPhases/progressPhaseColors/progressPhaseOverrideEnabled merge by normalized phase key using progressUpdatedAt timestamp maps; custom phase deletes use progressDeletedAt.customPhases so stale devices cannot resurrect removed custom phases. V15rProgressTab saves fetch latest remote, patch only project.progress fields, and save via the existing remote-baseline path. A narrow pre-sync fold preserves newer remote project.progress fields on any non-project.progress save. Project payments/logs, project.finance, project.timeline, weeklyData, team.members, service, and blueprint scopes remain untouched.',
  },
  'project.timeline': {
    scope: 'project.timeline',
    dataPath: 'projects[].phase_timeline[] / projects[].deposit_pct / projects[].phase_deposit_pct',
    owner: 'V15rPhaseTimelineTab',
    level: 'nested',
    identityField: 'phase_name (phase_timeline rows); project id + field name (deposit scalars)',
    timestampField: 'phase_timeline[].updatedAt; timelineUpdatedAt.deposit_pct; timelineUpdatedAt.phase_deposit_pct',
    tombstoneField: undefined,
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'mixed',
    priority: 'high',
    notes: 'Phase 6S-D1: protects projected cash flow / payment schedule / quote-vs-actual planning data from stale broad projects[] saves. phase_timeline rows merge by phase_name via mergePhaseTimelineRowsByPhase (projectScopeMerge.ts): newer updatedAt wins; tie/missing prefers incoming (explicit project.timeline saves); a winner never wipes a loser\'s defined field with an undefined/blank one. deposit_pct and phase_deposit_pct use a per-field last-writer-wins merge keyed by projects[].timelineUpdatedAt (mirrors project.finance/project.estimate scalar pattern): strictly-newer timelineUpdatedAt wins; on a tie the side with an actual value wins so a remote legacy value is never wiped by a local blank. V15rPhaseTimelineTab.handlePhaseEntryUpdate / handleDepositSave now fetch latest remote, run mergeProjectTimelineIntoRemote, and save through saveBackupWithRemoteBaselineSync (changedKey "projects", _scopes ["project.timeline"]); fallback saveBackupDataAndSync. A narrow pre-sync preservation fold (mergeRemoteProjectTimelineIntoOutgoing) protects newer remote phase_timeline/deposit data on any non-project.timeline broad save. This is SEPARATE from project.schedule (phases/plannedStart/plannedEnd/tasks) and project.progress/project.coordination, which remain unimplemented/deferred. Project payments source of truth remains logs[].collected (project.logs/project.payments); project.finance remains separate. Same client-clock/no-GC limitations as the other project scopes.',
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
  'project.lifecycle': {
    scope: 'project.lifecycle',
    dataPath: 'projects[].archive fields + deletedAt / deletedBy / status (project lifecycle metadata only)',
    owner: 'V15rProjectsPanel',
    level: 'nested',
    identityField: 'id',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'critical',
    notes: 'Phase 6Q + SYNC-01: project soft-delete and archive/restore lifecycle. Archive fields are archived/archivedAt/archivedReason plus legacy isArchived compatibility; lifecycle transitions stamp project updatedAt and resolve by strictly-newer timestamp (archivedAt/deletedAt legacy fallback, remote wins ties). Explicit archive/restore metadata beats legacy field absence. mergeProjectLifecycleIntoRemote patches ONLY lifecycle fields onto a fresh remote project; mergeAllProjectLifecycleIntoRemote is the incoming-based guard composed into the Projects panel broad saver. Child arrays, logs[], finance, other projects, serviceLogs, and blueprint data remain untouched. lastArchivedAt is historical/derived and is not a conflict field.',
  },
  'project.finance': {
    scope: 'project.finance',
    dataPath: 'projects[].finance (manualPaidAdjustment / lastCollectedAt / billedOverride / contractOverride / matCostOverride)',
    owner: 'V15rProjectsPanel / V15rProgressTab / getProjectFinancials',
    level: 'nested',
    identityField: 'project id + finance field name',
    timestampField: 'financeUpdatedAt.<field>',
    tombstoneField: undefined,
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'critical',
    notes: 'Phase 6S-A: money-critical projects[].finance fields (manualPaidAdjustment feeds getProjectFinancials paid → AR/exposure/risk → Dashboard/MoneyPanel/Home/NEXUS; billedOverride/contractOverride/matCostOverride/lastCollectedAt are the other override scalars) now have a per-field last-writer-wins merge keyed by a projects[].financeUpdatedAt per-field timestamp map (mergeProjectFinanceIntoRemote for a single project; mergeAllProjectFinanceIntoRemote for broad savers). The broad-saver helper is INCOMING-based: it returns a clone of the local backup (so every local project edit — status/archive/name/progress — is preserved exactly) with each project\'s finance scalar fields resolved against remote so a stale local finance bucket can NEVER overwrite a newer remote value, and a remote legacy/imported value that predates timestamps is never wiped by a local blank (tie → remote value kept). V15rProjectsPanel.persist and V15rProgressTab.persistProjectChange save locally for instant UI, then fetch latest remote, mergeAllProjectFinanceIntoRemote, and push through the existing saveBackupWithRemoteBaselineSync path (changedKey "projects", _scopes ["project.finance"]); fallback saveBackupDataAndSync. Scope excludes logs[] (project.logs/project.payments own logs[].collected), service payments, estimate rows/scalars, and project lifecycle. Same client-clock/no-GC limitations as the other project scopes.',
  },

  // ── Finance (derived weekly cache) ──
  'finance.weeklyData': {
    scope: 'finance.weeklyData',
    dataPath: 'BackupData.weeklyData[]',
    owner: 'V15rMoneyPanel (recalcWeeklyFromData) / import merge',
    level: 'top-level',
    identityField: 'wk',
    timestampField: 'weeklyUpdatedAt / derivedAt',
    tombstoneField: undefined,
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6S-B: weeklyData[] is a PERSISTED DERIVED financial cache / imported historical weekly-row store that drives MoneyPanel, Cash Flow, Business Overview, and the pulse fallback charts. It is NOT project.payments — the source of truth for project payments remains logs[].collected (project.logs / project.payments). Rows are keyed by wk and merged item-level by wk via weeklyDataScopeMerge.ts (mergeWeeklyRowsByWk / mergeWeeklyDataIntoRemote). manualOverride === true rows WIN over non-manual derived recalculation rows for the same wk; two manual rows resolve by newer weeklyUpdatedAt (tie/missing → remote, never overwrite manual data); two derived rows resolve by newer derivedAt/weeklyUpdatedAt (tie/missing → incoming so an explicit recalc applies). Optional per-row metadata: manualOverride/derivedAt/weeklyUpdatedAt. MoneyPanel recalcWeeklyFromData now fetches latest remote, mergeWeeklyDataIntoRemote, and saves through the existing remote-baseline path (changedKey "weeklyData", _scopes ["finance.weeklyData"]); fallback saveBackupDataAndSync. A narrow pre-sync preservation guard (mergeRemoteWeeklyDataIntoOutgoing) folds newer remote weeklyData into any NON-weeklyData broad save so stale local weeklyData cannot overwrite newer remote weekly rows. Dashboard/BusinessOverview/CashFlow reader migration deferred; no reader migration in this phase. Same client-clock/no-GC limitations as the other scopes.',
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
    dataPath: 'BackupData.employees[]',
    owner: 'V15rTeamPanel',
    level: 'top-level',
    identityField: 'id',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'critical',
    notes: 'Phase 6S-C: employees[] is now scoped and delete-safe via teamScopeMerge.ts (mergeEmployeesIntoRemote / mergeEmployeesById). id is the stable identity (falls back to employeeId, then a deterministic name/role/rate fingerprint); ensureEmployeeIdentity stamps createdAt/updatedAt without overwriting existing ids/timestamps. Deletes are TOMBSTONES (createEmployeeTombstone sets deletedAt/deletedBy/updatedAt/status="Deleted") — name/role/billRate/costRate/hourly_rate/applyMultiplier/employee_type/classification are preserved so historical logs[] and estimate labor rows keep resolving the employee (empId references are never rewritten). Merge is delete-safe LWW: both-deleted → newer deletedAt; one-deleted → tombstone beats an equal-or-older live row (live wins only if strictly newer); both-live → newer updatedAt, tie → more complete rate data, still tied → remote; a remote value is never wiped by a local blank. V15rTeamPanel CRUD (add/edit/toggleMultiplier/markComplianceAcknowledged/delete) now fetches latest remote, mergeEmployeesIntoRemote, and saves through the existing remote-baseline path (changedKey "employees", _scopes ["team.members"]); fallback saveBackupDataAndSync. Owner/me records (isOwner, id "me"/"owner"/"owner-virtual") cannot be deleted. Active dropdowns/rosters filter deleted + inactive/closed via getLiveEmployees; historical rows still display via the full raw array. A narrow pre-sync guard (mergeRemoteEmployeesIntoOutgoing) folds newer remote employees into any NON-employees broad save so stale local employees cannot overwrite a newer remote roster. team.time remains logs[] hours and is protected separately by project.logs; team.roles/team.assignments and settings.projectionScenarios/payroll remain future/deferred. Same client-clock/no-GC limitations as the other scopes.',
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
    dataPath: 'serviceLogs[] (Phase 6R-A) + serviceEstimates[] + activeServiceCalls[] (Phase 6R-B)',
    owner: 'V15rServiceCallsV2 / V15rFieldLogPanel / V15rEstimateTab',
    level: 'top-level',
    identityField: 'serviceLogId / serviceEstimateId / activeServiceCallId (each falls back to legacy id)',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'high',
    notes: 'Phase 6R-A: serviceLogs[] has delete-safe, item-level id-merge via serviceScopeMerge.ts (mergeServiceLogsIntoRemote). serviceLogId is the stable internal identity (falls back to legacy id, then a deterministic fingerprint); createdAt/updatedAt stamped by ensureServiceLogIdentity; deletes write deletedAt/deletedBy tombstones. A service "payment" is a set of FIELDS on the serviceLog row (collected/payStatus/balanceDue) protected together with the row; the append-only adjustments[]/statusEvents[] ledgers are unioned across both sides so payment/collection history is never dropped. Phase 6R-B: serviceEstimates[] and activeServiceCalls[] now have the same delete-safe lifecycle merge (mergeServiceEstimatesIntoRemote / mergeActiveServiceCallsIntoRemote) with serviceEstimateId / activeServiceCallId stable identities (fallback legacy id, then fingerprint), createdAt/updatedAt stamping, and deletedAt/deletedBy tombstones — their hard deletes are converted to tombstones. Mixed workflows (estimate → active call, active call → service log, estimate → completed service log) route through mergeServiceCallsScopeIntoRemote, which merges all three arrays in one remote-baseline save; this also fixes the completeAndLogService changedKey/silo mismatch (it previously mutated serviceLogs+serviceEstimates while saving under changedKey "logs"). Readers already exclude tombstones via isActiveServiceCall (deletedAt guard). serviceEstimates/activeServiceCalls do not feed MoneyPanel/Home exposure totals. multiDayServiceCalls is a SEPARATE scope (service.multiDayCalls, Phase 6R-C). Same client-clock and no-GC limitations as the project scopes.',
  },
  'service.multiDayCalls': {
    scope: 'service.multiDayCalls',
    dataPath: 'BackupData.multiDayServiceCalls[]',
    owner: 'V15rServiceCallsV2 / serviceCallService',
    level: 'top-level',
    identityField: 'service_call_id (fallback: id / serviceCallId / callId)',
    timestampField: 'updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'high',
    notes: 'Phase 6R-C: multiDayServiceCalls / ServiceCallsV2 has delete-safe item-level id-merge via serviceScopeMerge.ts (mergeMultiDayServiceCallsIntoRemote). service_call_id is the stable identity (falls back to id/serviceCallId/callId, then a deterministic fingerprint); stampMultiDayServiceCall stamps createdAt/updatedAt; deletes write deletedAt/deletedBy tombstones retained in raw backup while V15rServiceCallsV2 filters via getLiveMultiDayServiceCalls. Separate from service.calls (serviceLogs/serviceEstimates/activeServiceCalls). V15rServiceCallsV2 saves fetch latest remote and patch only multiDayServiceCalls through the existing remote-baseline path. A narrow pre-sync fold preserves newer remote multiDayServiceCalls on any non-service.multiDayCalls save.',
  },

  // ── Home agenda / custom alerts ──
  'home.agendaAlerts': {
    scope: 'home.agendaAlerts',
    dataPath: 'BackupData.agendaSections[] + BackupData.customAlerts[]',
    owner: 'V15rHome',
    level: 'top-level',
    identityField: 'agenda section id; agenda task id; custom alert id',
    timestampField: 'createdAt / updatedAt',
    tombstoneField: 'deletedAt',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'id-merge',
    priority: 'medium',
    notes: 'Phase 6S-G: Home agenda sub-categories/tasks and Nexus custom alerts merge by stable id with createdAt/updatedAt metadata; deletes are tombstones (deletedAt/deletedBy/status="deleted") retained in raw backup while V15rHome filters them via getLiveAgendaSections/getLiveCustomAlerts. Does not affect Home Job Health project cards or Service Jobs Requiring Attention. mergeHomeAgendaAlertsIntoRemote / mergeRemoteHomeAgendaAlertsIntoOutgoing in projectScopeMerge.ts. V15rHome writers fetch latest remote and patch only agendaSections/customAlerts. A narrow pre-sync fold preserves newer remote Home agenda/custom alerts on any non-home.agendaAlerts save.',
  },

  // ── Settings ──
  settings: {
    scope: 'settings',
    dataPath: 'settings{} + settings.fieldUpdatedAt{} + settings.fieldDeletedAt{}',
    owner: 'V15rSettingsPanel',
    level: 'top-level',
    identityField: 'singleton top-level field/group name',
    timestampField: 'settings.fieldUpdatedAt[fieldOrGroup]',
    tombstoneField: 'settings.fieldDeletedAt[fieldOrGroup]',
    needsTimestamp: false,
    needsTombstone: false,
    strategy: 'field-lww',
    priority: 'critical',
    notes: 'SYNC-02: settings remain one singleton scope, but every independent top-level scalar and whole logical group resolves separately. phaseWeights, ordered mtoPhases, overhead, defaultPricingCrewIds, and rfiLabels are whole groups; nested leaves are not independently timestamped. Strictly newer timestamp wins and remote wins ties. Timestamped explicit values (including null) beat legacy unstamped values; deletion tombstones distinguish intentional removal. Live refresh, scoped merges, broad saves, and the pre-sync remote-baseline fold all use settingsScopeMerge.ts. Owner/employee loaded rates, payroll burden, Team employee/crew costing, PTO/projections, laborCategory, and service cost snapshots/formulas remain deferred to SYNC-06.',
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
    'project.coordination',
    'project.schedule',
    'project.progress',
    'project.timeline',
    'project.notes',
    'project.lifecycle',
    'project.finance',
  ],
  'project.finance': [
    'project.finance',
  ],
  'project.timeline': [
    'project.timeline',
  ],
  'project.progress': [
    'project.progress',
  ],
  'project.schedule': [
    'project.schedule',
  ],
  'project.coordination': [
    'project.coordination',
  ],
  'project.estimate': [
    'project.estimate',
  ],
  'project.estimateVersions': [
    'project.estimateVersions',
  ],
  estimateVersions: [
    'project.estimateVersions',
  ],
  'home.agendaAlerts': [
    'home.agendaAlerts',
  ],
  agendaSections: [
    'home.agendaAlerts',
  ],
  customAlerts: [
    'home.agendaAlerts',
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
  serviceEstimates: [
    'service.calls',
  ],
  activeServiceCalls: [
    'service.calls',
  ],
  'service.calls': [
    'service.calls',
  ],
  'service.multiDayCalls': [
    'service.multiDayCalls',
  ],
  multiDayServiceCalls: [
    'service.multiDayCalls',
  ],
  ServiceCallsV2: [
    'service.multiDayCalls',
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
    'finance.weeklyData',
  ],
  blueprintSummaries: [
    'blueprint.annotations',
    'blueprint.workPackages',
    'blueprint.wireProfiles',
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
