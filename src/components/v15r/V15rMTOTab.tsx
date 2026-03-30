// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { getBackupData, saveBackupData, num, fmt } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

interface V15rMTOTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rMTOTab({ projectId, onUpdate, backup: initialBackup }: V15rMTOTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const phases = backup.settings?.mtoPhases || ['Underground', 'Rough In', 'Trim', 'Finish']

  const editMTORow = (rowId, field, value) => {
    pushState()
    const row = (p.mtoRows || []).find(r => r.id === rowId)
    if (row) {
      if (field === 'qty') row.qty = num(value)
      else if (field === 'name') row.name = String(value)
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const addMTORow = (phase) => {
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
    })
    saveBackupData(backup)
    forceUpdate()
  }

  const delMTORow = (rowId) => {
    pushState()
    p.mtoRows = (p.mtoRows || []).filter(r => r.id !== rowId)
    saveBackupData(backup)
    forceUpdate()
  }

  const getPBItem = (matId) => {
    if (!matId) return null
    return (backup.priceBook || []).find(x => x.id === matId)
  }

  // Check if completely empty
  const hasAnyRows = (p.mtoRows || []).length > 0

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
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

        {phases.map(phase => {
          const rows = (p.mtoRows || []).filter(r => r.phase === phase)
          let phTotal = 0
          rows.forEach(r => {
            const pbItem = getPBItem(r.matId)
            const cu = num(pbItem?.cost || 0)
            const waste = num(pbItem?.waste || 0)
            const lt = num(r.qty || 0) * cu * (1 + waste)
            phTotal += lt
          })

          return (
            <div key={phase} style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
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
                  <tbody>
                    {rows.map(r => {
                      const pbItem = getPBItem(r.matId)
                      const cu = num(pbItem?.cost || 0)
                      const waste = num(pbItem?.waste || 0)
                      const lt = num(r.qty || 0) * cu * (1 + waste)
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--bdr2)' }}>
                          <td style={{ padding: '8px' }}>
                            <input
                              type="text"
                              value={r.name || ''}
                              onChange={e => editMTORow(r.id, 'name', e.target.value)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--t1)',
                                width: '100%',
                                fontSize: '12px',
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px', fontSize: '11px', color: 'var(--t3)' }}>
                            {pbItem?.src || '—'}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            <input
                              type="number"
                              value={r.qty || 0}
                              onChange={e => editMTORow(r.id, 'qty', e.target.value)}
                              step="0.01"
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
                    })}
                  </tbody>
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
        })}

        {/* AI SUGGEST BUTTON */}
        <button
          onClick={() => alert('AI Suggest Materials placeholder')}
          style={{
            marginTop: '16px',
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
