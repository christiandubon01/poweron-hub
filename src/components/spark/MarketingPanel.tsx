'use client'

import { useState } from 'react'
import { Megaphone } from 'lucide-react'
import clsx from 'clsx'
import { LeadPipeline } from './LeadPipeline'
import { GCDashboard } from './GCDashboard'
import { CampaignTracker } from './CampaignTracker'
import { ReviewManager } from './ReviewManager'

type TabKey = 'leads' | 'gc_relationships' | 'campaigns' | 'reviews'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'leads', label: 'Leads' },
  { key: 'gc_relationships', label: 'GC Relationships' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'reviews', label: 'Reviews' },
]

export function MarketingPanel() {
  const [activeTab, setActiveTab] = useState<TabKey>('leads')

  return (
    <div className="space-y-4">
      {/* Header with SPARK Badge */}
      <div className="flex items-center gap-2 mb-6">
        <div className="flex items-center gap-2 px-3 py-1 bg-pink-500/20 text-pink-400 rounded-full">
          <Megaphone className="w-4 h-4" />
          <span className="text-sm font-medium">SPARK</span>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-800">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={clsx(
              'px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeTab === key
                ? 'bg-pink-500/20 text-pink-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="pt-2">
        {activeTab === 'leads' && <LeadPipeline />}
        {activeTab === 'gc_relationships' && <GCDashboard />}
        {activeTab === 'campaigns' && <CampaignTracker />}
        {activeTab === 'reviews' && <ReviewManager />}
      </div>
    </div>
  )
}
