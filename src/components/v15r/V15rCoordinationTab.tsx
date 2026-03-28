// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles, ChevronDown } from 'lucide-react'
import { getBackupData, saveBackupData } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

interface V15rCoordinationTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

const coordSections = [
  { key: 'light', label: 'Light Coordination', color: '#3b82f6' },
  { key: 'main', label: 'Main Coordination', color: '#f59e0b' },
  { key: 'urgent', label: 'Urgent Items', color: '#ef4444' },
  { key: 'research', label: 'Research', color: '#06b6d4' },
  { key: 'permit', label: 'Permit', color: '#a855f7' },
  { key: 'inspect', label: 'Inspection', color: '#10b981' },
  { key: 'warn', label: 'Warnings/Issues', color: '#f97316' },
]

export default function V15rCoordinationTab({ projectId, onUpdate, backup: initialBackup }: V15rCoordinationTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['light', 'main', 'urgent']))

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const toggleSection = (key) => {
    const newOpen = new Set(openSections)
    if (newOpen.has(key)) {
      newOpen.delete(key)
    } else {
      newOpen.add(key)
    }
    setOpenSections(newOpen)
  }

  const addItem = (key) => {
    const text = prompt(`Add ${coordSections.find(s => s.key === key)?.label || 'item'}:`)
    if (!text) return
    pushState()
    if (!p.coord) p.coord = {}
    if (!p.coord[key]) p.coord[key] = []
    p.coord[key].push({
      id: 'ci' + Date.now(),
      text: String(text),
      status: 'pending',
    })
    saveBackupData(backup)
    forceUpdate()
  }

  const editItem = (key, itemId, field, value) => {
    pushState()
    const items = (p.coord || {})[key] || []
    const item = items.find(i => i.id === itemId)
    if (item) {
      if (field === 'text') item.text = String(value)
      else if (field === 'status') item.status = String(value)
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const delItem = (key, itemId) => {
    pushState()
    if (p.coord && p.coord[key]) {
      p.coord[key] = p.coord[key].filter(i => i.id !== itemId)
    }
    saveBackupData(backup)
    forceUpdate()
  }

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {coordSections.map(section => {
            const items = (p.coord || {})[section.key] || []
            const isOpen = openSections.has(section.key)

            return (
              <div key={section.key} style={{ backgroundColor: '#232738', borderRadius: '8px', overflow: 'hidden' }}>
                <button
                  onClick={() => toggleSection(section.key)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    backgroundColor: section.color + '15',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '13px',
                  }}
                >
                  <ChevronDown
                    size={16}
                    style={{
                      color: section.color,
                      transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.2s',
                    }}
                  />
                  <span style={{ color: 'var(--t1)', fontWeight: '600', flex: 1, textAlign: 'left' }}>
                    {section.label}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--t3)', backgroundColor: '#1e2130', padding: '2px 8px', borderRadius: '3px' }}>
                    {items.length}
                  </span>
                </button>

                {isOpen && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {items.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--t3)', marginBottom: '12px', textAlign: 'center' }}>
                        No items yet
                      </div>
                    ) : (
                      <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {items.map(item => (
                          <div
                            key={item.id}
                            style={{
                              padding: '8px 10px',
                              backgroundColor: '#1e2130',
                              borderRadius: '4px',
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              fontSize: '12px',
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <input
                                type="text"
                                value={item.text || ''}
                                onChange={e => editItem(section.key, item.id, 'text', e.target.value)}
                                style={{
                                  width: '100%',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--t1)',
                                  fontSize: '12px',
                                  fontFamily: 'inherit',
                                  outline: 'none',
                                }}
                              />
                            </div>
                            <select
                              value={item.status || 'pending'}
                              onChange={e => editItem(section.key, item.id, 'status', e.target.value)}
                              style={{
                                padding: '3px 6px',
                                backgroundColor: '#0f1117',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '3px',
                                color: 'var(--t2)',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              <option value="pending">Pending</option>
                              <option value="completed">Completed</option>
                            </select>
                            <button
                              onClick={() => delItem(section.key, item.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                fontSize: '14px',
                                padding: '0',
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => addItem(section.key)}
                      style={{
                        width: '100%',
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
          })}
        </div>

        {/* AI PRIORITIZE BUTTON */}
        <button
          onClick={() => alert('AI Prioritize placeholder')}
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
          AI Prioritize
        </button>
      </div>
    </div>
  )
}
