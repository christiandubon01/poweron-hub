// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles, Download, Upload } from 'lucide-react'
import { getBackupData, saveBackupData } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

interface V15rFrameworkTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rFrameworkTab({ projectId, onUpdate, backup: initialBackup }: V15rFrameworkTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const frameworks = backup.blueprintSummaries || {}
  const projectFramework = frameworks[projectId] || {}

  const handleImport = () => {
    const json = prompt('Paste JSON framework:')
    if (!json) return
    try {
      pushState()
      const data = JSON.parse(json)
      if (!frameworks[projectId]) frameworks[projectId] = {}
      Object.assign(frameworks[projectId], data)
      saveBackupData(backup)
      forceUpdate()
      alert('Framework imported ✓')
    } catch (e) {
      alert('Invalid JSON: ' + e.message)
    }
  }

  const handleExport = () => {
    const json = JSON.stringify(projectFramework, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `framework_${p.id}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0' }}>Project Framework</h4>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleImport}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(59,130,246,0.2)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Upload size={14} />
                Import
              </button>
              <button
                onClick={handleExport}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(34,197,94,0.2)',
                  color: '#22c55e',
                  border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Download size={14} />
                Export
              </button>
            </div>
          </div>

          <p style={{ color: 'var(--t3)', fontSize: '13px', margin: '0' }}>
            {Object.keys(projectFramework).length > 0
              ? `Framework loaded with ${Object.keys(projectFramework).length} categories`
              : 'No framework imported yet. Import or create one above.'}
          </p>
        </div>

        {/* FRAMEWORK CONTENT */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 12px 0' }}>
              Categories ({Object.keys(projectFramework).length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
              {Object.keys(projectFramework).length > 0 ? (
                Object.entries(projectFramework).map(([key, val]: any) => (
                  <div
                    key={key}
                    style={{
                      padding: '8px 10px',
                      backgroundColor: '#1e2130',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: 'var(--t2)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{key}</span>
                    <span style={{ fontSize: '10px', color: 'var(--t3)' }}>
                      {Array.isArray(val) ? val.length : Object.keys(val || {}).length}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--t3)', padding: '12px', textAlign: 'center' }}>
                  No categories yet
                </div>
              )}
            </div>
          </div>

          <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 12px 0' }}>
              Notes
            </h4>
            <div style={{ fontSize: '12px', color: 'var(--t3)', lineHeight: '1.6' }}>
              <p>• Framework structure stored independently from RFI and Coordination</p>
              <p>• Import/export as JSON for backup and sharing</p>
              <p>• Integrate framework items with RFI or Coordination as needed</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
