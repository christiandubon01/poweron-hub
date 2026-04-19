// @ts-nocheck
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Sparkles, FileText, Search } from 'lucide-react'
import { getBackupData, saveBackupData, num, fmt } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { exportMaterialSummaryPDF } from '@/services/mtoExportService'

interface V15rMTOTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rMTOTab({ projectId, onUpdate, backup: initialBackup }: V15rMTOTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  // ── Multi-select state ──────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Bulk assign state ───────────────────────────────────────────────
  const [bulkPlacement, setBulkPlacement] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingBulkPlacement, setPendingBulkPlacement] = useState('')

  // ── Placement local state (Bugs 1+2+3) ─────────────────────────────
  // localPlacements holds per-row typed value before onBlur / Enter commit.
  // onChange updates ONLY this local state — no data write, no grouping re-trigger.
  // onBlur and onEnter commit the value to the actual row data.
  const [localPlacements, setLocalPlacements] = useState<Record<string, string>>({})
  const [localUnitCosts, setLocalUnitCosts] = useState<Record<string, string>>({})

  // ── Row focus / hover tracking (Bug 4) ─────────────────────────────
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)

  // ── Inline edit state for chip-to-input transform ─────────────────
  const [editingPlacementId, setEditingPlacementId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)

  // ── Add to Price Book modal state ──────────────────────────────────
  const [pbModalRowId, setPbModalRowId] = useState<string | null>(null)
  const [pbFormName, setPbFormName] = useState('')
  const [pbFormCat, setPbFormCat] = useState('')
  const [pbFormSupplier, setPbFormSupplier] = useState('')
  const [pbFormCost, setPbFormCost] = useState<number>(0)
  const [pbFormPackSize, setPbFormPackSize] = useState<number>(1)
  const [pbFormUnit, setPbFormUnit] = useState('EA')


  // ── Data ────────────────────────────────────────────────────────────
  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const phases = backup.settings?.mtoPhases || ['Underground', 'Rough In', 'Trim', 'Finish']
  const allRows: any[] = p.mtoRows || []

  // ── Row mutations ───────────────────────────────────────────────────
  const editMTORow = (rowId: string, field: string, value: any) => {
    pushState()
    const row = allRows.find(r => r.id === rowId)
    if (row) {
      if (field === 'qty') row.qty = num(value)
      else if (field === 'name') row.name = String(value)
      else if (field === 'placement') row.placement = String(value)
      else if (field === 'note') row.note = String(value)
      else if (field === 'unitCost') {
        // Empty string = clear override (fall back to priceBook suggestion)
        row.unitCost = value === '' || value === null || value === undefined ? undefined : num(value)
      }
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const addMTORow = (phase: string) => {
    pushState()
    p.mtoRows = p.mtoRows || []
    p.mtoRows.push({
      id: 'mto' + Date.now(),
      phase,
      matId: '',
      name: 'New item',
      qty: 1,
      detailNote: '',
      supplierNote: '',
      placement: '',
      note: '',
    })
    saveBackupData(backup)
    forceUpdate()
  }

  const delMTORow = (rowId: string) => {
    pushState()
    p.mtoRows = (p.mtoRows || []).filter(r => r.id !== rowId)
    setSelectedIds(prev => { const n = new Set(prev); n.delete(rowId); return n })
    // Clean up local placement state for the deleted row
    setLocalPlacements(prev => { const n = { ...prev }; delete n[rowId]; return n })
    saveBackupData(backup)
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
    backup.priceBook = backup.priceBook || []
    backup.priceBook.push(newItem)

    // Link the MTO row to the new price book entry
    const row = (p.mtoRows || []).find((r: any) => r.id === rowId)
    if (row) row.matId = newItem.id

    saveBackupData(backup)
    forceUpdate()
    closePbModal()
  }

  // ── Derived flags ───────────────────────────────────────────────────
  const hasAnyRows = allRows.length > 0
  // IMPORTANT: grouping reads ONLY from committed row data, never from localPlacements
  const hasAnyPlacement = allRows.some(r => r.placement && r.placement.trim())
  const existingPlacements: string[] = [...new Set(allRows.map(r => r.placement).filter(Boolean))]

  // ── Selection helpers ───────────────────────────────────────────────
  // Click handle = toggle that one row. No drag-range, no hover expansion.
  const handleRowMouseDown = (e: React.MouseEvent, rowId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(rowId)) n.delete(rowId)
      else n.add(rowId)
      return n
    })
  }

  // No-op kept for signature compatibility (tr still calls it)
  const handleRowMouseEnter = (_rowId: string) => {
    // Drag-range-select disabled — handles only toggle individual rows on click
  }

  // ── Bulk assign ─────────────────────────────────────────────────────
  const applyBulkAssign = () => {
    if (selectedIds.size >= 2) {
      setPendingBulkPlacement(bulkPlacement)
      setShowConfirm(true)
    } else {
      doApplyBulk(bulkPlacement)
    }
  }

  const doApplyBulk = (placement: string) => {
    pushState()
    ;(p.mtoRows || []).forEach(r => {
      if (selectedIds.has(r.id)) r.placement = placement
    })
    saveBackupData(backup)
    setSelectedIds(new Set())
    setBulkPlacement('')
    setShowConfirm(false)
    forceUpdate()
  }

  // ── Sub-renderers ───────────────────────────────────────────────────
  const renderTableHead = () => (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--bdr2)' }}>
        <th style={{ width: '20px' }}></th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Item Title</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '100px' }}>Supplier</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '110px' }}>Family</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '60px' }}>Qty</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '60px' }}>Unit</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Unit Cost</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Sell Price</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '90px' }}>Total</th>
        <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600', width: '40px' }}></th>
      </tr>
    </thead>
  )

  const renderRow = (r: any) => {
    const pbItem = getPBItem(r.matId)
    // cu = row-level override if present, otherwise priceBook suggestion
    const cu = r.unitCost !== undefined && r.unitCost !== null
      ? num(r.unitCost)
      : num(pbItem?.cost || 0)
    const waste = num(pbItem?.waste || 0)
    const markupPct = num(backup.settings?.markup || 0) / 100
    const sellPrice = cu * (1 + markupPct)
    const lt = num(r.qty || 0) * sellPrice * (1 + waste)
    const isSelected = selectedIds.has(r.id)
    // Normalize supplier display: empty or legacy "PDF Import" → N/A
    const supplierDisplay = (!pbItem?.src || pbItem.src === 'PDF Import' || pbItem.src === 'PDF Imported')
      ? 'N/A'
      : pbItem.src
    const familyDisplay = (!pbItem?.cat || pbItem.cat === 'PDF Imported')
      ? '—'
      : pbItem.cat
    // Unit cost input — local state for smooth typing, commits on blur
    const localCostVal = localUnitCosts[r.id] !== undefined
      ? localUnitCosts[r.id]
      : (cu > 0 ? String(cu) : '')

    // ── Bug 1+2+3: local placement value ────────────────────────────
    // localVal shows the typed value; committed r.placement is the source of truth for grouping.
    const localVal = localPlacements[r.id] !== undefined ? localPlacements[r.id] : (r.placement || '')

    // Commit placement to data layer (onBlur / Enter).
    // Reads from e.target.value to always have the latest DOM value.
    const commitPlacement = (domValue: string) => {
      if (domValue !== (r.placement || '')) {
        editMTORow(r.id, 'placement', domValue)
      }
      // Remove local override; row will read from r.placement on next render
      setLocalPlacements(prev => { const n = { ...prev }; delete n[r.id]; return n })
    }

    // ── Bug 4: secondary row visibility ─────────────────────────────
    const isRowFocused = focusedRowId === r.id
    const isRowHovered = hoveredRowId === r.id

    // ── Google search button visibility ─────────────────────────────
    // Show when item name has text AND no price book item name matches it.
    const nameHasText = !!(r.name && r.name.trim())
    const showSearchBtn = nameHasText && !hasPBNameMatch(r.name)
    // Chip-based placement/note UX
    const hasPlacementVal = !!(localVal.trim())
    const hasNoteVal = !!(r.note && r.note.trim())
    const isEditingPlacement = editingPlacementId === r.id
    const isEditingNote = editingNoteId === r.id

    return (
      <tr
        key={r.id}
        onMouseEnter={() => setHoveredRowId(r.id)}
        onMouseLeave={() => setHoveredRowId(null)}
        style={{
          borderBottom: '1px solid var(--bdr2)',
          userSelect: 'none',
          backgroundColor: isSelected ? 'rgba(59,130,246,0.08)' : 'transparent',
          borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
          cursor: 'default',
          transition: 'background-color 0.1s, border-left-color 0.1s',
        }}
      >
        {/* Drag handle — only this cell initiates selection */}
        <td
          onMouseDown={e => handleRowMouseDown(e, r.id)}
          title="Drag to select range, Ctrl+click for multi-select"
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
          {/* Name input + optional Google search button — inline flex row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="text"
              value={r.name || ''}
              onChange={e => editMTORow(r.id, 'name', e.target.value)}
              onMouseDown={e => e.stopPropagation()}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--t1)',
                flex: 1,
                minWidth: 0,
                fontSize: '12px',
              }}
            />
            {showSearchBtn && (
              <button
                title="Search this item online"
                onClick={() => {
                  window.open(
                    'https://www.google.com/search?q=' + encodeURIComponent(r.name.trim()),
                    '_blank'
                  )
                }}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 6px',
                  background: 'none',
                  border: 'none',
                  borderRadius: '3px',
                  color: isRowHovered ? 'rgba(148,163,184,0.85)' : 'rgba(148,163,184,0.3)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  flexShrink: 0,
                  transition: 'color 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                <Search size={10} />
                Search
              </button>
            )}
            {/* + Price Book button — visible on hover */}
            {isRowHovered && (
              <button
                title="Add to Price Book"
                onClick={e => { e.stopPropagation(); openPbModal(r) }}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 6px',
                  background: 'rgba(16,185,129,0.15)',
                  border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: '3px',
                  color: '#10b981',
                  cursor: 'pointer',
                  fontSize: '10px',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                + Price Book
              </button>
            )}
          </div>

          {/* Placement chip / input */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* -- Placement -- */}
            {hasPlacementVal && !isEditingPlacement ? (
              <span
                onClick={() => setEditingPlacementId(r.id)}
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
                  onClick={e => {
                    e.stopPropagation()
                    editMTORow(r.id, 'placement', '')
                    setLocalPlacements(prev => { const n = { ...prev }; delete n[r.id]; return n })
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
                onChange={e => setLocalPlacements(prev => ({ ...prev, [r.id]: e.target.value }))}
                onBlur={e => {
                  commitPlacement(e.target.value)
                  setEditingPlacementId(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitPlacement((e.target as HTMLInputElement).value)
                    setEditingPlacementId(null)
                  }
                  if (e.key === 'Escape') {
                    setLocalPlacements(prev => { const n = { ...prev }; delete n[r.id]; return n })
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
                onClick={() => setEditingPlacementId(r.id)}
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
                onClick={() => setEditingNoteId(r.id)}
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
                {r.note}
                <span
                  onClick={e => {
                    e.stopPropagation()
                    editMTORow(r.id, 'note', '')
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
                value={r.note || ''}
                onChange={e => editMTORow(r.id, 'note', e.target.value)}
                onBlur={() => setEditingNoteId(null)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
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
                onClick={() => setEditingNoteId(r.id)}
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

            {/* -- Supplier Note chip -- */}
            {r.supplierNote && r.supplierNote.trim() ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(6,182,212,0.15)',
                  color: '#22d3ee',
                  border: '1px solid rgba(6,182,212,0.3)',
                  fontSize: '10px',
                  fontWeight: '500',
                  lineHeight: '1.5',
                }}
              >
                📋 {r.supplierNote.trim()}
              </span>
            ) : null}
          </div>
        </td>

        <td style={{ padding: '8px', fontSize: '11px', color: supplierDisplay === 'N/A' ? 'var(--t3)' : 'var(--t2)' }}>
          {supplierDisplay}
        </td>
        <td style={{ padding: '8px', fontSize: '11px', color: 'var(--t3)' }}>
          {familyDisplay}
        </td>
        <td style={{ padding: '8px', textAlign: 'right' }}>
          <input
            type="number"
            value={r.qty || 0}
            onChange={e => editMTORow(r.id, 'qty', e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            step="1"
            onKeyDown={e => {
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                editMTORow(r.id, 'qty', Math.floor(num(r.qty || 0)) + 1)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                editMTORow(r.id, 'qty', Math.max(0, Math.ceil(num(r.qty || 0)) - 1))
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
          <input
            type="number"
            value={localCostVal}
            placeholder="—"
            step="0.01"
            onMouseDown={e => e.stopPropagation()}
            onChange={e => {
              // Local only — smooth typing, no save until blur/Enter
              setLocalUnitCosts(prev => ({ ...prev, [r.id]: e.target.value }))
            }}
            onBlur={e => {
              const v = e.target.value
              editMTORow(r.id, 'unitCost', v)
              setLocalUnitCosts(prev => {
                const n = { ...prev }
                delete n[r.id]
                return n
              })
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setLocalUnitCosts(prev => {
                  const n = { ...prev }
                  delete n[r.id]
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
        </td>
        <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '12px', color: '#60a5fa' }}>
          {cu > 0 ? fmt(sellPrice) : '—'}
        </td>
        <td style={{ padding: '8px', textAlign: 'right', fontWeight: '600', color: '#10b981', fontFamily: 'monospace' }}>
          {cu > 0 ? fmt(lt) : '—'}
        </td>
        <td style={{ padding: '8px', textAlign: 'center' }}>
          <button
            onClick={() => delMTORow(r.id)}
            onMouseDown={e => e.stopPropagation()}
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '0',
            }}
          >
            ×
          </button>
        </td>
      </tr>
    )
  }

  // Phase-grouped view (original behavior — no placements assigned)
  const renderPhaseGroups = () =>
    phases.map(phase => {
      const rows = allRows.filter(r => r.phase === phase)
      let phTotal = 0
      rows.forEach(r => {
        const pbItem = getPBItem(r.matId)
        const cu = num(pbItem?.cost || 0)
        const waste = num(pbItem?.waste || 0)
        const markupPct = num(backup.settings?.markup || 0) / 100
        phTotal += num(r.qty || 0) * cu * (1 + markupPct) * (1 + waste)
      })

      return (
        <div
          key={phase}
          style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}
        >
          <div
            style={{
              backgroundColor: 'rgba(139,92,246,0.1)',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0' }}>
              {phase} ({rows.length} items)
            </h4>
            <span style={{ color: '#10b981', fontWeight: '600', fontFamily: 'monospace' }}>{fmt(phTotal)}</span>
          </div>

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
              onClick={() => addMTORow(phases[0] || 'Underground')}
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

        {/* FLOATING ACTION BAR — visible when ≥1 row selected */}
        {selectedIds.size > 0 && (
          <div
            style={{
              position: 'sticky',
              top: '0',
              zIndex: 20,
              backgroundColor: '#2d3148',
              border: '1px solid rgba(99,102,241,0.5)',
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
              marginBottom: '12px',
              boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
            }}
          >
            <span style={{ color: '#a5b4fc', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}>
              {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'items'} selected
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--t3)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                Assign to placement:
              </span>
              <input
                list="mto-placement-options"
                value={bulkPlacement}
                onChange={e => setBulkPlacement(e.target.value)}
                placeholder="Type or select…"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '4px',
                  color: 'var(--t1)',
                  fontSize: '12px',
                  padding: '4px 8px',
                  minWidth: '140px',
                }}
              />
              <datalist id="mto-placement-options">
                {existingPlacements.map(pl => (
                  <option key={pl} value={pl} />
                ))}
              </datalist>
              {/* UX Fix: renamed from "Apply" to "Move to Placement →" for clarity */}
              <button
                onClick={applyBulkAssign}
                style={{
                  padding: '4px 12px',
                  backgroundColor: 'rgba(99,102,241,0.3)',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99,102,241,0.4)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Move to Placement →
              </button>
            </div>

            <button
              onClick={() => { setSelectedIds(new Set()); setBulkPlacement('') }}
              style={{
                padding: '4px 10px',
                background: 'none',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--t3)',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* CONFIRMATION DIALOG — 2+ items bulk assign */}
        {showConfirm && (
          <div
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.65)',
              zIndex: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={e => { if (e.target === e.currentTarget) { setShowConfirm(false); setPendingBulkPlacement('') } }}
          >
            <div
              style={{
                backgroundColor: '#2d3148',
                borderRadius: '10px',
                padding: '24px',
                maxWidth: '360px',
                width: '90%',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
              }}
            >
              <p style={{ color: 'var(--t1)', fontSize: '14px', margin: '0 0 20px 0', lineHeight: '1.5' }}>
                You're moving{' '}
                <strong style={{ color: '#a5b4fc' }}>{selectedIds.size} items</strong> to{' '}
                <strong style={{ color: '#86efac' }}>
                  {pendingBulkPlacement || '(unassigned)'}
                </strong>
                . Are you sure?
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setShowConfirm(false); setPendingBulkPlacement('') }}
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
                  onClick={() => doApplyBulk(pendingBulkPlacement)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'rgba(99,102,241,0.3)',
                    color: '#a5b4fc',
                    border: '1px solid rgba(99,102,241,0.4)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600',
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MAIN CONTENT — phase view or placement view */}
        {hasAnyRows && (hasAnyPlacement ? renderPlacementGroups() : renderPhaseGroups())}

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
