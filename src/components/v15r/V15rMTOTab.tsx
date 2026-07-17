// @ts-nocheck
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Sparkles, FileText, Search, ChevronDown, ChevronRight } from 'lucide-react'
import { useRemoteDataRefresh } from '@/hooks/useRemoteDataRefresh'
import {
  fetchLatestRemoteBackup,
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  saveBackupWithRemoteBaselineSync,
  getLiveProjectLogs,
  num,
  fmt,
} from '@/services/backupDataService'
import {
  createMaterialIdentityContext,
  createMaterialRowTombstone,
  getLiveMaterialRows,
  getMaterialStableId,
  mergeProjectMaterialsIntoRemote,
} from '@/services/projectScopeMerge'
import { pushState } from '@/services/undoRedoService'
import { exportMaterialSummaryPDF } from '@/services/mtoExportService'
import { loadInnerProjectViewPrefs, mergeInnerProjectViewPrefs } from '@/utils/v15rViewPrefs'
import { getProjectPhaseNames, getLegacyPhaseNames, normalizePhaseName } from '@/utils/v15rProjectPhases'

interface V15rMTOTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

function newMaterialStableId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `mat_${crypto.randomUUID()}`
  return `mat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function currentPurchaseMs(log: any): number {
  for (const value of [log?.date, log?.updatedAt, log?.createdAt]) {
    const ms = Date.parse(String(value || '').trim())
    if (!Number.isNaN(ms)) return ms
  }
  const idMs = String(log?.id || log?.logId || '').match(/(\d{13})/)
  return idMs ? Number(idMs[1]) : Number.NEGATIVE_INFINITY
}

function currentPurchaseAmount(log: any): number {
  return num(log?.mat || log?.materialCost)
}

function findMTORowIndexByStableId(rows: any[], stableId: string, projectId?: string): number {
  const context = createMaterialIdentityContext(rows, projectId, 'mtoRows')
  return (Array.isArray(rows) ? rows : []).findIndex((row: any) => {
    if (String(row?.id || '') === stableId) return true
    return getMaterialStableId(row, projectId, 'mtoRows', context) === stableId
  })
}

function stampMTORowForEdit(
  row: any,
  projectId?: string,
  now = new Date().toISOString(),
  stableIdOverride?: string,
): any {
  const context = createMaterialIdentityContext([row], projectId, 'mtoRows')
  const stableId = stableIdOverride || getMaterialStableId(row, projectId, 'mtoRows', context)
  return {
    ...row,
    materialId: row?.materialId || stableId,
    mtoId: row?.mtoId || stableId,
    createdAt: row?.createdAt || now,
    updatedAt: now,
  }
}

const MTO_ROW_SAVE_DEBOUNCE_MS = 300

function cloneMtoDraftMap(
  draft: Record<string, { name?: string; qty?: string; note?: string }>,
): Record<string, { name?: string; qty?: string; note?: string }> {
  return JSON.parse(JSON.stringify(draft || {}))
}

export default function V15rMTOTab({ projectId, onUpdate, backup: initialBackup }: V15rMTOTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>(() =>
    loadInnerProjectViewPrefs(projectId).mto?.collapsedPhases || {},
  )

  useEffect(() => {
    setCollapsedPhases(loadInnerProjectViewPrefs(projectId).mto?.collapsedPhases || {})
  }, [projectId])

  // ── Placement local state (Bugs 1+2+3) ─────────────────────────────
  // localPlacements holds per-row typed value before onBlur / Enter commit.
  // onChange updates ONLY this local state — no data write, no grouping re-trigger.
  // onBlur and onEnter commit the value to the actual row data.
  const [localPlacements, setLocalPlacements] = useState<Record<string, string>>({})
  const [localUnitCosts, setLocalUnitCosts] = useState<Record<string, string>>({})
  const [localSupplierNotes, setLocalSupplierNotes] = useState<Record<string, string>>({})

  // Phase 6U hotfix: draft-first name/qty/note — React state + ref mirror (matches Estimate pattern).
  const [mtoRowDrafts, setMtoRowDrafts] = useState<Record<string, { name?: string; qty?: string; note?: string }>>({})
  const latestMtoDraftRef = useRef<Record<string, { name?: string; qty?: string; note?: string }>>({})
  const mtoEditingRef = useRef(false)
  const mtoSaveQueueRef = useRef({
    timer: null as ReturnType<typeof setTimeout> | null,
    inFlight: false,
    flushPromise: null as Promise<boolean> | null,
    needsFlush: false,
    seq: 0,
  })
  const flushMtoSaveQueueRef = useRef<(() => Promise<boolean>) | null>(null)
  const mtoStructuralKeyRef = useRef('__init__')
  const [mtoInputFocused, setMtoInputFocused] = useState(false)

  // ── Row focus / hover tracking (Bug 4) ─────────────────────────────
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)

  // ── Auto-focus refs for new row quick-entry ───────────────────────
  const newMTORowIdRef = useRef<string | null>(null)
  const mtoNameInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // ── Drag-reorder state ────────────────────────────────────────────
  const dragRowIdRef = useRef<string | null>(null)
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null)

  // ── Inline edit state for chip-to-input transform ─────────────────
  const [editingPlacementId, setEditingPlacementId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingSupplierNoteId, setEditingSupplierNoteId] = useState<string | null>(null)

  // ── Add to Price Book modal state ──────────────────────────────────
  const [pbModalRowId, setPbModalRowId] = useState<string | null>(null)
  const [pbFormName, setPbFormName] = useState('')
  const [pbFormCat, setPbFormCat] = useState('')
  const [pbFormSupplier, setPbFormSupplier] = useState('')
  const [pbFormCost, setPbFormCost] = useState<number>(0)
  const [pbFormPackSize, setPbFormPackSize] = useState<number>(1)
  const [pbFormUnit, setPbFormUnit] = useState('EA')
  const [showCurrentPurchasesModal, setShowCurrentPurchasesModal] = useState(false)

  const mtoSaveQueue = mtoSaveQueueRef.current
  const isMtoDirty =
    mtoInputFocused ||
    mtoEditingRef.current ||
    !!mtoSaveQueue.timer ||
    !!mtoSaveQueue.inFlight ||
    !!mtoSaveQueue.needsFlush ||
    editingPlacementId !== null ||
    editingNoteId !== null ||
    editingSupplierNoteId !== null ||
    pbModalRowId !== null

  useRemoteDataRefresh({
    scopeId: 'mto',
    label: 'Material Takeoff',
    isDirty: isMtoDirty,
    onRemoteDataApplied: () => {
      latestMtoDraftRef.current = {}
      setMtoRowDrafts({})
      forceUpdate()
      onUpdate?.()
    },
  })

  useEffect(() => {
    return () => {
      const queue = mtoSaveQueueRef.current
      if (queue.timer) {
        clearTimeout(queue.timer)
        queue.timer = null
        queue.needsFlush = true
      }
      if (queue.needsFlush && flushMtoSaveQueueRef.current) {
        void flushMtoSaveQueueRef.current()
      }
    }
  }, [])


  // ── Data ────────────────────────────────────────────────────────────
  const backup = getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const phases = getProjectPhaseNames(backup)
  const rawMTORows: any[] = Array.isArray(p.mtoRows) ? p.mtoRows : []
  const allRows: any[] = getLiveMaterialRows(rawMTORows, p.id, 'mtoRows')
  const legacyPhases = getLegacyPhaseNames(allRows.map(r => r.phase), phases)
  const displayPhases = [...phases, ...legacyPhases]
  const currentPurchaseEntries = getLiveProjectLogs(backup, projectId)
    .filter((log: any) => currentPurchaseAmount(log) > 0)
    .sort((a: any, b: any) => currentPurchaseMs(b) - currentPurchaseMs(a))
  const currentPurchaseTotal = currentPurchaseEntries.reduce((sum: number, log: any) => sum + currentPurchaseAmount(log), 0)

  const getMtoRowUiId = (row: any): string =>
    String(getMaterialStableId(row, p.id, 'mtoRows'))

  // ── Row mutations ───────────────────────────────────────────────────
  const persistMaterialChange = async (
    mutate: (freshProject: any, freshBackup: any) => boolean | void,
    options?: { skipPushState?: boolean; skipUiRefresh?: boolean },
  ) => {
    const freshBackup = getBackupData()
    if (!freshBackup) return false
    const freshProject = (freshBackup.projects || []).find((x: any) => String(x?.id || '') === projectId)
    if (!freshProject) return false
    if (!options?.skipPushState) pushState()

    freshProject.mtoRows = Array.isArray(freshProject.mtoRows) ? freshProject.mtoRows : []
    const didChange = mutate(freshProject, freshBackup)
    if (didChange === false) return false

    freshBackup._lastSavedAt = new Date().toISOString()
    try {
      saveBackupData(freshBackup)
    } catch {
      mtoSaveQueueRef.current.needsFlush = false
      return false
    }
    if (!options?.skipUiRefresh) {
      forceUpdate()
      if (onUpdate) onUpdate()
    }

    try {
      const remote = await fetchLatestRemoteBackup()
      const remoteHasProject = !!(
        remote.hasRemoteRow &&
        remote.remoteData &&
        (remote.remoteData.projects || []).some((rp: any) => String(rp?.id || '') === projectId)
      )

      if (remoteHasProject) {
        const merged = mergeProjectMaterialsIntoRemote(remote.remoteData, freshBackup, projectId)
        await saveBackupWithRemoteBaselineSync(
          merged,
          {
            remoteUpdatedAt: remote.remoteUpdatedAt,
            remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
          },
          {
            source: 'project-materials-remote-merge',
            changedKey: 'projects',
            _scopes: ['project.materials'],
          },
        )
        if (!options?.skipUiRefresh && onUpdate) onUpdate()
        return true
      }

      saveBackupDataAndSync(freshBackup, 'projects', { source: 'project.materials', _scopes: ['project.materials'] })
      return true
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') {
        mtoSaveQueueRef.current.needsFlush = false
        return false
      }
      console.warn('[V15rMTOTab] Materials remote-merge save failed; kept local and used guarded sync', err)
      try {
        saveBackupDataAndSync(freshBackup, 'projects', { source: 'project.materials', _scopes: ['project.materials'] })
        return true
      } catch (fallbackErr) {
        if ((fallbackErr as Error)?.name !== 'BackupStorageWriteError') throw fallbackErr
        mtoSaveQueueRef.current.needsFlush = false
        return false
      }
    }
  }

  const getMtoDraftValue = (rowUiId: string, field: 'name' | 'qty' | 'note', fallback: any) => {
    const draft = mtoRowDrafts[rowUiId] ?? latestMtoDraftRef.current[rowUiId]
    if (draft && draft[field] !== undefined) return draft[field]
    return fallback
  }

  const buildMtoStructuralKey = (rows: any[]): string =>
    `${projectId}::${(rows || []).map(r => getMtoRowUiId(r)).join(',')}`

  const canReconcileMtoDraft = (): boolean => {
    if (mtoInputFocused || mtoEditingRef.current) return false
    if (editingPlacementId || editingNoteId || editingSupplierNoteId || pbModalRowId) return false
    const queue = mtoSaveQueueRef.current
    if (queue.timer || queue.inFlight || queue.needsFlush) return false
    return true
  }

  {
    const structuralKey = buildMtoStructuralKey(allRows)
    if (structuralKey !== mtoStructuralKeyRef.current && canReconcileMtoDraft()) {
      const liveIds = new Set(allRows.map(r => getMtoRowUiId(r)))
      setMtoRowDrafts(prev => {
        const nextDraft: Record<string, { name?: string; qty?: string; note?: string }> = {}
        for (const [rowId, draft] of Object.entries(prev)) {
          if (liveIds.has(rowId)) nextDraft[rowId] = draft
        }
        latestMtoDraftRef.current = nextDraft
        return nextDraft
      })
    }
    mtoStructuralKeyRef.current = structuralKey
  }

  const applyMtoDraftsToRows = (rows: any[]): any[] => {
    const context = createMaterialIdentityContext(rows, projectId, 'mtoRows')
    return (rows || []).map((row: any) => {
      const rowUiId = getMaterialStableId(row, projectId, 'mtoRows', context)
      const draft = latestMtoDraftRef.current[rowUiId]
      if (!draft) return row
      const updated = { ...row }
      if (draft.name !== undefined) updated.name = String(draft.name)
      if (draft.qty !== undefined) updated.qty = num(draft.qty)
      if (draft.note !== undefined) updated.note = String(draft.note)
      return stampMTORowForEdit(updated, projectId, undefined, rowUiId)
    })
  }

  const saveMtoDraftSnapshotRemote = async (seq: number): Promise<boolean> => {
    const queue = mtoSaveQueueRef.current
    if (seq !== queue.seq) return true

    const draftSnapshot = cloneMtoDraftMap(latestMtoDraftRef.current)
    if (Object.keys(draftSnapshot).length === 0) return true

    const saved = await persistMaterialChange((freshProject) => {
      freshProject.mtoRows = applyMtoDraftsToRows(freshProject.mtoRows || [])
    }, { skipPushState: true, skipUiRefresh: true })
    if (!saved) return false

    if (seq !== queue.seq) return true
    // Keep drafts while typing — do not clear ref/state here; blur flush clears when safe.
    return true
  }

  const flushMtoSaveQueue = (): Promise<boolean> => {
    const queue = mtoSaveQueueRef.current
    if (queue.flushPromise) {
      queue.needsFlush = true
      return queue.flushPromise
    }

    queue.flushPromise = (async () => {
      queue.inFlight = true
      let saved = true
      try {
        do {
          queue.needsFlush = false
          const seq = queue.seq
          saved = await saveMtoDraftSnapshotRemote(seq)
          if (!saved) {
            queue.needsFlush = false
            break
          }
        } while (queue.needsFlush)
      } finally {
        queue.inFlight = false
        queue.flushPromise = null
      }
      return saved
    })()
    return queue.flushPromise
  }
  flushMtoSaveQueueRef.current = flushMtoSaveQueue

  const queueMtoDraftSave = () => {
    const queue = mtoSaveQueueRef.current
    queue.seq += 1
    queue.needsFlush = true
    if (queue.timer) clearTimeout(queue.timer)
    queue.timer = setTimeout(() => {
      queue.timer = null
      void flushMtoSaveQueue()
    }, MTO_ROW_SAVE_DEBOUNCE_MS)
  }

  const flushMtoDraftImmediate = async (): Promise<boolean> => {
    const queue = mtoSaveQueueRef.current
    if (queue.timer) {
      clearTimeout(queue.timer)
      queue.timer = null
    }
    queue.seq += 1
    queue.needsFlush = true
    return flushMtoSaveQueue()
  }

  const isMtoDraftInputFocused = (): boolean =>
    !!document.activeElement?.closest?.('[data-mto-draft-input]')

  const updateMtoRowDraft = (rowId: string, field: 'name' | 'qty' | 'note', value: string) => {
    setMtoRowDrafts(prev => {
      const next = {
        ...prev,
        [rowId]: { ...(prev[rowId] || {}), [field]: value },
      }
      latestMtoDraftRef.current = next
      return next
    })
    queueMtoDraftSave()
  }

  const onMtoInputFocus = () => {
    mtoEditingRef.current = true
    setMtoInputFocused(true)
  }

  const onMtoInputBlur = () => {
    requestAnimationFrame(() => {
      if (isMtoDraftInputFocused()) return
      void (async () => {
        const saved = await flushMtoDraftImmediate()
        if (saved && !isMtoDraftInputFocused()) {
          mtoEditingRef.current = false
          setMtoInputFocused(false)
          latestMtoDraftRef.current = {}
          setMtoRowDrafts({})
          forceUpdate()
          onUpdate?.()
        }
      })()
    })
  }

  const commitMtoRowFieldImmediate = async (rowId: string, field: 'name' | 'qty' | 'note', value: any) => {
    const saved = await persistMaterialChange((freshProject) => {
      const rows: any[] = freshProject.mtoRows || []
      const idx = findMTORowIndexByStableId(rows, rowId, projectId)
      if (idx === -1) return false
      const row = { ...rows[idx] }
      if (row.deletedAt) return false
      if (field === 'qty') row.qty = num(value)
      else if (field === 'name') row.name = String(value)
      else if (field === 'note') row.note = String(value)
      else return false
      rows[idx] = stampMTORowForEdit(row, projectId, undefined, rowId)
      freshProject.mtoRows = rows
    })
    if (!saved) return false

    setMtoRowDrafts(prev => {
      const rowDraft = { ...(prev[rowId] || {}) }
      delete rowDraft[field]
      const next = { ...prev }
      if (Object.keys(rowDraft).length === 0) delete next[rowId]
      else next[rowId] = rowDraft
      latestMtoDraftRef.current = next
      return next
    })
    return true
  }

  const editMTORow = async (rowId: string, field: string, value: any): Promise<boolean> => {
    if (field === 'name' || field === 'qty' || field === 'note') {
      updateMtoRowDraft(rowId, field, String(value))
      return true
    }
    return persistMaterialChange((freshProject) => {
      const rows: any[] = freshProject.mtoRows || []
      const idx = findMTORowIndexByStableId(rows, rowId, projectId)
      if (idx === -1) return false
      const row = { ...rows[idx] }
      if (row.deletedAt) return false
      if (field === 'placement') row.placement = String(value)
      else if (field === 'unitCost') {
        row.unitCost = value === '' || value === null || value === undefined ? undefined : num(value)
      }
      else if (field === 'supplierNote') row.supplierNote = String(value)
      else return false
      rows[idx] = stampMTORowForEdit(row, projectId, undefined, rowId)
      freshProject.mtoRows = rows
    })
  }

  const addMTORow = (phase: string) => {
    const now = new Date().toISOString()
    const stableId = newMaterialStableId()
    const legacyId = 'mto' + Date.now()
    void persistMaterialChange((freshProject) => {
      freshProject.mtoRows = freshProject.mtoRows || []
      freshProject.mtoRows.push({
        materialId: stableId,
        mtoId: stableId,
        id: legacyId,
        phase,
        matId: '',
        name: '',
        qty: 1,
        detailNote: '',
        supplierNote: '',
        placement: '',
        note: '',
        createdAt: now,
        updatedAt: now,
      })
    })
    newMTORowIdRef.current = stableId
    forceUpdate()
    requestAnimationFrame(() => {
      mtoNameInputRefs.current[stableId]?.focus()
    })
  }

  const delMTORow = async (rowId: string) => {
    const saved = await persistMaterialChange((freshProject) => {
      const rows: any[] = freshProject.mtoRows || []
      const idx = findMTORowIndexByStableId(rows, rowId, projectId)
      if (idx === -1) {
        console.warn('[V15rMTOTab] Delete skipped; MTO row not found', rowId)
        return false
      }
      const context = createMaterialIdentityContext(rows, projectId, 'mtoRows')
      rows[idx] = createMaterialRowTombstone(rows[idx], projectId, 'mtoRows', undefined, context)
    })
    if (!saved) return
    setLocalPlacements(prev => { const n = { ...prev }; delete n[rowId]; return n })
    setLocalSupplierNotes(prev => { const n = { ...prev }; delete n[rowId]; return n })
    setLocalUnitCosts(prev => { const n = { ...prev }; delete n[rowId]; return n })
    delete latestMtoDraftRef.current[rowId]
    setMtoRowDrafts(prev => {
      const next = { ...prev }
      delete next[rowId]
      latestMtoDraftRef.current = next
      return next
    })
    forceUpdate()
  }

  const reorderMTORow = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    void persistMaterialChange((freshProject) => {
      const rawRows: any[] = freshProject.mtoRows || []
      const liveRows = getLiveMaterialRows(rawRows, projectId, 'mtoRows')
      const dragIdx = liveRows.findIndex((r: any) => getMaterialStableId(r, projectId, 'mtoRows') === dragId)
      const dropIdx = liveRows.findIndex((r: any) => getMaterialStableId(r, projectId, 'mtoRows') === dropId)
      if (dragIdx === -1 || dropIdx === -1) return false
      const [dragged] = liveRows.splice(dragIdx, 1)
      liveRows.splice(dropIdx, 0, stampMTORowForEdit(dragged, projectId))
      const tombstones = rawRows.filter((r: any) => r?.deletedAt)
      freshProject.mtoRows = [...liveRows, ...tombstones]
    })
    forceUpdate()
  }

  const getPBItem = (matId: string) => {
    if (!matId) return null
    return (backup.priceBook || []).find(x => x.id === matId)
  }

  // Returns true if any price book item name contains the given text (case-insensitive).
  // Used to decide whether to show the Google search button on a row.
  const hasPBNameMatch = (name: string): boolean => {
    if (!name || !name.trim()) return false
    const lower = name.toLowerCase().trim()
    return (backup.priceBook || []).some((item: any) =>
      item.name && item.name.toLowerCase().includes(lower)
    )
  }

  // ── Price Book modal helpers ────────────────────────────────────────
  const openPbModal = (r: any) => {
    setPbModalRowId(r.id)
    setPbFormName(r.name || '')
    setPbFormCat('')
    setPbFormSupplier('')
    setPbFormCost(0)
    setPbFormPackSize(1)
    setPbFormUnit('EA')
  }

  const closePbModal = () => {
    setPbModalRowId(null)
  }

  const getPbCategories = (): string[] => {
    const cats = (backup.priceBook || []).map((x: any) => x.cat).filter(Boolean)
    return [...new Set<string>(cats)].sort()
  }

  const findPbDuplicates = (name: string): any[] => {
    if (!name || !name.trim()) return []
    const lower = name.toLowerCase().trim()
    return (backup.priceBook || []).filter((x: any) =>
      x.name && x.name.toLowerCase().includes(lower)
    )
  }

  const confirmAddToPriceBook = (rowId: string) => {
    const newItem: any = {
      id: 'pb_' + Date.now(),
      name: pbFormName.trim(),
      cat: pbFormCat,
      src: pbFormSupplier,
      cost: pbFormCost,
      packSize: pbFormPackSize,
      unit: pbFormUnit,
      waste: 0,
    }
    if (!Array.isArray(backup.priceBook)) {
      backup.priceBook = backup.priceBook && typeof backup.priceBook === 'object'
        ? Object.values(backup.priceBook) as any[]
        : []
    }
    backup.priceBook.push(newItem)

    // Link the MTO row to the new price book entry
    const row = (p.mtoRows || []).find((r: any) => r.id === rowId)
    if (row) row.matId = newItem.id

    saveBackupDataAndSync(backup, 'projects')
    forceUpdate()
    closePbModal()
  }

  // ── Derived flags ───────────────────────────────────────────────────
  const hasAnyRows = allRows.length > 0

  const togglePhaseBucket = (phase: string) => {
    setCollapsedPhases(prev => {
      const nextCollapsed = !prev[phase]
      mergeInnerProjectViewPrefs(projectId, {
        mto: { collapsedPhases: { [phase]: nextCollapsed } },
      })
      return { ...prev, [phase]: nextCollapsed }
    })
  }

  const formatItemCount = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`

  const renderCurrentPurchaseDetail = (label: string, value: any, options?: { mono?: boolean }) => {
    const text = String(value || '').trim()
    if (!text) return null
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--t3)', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ color: 'var(--t1)', fontSize: '12px', fontFamily: options?.mono ? 'monospace' : 'inherit', overflowWrap: 'anywhere' }}>
          {text}
        </div>
      </div>
    )
  }

  // ── Sub-renderers ───────────────────────────────────────────────────
  const renderTableHead = () => (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--bdr2)' }}>
        <th style={{ width: '20px' }}></th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Item Title</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '150px' }}>Supplier</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '110px' }}>Family</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '60px' }}>Qty</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '60px' }}>Unit</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Unit Cost</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Sell Price</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '90px' }}>Total</th>
        <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600', width: '110px' }}></th>
      </tr>
    </thead>
  )

  const renderRow = (r: any) => {
    const pbItem = getPBItem(r.matId)
    const rowUiId = getMaterialStableId(r, p.id, 'mtoRows')
    // cu = row-level override if present, otherwise priceBook suggestion
    const cu = r.unitCost !== undefined && r.unitCost !== null
      ? num(r.unitCost)
      : num(pbItem?.cost || 0)
    const waste = num(pbItem?.waste || 0)
    const markupPct = num(backup.settings?.markup || 0) / 100
    const sellPrice = cu * (1 + markupPct)
    const lt = num(getMtoDraftValue(rowUiId, 'qty', r.qty || 0)) * sellPrice * (1 + waste)
    // Project-only supplier note (inline editable, project-scoped only)
    const localSupplierNoteVal = localSupplierNotes[rowUiId] !== undefined
      ? localSupplierNotes[rowUiId]
      : (r.supplierNote || '')
    const isEditingSupplierNote = editingSupplierNoteId === rowUiId
    const hasSupplierNoteVal = !!(localSupplierNoteVal.trim())
    // PB supplier — valid only if not a legacy import placeholder
    const pbSupplierSrc = (!pbItem?.src || pbItem.src === 'PDF Import' || pbItem.src === 'PDF Imported')
      ? null
      : pbItem.src
    const familyDisplay = (!pbItem?.cat || pbItem.cat === 'PDF Imported')
      ? '—'
      : pbItem.cat
    // Unit cost input — local state for smooth typing, commits on blur
    const localCostVal = localUnitCosts[rowUiId] !== undefined
      ? localUnitCosts[rowUiId]
      : (cu > 0 ? String(cu) : '')

    // ── Bug 1+2+3: local placement value ────────────────────────────
    // localVal shows the typed value; committed r.placement is the source of truth for grouping.
    const localVal = localPlacements[rowUiId] !== undefined ? localPlacements[rowUiId] : (r.placement || '')

    // Commit placement to data layer (onBlur / Enter).
    // Reads from e.target.value to always have the latest DOM value.
    const commitPlacement = async (domValue: string) => {
      if (domValue !== (r.placement || '')) {
        const saved = await editMTORow(rowUiId, 'placement', domValue)
        if (!saved) return
      }
      // Remove local override; row will read from r.placement on next render
      setLocalPlacements(prev => { const n = { ...prev }; delete n[rowUiId]; return n })
    }

    // ── Bug 4: secondary row visibility ─────────────────────────────
    const isRowFocused = focusedRowId === rowUiId
    const isRowHovered = hoveredRowId === rowUiId

    const displayName = String(getMtoDraftValue(rowUiId, 'name', r.name || '') || '')
    const displayNote = String(getMtoDraftValue(rowUiId, 'note', r.note || '') || '')
    const displayQty = getMtoDraftValue(rowUiId, 'qty', r.qty || 0)

    // ── Google search button visibility ─────────────────────────────
    // Show when item name has text AND no price book item name matches it.
    const nameHasText = !!displayName.trim()
    const showSearchBtn = nameHasText && !hasPBNameMatch(displayName)
    // Chip-based placement/note UX
    const hasPlacementVal = !!(localVal.trim())
    const hasNoteVal = !!displayNote.trim()
    const isEditingPlacement = editingPlacementId === rowUiId
    const isEditingNote = editingNoteId === rowUiId

    return (
      <tr
        key={rowUiId}
        onMouseEnter={() => setHoveredRowId(rowUiId)}
        onMouseLeave={() => setHoveredRowId(null)}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverRowId(rowUiId) }}
        onDrop={e => {
          e.preventDefault()
          const fromId = dragRowIdRef.current
          if (fromId && fromId !== rowUiId) reorderMTORow(fromId, rowUiId)
          setDragOverRowId(null)
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverRowId(null)
        }}
        style={{
          borderBottom: '1px solid var(--bdr2)',
          userSelect: 'none',
          cursor: 'default',
          borderTop: dragOverRowId === rowUiId ? '2px solid #3b82f6' : '2px solid transparent',
          transition: 'border-top-color 0.08s',
        }}
      >
        {/* Handle — draggable; drag-and-drop to reorder within phase */}
        <td
          draggable
          onDragStart={e => {
            dragRowIdRef.current = rowUiId
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', rowUiId)
          }}
          onDragEnd={() => {
            dragRowIdRef.current = null
            setDragOverRowId(null)
          }}
          title="Drag to reorder"
          style={{
            padding: '8px 4px',
            width: '20px',
            textAlign: 'center',
            cursor: 'grab',
            color: 'var(--t3)',
            fontSize: '14px',
            lineHeight: '1',
            userSelect: 'none',
          }}
        >
          ⋮⋮
        </td>
        {/* Item Title + inline placement/note fields */}
        <td style={{ padding: '8px' }}>
          {/* Name input — actions are in the right-side actions column */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              ref={el => { mtoNameInputRefs.current[rowUiId] = el }}
              type="text"
              data-mto-draft-input
              value={displayName}
              onChange={e => updateMtoRowDraft(rowUiId, 'name', e.target.value)}
              onFocus={onMtoInputFocus}
              onBlur={onMtoInputBlur}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              onMouseDown={e => e.stopPropagation()}
              placeholder={newMTORowIdRef.current === rowUiId ? 'Item name…' : ''}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--t1)',
                flex: 1,
                minWidth: 0,
                fontSize: '12px',
              }}
            />
          </div>

          {/* Placement chip / input */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* -- Placement -- */}
            {hasPlacementVal && !isEditingPlacement ? (
              <span
                onClick={() => setEditingPlacementId(rowUiId)}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(16,185,129,0.12)',
                  color: '#86efac',
                  fontSize: '10px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  lineHeight: '1.5',
                }}
              >
                {localVal}
                <span
                  onClick={async e => {
                    e.stopPropagation()
                    if (!await editMTORow(rowUiId, 'placement', '')) return
                    setLocalPlacements(prev => { const n = { ...prev }; delete n[rowUiId]; return n })
                    setEditingPlacementId(null)
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    cursor: 'pointer',
                    color: 'rgba(134,239,172,0.5)',
                    fontSize: '12px',
                    lineHeight: '1',
                    marginLeft: '2px',
                  }}
                  title="Clear placement"
                >
                  x
                </span>
              </span>
            ) : isEditingPlacement ? (
              <input
                autoFocus
                type="text"
                value={localVal}
                onChange={e => setLocalPlacements(prev => ({ ...prev, [rowUiId]: e.target.value }))}
                onBlur={e => {
                  void commitPlacement(e.target.value)
                  setEditingPlacementId(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void commitPlacement((e.target as HTMLInputElement).value)
                    setEditingPlacementId(null)
                  }
                  if (e.key === 'Escape') {
                    setLocalPlacements(prev => { const n = { ...prev }; delete n[rowUiId]; return n })
                    setEditingPlacementId(null)
                  }
                }}
                onMouseDown={e => e.stopPropagation()}
                placeholder="Zone/Placement"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(16,185,129,0.35)',
                  borderRadius: '9999px',
                  color: '#86efac',
                  fontSize: '10px',
                  padding: '2px 8px',
                  width: '120px',
                  outline: 'none',
                }}
              />
            ) : isRowHovered ? (
              <span
                onClick={() => setEditingPlacementId(rowUiId)}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: 'transparent',
                  border: '1px dashed rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.18)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  lineHeight: '1.5',
                }}
              >
                + placement
              </span>
            ) : null}

            {/* -- Note -- */}
            {hasNoteVal && !isEditingNote ? (
              <span
                onClick={() => setEditingNoteId(rowUiId)}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(148,163,184,0.1)',
                  color: 'var(--t3)',
                  fontSize: '10px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  lineHeight: '1.5',
                }}
              >
                {displayNote}
                <span
                  onClick={async e => {
                    e.stopPropagation()
                    if (!await commitMtoRowFieldImmediate(rowUiId, 'note', '')) return
                    setEditingNoteId(null)
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    cursor: 'pointer',
                    color: 'rgba(148,163,184,0.4)',
                    fontSize: '12px',
                    lineHeight: '1',
                    marginLeft: '2px',
                  }}
                  title="Clear note"
                >
                  x
                </span>
              </span>
            ) : isEditingNote ? (
              <input
                autoFocus
                type="text"
                data-mto-draft-input
                value={displayNote}
                onChange={e => updateMtoRowDraft(rowUiId, 'note', e.target.value)}
                onFocus={onMtoInputFocus}
                onBlur={() => {
                  onMtoInputBlur()
                  setEditingNoteId(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onMtoInputBlur()
                    setEditingNoteId(null)
                  }
                  if (e.key === 'Escape') setEditingNoteId(null)
                }}
                onMouseDown={e => e.stopPropagation()}
                placeholder="Field note"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(148,163,184,0.25)',
                  borderRadius: '9999px',
                  color: 'var(--t3)',
                  fontSize: '10px',
                  padding: '2px 8px',
                  width: '120px',
                  outline: 'none',
                }}
              />
            ) : isRowHovered ? (
              <span
                onClick={() => setEditingNoteId(rowUiId)}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: 'transparent',
                  border: '1px dashed rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.18)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  lineHeight: '1.5',
                }}
              >
                + note
              </span>
            ) : null}

          </div>
        </td>

        {/* Supplier — project-only inline edit; PB supplier shown read-only when present */}
        <td style={{ padding: '8px', fontSize: '11px' }}>
          {hasSupplierNoteVal && !isEditingSupplierNote ? (
            <span
              onClick={() => setEditingSupplierNoteId(rowUiId)}
              onMouseDown={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '2px 8px', borderRadius: '9999px',
                backgroundColor: 'rgba(6,182,212,0.15)', color: '#22d3ee',
                border: '1px solid rgba(6,182,212,0.3)', fontSize: '10px',
                fontWeight: '500', cursor: 'pointer', lineHeight: '1.5',
                maxWidth: '160px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}
            >
              {localSupplierNoteVal}
              <span
                onClick={async e => {
                  e.stopPropagation()
                  if (!await editMTORow(rowUiId, 'supplierNote', '')) return
                  setLocalSupplierNotes(prev => { const n = { ...prev }; delete n[rowUiId]; return n })
                  setEditingSupplierNoteId(null)
                }}
                onMouseDown={e => e.stopPropagation()}
                style={{ cursor: 'pointer', color: 'rgba(34,211,238,0.5)', fontSize: '12px', lineHeight: '1', marginLeft: '2px' }}
                title="Clear project supplier"
              >x</span>
            </span>
          ) : isEditingSupplierNote ? (
            <input
              autoFocus
              type="text"
              value={localSupplierNoteVal}
              onChange={e => setLocalSupplierNotes(prev => ({ ...prev, [rowUiId]: e.target.value }))}
              onBlur={async e => {
                if (!await editMTORow(rowUiId, 'supplierNote', e.target.value)) return
                setLocalSupplierNotes(prev => { const n = { ...prev }; delete n[rowUiId]; return n })
                setEditingSupplierNoteId(null)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setLocalSupplierNotes(prev => { const n = { ...prev }; delete n[rowUiId]; return n })
                  setEditingSupplierNoteId(null)
                }
              }}
              onMouseDown={e => e.stopPropagation()}
              placeholder="Supplier"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(6,182,212,0.35)',
                borderRadius: '9999px', color: '#22d3ee',
                fontSize: '10px', padding: '2px 8px', width: '130px', outline: 'none',
              }}
            />
          ) : pbSupplierSrc ? (
            <span style={{ color: 'var(--t2)' }}>{pbSupplierSrc}</span>
          ) : isRowHovered ? (
            <span
              onClick={() => setEditingSupplierNoteId(rowUiId)}
              onMouseDown={e => e.stopPropagation()}
              style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: '9999px',
                backgroundColor: 'transparent', border: '1px dashed rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.18)', fontSize: '10px', cursor: 'pointer', lineHeight: '1.5',
              }}
            >+ supplier</span>
          ) : (
            <span style={{ color: 'var(--t3)' }}>N/A</span>
          )}
        </td>
        <td style={{ padding: '8px', fontSize: '11px', color: 'var(--t3)' }}>
          {familyDisplay}
        </td>
        <td style={{ padding: '8px', textAlign: 'right' }}>
          <input
            type="number"
            data-mto-draft-input
            value={displayQty}
            onChange={e => updateMtoRowDraft(rowUiId, 'qty', e.target.value)}
            onFocus={onMtoInputFocus}
            onBlur={onMtoInputBlur}
            onMouseDown={e => e.stopPropagation()}
            step="1"
            onKeyDown={e => {
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                updateMtoRowDraft(rowUiId, 'qty', String(Math.floor(num(displayQty || 0)) + 1))
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                updateMtoRowDraft(rowUiId, 'qty', String(Math.max(0, Math.ceil(num(displayQty || 0)) - 1)))
              }
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--t1)',
              width: '100%',
              textAlign: 'right',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}
          />
        </td>
        <td style={{ padding: '8px', fontSize: '11px', color: 'var(--t3)' }}>
          {pbItem?.unit || 'EA'}
        </td>
        <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
            <span style={{ color: 'var(--t3)', fontSize: '11px', flexShrink: 0 }}>$</span>
            <input
              type="number"
              value={localCostVal}
              placeholder="—"
              step="0.01"
              onMouseDown={e => e.stopPropagation()}
              onChange={e => {
                // Local only — smooth typing, no save until blur/Enter
                setLocalUnitCosts(prev => ({ ...prev, [rowUiId]: e.target.value }))
              }}
              onBlur={async e => {
                const v = e.target.value
                if (!await editMTORow(rowUiId, 'unitCost', v)) return
                setLocalUnitCosts(prev => {
                  const n = { ...prev }
                  delete n[rowUiId]
                  return n
                })
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setLocalUnitCosts(prev => {
                    const n = { ...prev }
                    delete n[rowUiId]
                    return n
                  })
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: r.unitCost !== undefined ? '#fbbf24' : 'var(--t1)', // yellow = overridden
                width: '100%',
                textAlign: 'right',
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
              title={r.unitCost !== undefined ? 'Overridden — clear field to revert to Price Book suggestion' : 'Price Book suggestion — edit to override for this row'}
            />
          </div>
        </td>
        <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '12px', color: '#60a5fa' }}>
          {cu > 0 ? fmt(sellPrice) : '—'}
        </td>
        <td style={{ padding: '8px', textAlign: 'right', fontWeight: '600', color: '#10b981', fontFamily: 'monospace' }}>
          {cu > 0 ? fmt(lt) : '—'}
        </td>
        {/* Right-side actions: Price Book → Search → Delete — always visible */}
        <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {/* Price Book */}
            <button
              title="Add to Price Book"
              onClick={e => { e.stopPropagation(); openPbModal(r) }}
              onMouseDown={e => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', gap: '2px',
                padding: '2px 5px',
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.25)',
                borderRadius: '3px',
                color: '#10b981',
                cursor: 'pointer',
                fontSize: '10px',
                whiteSpace: 'nowrap',
              }}
            >
              + PB
            </button>
            {/* Search */}
            <button
              title="Search this item online"
              onClick={() => {
                if (r.name && r.name.trim()) {
                  window.open('https://www.google.com/search?q=' + encodeURIComponent(r.name.trim()), '_blank')
                }
              }}
              onMouseDown={e => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', gap: '2px',
                padding: '2px 5px',
                background: 'none',
                border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: '3px',
                color: r.name && r.name.trim() ? 'rgba(148,163,184,0.75)' : 'rgba(148,163,184,0.25)',
                cursor: r.name && r.name.trim() ? 'pointer' : 'default',
                fontSize: '10px',
                whiteSpace: 'nowrap',
              }}
            >
              <Search size={9} />
            </button>
            {/* Delete */}
            <button
              onClick={() => void delMTORow(rowUiId)}
              onMouseDown={e => e.stopPropagation()}
              title="Delete row"
              style={{
                background: 'none',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: '3px',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: '13px',
                padding: '1px 5px',
                lineHeight: '1',
              }}
            >
              ×
            </button>
          </div>
        </td>
      </tr>
    )
  }

  // Phase-grouped view (original behavior — no placements assigned)
  const renderPhaseGroups = () =>
    displayPhases.map(phase => {
      const isLegacyPhase = legacyPhases.includes(phase)
      const rows = allRows.filter(r => normalizePhaseName(r.phase, phases) === phase)
      const isCollapsed = collapsedPhases[phase] === true
      let phTotal = 0
      rows.forEach(r => {
        const pbItem = getPBItem(r.matId)
        const cu = r.unitCost !== undefined && r.unitCost !== null
          ? num(r.unitCost)
          : num(pbItem?.cost || 0)
        const waste = num(pbItem?.waste || 0)
        const markupPct = num(backup.settings?.markup || 0) / 100
        phTotal += num(r.qty || 0) * cu * (1 + markupPct) * (1 + waste)
      })

      return (
        <div
          key={phase}
          style={{
            background: 'linear-gradient(180deg, rgba(35,39,56,0.96), rgba(26,29,39,0.96))',
            border: '1px solid rgba(148,163,184,0.12)',
            borderRadius: '12px',
            marginBottom: '14px',
            overflow: 'hidden',
            boxShadow: '0 18px 42px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.02) inset',
          }}
        >
          <button
            type="button"
            aria-expanded={!isCollapsed}
            onClick={() => togglePhaseBucket(phase)}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, rgba(79,70,229,0.26), rgba(14,165,233,0.12) 52%, rgba(15,23,42,0.38))',
              padding: '11px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '14px',
              border: 'none',
              borderBottom: isCollapsed ? 'none' : '1px solid rgba(255,255,255,0.06)',
              boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 0 24px rgba(99,102,241,0.10)',
              cursor: 'pointer',
              textAlign: 'left',
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '999px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#c4b5fd',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  flexShrink: 0,
                }}
              >
                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </span>
              <span style={{ width: '3px', height: '24px', borderRadius: '999px', background: 'linear-gradient(180deg, #a78bfa, #22d3ee)', boxShadow: '0 0 16px rgba(167,139,250,0.45)', flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--t1)', fontWeight: '800', fontSize: '14px', letterSpacing: '0.01em' }}>
                    {isLegacyPhase ? `Unmapped / Legacy Phase: ${phase}` : phase}
                  </span>
                  <span
                    style={{
                      color: '#cbd5e1',
                      fontSize: '11px',
                      fontWeight: '700',
                      padding: '2px 7px',
                      borderRadius: '999px',
                      background: 'rgba(15,23,42,0.36)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {formatItemCount(rows.length)}
                  </span>
                </span>
                <span style={{ display: 'block', color: 'rgba(203,213,225,0.58)', fontSize: '10px', marginTop: '2px', fontWeight: '600' }}>
                  {isCollapsed ? 'Collapsed' : 'Expanded'}
                </span>
              </span>
            </div>
            <span style={{ color: '#10b981', fontWeight: '800', fontFamily: 'monospace', fontSize: '13px', flexShrink: 0, textShadow: '0 0 16px rgba(16,185,129,0.18)' }}>{fmt(phTotal)}</span>
          </button>

          {!isCollapsed && (
            <div style={{ padding: '12px' }}>
              <table style={{ width: '100%', fontSize: '12px', color: 'var(--t2)', borderCollapse: 'collapse' }}>
                {renderTableHead()}
                <tbody>{rows.map(r => renderRow(r))}</tbody>
              </table>
              <button
                onClick={() => addMTORow(phase)}
                style={{
                  marginTop: '8px',
                  padding: '6px 12px',
                  backgroundColor: 'rgba(59,130,246,0.2)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                + Add Item
              </button>
            </div>
          )}
        </div>
      )
    })

  // Placement-grouped view (active when any row has a placement value)
  const renderPlacementGroups = () => {
    const unassigned = allRows.filter(r => !r.placement || !r.placement.trim())
    const placementMap: Record<string, any[]> = {}
    allRows.forEach(r => {
      if (r.placement && r.placement.trim()) {
        if (!placementMap[r.placement]) placementMap[r.placement] = []
        placementMap[r.placement].push(r)
      }
    })

    const renderGroup = (rows: any[], label?: string | null) => {
      let grpTotal = 0
      rows.forEach(r => {
        const pbItem = getPBItem(r.matId)
        const cu = r.unitCost !== undefined && r.unitCost !== null ? num(r.unitCost) : num(pbItem?.cost || 0)
        const waste = num(pbItem?.waste || 0)
        const markupPct = num(backup.settings?.markup || 0) / 100
        grpTotal += num(r.qty || 0) * cu * (1 + markupPct) * (1 + waste)
      })

      return (
        <div
          key={label || '__unassigned__'}
          style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}
        >
          {/* Placement header — only for named groups */}
          {label && (
            <div
              style={{
                backgroundColor: 'rgba(16,185,129,0.1)',
                padding: '10px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <h4 style={{ color: '#86efac', fontWeight: '600', margin: '0', fontSize: '13px' }}>
                📍 {label} <span style={{ color: 'var(--t3)', fontWeight: '400' }}>({rows.length})</span>
              </h4>
              <span style={{ color: '#10b981', fontWeight: '600', fontFamily: 'monospace' }}>{fmt(grpTotal)}</span>
            </div>
          )}

          <div style={{ padding: '12px' }}>
            <table style={{ width: '100%', fontSize: '12px', color: 'var(--t2)', borderCollapse: 'collapse' }}>
              {renderTableHead()}
              <tbody>{rows.map(r => renderRow(r))}</tbody>
            </table>
          </div>
        </div>
      )
    }

    const sortedPlacements = Object.entries(placementMap).sort(([a], [b]) => a.localeCompare(b))

    return (
      <>
        {/* Unassigned rows come first, no header */}
        {unassigned.length > 0 && renderGroup(unassigned, null)}

        {/* Named placement groups */}
        {sortedPlacements.map(([label, rows]) => renderGroup(rows, label))}

        {/* Add-item buttons per phase (still accessible in placement view) */}
        <div
          style={{
            backgroundColor: '#232738',
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '6px',
          }}
        >
          <span style={{ color: 'var(--t3)', fontSize: '11px', marginRight: '4px' }}>Add to phase:</span>
          {phases.map(phase => (
            <button
              key={phase}
              onClick={() => addMTORow(phase)}
              style={{
                padding: '4px 10px',
                backgroundColor: 'rgba(59,130,246,0.2)',
                color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              + {phase}
            </button>
          ))}
        </div>
      </>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div
      style={{ backgroundColor: '#1a1d27', padding: '0' }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <button
            type="button"
            onClick={() => setShowCurrentPurchasesModal(true)}
            style={{
              padding: '8px 14px',
              backgroundColor: 'rgba(14,165,233,0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(14,165,233,0.35)',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '700',
              cursor: 'pointer',
            }}
          >
            Current Purchases ({currentPurchaseEntries.length})
          </button>
        </div>

        {/* EMPTY STATE */}
        {!hasAnyRows && (
          <div
            style={{
              backgroundColor: '#232738',
              borderRadius: '8px',
              padding: '40px 16px',
              textAlign: 'center',
              color: 'var(--t3)',
              marginBottom: '16px',
            }}
          >
            <p style={{ margin: '0 0 16px 0' }}>No materials added yet. Start by adding items to a phase.</p>
            <button
              onClick={() => addMTORow(phases[0] || 'Estimating')}
              style={{
                padding: '8px 16px',
                backgroundColor: 'rgba(59,130,246,0.2)',
                color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              + Add Material
            </button>
          </div>
        )}

        {/* MAIN CONTENT — always phase view; placement is informational only */}
        {renderPhaseGroups()}

        {/* EXPORT BUTTONS ROW */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
          <button
            onClick={() => exportMaterialSummaryPDF(p, backup.priceBook || [])}
            style={{
              padding: '10px 16px',
              backgroundColor: 'rgba(16,185,129,0.15)',
              color: '#10b981',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FileText size={14} />
            Material Summary PDF
          </button>
        </div>

        {/* CURRENT PURCHASES MODAL */}
        {showCurrentPurchasesModal && (
          <div
            onClick={e => { if (e.target === e.currentTarget) setShowCurrentPurchasesModal(false) }}
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(2,6,23,0.72)',
              backdropFilter: 'blur(8px)',
              zIndex: 60,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '18px',
            }}
          >
            <div
              style={{
                background: 'linear-gradient(180deg, rgba(45,49,72,0.98), rgba(26,29,39,0.98))',
                borderRadius: '12px',
                padding: '0',
                maxWidth: '820px',
                width: '94%',
                maxHeight: '86vh',
                border: '1px solid rgba(148,163,184,0.18)',
                boxShadow: '0 24px 70px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.03) inset',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
              onMouseDown={e => e.stopPropagation()}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '16px',
                alignItems: 'flex-start',
                padding: '22px 24px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(135deg, rgba(14,165,233,0.14), rgba(16,185,129,0.06) 48%, rgba(15,23,42,0.16))',
              }}>
                <div>
                  <h3 style={{ color: '#e0f2fe', margin: '0 0 4px 0', fontSize: '18px', fontWeight: '850' }}>
                    Current Purchases
                  </h3>
                  <p style={{ color: 'var(--t3)', margin: 0, fontSize: '12px' }}>
                    Material purchases logged for this project.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCurrentPurchasesModal(false)}
                  style={{
                    background: 'rgba(15,23,42,0.34)',
                    border: '1px solid rgba(255,255,255,0.16)',
                    color: '#cbd5e1',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    lineHeight: '1',
                    padding: '7px 10px',
                  }}
                >
                  x
                </button>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '12px 14px',
                backgroundColor: 'rgba(15,23,42,0.36)',
                border: '1px solid rgba(148,163,184,0.12)',
                borderRadius: '8px',
                margin: '16px 24px 14px',
                flexWrap: 'wrap',
              }}>
                <span style={{ color: 'var(--t2)', fontSize: '12px', fontWeight: '700' }}>
                  Entries: <span style={{ color: 'var(--t1)', fontFamily: 'monospace' }}>{currentPurchaseEntries.length}</span>
                </span>
                <span style={{ color: 'var(--t2)', fontSize: '12px', fontWeight: '700' }}>
                  Total material purchases: <span style={{ color: '#10b981', fontFamily: 'monospace' }}>{fmt(currentPurchaseTotal)}</span>
                </span>
              </div>

              <div style={{ overflowY: 'auto', padding: '0 20px 22px 24px' }}>
                {currentPurchaseEntries.length === 0 ? (
                  <div style={{
                    color: 'var(--t3)',
                    textAlign: 'center',
                    padding: '38px 16px',
                    backgroundColor: 'rgba(15,23,42,0.32)',
                    border: '1px dashed rgba(148,163,184,0.22)',
                    borderRadius: '10px',
                    fontSize: '13px',
                  }}>
                    <div style={{ color: 'var(--t1)', fontWeight: '800', marginBottom: '5px' }}>No material purchases logged yet.</div>
                    <div>Material entries from Project Logs will appear here.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {currentPurchaseEntries.map((log: any, idx: number) => {
                      const amount = currentPurchaseAmount(log)
                      const employee = log.emp || log.owner || log.ownerName || log.me || 'Me'
                      const emergencyOrApproval = [
                        log.emergencyMatInfo,
                        log.po,
                        log.poNumber,
                        log.purchaseOrder,
                        log.approvalInfo,
                        log.approvedBy,
                        log.approvalAt,
                      ].filter(Boolean).join(' | ')
                      return (
                        <div
                          key={log.id || log.logId || `${log.date || 'purchase'}-${idx}`}
                          style={{
                            background: 'linear-gradient(180deg, rgba(15,23,42,0.42), rgba(15,23,42,0.24))',
                            border: '1px solid rgba(148,163,184,0.14)',
                            borderRadius: '10px',
                            padding: '14px',
                            boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ color: '#f8fafc', fontWeight: '850', fontSize: '14px' }}>{log.date || 'No date'}</span>
                              {log.phase && (
                                <span style={{
                                  color: '#bae6fd',
                                  fontSize: '11px',
                                  fontWeight: '700',
                                  padding: '3px 8px',
                                  borderRadius: '999px',
                                  background: 'rgba(14,165,233,0.12)',
                                  border: '1px solid rgba(14,165,233,0.24)',
                                }}>{log.phase}</span>
                              )}
                            </div>
                            <span style={{ color: '#34d399', fontFamily: 'monospace', fontSize: '16px', fontWeight: '850', textShadow: '0 0 18px rgba(16,185,129,0.18)' }}>
                              {fmt(amount)}
                            </span>
                          </div>

                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                            gap: '10px 14px',
                            padding: '10px',
                            backgroundColor: 'rgba(255,255,255,0.035)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '8px',
                          }}>
                            {renderCurrentPurchaseDetail('Employee', employee)}
                            {renderCurrentPurchaseDetail('Store / Vendor', log.store)}
                            {renderCurrentPurchaseDetail('Labor Hours', num(log.hrs) > 0 ? num(log.hrs) : '')}
                            {renderCurrentPurchaseDetail('Mileage', num(log.miles) > 0 ? num(log.miles) : '')}
                            {renderCurrentPurchaseDetail('Collected', num(log.collected) > 0 ? fmt(num(log.collected)) : '', { mono: true })}
                          </div>

                          {(log.notes || emergencyOrApproval || log.detailLink) && (
                            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {log.notes && (
                                <div>
                                  <div style={{ color: 'var(--t3)', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>Work Performed / Notes</div>
                                  <div style={{ color: '#f8fafc', fontSize: '13px', lineHeight: '1.55', overflowWrap: 'anywhere' }}>{log.notes}</div>
                                </div>
                              )}
                              {emergencyOrApproval && (
                                <div style={{
                                  backgroundColor: 'rgba(245,158,11,0.08)',
                                  border: '1px solid rgba(245,158,11,0.18)',
                                  borderRadius: '8px',
                                  padding: '9px 10px',
                                }}>
                                  {renderCurrentPurchaseDetail('Emergency / PO / Approval', emergencyOrApproval)}
                                </div>
                              )}
                              {log.detailLink && (
                                <div>
                                  <div style={{ color: 'var(--t3)', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '6px' }}>Detail Link</div>
                                  <a
                                    href={log.detailLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      padding: '7px 11px',
                                      backgroundColor: 'rgba(14,165,233,0.16)',
                                      border: '1px solid rgba(14,165,233,0.34)',
                                      borderRadius: '7px',
                                      color: '#7dd3fc',
                                      fontSize: '12px',
                                      fontWeight: '800',
                                      textDecoration: 'none',
                                    }}
                                  >
                                    Open Receipt / Detail
                                  </a>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ADD TO PRICE BOOK MODAL */}
        {pbModalRowId && (() => {
          const markup = num((backup.settings?.markup) || 0)
          const customerPrice = pbFormCost * (1 + markup / 100)
          const duplicates = findPbDuplicates(pbFormName)
          const pbCategories = getPbCategories()
          const unitOptions = ['EA', 'RL', 'LF', 'BX', 'FT', 'IN', 'SQ', 'PR', 'HR']
          return (
            <div
              onClick={e => { if (e.target === e.currentTarget) closePbModal() }}
              style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.65)',
                zIndex: 60,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  backgroundColor: '#2d3148',
                  borderRadius: '10px',
                  padding: '24px',
                  maxWidth: '420px',
                  width: '92%',
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                }}
                onMouseDown={e => e.stopPropagation()}
              >
                <h3 style={{ color: '#10b981', margin: '0 0 16px 0', fontSize: '15px', fontWeight: '700' }}>
                  + Add to Price Book
                </h3>

                {/* Item Name */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ color: 'var(--t3)', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                    Item Name
                  </label>
                  <input
                    type="text"
                    value={pbFormName}
                    onChange={e => setPbFormName(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px',
                      color: 'var(--t1)',
                      fontSize: '13px',
                      padding: '6px 10px',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Duplicate warning */}
                {duplicates.length > 0 && (
                  <div style={{
                    backgroundColor: 'rgba(234,179,8,0.12)',
                    border: '1px solid rgba(234,179,8,0.35)',
                    borderRadius: '5px',
                    padding: '8px 12px',
                    marginBottom: '12px',
                    fontSize: '11px',
                    color: '#fde68a',
                  }}>
                    <strong>⚠ Similar items found in Price Book:</strong>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px' }}>
                      {duplicates.slice(0, 5).map((d: any) => (
                        <li key={d.id}>{d.name} {d.cat ? `(${d.cat})` : ''}</li>
                      ))}
                    </ul>
                    <span style={{ color: 'rgba(253,230,138,0.65)', marginTop: '4px', display: 'block' }}>
                      You can still proceed.
                    </span>
                  </div>
                )}

                {/* Two-column: Category + Supplier */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--t3)', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                      Category
                    </label>
                    <select
                      value={pbFormCat}
                      onChange={e => setPbFormCat(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '5px',
                        color: 'var(--t1)',
                        fontSize: '12px',
                        padding: '6px 8px',
                        outline: 'none',
                      }}
                    >
                      <option value="">— Select —</option>
                      {pbCategories.map((c: string) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--t3)', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                      Supplier
                    </label>
                    <input
                      type="text"
                      value={pbFormSupplier}
                      onChange={e => setPbFormSupplier(e.target.value)}
                      placeholder="e.g. Anixter"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '5px',
                        color: 'var(--t1)',
                        fontSize: '12px',
                        padding: '6px 10px',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {/* Internal Cost + Pack Size */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--t3)', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                      Internal Cost (per item)
                    </label>
                    <input
                      type="number"
                      value={pbFormCost}
                      onChange={e => setPbFormCost(parseFloat(e.target.value) || 0)}
                      min="0"
                      step="0.01"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '5px',
                        color: 'var(--t1)',
                        fontSize: '12px',
                        padding: '6px 10px',
                        outline: 'none',
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--t3)', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                      Pack Size
                    </label>
                    <input
                      type="number"
                      value={pbFormPackSize}
                      onChange={e => setPbFormPackSize(parseInt(e.target.value) || 1)}
                      min="1"
                      step="1"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '5px',
                        color: 'var(--t1)',
                        fontSize: '12px',
                        padding: '6px 10px',
                        outline: 'none',
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                </div>

                {/* Unit + Customer Price */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--t3)', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                      Unit
                    </label>
                    <select
                      value={pbFormUnit}
                      onChange={e => setPbFormUnit(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '5px',
                        color: 'var(--t1)',
                        fontSize: '12px',
                        padding: '6px 8px',
                        outline: 'none',
                      }}
                    >
                      {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--t3)', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                      Customer Price ({markup}% markup)
                    </label>
                    <div style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '5px',
                      color: '#10b981',
                      fontSize: '13px',
                      padding: '6px 10px',
                      fontFamily: 'monospace',
                      fontWeight: '600',
                    }}>
                      {fmt(customerPrice)}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={closePbModal}
                    style={{
                      padding: '8px 16px',
                      background: 'none',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: 'var(--t2)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => confirmAddToPriceBook(pbModalRowId)}
                    style={{
                      padding: '8px 18px',
                      backgroundColor: 'rgba(16,185,129,0.25)',
                      color: '#10b981',
                      border: '1px solid rgba(16,185,129,0.45)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '700',
                    }}
                  >
                    Confirm &amp; Add
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* AI SUGGEST BUTTON */}
        <button
          onClick={() => alert('AI Suggest Materials placeholder')}
          style={{
            marginTop: '10px',
            padding: '10px 16px',
            backgroundColor: 'rgba(139,92,246,0.2)',
            color: '#a78bfa',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Sparkles size={14} />
          AI Suggest Materials
        </button>
      </div>
    </div>
  )
}
