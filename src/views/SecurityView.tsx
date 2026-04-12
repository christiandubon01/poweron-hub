// @ts-nocheck
/**
 * SecurityView.tsx
 * INT-1 — Admin-only Security & Compliance Center.
 *
 * Tabs:
 *   - Pen Test Dashboard (SEC1)
 *   - Threat Monitor    (SEC2)
 *   - Key Rotation      (SEC3)
 *   - Compliance        (SEC4)
 *
 * Visible only to admin/owner role.
 */

import React, { useState } from 'react'
import { PenTestDashboard } from '@/components/security/PenTestDashboard'
import { ThreatMonitorPanel } from '@/components/security/ThreatMonitorPanel'
import { KeyRotationPanel } from '@/components/security/KeyRotationPanel'
import { CompliancePanel } from '@/components/security/CompliancePanel'

type SecurityTab = 'pentest' | 'threat' | 'keys' | 'compliance'

const TABS: { id: SecurityTab; label: string }[] = [
  { id: 'pentest',    label: '🛡 Pen Test' },
  { id: 'threat',    label: '👁 Threat Monitor' },
  { id: 'keys',      label: '🔑 Key Rotation' },
  { id: 'compliance', label: '📋 Compliance' },
]

export default function SecurityView() {
  const [activeTab, setActiveTab] = useState<SecurityTab>('pentest')

  return (
    <div className="w-full min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-2">
        <h1 className="text-xl font-bold text-red-400 flex items-center gap-2">
          🔐 Security Center
          <span className="text-xs font-semibold px-2 py-0.5 bg-red-900/60 text-red-300 rounded uppercase tracking-wide">
            Admin Only
          </span>
        </h1>
        <p className="text-xs text-gray-500 mt-1">Penetration testing, threat monitoring, key rotation, and CCPA compliance.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-2 pb-0 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-t transition-colors ${
              activeTab === tab.id
                ? 'bg-red-900/40 text-red-300 border-b-2 border-red-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'pentest'    && <PenTestDashboard />}
        {activeTab === 'threat'    && <ThreatMonitorPanel />}
        {activeTab === 'keys'      && <KeyRotationPanel />}
        {activeTab === 'compliance' && <CompliancePanel />}
      </div>
    </div>
  )
}
