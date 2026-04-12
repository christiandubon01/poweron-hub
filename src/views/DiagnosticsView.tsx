// @ts-nocheck
/**
 * DiagnosticsView.tsx
 * INT-1 — Lead Diagnostics view.
 *
 * Wraps DIAG components: DiagnosticPipelineView, DiagnosticReport,
 * ScenarioSimulatorPanel into a unified panel with internal routing.
 */

import React, { useState } from 'react'
import DiagnosticPipelineView from '@/components/diagnostics/DiagnosticPipelineView'
import DiagnosticReport from '@/components/diagnostics/DiagnosticReport'
import ScenarioSimulatorPanel from '@/components/diagnostics/ScenarioSimulatorPanel'

type DiagView = 'pipeline' | 'report' | 'simulator'

export default function DiagnosticsView() {
  const [view, setView] = useState<DiagView>('pipeline')
  const [reportLeadId, setReportLeadId] = useState<string>('')

  return (
    <div className="w-full min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-4 pb-0 border-b border-gray-800">
        {([
          { id: 'pipeline',  label: '🔭 Pipeline View' },
          { id: 'simulator', label: '🎯 Scenario Simulator' },
          { id: 'report',    label: '📊 Diagnostic Report' },
        ] as { id: DiagView; label: string }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-t transition-colors ${
              view === tab.id
                ? 'bg-cyan-900/30 text-cyan-300 border-b-2 border-cyan-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === 'pipeline' && (
          <DiagnosticPipelineView
            onViewReport={(leadId: string) => {
              setReportLeadId(leadId)
              setView('report')
            }}
          />
        )}
        {view === 'simulator' && <ScenarioSimulatorPanel />}
        {view === 'report' && (
          <DiagnosticReport
            leadId={reportLeadId || 'demo-lead-001'}
            onBack={() => setView('pipeline')}
          />
        )}
      </div>
    </div>
  )
}
