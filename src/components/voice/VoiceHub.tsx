// @ts-nocheck
/**
 * VoiceHub.tsx — B14 | Voice Hub consolidation
 *
 * Replaces three separate sidebar items (Journal, Voice Journaling V2,
 * Voice Capture Queue) with a single tabbed panel.
 *
 * Tabs:
 *   Quick Capture — Voice Capture Queue (VoiceJournalingV2)
 *   Journal       — JournalPanel
 *   Insights      — Voice Journaling V2 (VoiceJournalingV2)
 *
 * Rule: Do NOT rewrite underlying components — wrap in tabs only.
 */

import React, { useState, Suspense, lazy } from 'react'

// Lazy-load underlying components (same pattern used in AppShell)
function chunkRetry<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((): any => { window.location.reload(); return { default: () => null } })
}

const VoiceJournalingV2 = lazy(() => chunkRetry(() => import('@/views/VoiceJournalingV2')))
const JournalPanel = lazy(() =>
  import('@/components/JournalPanel')
    .then(m => ({ default: m.JournalPanel }))
    .catch((): any => { window.location.reload(); return { default: () => null } })
)

type VoiceHubTab = 'quick-capture' | 'journal' | 'insights'

const TABS: { id: VoiceHubTab; label: string }[] = [
  { id: 'quick-capture', label: 'Quick Capture' },
  { id: 'journal',       label: 'Journal'        },
  { id: 'insights',      label: 'Insights'       },
]

function PanelLoading() {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function VoiceHub() {
  const [activeTab, setActiveTab] = useState<VoiceHubTab>('quick-capture')

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--text-primary)' }}>
      {/* Horizontal tab bar */}
      <div
        className="flex-shrink-0 flex items-center border-b gap-1 px-4 pt-3"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
      >
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-md focus:outline-none ${
              activeTab === tab.id
                ? 'border-b-2 border-emerald-500 text-emerald-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            style={{ marginBottom: activeTab === tab.id ? '-1px' : undefined }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'quick-capture' && (
          <Suspense fallback={<PanelLoading />}>
            <VoiceJournalingV2 />
          </Suspense>
        )}
        {activeTab === 'journal' && (
          <Suspense fallback={<PanelLoading />}>
            <JournalPanel />
          </Suspense>
        )}
        {activeTab === 'insights' && (
          <Suspense fallback={<PanelLoading />}>
            <VoiceJournalingV2 />
          </Suspense>
        )}
      </div>
    </div>
  )
}
