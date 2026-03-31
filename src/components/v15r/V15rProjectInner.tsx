// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { getBackupData, saveBackupData, getOverallCompletion, health, fmt } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import V15rEstimateTab from './V15rEstimateTab'
import V15rMTOTab from './V15rMTOTab'
import V15rProgressTab from './V15rProgressTab'
import V15rFrameworkTab from './V15rFrameworkTab'
import V15rRFITab from './V15rRFITab'
import V15rCoordinationTab from './V15rCoordinationTab'
import V15rBlueprintsTab from './V15rBlueprintsTab'

interface V15rProjectInnerProps {
  projectId: string
  activeTab?: string
  onTabChange?: (tab: string) => void
  onClose?: () => void
}

// Map external tab IDs (from sidebar nav) to internal tab IDs
function mapExternalToInternalTab(externalTab?: string): string {
  const mapping: Record<string, string> = {
    'estimate': 'estimate',
    'material-takeoff': 'mto',
    'progress': 'progress',
    'framework': 'framework',
    'rfi-tracker': 'rfi',
    'coordination': 'coord',
    'blueprints': 'blueprints',
  }
  return mapping[externalTab || 'estimate'] || 'estimate'
}

export default function V15rProjectInner({ projectId, activeTab: propActiveTab, onTabChange, onClose }: V15rProjectInnerProps) {
  const [localTab, setLocalTab] = useState(mapExternalToInternalTab(propActiveTab))
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  // Sync local tab with prop changes
  React.useEffect(() => {
    const newTab = mapExternalToInternalTab(propActiveTab)
    setLocalTab(newTab)
  }, [propActiveTab])

  const backup = getBackupData()
  if (!backup) return <div className="text-red-400 p-4">No backup data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div className="text-red-400 p-4">Project not found</div>

  const h = health(p, backup)
  const completion = Math.round(getOverallCompletion(p, backup))

  const tabs = [
    { id: 'estimate', label: 'Estimate', component: V15rEstimateTab },
    { id: 'mto', label: 'Material Takeoff', component: V15rMTOTab },
    { id: 'progress', label: 'Progress', component: V15rProgressTab },
    { id: 'framework', label: 'Framework', component: V15rFrameworkTab },
    { id: 'rfi', label: 'RFI Tracker', component: V15rRFITab },
    { id: 'coord', label: 'Coordination', component: V15rCoordinationTab },
    { id: 'blueprints', label: '📐 Blueprints', component: V15rBlueprintsTab },
  ]

  const ActiveComponent = tabs.find(t => t.id === localTab)?.component || V15rEstimateTab

  const handleTabClick = (tabId: string) => {
    setLocalTab(tabId)
    if (onTabChange) {
      // Map internal tab IDs back to external names for parent
      const reverseMapping: Record<string, string> = {
        'estimate': 'estimate',
        'mto': 'material-takeoff',
        'progress': 'progress',
        'framework': 'framework',
        'rfi': 'rfi-tracker',
        'coord': 'coordination',
        'blueprints': 'blueprints',
      }
      onTabChange(reverseMapping[tabId] || tabId)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#1a1d27' }}>
      <div
        className="sticky top-0 z-40 border-b"
        style={{ backgroundColor: '#232738', borderColor: 'rgba(255,255,255,0.05)', paddingBottom: '12px' }}
      >
        <div className="px-4 py-3">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--t1)' }}>
                {p.name}
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>
                {p.type} • Health: <span style={{ color: h.clr }}>{h.sc}%</span> • {completion}% complete
              </p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                style={{
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
                ← Back to Projects
              </button>
            )}
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className="px-3 text-sm font-medium whitespace-nowrap rounded-t transition-colors flex-shrink-0"
                style={{
                  minHeight: '44px', // iOS touch target minimum
                  backgroundColor: localTab === tab.id ? 'rgba(59,130,246,0.5)' : 'transparent',
                  color: localTab === tab.id ? '#fff' : 'var(--t3)',
                  borderBottom: localTab === tab.id ? '2px solid #3b82f6' : 'none',
                  fontSize: '14px',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <ActiveComponent projectId={projectId} onUpdate={forceUpdate} backup={backup} />
      </div>
    </div>
  )
}
