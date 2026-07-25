import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cable, Plus, X } from 'lucide-react'
import { getBackupData } from '@/services/backupDataService'
import {
  archiveOperationsBlueprintWireProfile,
  createOperationsBlueprintWireProfile,
  deleteUnreferencedOperationsBlueprintWireProfile,
  duplicateOperationsBlueprintWireProfile,
  getOperationsBlueprintWireProfiles,
  identifyOperationsBlueprintWireProfileReferences,
  restoreOperationsBlueprintWireProfile,
  updateOperationsBlueprintWireProfile,
  type BlueprintAnnotation,
  type SaveBlueprintAnnotationsResult,
} from '@/services/blueprintLibraryService'
import type { WireProfile } from '../types'
import {
  defaultWireProfileDraft,
  validateWireProfileDraft,
  type WireProfileDraft,
} from '../wireProfileDraftValidation'
import {
  collectMissingWireProfileReferenceIds,
  summarizeWireProfileReferences,
  type WireProfileReferenceSummary,
} from '../wireProfileReferenceSummary'
import {
  STARTER_WIRE_PROFILES,
  buildStarterWireProfileCreateInput,
  getMissingStarterWireProfiles,
  summarizeStarterWireProfileResult,
  type StarterWireProfileResult,
} from '../starterWireProfiles'
import {
  canApplyWireProfileAsyncResult,
  canDismissWireProfileManager,
  classifyWireProfileSaveResult,
  draftFromWireProfile,
  filterWireProfiles,
  getWireProfileCloseRequestResult,
  getWireProfileConfirmedDiscardResult,
  getWireProfileEscapeOutcome,
  getWireProfileListState,
  getWireProfileModalOverlayClassName,
  getWireProfileProjectChangeResult,
  isWireProfileDraftDirty,
  reconcileWireProfileConfirmationForRefresh,
  reconcileWireProfileSelection,
  type WireProfileDiscardDraftAction,
  type WireProfileActionState,
  type WireProfileFilter,
} from '../wireProfileManagerState'
import { WireProfileConfirmDialog } from './WireProfileConfirmDialog'
import { WireProfileForm } from './WireProfileForm'
import { WireProfileList } from './WireProfileList'

type ConfirmState =
  | { type: 'archive'; profileId: string; profileName: string }
  | { type: 'delete'; profileId: string; profileName: string; summary: WireProfileReferenceSummary }
  | { type: 'discard-draft'; action: WireProfileDiscardDraftAction; title: string; body: string; confirmLabel: string }

function readProjectAnnotations(backup: any, projectId: string): BlueprintAnnotation[] {
  const annotationMap = backup?.blueprintSummaries?.operationsBlueprintAnnotations
  if (!annotationMap || typeof annotationMap !== 'object' || Array.isArray(annotationMap)) return []
  const out: BlueprintAnnotation[] = []
  for (const rawList of Object.values(annotationMap)) {
    if (!Array.isArray(rawList)) continue
    for (const annotation of rawList as BlueprintAnnotation[]) {
      if (String(annotation?.projectId || '').trim() === projectId && !annotation.deletedAt) out.push(annotation)
    }
  }
  return out
}

function statusMessage(result: SaveBlueprintAnnotationsResult, action: string): { tone: 'success' | 'warning' | 'error'; text: string } {
  const tone = classifyWireProfileSaveResult(result)
  if (tone === 'error') return { tone, text: result.error || `${action} failed.` }
  if (tone === 'warning') return { tone, text: result.warning || `${action} saved locally. Cloud sync is pending.` }
  return { tone, text: `${action} saved.` }
}

export function WireProfileManagerDialog({
  open,
  projectId,
  projectName,
  portalTarget,
  remoteRefreshVersion = 0,
  onForceClose,
}: {
  open: boolean
  projectId?: string | null
  projectName?: string
  portalTarget?: HTMLElement | null
  remoteRefreshVersion?: number
  onForceClose: () => void
}) {
  const cleanProjectId = String(projectId || '').trim()
  const projectReady = !!cleanProjectId
  const mountedRef = useRef(false)
  const sessionRef = useRef(0)
  const actionTokenRef = useRef(0)
  const projectRef = useRef(cleanProjectId)
  const baselineDraftRef = useRef<WireProfileDraft>(defaultWireProfileDraft())
  const modeRef = useRef<'create' | 'edit'>('create')
  const [profiles, setProfiles] = useState<WireProfile[]>([])
  const [filter, setFilter] = useState<WireProfileFilter>('active')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WireProfileDraft>(defaultWireProfileDraft)
  const [baselineDraft, setBaselineDraft] = useState<WireProfileDraft>(defaultWireProfileDraft)
  const [mode, setMode] = useState<'create' | 'edit'>('create')
  const [summaries, setSummaries] = useState<Record<string, WireProfileReferenceSummary>>({})
  const [missingReferenceIds, setMissingReferenceIds] = useState<string[]>([])
  const [action, setAction] = useState<WireProfileActionState>('idle')
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const busy = action !== 'idle'
  const canDismiss = canDismissWireProfileManager({ busy, confirmOpen: !!confirm })
  const draftDirty = useMemo(() => isWireProfileDraftDirty({ draft, baselineDraft }), [draft, baselineDraft])
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedId && !profile.deletedAt) || null,
    [profiles, selectedId],
  )
  const validation = useMemo(() => validateWireProfileDraft(draft), [draft])
  const visibleProfiles = useMemo(() => filterWireProfiles(profiles, filter), [profiles, filter])
  const listState = useMemo(() => getWireProfileListState(profiles, filter), [profiles, filter])
  const liveProfiles = useMemo(() => profiles.filter((profile) => !profile.deletedAt), [profiles])
  const allProfilesEmpty = liveProfiles.length === 0

  useEffect(() => {
    baselineDraftRef.current = baselineDraft
  }, [baselineDraft])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const performClose = useCallback(() => {
    sessionRef.current += 1
    actionTokenRef.current += 1
    onForceClose()
  }, [onForceClose])

  const requestClose = useCallback(() => {
    const closeResult = getWireProfileCloseRequestResult({ busy, confirmOpen: !!confirm, dirty: draftDirty })
    if (closeResult === 'blocked-busy' || closeResult === 'blocked-confirm') return
    if (closeResult === 'open-discard-confirm') {
      setConfirm({
        type: 'discard-draft',
        action: { kind: 'close-manager' },
        title: 'Discard Unsaved Changes?',
        body: 'Unsaved wire profile edits will be lost. The profile will not be changed unless you save it first.',
        confirmLabel: 'Discard and Close',
      })
      return
    }
    performClose()
  }, [busy, confirm, draftDirty, performClose])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionRef.current += 1
      actionTokenRef.current += 1
    }
  }, [])

  const refresh = useCallback((preferredSelectedId?: string | null) => {
    if (!projectReady) {
      setProfiles([])
      setSummaries({})
      setMissingReferenceIds([])
      setSelectedId(null)
      setMode('create')
      const cleanDraft = defaultWireProfileDraft()
      setDraft(cleanDraft)
      setBaselineDraft(cleanDraft)
      return
    }
    const backup = getBackupData()
    const nextProfiles = getOperationsBlueprintWireProfiles(backup, cleanProjectId)
    const nextSummaries: Record<string, WireProfileReferenceSummary> = {}
    for (const profile of nextProfiles) {
      const references = identifyOperationsBlueprintWireProfileReferences(backup, cleanProjectId, profile.id)
      nextSummaries[profile.id] = summarizeWireProfileReferences(references, profile.id)
    }
    setProfiles(nextProfiles)
    setSummaries(nextSummaries)
    setMissingReferenceIds(collectMissingWireProfileReferenceIds(readProjectAnnotations(backup, cleanProjectId), nextProfiles.map((profile) => profile.id)))
    setConfirm((current) => {
      const normalized = current?.type === 'discard-draft'
        ? { type: current.type, action: current.action }
        : current
          ? { type: current.type, profileId: current.profileId }
          : null
      const result = reconcileWireProfileConfirmationForRefresh(normalized, nextProfiles)
      if (result.cleared) setMessage({ tone: 'warning', text: 'The pending wire profile confirmation was cleared because the target profile changed elsewhere.' })
      return result.confirm ? current : null
    })
    setSelectedId((previous) => {
      const nextSelectedId = reconcileWireProfileSelection(preferredSelectedId ?? previous, nextProfiles)
      if (!nextSelectedId) {
        setMode('create')
        const cleanDraft = defaultWireProfileDraft()
        setDraft(cleanDraft)
        setBaselineDraft(cleanDraft)
        return null
      }
      const nextSelectedProfile = nextProfiles.find((profile) => profile.id === nextSelectedId && !profile.deletedAt) || null
      if (nextSelectedProfile) {
        const nextBaseline = draftFromWireProfile(nextSelectedProfile)
        setBaselineDraft(nextBaseline)
        setDraft((currentDraft) => (
          modeRef.current === 'edit' && !isWireProfileDraftDirty({ draft: currentDraft, baselineDraft: baselineDraftRef.current })
            ? nextBaseline
            : currentDraft
        ))
      }
      return nextSelectedId
    })
  }, [cleanProjectId, projectReady])

  useEffect(() => {
    if (!open) return
    sessionRef.current += 1
    actionTokenRef.current += 1
    projectRef.current = cleanProjectId
    const cleanDraft = defaultWireProfileDraft()
    setFilter('active')
    setMode('create')
    setDraft(cleanDraft)
    setBaselineDraft(cleanDraft)
    setAction('idle')
    setMessage(null)
    setConfirm(null)
    refresh(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (getWireProfileProjectChangeResult({ open, previousProjectId: projectRef.current, nextProjectId: cleanProjectId }) === 'no-op') return
    sessionRef.current += 1
    actionTokenRef.current += 1
    projectRef.current = cleanProjectId
    const cleanDraft = defaultWireProfileDraft()
    setFilter('active')
    setMode('create')
    setSelectedId(null)
    setDraft(cleanDraft)
    setBaselineDraft(cleanDraft)
    setAction('idle')
    setMessage(null)
    setConfirm(null)
    onForceClose()
  }, [cleanProjectId, onForceClose, open])

  useEffect(() => {
    if (open) refresh(selectedId)
  }, [open, refresh, remoteRefreshVersion, selectedId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const outcome = getWireProfileEscapeOutcome({ busy, confirmOpen: !!confirm })
      if (outcome === 'cancel-confirm') {
        setConfirm(null)
        return
      }
      if (outcome === 'close') requestClose()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [busy, confirm, open, requestClose])

  useEffect(() => {
    if (!selectedProfile || mode !== 'edit') return
    const nextDraft = draftFromWireProfile(selectedProfile)
    setDraft(nextDraft)
    setBaselineDraft(nextDraft)
  }, [mode, selectedProfile?.id])

  if (!open) return null

  const selectProfile = (profile: WireProfile) => {
    if (busy) return
    if (draftDirty) {
      setConfirm({
        type: 'discard-draft',
        action: { kind: 'select-profile', profileId: profile.id },
        title: 'Discard Unsaved Changes?',
        body: 'Unsaved wire profile edits will be lost before switching profiles. The current profile will not be changed unless you save it first.',
        confirmLabel: 'Discard Changes',
      })
      return
    }
    setSelectedId(profile.id)
    setMode('edit')
    const nextDraft = draftFromWireProfile(profile)
    setDraft(nextDraft)
    setBaselineDraft(nextDraft)
    setMessage(null)
  }

  const startNew = () => {
    if (busy) return
    if (draftDirty) {
      setConfirm({
        type: 'discard-draft',
        action: { kind: 'start-new' },
        title: 'Discard Unsaved Changes?',
        body: 'Unsaved wire profile edits will be lost. A new profile form will open after discarding.',
        confirmLabel: 'Discard Changes',
      })
      return
    }
    setSelectedId(null)
    setMode('create')
    const cleanDraft = defaultWireProfileDraft()
    setDraft(cleanDraft)
    setBaselineDraft(cleanDraft)
    setMessage(null)
  }

  const performSecondaryAction = () => {
    if (busy) return
    if (draftDirty) {
      setConfirm({
        type: 'discard-draft',
        action: { kind: mode === 'create' ? 'reset-create' : 'cancel-edit' },
        title: 'Discard Unsaved Changes?',
        body: 'Unsaved wire profile edits will be lost. The profile will not be changed unless you save it first.',
        confirmLabel: 'Discard Changes',
      })
      return
    }
    if (mode === 'create') {
      const cleanDraft = defaultWireProfileDraft()
      setDraft(cleanDraft)
      setBaselineDraft(cleanDraft)
      setMessage(null)
      return
    }
    const cleanDraft = defaultWireProfileDraft()
    setSelectedId(null)
    setMode('create')
    setDraft(cleanDraft)
    setBaselineDraft(cleanDraft)
    setMessage(null)
  }

  const applyDiscardDraft = (discardAction: WireProfileDiscardDraftAction) => {
    setConfirm(null)
    if (getWireProfileConfirmedDiscardResult(discardAction) === 'force-close') {
      performClose()
      return
    }
    if (discardAction.kind === 'select-profile') {
      const targetProfile = discardAction.profileId
        ? profiles.find((profile) => profile.id === discardAction.profileId && !profile.deletedAt)
        : null
      if (targetProfile) {
        const nextDraft = draftFromWireProfile(targetProfile)
        setSelectedId(targetProfile.id)
        setMode('edit')
        setDraft(nextDraft)
        setBaselineDraft(nextDraft)
        setMessage(null)
        return
      }
      setMessage({ tone: 'warning', text: 'The selected wire profile changed elsewhere. Unsaved edits were discarded.' })
    }
    const cleanDraft = defaultWireProfileDraft()
    setSelectedId(null)
    setMode('create')
    setDraft(cleanDraft)
    setBaselineDraft(cleanDraft)
    setMessage(null)
  }

  const runAction = async (
    nextAction: WireProfileActionState,
    label: string,
    operation: (backup: any) => Promise<SaveBlueprintAnnotationsResult & { profile?: WireProfile }>,
    after?: (result: SaveBlueprintAnnotationsResult & { profile?: WireProfile }) => void,
  ) => {
    if (busy || !projectReady) return
    const expectedProjectId = cleanProjectId
    const sessionId = sessionRef.current
    const actionToken = actionTokenRef.current + 1
    actionTokenRef.current = actionToken
    setAction(nextAction)
    setMessage(null)
    try {
      const result = await operation(getBackupData())
      if (!canApplyWireProfileAsyncResult({
        mounted: mountedRef.current,
        projectId: projectRef.current,
        expectedProjectId,
        sessionId,
        currentSessionId: sessionRef.current,
        actionToken,
        currentActionToken: actionTokenRef.current,
      })) return
      setMessage(statusMessage(result, label))
      refresh(result.profile?.id || selectedId)
      if (result.localSaved && !result.error) after?.(result)
    } catch (error) {
      if (!canApplyWireProfileAsyncResult({
        mounted: mountedRef.current,
        projectId: projectRef.current,
        expectedProjectId,
        sessionId,
        currentSessionId: sessionRef.current,
        actionToken,
        currentActionToken: actionTokenRef.current,
      })) return
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : `${label} failed.` })
    } finally {
      if (canApplyWireProfileAsyncResult({
        mounted: mountedRef.current,
        projectId: projectRef.current,
        expectedProjectId,
        sessionId,
        currentSessionId: sessionRef.current,
        actionToken,
        currentActionToken: actionTokenRef.current,
      })) setAction('idle')
    }
  }

  const saveDraft = () => {
    const parsed = validateWireProfileDraft(draft)
    if (!parsed.valid || !parsed.value) return
    if (mode === 'create') {
      void runAction('create', 'Wire profile', (backup) => createOperationsBlueprintWireProfile(backup, { projectId: cleanProjectId, ...parsed.value! }), (result) => {
        if (result.profile) {
          setMode('edit')
          const nextDraft = draftFromWireProfile(result.profile)
          setDraft(nextDraft)
          setBaselineDraft(nextDraft)
        }
      })
      return
    }
    if (!selectedId) return
    void runAction('update', 'Wire profile', (backup) => updateOperationsBlueprintWireProfile(backup, cleanProjectId, selectedId, parsed.value!))
  }

  const duplicateProfile = (profile: WireProfile) => {
    void runAction('duplicate', 'Wire profile copy', (backup) => duplicateOperationsBlueprintWireProfile(backup, cleanProjectId, profile.id), (result) => {
      if (result.profile) {
        setFilter('active')
        setMode('edit')
        const nextDraft = draftFromWireProfile(result.profile)
        setDraft(nextDraft)
        setBaselineDraft(nextDraft)
      }
    })
  }

  const restoreProfile = (profile: WireProfile) => {
    void runAction('restore', 'Wire profile restore', (backup) => restoreOperationsBlueprintWireProfile(backup, cleanProjectId, profile.id), () => {
      setFilter('active')
    })
  }

  const addStarters = async () => {
    if (busy || !projectReady) return
    const expectedProjectId = cleanProjectId
    const sessionId = sessionRef.current
    const actionToken = actionTokenRef.current + 1
    actionTokenRef.current = actionToken
    setAction('starters')
    setMessage(null)
    const aggregate: StarterWireProfileResult = { createdNames: [], skippedNames: [], failed: [], warnings: [] }
    try {
      for (const starter of STARTER_WIRE_PROFILES) {
        const backup = getBackupData()
        const existing = getOperationsBlueprintWireProfiles(backup, cleanProjectId)
        const missing = getMissingStarterWireProfiles(existing)
        if (!missing.some((item) => item.name === starter.name)) {
          aggregate.skippedNames.push(starter.name)
          continue
        }
        try {
          const result = await createOperationsBlueprintWireProfile(backup, buildStarterWireProfileCreateInput(cleanProjectId, starter))
          if (!canApplyWireProfileAsyncResult({
            mounted: mountedRef.current,
            projectId: projectRef.current,
            expectedProjectId,
            sessionId,
            currentSessionId: sessionRef.current,
            actionToken,
            currentActionToken: actionTokenRef.current,
          })) return
          const tone = classifyWireProfileSaveResult(result)
          if (tone === 'error') {
            aggregate.failed.push({ name: starter.name, error: result.error || 'Starter profile was not saved locally.' })
          } else {
            aggregate.createdNames.push(starter.name)
            if (tone === 'warning') aggregate.warnings.push(result.warning || `${starter.name} saved locally. Cloud sync is pending.`)
          }
        } catch (error) {
          aggregate.failed.push({ name: starter.name, error: error instanceof Error ? error.message : 'Starter profile failed.' })
        }
      }
      if (!canApplyWireProfileAsyncResult({
        mounted: mountedRef.current,
        projectId: projectRef.current,
        expectedProjectId,
        sessionId,
        currentSessionId: sessionRef.current,
        actionToken,
        currentActionToken: actionTokenRef.current,
      })) return
      refresh(null)
      if (!canApplyWireProfileAsyncResult({
        mounted: mountedRef.current,
        projectId: projectRef.current,
        expectedProjectId,
        sessionId,
        currentSessionId: sessionRef.current,
        actionToken,
        currentActionToken: actionTokenRef.current,
      })) return
      setFilter('active')
      setMessage(summarizeStarterWireProfileResult(aggregate))
    } catch (error) {
      if (!canApplyWireProfileAsyncResult({
        mounted: mountedRef.current,
        projectId: projectRef.current,
        expectedProjectId,
        sessionId,
        currentSessionId: sessionRef.current,
        actionToken,
        currentActionToken: actionTokenRef.current,
      })) return
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Starter profiles failed.' })
    } finally {
      if (canApplyWireProfileAsyncResult({
        mounted: mountedRef.current,
        projectId: projectRef.current,
        expectedProjectId,
        sessionId,
        currentSessionId: sessionRef.current,
        actionToken,
        currentActionToken: actionTokenRef.current,
      })) setAction('idle')
    }
  }

  const confirmArchive = () => {
    if (confirm?.type !== 'archive') return
    const profileId = confirm.profileId
    setConfirm(null)
    void runAction('archive', 'Wire profile archive', (backup) => archiveOperationsBlueprintWireProfile(backup, cleanProjectId, profileId))
  }

  const confirmDelete = () => {
    if (confirm?.type !== 'delete') return
    const profileId = confirm.profileId
    setConfirm(null)
    void runAction('delete', 'Wire profile deletion', (backup) => {
      const freshRefs = identifyOperationsBlueprintWireProfileReferences(backup, cleanProjectId, profileId)
      if (freshRefs.length > 0) {
        return Promise.resolve({ localSaved: false, cloudSynced: false, error: 'Referenced wire profiles cannot be hard-deleted.' })
      }
      return deleteUnreferencedOperationsBlueprintWireProfile(backup, cleanProjectId, profileId)
    })
  }

  const target = portalTarget || document.body

  return createPortal(
    <div
      className={getWireProfileModalOverlayClassName()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Wire Profiles"
        className="relative flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] text-gray-100 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100"><Cable size={18} /> Wire Profiles</h3>
            <p className="mt-0.5 truncate text-xs text-gray-500">{projectName || 'Active project'}</p>
          </div>
          <button type="button" disabled={!canDismiss} onClick={requestClose} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Close Wire Profiles" aria-disabled={!canDismiss}>
            <X size={16} />
          </button>
        </div>

        {!projectReady ? (
          <div className="p-6 text-sm text-amber-200">Wire Profiles need a project id. Open this manager from a project-scoped blueprint.</div>
        ) : (
          <>
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-md border border-gray-700 bg-gray-950/50 p-1">
                  {(['active', 'archived'] as WireProfileFilter[]).map((item) => (
                    <button key={item} type="button" disabled={busy} onClick={() => setFilter(item)} className={`min-h-10 rounded px-3 text-xs font-semibold capitalize ${filter === item ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                      {item}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={startNew} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-gray-700 px-3 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50">
                    <Plus size={13} /> New Profile
                  </button>
                  {allProfilesEmpty && (
                    <button type="button" disabled={busy} onClick={() => void addStarters()} className="inline-flex min-h-10 items-center rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                      Add Starter Profiles
                    </button>
                  )}
                </div>
              </div>
              {missingReferenceIds.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-200">
                  {missingReferenceIds.length} missing wire profile id{missingReferenceIds.length === 1 ? '' : 's'} referenced by existing circuits. No reassignment was made.
                </div>
              )}
              {message && (
                <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${message.tone === 'error' ? 'border-red-500/40 bg-red-950/25 text-red-200' : message.tone === 'warning' ? 'border-amber-500/40 bg-amber-950/25 text-amber-200' : 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200'}`}>
                  {message.text}
                </div>
              )}
            </div>

            <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-b border-gray-800 p-3 md:border-b-0 md:border-r">
                {visibleProfiles.length > 0 ? (
                  <WireProfileList
                    profiles={visibleProfiles}
                    selectedId={selectedId}
                    summaries={summaries}
                    busy={busy}
                    onSelect={selectProfile}
                    onDuplicate={duplicateProfile}
                    onArchive={(profile) => {
                      if (busy) return
                      setConfirm({ type: 'archive', profileId: profile.id, profileName: profile.name })
                    }}
                    onRestore={restoreProfile}
                    onDelete={(profile) => {
                      if (busy) return
                      const summary = summarizeWireProfileReferences(identifyOperationsBlueprintWireProfileReferences(getBackupData(), cleanProjectId, profile.id), profile.id)
                      if (summary.totalLiveReferences > 0) {
                        setMessage({ tone: 'warning', text: `${summary.totalLiveReferences} existing circuit reference${summary.totalLiveReferences === 1 ? '' : 's'} use this profile. Archive it instead of deleting.` })
                        return
                      }
                      setConfirm({ type: 'delete', profileId: profile.id, profileName: profile.name, summary })
                    }}
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-gray-700 px-4 py-8 text-center">
                    <div className="text-sm font-semibold text-gray-200">{listState === 'empty' ? 'No Wire Profiles yet.' : 'No active Wire Profiles.'}</div>
                    <div className="mt-2 text-xs text-gray-500">{listState === 'archived-only' ? 'Archived profiles are available in the Archived view.' : 'Create one or add the starter set.'}</div>
                  </div>
                )}
              </div>

              <WireProfileForm
                draft={draft}
                errors={validation.errors}
                busy={busy}
                mode={mode}
                projectReady={projectReady}
                onChange={setDraft}
                onSave={saveDraft}
                onSecondaryAction={performSecondaryAction}
              />
            </div>

            {selectedProfile && mode === 'edit' && (
              <div className="border-t border-gray-800 px-4 py-3 text-xs text-gray-400">
                References: {summaries[selectedProfile.id]?.totalLiveReferences || 0} live, {summaries[selectedProfile.id]?.defaultAssignmentCount || 0} default, {summaries[selectedProfile.id]?.segmentOverrideCount || 0} segment override, {summaries[selectedProfile.id]?.blueprintSetCount || 0} set{(summaries[selectedProfile.id]?.blueprintSetCount || 0) === 1 ? '' : 's'}, {summaries[selectedProfile.id]?.pageCount || 0} page{(summaries[selectedProfile.id]?.pageCount || 0) === 1 ? '' : 's'}.
              </div>
            )}
          </>
        )}

        {confirm?.type === 'archive' && (
          <WireProfileConfirmDialog
            title="Archive Wire Profile"
            body="Existing circuits remain linked and estimates stay resolvable. This profile will be hidden from future profile selection and can be restored later."
            confirmLabel="Archive Profile"
            busy={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={confirmArchive}
          />
        )}
        {confirm?.type === 'delete' && (
          <WireProfileConfirmDialog
            title="Delete Wire Profile"
            body="This permanently deletes the exact unreferenced profile and cannot be undone."
            confirmLabel="Delete Permanently"
            danger
            busy={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={confirmDelete}
          />
        )}
        {confirm?.type === 'discard-draft' && (
          <WireProfileConfirmDialog
            title={confirm.title}
            body={confirm.body}
            confirmLabel={confirm.confirmLabel}
            busy={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={() => applyDiscardDraft(confirm.action)}
          />
        )}
      </div>
    </div>,
    target,
  )
}
