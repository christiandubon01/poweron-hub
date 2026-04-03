// @ts-nocheck
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Sparkles, FileText } from 'lucide-react'
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
  const [isSelecting, setIsSelecting] = useState(false)
  const anchorIdRef = useRef<string | null>(null)

  // ── Bulk assign state ───────────────────────────────────────────────
  const [bulkPlacement, setBulkPlacement] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingBulkPlacement, setPendingBulkPlacement] = useState('')

  // ── Placement local state (Bugs 1+2+3) ─────────────────────────────
  // localPlacements holds per-row typed value before onBlur / Enter commit.
  // onChange updates ONLY this local state — no data write, no grouping re-trigger.
  // onBlur and onEnter commit the value to the actual row data.
  const [localPlacements, setLocalPlacements] = useState<Record<string, string>>({})

  // ── Row focus / hover tracking (Bug 4) ─────────────────────────────
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)

  // Global mouseup ends drag-select
  const handleMouseUp = useCallback(() => setIsSelecting(false), [])
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

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

  // ── Derived flags ───────────────────────────────────────────────────
  const hasAnyRows = allRows.length > 0
  // IMPORTANT: grouping reads ONLY from committed row data, never from localPlacements
  const hasAnyPlacement = allRows.some(r => r.placement && r.placement.trim())
  const existingPlacements: string[] = [...new Set(allRows.map(r => r.placement).filter(Boolean))]

  // ── Selection helpers ───────────────────────────────────────────────
  const handleRowMouseDown = (e: React.MouseEvent, rowId: string) => {
    if (e.button !== 0) return
    if (e.ctrlKey || e.metaKey) {
      // Non-contiguous toggle
      setSelectedIds(prev => {
        const n = new Set(prev)
        if (n.has(rowId)) n.delete(rowId)
        else n.add(rowId)
        return n
      })
    } else {
      // Start drag-range selection
      setIsSelecting(true)
      anchorIdRef.current = rowId
      setSelectedIds(new Set([rowId]))
    }
  }

  const handleRowMouseEnter = (rowId: string) => {
    if (!isSelecting || !anchorIdRef.current) return
    const ids = allRows.map(r => r.id)
    const anchorIdx = ids.indexOf(anchorIdRef.current)
    const currIdx = ids.indexOf(rowId)
    if (anchorIdx < 0 || currIdx < 0) return
    const start = Math.min(anchorIdx, currIdx)
    const end = Math.max(anchorIdx, currIdx)
    setSelectedIds(new Set(ids.slice(start, end + 1)))
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
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Item Title</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '100px' }}>Source</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '60px' }}>Qty</th>
        <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '60px' }}>Unit</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Unit Cost</th>
        <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Total</th>
        <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600', width: '40px' }}></th>
      </tr>
    </thead>
  )

  const renderRow = (r: any) => {
    const pbItem = getPBItem(r.matId)
    const cu = num(pbItem?.cost || 0)
    const waste = num(pbItem?.waste || 0)
    const lt = num(r.qty || 0) * cu * (1 + waste)
    const isSelected = selectedIds.has(r.id)

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
    // Show inputs if there is any committed OR locally-typed placement, or a note, or the row is focused
    const hasPlacementVal = !!(localVal.trim())
    const hasNoteVal = !!(r.note && r.note.trim())
    const hasAnySecondaryValue = hasPlacementVal || hasNoteVal
    const showSecondaryInputs = hasAnySecondaryValue || isRowFocused
    // Show the "+Add" hint only when hovered but secondary is hidden
    const showAddHint = !showSecondaryInputs && isRowHovered

    return (
      <tr
        key={r.id}
        onMouseDown={e => handleRowMouseDown(e, r.id)}
        onMouseEnter={() => { handleRowMouseEnter(r.id); setHoveredRowId(r.id) }}
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
        {/* Item Title + inline placement/note fields */}
        <td style={{ padding: '8px' }}>
          <input
            type="text"
            value={r.name || ''}
            onChange={e => editMTORow(r.id, 'name', e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--t1)',
              width: '100%',
              fontSize: '12px',
              display: 'block',
            }}
          />

          {/* Bug 4: Hover hint — only shown when row is hovered, has no values, and is not focused */}
          {showAddHint && (
            <div
              onClick={() => setFocusedRowId(r.id)}
              onMouseDown={e => e.stopPropagation()}
              style={{
                marginTop: '3px',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.25)',
                cursor: 'pointer',
                padding: '2px 0',
              }}
            >
              + Add placement / note
            </div>
          )}

          {/* Bug 4: Secondary inputs — hidden when both empty and not focused */}
          {showSecondaryInputs && (
            <div
              style={{ display: 'flex', gap: '4px', marginTop: '3px' }}
              onFocus={() => setFocusedRowId(r.id)}
              onBlur={e => {
                // Only clear focus if focus moved entirely outside this wrapper
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setFocusedRowId(null)
                }
              }}
            >
              {/* Bug 1+2+3: placement uses local state; commits on blur/Enter */}
              <input
                type="text"
                value={localVal}
                onChange={e => setLocalPlacements(prev => ({ ...prev, [r.id]: e.target.value }))}
                onBlur={e => commitPlacement(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitPlacement((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).blur()
                  }
                }}
                onMouseDown={e => e.stopPropagation()}
                placeholder="Zone/Placement"
                title="Optional zone or location tag"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '3px',
                  color: localVal.trim() ? '#86efac' : 'var(--t3)',
                  width: '50%',
                  fontSize: '10px',
                  padding: '2px 5px',
                }}
              />
              <input
                type="text"
                value={r.note || ''}
                onChange={e => editMTORow(r.id, 'note', e.target.value)}
                onMouseDown={e => e.stopPropagation()}
                placeholder="Field note"
                title="Optional field note"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '3px',
                  color: 'var(--t3)',
                  width: '50%',
                  fontSize: '10px',
                  padding: '2px 5px',
                }}
              />
            </div>
          )}
        </td>

        <td style={{ padding: '8px', fontSize: '11px', color: 'var(--t3)' }}>
          {pbItem?.src || '—'}
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
          {cu > 0 ? fmt(cu) : '—'}
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
        phTotal += num(r.qty || 0) * cu * (1 + waste)
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
        const cu = num(pbItem?.cost || 0)
        const waste = num(pbItem?.waste || 0)
        grpTotal += num(r.qty || 0) * cu * (1 + waste)
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
      onMouseLeave={() => setIsSelecting(false)}
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
