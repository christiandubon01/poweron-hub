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
  fetchRecentControlRequests,
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
import { applyProgressLabel, noticeFromApplyResult, type ApplyNotice } from './applyCandidateView'

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
  fetchRecentControlRequests?(organizationId: string, repoKey: string, limit?: number): Promise<ControlRequestRow[]>
  fetchRunSnapshotRows(organizationId: string, limit?: number): Promise<RunSnapshotRow[]>
  fetchScopePackRows?(organizationId: string, repoKey: string): Promise<ScopePackRow[]>
}

/** The real service (Supabase). Injectable for fake-backed tests only. */
export const controlTowerService: ControlTowerServiceApi = {
  resolveContext: resolveControlTowerContext,
  fetchHostPresenceRows,
  insertControlRequest,
  fetchControlRequest,
  fetchRecentControlRequests,
  fetchRunSnapshotRows,
  fetchScopePackRows,
}

export interface ScopeDraft {
  scope: string
  constraints: string[]
  requestedRouting: { provider?: string; requestedModel?: string } | null
  roleRouting?: {
    architect?: { provider?: string; requestedModel?: string }
    implementer?: { provider?: string; requestedModel?: string }
    verifier?: { provider?: string; requestedModel?: string }
  } | null
  scopePackId?: string
  scopePackVersion?: number
  scopePackPhaseId?: string
  staleAcknowledged?: boolean
  ownerReviewedConflict?: boolean
  planningMode?: 'fast' | 'deep'
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
export const PLANNING_STATUS_LINES = [
  'Request received',
  'Architect started',
  'Using cached repo map',
  'Searching relevant areas',
  'Building plan',
  'Architect plan received',
  'Validating plan',
  'Validated',
  'Plan ready',
  'Plan format needs correction',
  'Architect correcting plan',
  'Validating corrected plan',
] as const

const PLANNING_STATUS_PATTERNS = [
  /^Found \d+ candidate files$/,
  /^Inspecting \d+ relevant files$/,
]

const PROVIDER_PLANNING_LINES = new Set<string>([
  'Building plan',
  'Architect plan received',
  'Validating plan',
  'Validated',
  'Plan ready',
  'Plan format needs correction',
  'Architect correcting plan',
  'Validating corrected plan',
])

export function planningStatusLine(result: Record<string, unknown> | null): string | null {
  const line = result?.planningStatus
  if (typeof line !== 'string') return null
  if ((PLANNING_STATUS_LINES as readonly string[]).includes(line)) return line
  return PLANNING_STATUS_PATTERNS.some(pattern => pattern.test(line)) ? line : null
}

export const APPROVAL_STATUS_LINES = [
  'Submitting approval',
  'Approval queued',
  'Host processing approval',
  'Creating run',
  'Run created',
  'Starting tasks',
] as const

function approvalStatusForRow(row: ControlRequestRow): string {
  if (row.status === 'pending') return 'Approval queued'
  if (row.status === 'claimed') {
    return row.result?.approvalStatus === 'Creating run' ? 'Creating run' : 'Host processing approval'
  }
  if (row.status === 'completed' && typeof row.result?.runId === 'string' && row.result.runId.length > 0) return 'Run created'
  return 'Host processing approval'
}

function approvalFailureMessage(row: ControlRequestRow): string {
  const reason = (row.error ?? 'The Host failed to start the Run.').slice(0, 500)
  return `Run could not be created.\nApproval request ${row.id} failed: ${reason}`
}

function sameApprovedPlan(row: ControlRequestRow, planId: string, planHash: string): boolean {
  return row.request_type === 'approve_plan' && row.payload.planId === planId && row.payload.planHash === planHash
}

function chooseDisplayedRun(
  views: ControlTowerRunView[],
  options: { preferredId: string | null; currentId: string | null; allowHistory: boolean },
): ControlTowerRunView | null {
  if (options.preferredId) {
    const created = views.find((view) => view.runId === options.preferredId)
    if (created) return created
    if (!options.allowHistory) return null
  }
  if (options.currentId) {
    const current = views.find((view) => view.runId === options.currentId)
    if (current && ACTIVE_RUN_STATES.has(current.runState)) return current
  }
  const active = views.find((view) => ACTIVE_RUN_STATES.has(view.runState))
  if (active) return active
  return options.allowHistory ? (views[0] ?? null) : null
}
const UNAVAILABLE_PRESENCE: HostPresenceView = { state: 'offline', repoKey: null, providers: [], providerFleet: [], hostVersion: null, lastSeenAt: null, hostInstanceId: null, restartRequired: false, restartDetectedAt: null, hostHealth: null }

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
  const [planningStatus, setPlanningStatus] = useState<string | null>(null)
  const [planningStartedAt, setPlanningStartedAt] = useState<number | null>(null)
  const [providerStartedAt, setProviderStartedAt] = useState<number | null>(null)
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null)
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
  const [applyRequestId, setApplyRequestId] = useState<string | null>(null)
  const [applyProgress, setApplyProgress] = useState<string | null>(null)
  const [applyNotice, setApplyNotice] = useState<ApplyNotice | null>(null)

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
  const approvedRunIdRef = useRef<string | null>(null)
  const approvalSubmitLock = useRef(false)
  const applyIdRef = useRef(applyRequestId)
  applyIdRef.current = applyRequestId
  const applySubmitLock = useRef(false)

  const applySnapshots = useCallback((rows: RunSnapshotRow[], options: { preferredId: string | null; allowHistory: boolean }) => {
    const views = rows.map(mapRunSnapshotRow).filter((view): view is ControlTowerRunView => view !== null)
    const selected = chooseDisplayedRun(views, {
      preferredId: options.preferredId,
      currentId: options.preferredId ? null : runIdRef.current,
      allowHistory: options.allowHistory,
    })
    if (selected) runIdRef.current = selected.runId
    if (selected || options.allowHistory) setRun(selected)
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
          setPlanningStatus(null)
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
          setPlanningStatus(null)
          setPlanError(row.error ?? 'The Host failed to create the plan.')
          setPhase('plan-error')
        } else {
          const line = planningStatusLine(row?.result ?? null)
          if (line) {
            setPlanningStatus(line)
            if (PROVIDER_PLANNING_LINES.has(line)) {
              setProviderStartedAt(current => current ?? Date.now())
            }
          }
        }
      } catch {
        // transient poll failure — keep the current phase
      }
    }

    // Approve poll: has the Host created the Run?
    let phaseNow = phaseRef.current
    if (!approvingIdRef.current && !planningIdRef.current && (phaseNow === 'idle' || phaseNow === 'unavailable') && nextPresence.repoKey && service.fetchRecentControlRequests) {
      try {
        const recent = await service.fetchRecentControlRequests(org, nextPresence.repoKey, 8)
        const inflight = recent.find((row) => row.request_type === 'approve_plan' && (row.status === 'pending' || row.status === 'claimed'))
        if (inflight) {
          approvingIdRef.current = inflight.client_request_id
          setApprovingRequestId(inflight.client_request_id)
          setApprovalStatus(approvalStatusForRow(inflight))
          phaseNow = 'approving'
          phaseRef.current = phaseNow
          setPhase(phaseNow)
        }
      } catch {
        // A recovery miss keeps the last honest phase. The next poll retries.
      }
    }

    const approvingId = approvingIdRef.current
    if (approvingId) {
      try {
        const row = await service.fetchControlRequest(org, approvingId)
        if (row?.status === 'failed') {
          approvingIdRef.current = null
          approvedRunIdRef.current = null
          setApprovingRequestId(null)
          setApprovalStatus(null)
          setPlanError(approvalFailureMessage(row))
          phaseNow = 'approving-error'
          phaseRef.current = phaseNow
          setPhase(phaseNow)
        } else if (row?.status === 'completed') {
          const result = row.result
          const runId = result?.runId
          if (typeof runId === 'string' && runId.length > 0) {
            approvedRunIdRef.current = runId
            setApprovalStatus('Run created')
          } else if (result?.phaseResult === 'audit-accepted') {
            approvingIdRef.current = null
            setApprovingRequestId(null)
            setApprovalStatus(null)
            setPlanError('Audit accepted. No run was created.')
            phaseNow = 'approving-error'
            phaseRef.current = phaseNow
            setPhase(phaseNow)
          }
        } else if (row && (row.status === 'pending' || row.status === 'claimed')) {
          setApprovalStatus(approvalStatusForRow(row))
        }
      } catch {
        // transient poll failure — keep the current phase
      }
    }

    const applyId = applyIdRef.current
    if (applyId) {
      try {
        const row = await service.fetchControlRequest(org, applyId)
        if (row?.status === 'pending') {
          setApplyProgress('Apply requested')
        } else if (row && (row.status === 'claimed')) {
          const label = applyProgressLabel(row.result?.phase)
          if (label) setApplyProgress(label)
        } else if (row && (row.status === 'completed' || row.status === 'failed')) {
          setApplyNotice(noticeFromApplyResult(row.status, row.result, row.error))
          setApplyProgress(row.status === 'completed' ? 'Applied' : applyProgressLabel(row.result?.phase))
          applyIdRef.current = null
          setApplyRequestId(null)
        }
      } catch {
        // A transient poll miss keeps the last honest apply state.
      }
    }

    // Snapshots: current run + history. An in-flight approval never adopts an older session.
    try {
      const rows = await service.fetchRunSnapshotRows(org, 5)
      const waitingForNewRun = phaseNow === 'approving' || phaseNow === 'approving-error'
      const { selected } = applySnapshots(rows, {
        preferredId: approvedRunIdRef.current,
        allowHistory: !waitingForNewRun,
      })
      if (phaseNow === 'approving' && selected && selected.runId === approvedRunIdRef.current) {
        setApprovalStatus(selected.runState === 'pending' ? 'Starting tasks' : null)
        phaseNow = 'run'
        phaseRef.current = phaseNow
        setPhase(phaseNow)
        setApprovingRequestId(null)
        approvingIdRef.current = null
      } else if (phaseNow === 'idle' || phaseNow === 'unavailable') {
        const nextPhase = selected && ACTIVE_RUN_STATES.has(selected.runState) ? 'run' : 'idle'
        phaseRef.current = nextPhase
        setPhase(nextPhase)
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
    setPlanningStatus('Request received')
    setPlanningStartedAt(Date.now())
    setProviderStartedAt(null)
    setPlan(null)
    setPlanError(null)
    setPhase('planning')
    try {
      await service.insertControlRequest({
        organizationId: org,
        repoKey: presence.repoKey,
        requestType: 'create_plan',
        clientRequestId,
        payload: {
          scope,
          constraints: input.constraints,
          planningMode: input.planningMode ?? 'fast',
          ...(input.requestedRouting ? { requestedRouting: input.requestedRouting } : {}),
          ...(input.roleRouting ? { roleRouting: input.roleRouting } : {}),
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
      setPlanningRequestId(clientRequestId)
    } catch (error) {
      setPlanningStatus(null)
      setPlanningStartedAt(null)
      setProviderStartedAt(null)
      setPhase('composing')
      throw error
    } finally {
      setBusy(false)
    }
  }, [presence.repoKey, service])

  /** New create_plan from the same owner inputs. The failed request stays historical. */
  const retryPlanning = useCallback(async (): Promise<void> => {
    await submitScope(draft)
  }, [draft, submitScope])

  /** Owner approves the EXACT plan (planId + planHash) → approve_plan request. */
  const approvePlan = useCallback(async (): Promise<void> => {
    if (approvalSubmitLock.current || approvingIdRef.current) return
    const org = contextRef.current?.organizationId
    const currentPlan = planRef.current
    if (!org || !currentPlan) throw new Error('No plan to approve.')
    if (!presence.repoKey) throw new Error('No connected Host repository.')
    approvalSubmitLock.current = true
    setBusy(true)
    setApprovalStatus('Submitting approval')
    phaseRef.current = 'approving'
    setPhase('approving')
    try {
      const recent = service.fetchRecentControlRequests
        ? await service.fetchRecentControlRequests(org, presence.repoKey, 8)
        : []
      const matching = recent.filter((row) => sameApprovedPlan(row, currentPlan.planId, currentPlan.planHash))
      const inflight = matching.find((row) => row.status === 'pending' || row.status === 'claimed')
      const succeeded = matching.find((row) => row.status === 'completed' && typeof row.result?.runId === 'string' && row.result.runId.length > 0)
      if (inflight) {
        approvingIdRef.current = inflight.client_request_id
        setApprovingRequestId(inflight.client_request_id)
        setApprovalStatus(approvalStatusForRow(inflight))
        return
      }
      if (succeeded) {
        approvedRunIdRef.current = String(succeeded.result?.runId)
        approvingIdRef.current = succeeded.client_request_id
        setApprovingRequestId(succeeded.client_request_id)
        setApprovalStatus('Run created')
        return
      }
      const clientRequestId = makeClientRequestId()
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
      approvingIdRef.current = clientRequestId
      setApprovingRequestId(clientRequestId)
      setApprovalStatus('Approval queued')
    } catch (error) {
      phaseRef.current = 'plan-review'
      setPhase('plan-review')
      setApprovalStatus(null)
      throw error
    } finally {
      approvalSubmitLock.current = false
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
    approvingIdRef.current = null
    approvedRunIdRef.current = null
    setApprovingRequestId(null)
    setApprovalStatus(null)
    setPlan(null)
    setPlanError(null)
    setPlanningStatus(null)
    setPlanningStartedAt(null)
    setProviderStartedAt(null)
    const nextPhase = contextRef.current ? 'idle' : 'unavailable'
    phaseRef.current = nextPhase
    setPhase(nextPhase)
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

  /** Owner explicitly applies one verified candidate. The Host owns the files. */
  const requestApplyCandidate = useCallback(async (targetRunId: string, attemptId: string): Promise<void> => {
    if (applySubmitLock.current || applyIdRef.current) return
    const org = contextRef.current?.organizationId
    if (!org) throw new Error('Not authenticated.')
    if (!presence.repoKey) throw new Error('No connected Host repository.')
    applySubmitLock.current = true
    setBusy(true)
    setApplyNotice(null)
    setApplyProgress('Apply requested')
    const clientRequestId = makeClientRequestId()
    try {
      await service.insertControlRequest({
        organizationId: org,
        repoKey: presence.repoKey,
        requestType: 'apply_candidate',
        clientRequestId,
        payload: { runId: targetRunId, attemptId },
      })
      applyIdRef.current = clientRequestId
      setApplyRequestId(clientRequestId)
    } catch (error) {
      setApplyProgress(null)
      throw error
    } finally {
      applySubmitLock.current = false
      setBusy(false)
    }
  }, [presence.repoKey, service])

  return useMemo(() => ({
    phase,
    presence,
    hostRestartRequired: presence.restartRequired,
    context,
    contextError,
    plan,
    planError,
    planningStatus,
    planningStartedAt,
    providerStartedAt,
    approvalStatus,
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
    retryPlanning,
    approvePlan,
    cancelPlanReview,
    cancelRun,
    applyProgress,
    applyNotice,
    requestApplyCandidate,
  }), [
    phase, presence, context, contextError, plan, planError, planningStatus, planningStartedAt, providerStartedAt, approvalStatus, run, runHistory, draft, busy,
    scopePacks, scopePackRows, importWarning, scopeStorage, importing, importScopePack, refresh,
    openComposer, closeComposer, editScope, submitScope, retryPlanning, approvePlan, cancelPlanReview, cancelRun,
    applyProgress, applyNotice, requestApplyCandidate,
  ])
}
