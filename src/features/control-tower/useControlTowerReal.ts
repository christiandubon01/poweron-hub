/**
 * CT-CORE-1: the REAL Control Tower hook.
 *
 * Wires the authenticated browser to the control-plane tables and drives the
 * owner-facing state machine (§34-§35):
 *   unavailable → idle → composing → planning → plan-review → approving →
 *   run (live snapshots) → terminal.
 *
 * No fixture fallback (§30): every displayed value comes from a real query or
 * a real Host-published row. Planning/approval/cancel are REQUESTS — the
 * browser never executes anything and never talks to the Host directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SCOPE_STORAGE_PENDING_MESSAGE, isScopeStoragePendingError, type ScopeStorageState } from './scopeStorage'
import {
  computeHostPresence,
  mapPlanResult,
  mapRunSnapshotRow,
  type ControlTowerRunView,
  type HostPresenceView,
  type PlanReviewModel,
} from './controlTowerAdapter'
import {
  insertControlRequest,
  fetchControlRequest,
  fetchHostPresenceRows,
  fetchRunSnapshotRows,
  fetchScopePackRows,
  resolveControlTowerContext,
  type ControlRequestRow,
  type ControlRequestType,
  type ControlTowerContext,
  type HostPresenceRow,
  type RunSnapshotRow,
  type ScopePackRow,
} from './controlTowerService'
import type { ScopePackImportDraft, ScopePackListItem } from './scopePack/types'

// Re-exported for the composer/panel components that consume presence views.
export type { HostPresenceView } from './controlTowerAdapter'

export type ControlTowerPhase =
  | 'unavailable'
  | 'idle'
  | 'composing'
  | 'planning'
  | 'plan-review'
  | 'plan-error'
  | 'approving'
  | 'approving-error'
  | 'run'

export interface ControlTowerServiceApi {
  resolveContext(): Promise<ControlTowerContext>
  fetchHostPresenceRows(organizationId: string): Promise<HostPresenceRow[]>
  insertControlRequest(input: {
    organizationId: string
    repoKey: string
    requestType: ControlRequestType
    clientRequestId: string
    payload: Record<string, unknown>
  }): Promise<ControlRequestRow>
  fetchControlRequest(organizationId: string, clientRequestId: string): Promise<ControlRequestRow | null>
  fetchRunSnapshotRows(organizationId: string, limit?: number): Promise<RunSnapshotRow[]>
  fetchScopePackRows?(organizationId: string, repoKey: string): Promise<ScopePackRow[]>
}

/** The real service (Supabase). Injectable for fake-backed tests only. */
export const controlTowerService: ControlTowerServiceApi = {
  resolveContext: resolveControlTowerContext,
  fetchHostPresenceRows,
  insertControlRequest,
  fetchControlRequest,
  fetchRunSnapshotRows,
  fetchScopePackRows,
}

export interface ScopeDraft {
  scope: string
  constraints: string[]
  requestedRouting: { provider?: string; requestedModel?: string } | null
  scopePackId?: string
  scopePackVersion?: number
  scopePackPhaseId?: string
  staleAcknowledged?: boolean
  ownerReviewedConflict?: boolean
}

function toListItem(row: ScopePackRow): ScopePackListItem {
  const pack = row.pack ?? {}
  const phases = Array.isArray(pack.roadmapPhases) ? pack.roadmapPhases as Array<Record<string, unknown>> : []
  const selected = phases.find(phase => String(phase.id) === row.current_phase_id)
  return {
    packId: row.id,
    title: row.title,
    currentPhaseId: row.current_phase_id,
    currentPhaseTitle: typeof selected?.title === 'string' ? selected.title : null,
    reconciliationState: row.reconciliation_state,
    historicalCheckpoint: typeof pack.historicalCheckpoint === 'string' ? pack.historicalCheckpoint : null,
    lastReconciledAt: row.last_reconciled_at,
    version: row.version,
    sourceFilename: row.source_filename,
    sourceHash: row.source_hash,
  }
}

const ACTIVE_RUN_STATES = new Set(['pending', 'running', 'paused'])
const UNAVAILABLE_PRESENCE: HostPresenceView = { state: 'unavailable', repoKey: null, providers: [], providerFleet: [], hostVersion: null, lastSeenAt: null, hostInstanceId: null }

function makeClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `req-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

export function useControlTowerReal(options: { service?: ControlTowerServiceApi; pollIntervalMs?: number } = {}) {
  const service = options.service ?? controlTowerService
  const pollIntervalMs = options.pollIntervalMs ?? 4_000

  const [context, setContext] = useState<ControlTowerContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [presence, setPresence] = useState<HostPresenceView>(UNAVAILABLE_PRESENCE)
  const [phase, setPhase] = useState<ControlTowerPhase>('unavailable')
  const [plan, setPlan] = useState<PlanReviewModel | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planningRequestId, setPlanningRequestId] = useState<string | null>(null)
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null)
  const [run, setRun] = useState<ControlTowerRunView | null>(null)
  const [runHistory, setRunHistory] = useState<ControlTowerRunView[]>([])
  const [draft, setDraft] = useState<ScopeDraft>({ scope: '', constraints: [], requestedRouting: null })
  const [busy, setBusy] = useState(false)
  const [scopePacks, setScopePacks] = useState<ScopePackListItem[]>([])
  const [scopePackRows, setScopePackRows] = useState<ScopePackRow[]>([])
  const [importWarning, setImportWarning] = useState<string | null>(null)
  const [scopeStorage, setScopeStorage] = useState<ScopeStorageState>('unknown')
  const [importing, setImporting] = useState(false)

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const planningIdRef = useRef(planningRequestId)
  planningIdRef.current = planningRequestId
  const approvingIdRef = useRef(approvingRequestId)
  approvingIdRef.current = approvingRequestId
  const planRef = useRef(plan)
  planRef.current = plan
  const contextRef = useRef(context)
  contextRef.current = context
  const runIdRef = useRef<string | null>(null)
  runIdRef.current = run?.runId ?? runIdRef.current

  const applySnapshots = useCallback((rows: RunSnapshotRow[]) => {
    const views = rows.map(mapRunSnapshotRow).filter((view): view is ControlTowerRunView => view !== null)
    const desiredId = runIdRef.current
    const selected = (desiredId ? views.find((view) => view.runId === desiredId) : null) ?? views[0] ?? null
    if (selected) runIdRef.current = selected.runId
    setRun(selected)
    setRunHistory(views)
    return { selected, views }
  }, [])

  /** One poll cycle: presence, in-flight requests, and run snapshots. */
  const refresh = useCallback(async (): Promise<void> => {
    let activeContext = contextRef.current
    if (!activeContext) {
      try {
        activeContext = await service.resolveContext()
        setContext(activeContext)
        setContextError(null)
      } catch (error) {
        setContextError(error instanceof Error ? error.message : String(error))
        setPhase('unavailable')
        return
      }
    }
    const org = activeContext.organizationId

    let presenceRows: HostPresenceRow[] = []
    try {
      presenceRows = await service.fetchHostPresenceRows(org)
    } catch {
      setPresence(UNAVAILABLE_PRESENCE)
    }
    const nextPresence = computeHostPresence(presenceRows, Date.now())
    setPresence(nextPresence)

    // Planning poll: has the Host completed the create_plan request?
    const planningId = planningIdRef.current
    if (planningId) {
      try {
        const row = await service.fetchControlRequest(org, planningId)
        if (row?.status === 'completed') {
          setPlanningRequestId(null)
          const mapped = mapPlanResult(row.result)
          if (mapped) {
            setPlan(mapped)
            setPlanError(null)
            setPhase('plan-review')
          } else {
            setPlanError('The Host returned a plan that could not be read. Create a new plan.')
            setPhase('plan-error')
          }
        } else if (row?.status === 'failed') {
          setPlanningRequestId(null)
          setPlanError(row.error ?? 'The Host failed to create the plan.')
          setPhase('plan-error')
        }
      } catch {
        // transient poll failure — keep the current phase
      }
    }

    // Approve poll: has the Host created the Run?
    const approvingId = approvingIdRef.current
    if (approvingId) {
      try {
        const row = await service.fetchControlRequest(org, approvingId)
        if (row?.status === 'failed') {
          setApprovingRequestId(null)
          setPlanError(row.error ?? 'The Host failed to start the Run.')
          setPhase('approving-error')
        } else if (row?.status === 'completed') {
          const runId = (row.result as Record<string, unknown> | null)?.runId
          if (typeof runId === 'string') runIdRef.current = runId
        }
      } catch {
        // transient poll failure
      }
    }

    // Snapshots: current run + history.
    try {
      const rows = await service.fetchRunSnapshotRows(org, 5)
      const { selected } = applySnapshots(rows)
      if (phaseRef.current === 'approving' && selected && runIdRef.current === selected.runId) {
        setApprovingRequestId(null)
        setPhase('run')
      } else if (phaseRef.current === 'idle' || phaseRef.current === 'unavailable') {
        setPhase(selected && ACTIVE_RUN_STATES.has(selected.runState) ? 'run' : 'idle')
      }
    } catch {
      // Snapshot fetch failures leave the last-known state; presence stays honest.
    }

    if (nextPresence.repoKey && service.fetchScopePackRows) {
      try {
        const packs = await service.fetchScopePackRows(org, nextPresence.repoKey)
        setScopePackRows(packs)
        setScopePacks(packs.map(toListItem))
        setScopeStorage('ready')
      } catch (error) {
        if (isScopeStoragePendingError(error)) setScopeStorage('pending')
      }
    }
  }, [applySnapshots, service])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (pollIntervalMs <= 0) return
    const timer = window.setInterval(() => { void refresh() }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [refresh, pollIntervalMs])

  const openComposer = useCallback(() => { setPhase('composing') }, [])
  const closeComposer = useCallback(() => { setPhase(contextRef.current ? 'idle' : 'unavailable') }, [])
  const editScope = useCallback(() => { setPhase('composing') }, [])

  /** Owner submits scope → typed create_plan request. Host must be connected (§36). */
  const submitScope = useCallback(async (input: ScopeDraft): Promise<void> => {
    const org = contextRef.current?.organizationId
    if (!org) throw new Error('Not authenticated.')
    const scope = input.scope.trim()
    if (!scope) throw new Error('Scope is required.')
    if (!presence.repoKey) throw new Error('No connected Host repository.')
    const clientRequestId = makeClientRequestId()
    setBusy(true)
    try {
      await service.insertControlRequest({
        organizationId: org,
        repoKey: presence.repoKey,
        requestType: 'create_plan',
        clientRequestId,
        payload: {
          scope,
          constraints: input.constraints,
          ...(input.requestedRouting ? { requestedRouting: input.requestedRouting } : {}),
          ...(input.scopePackId && input.scopePackVersion && input.scopePackPhaseId
            ? {
                scopePackId: input.scopePackId,
                scopePackVersion: input.scopePackVersion,
                scopePackPhaseId: input.scopePackPhaseId,
                ...(input.staleAcknowledged ? { staleAcknowledged: true } : {}),
                ...(input.ownerReviewedConflict ? { ownerReviewedConflict: true } : {}),
              }
            : {}),
        },
      })
      setDraft(input)
      setPlan(null)
      setPlanError(null)
      setPlanningRequestId(clientRequestId)
      setPhase('planning')
    } finally {
      setBusy(false)
    }
  }, [presence.repoKey, service])

  /** Owner approves the EXACT plan (planId + planHash) → approve_plan request. */
  const approvePlan = useCallback(async (): Promise<void> => {
    const org = contextRef.current?.organizationId
    const currentPlan = planRef.current
    if (!org || !currentPlan) throw new Error('No plan to approve.')
    if (!presence.repoKey) throw new Error('No connected Host repository.')
    const clientRequestId = makeClientRequestId()
    setBusy(true)
    try {
      await service.insertControlRequest({
        organizationId: org,
        repoKey: presence.repoKey,
        requestType: 'approve_plan',
        clientRequestId,
        payload: {
          planId: currentPlan.planId,
          planHash: currentPlan.planHash,
          ...(currentPlan.approval?.requiresStaleAcknowledgment ? { staleAcknowledged: true } : {}),
          ...(currentPlan.approval?.requiresOwnerReview ? { ownerReviewedConflict: true } : {}),
        },
      })
      setApprovingRequestId(clientRequestId)
      setPhase('approving')
    } finally {
      setBusy(false)
    }
  }, [presence.repoKey, service])

  const importScopePack = useCallback(async (draftInput: ScopePackImportDraft): Promise<{ packId: string; duplicate: boolean } | null> => {
    const org = contextRef.current?.organizationId
    if (!org) throw new Error('Not authenticated.')
    if (!presence.repoKey) throw new Error('No connected Host repository.')
    const clientRequestId = makeClientRequestId()
    setImporting(true)
    setImportWarning(null)
    try {
      await service.insertControlRequest({
        organizationId: org,
        repoKey: presence.repoKey,
        requestType: 'import_scope_pack',
        clientRequestId,
        payload: { ...draftInput },
      })
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const row = await service.fetchControlRequest(org, clientRequestId)
        if (row?.status === 'failed') {
          const message = row.error ?? 'Scope Pack import failed.'
          if (isScopeStoragePendingError(message)) {
            setScopeStorage('pending')
            setImportWarning(SCOPE_STORAGE_PENDING_MESSAGE)
            return null
          }
          throw new Error(message)
        }
        if (row?.status === 'completed') {
          const result = row.result ?? {}
          const duplicate = result.duplicate === true
          if (duplicate) setImportWarning(typeof result.warning === 'string' ? result.warning : 'This handoff was already imported.')
          if (presence.repoKey && service.fetchScopePackRows) {
            const packs = await service.fetchScopePackRows(org, presence.repoKey)
            setScopePackRows(packs)
            setScopePacks(packs.map(toListItem))
          }
          return { packId: String(result.packId ?? result.existingPackId ?? ''), duplicate }
        }
      }
      return { packId: '', duplicate: false }
    } catch (error) {
      if (isScopeStoragePendingError(error)) {
        setScopeStorage('pending')
        setImportWarning(SCOPE_STORAGE_PENDING_MESSAGE)
        return null
      }
      throw error
    } finally {
      setImporting(false)
    }
  }, [presence.repoKey, service])

  /** Discard the reviewed plan (does not touch any Run). */
  const cancelPlanReview = useCallback(() => {
    setPlan(null)
    setPlanError(null)
    setPhase(contextRef.current ? 'idle' : 'unavailable')
  }, [])

  /** Owner cancels an active Run — a typed request, executed only by the Host. */
  const cancelRun = useCallback(async (targetRunId: string): Promise<void> => {
    const org = contextRef.current?.organizationId
    if (!org) throw new Error('Not authenticated.')
    if (!presence.repoKey) throw new Error('No connected Host repository.')
    setBusy(true)
    try {
      await service.insertControlRequest({
        organizationId: org,
        repoKey: presence.repoKey,
        requestType: 'cancel_run',
        clientRequestId: makeClientRequestId(),
        payload: { runId: targetRunId },
      })
    } finally {
      setBusy(false)
    }
  }, [presence.repoKey, service])

  return useMemo(() => ({
    phase,
    presence,
    context,
    contextError,
    plan,
    planError,
    run,
    runHistory,
    draft,
    busy,
    scopePacks,
    scopePackRows,
    importWarning,
    scopeStorage,
    importing,
    importScopePack,
    refresh,
    openComposer,
    closeComposer,
    editScope,
    submitScope,
    approvePlan,
    cancelPlanReview,
    cancelRun,
  }), [
    phase, presence, context, contextError, plan, planError, run, runHistory, draft, busy,
    scopePacks, scopePackRows, importWarning, scopeStorage, importing, importScopePack, refresh,
    openComposer, closeComposer, editScope, submitScope, approvePlan, cancelPlanReview, cancelRun,
  ])
}