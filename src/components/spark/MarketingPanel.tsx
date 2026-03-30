'use client'

import { useState } from 'react'
import { Megaphone } from 'lucide-react'
import clsx from 'clsx'
import { LeadPipeline } from './LeadPipeline'
import { GCDashboard } from './GCDashboard'
import { CampaignTracker } from './CampaignTracker'
import { ReviewManager } from './ReviewManager'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'
import { getBackupData, num } from '@/services/backupDataService'

type TabKey = 'overview' | 'leads' | 'gc_relationships' | 'campaigns' | 'reviews'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'leads', label: 'Leads' },
  { key: 'gc_relationships', label: 'GC Relationships' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'reviews', label: 'Reviews' },
]

export function MarketingPanel() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const backup = getBackupData()
  const gcContacts = backup?.gcContacts || []
  const serviceLeads = backup?.serviceLeads || []
  const staleLeads = serviceLeads.filter(l => l.createdAt && new Date(l.createdAt) < new Date(Date.now() - 14 * 86400000) && l.status !== 'Converted' && l.status !== 'Lost')
  const sparkContext = `Lead pipeline: ${gcContacts.length} GC contacts, ${serviceLeads.length} service leads. ${staleLeads.length} stale leads (no contact 14+ days). Analyze lead pipeline health and recommend actions.`
  const sparkSystem = 'You are SPARK, the marketing and lead generation agent for Power On Solutions LLC. Analyze lead pipeline, flag stale leads, and suggest outreach strategies. Be concise and action-oriented.'
  const spark = useProactiveAI('spark', sparkSystem, sparkContext, gcContacts.length > 0 || serviceLeads.length > 0)

  return (
    <div className="space-y-4">
      {/* Proactive AI Insight Card */}
      <ProactiveInsightCard
        agentName="SPARK"
        agentColor="#ec4899"
        response={spark.response}
        loading={spark.loading}
        error={spark.error}
        onRefresh={spark.refresh}
        emptyMessage="No leads yet. Want me to help you draft an outreach message for a GC contact?"
        systemPrompt={sparkSystem}
      />

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
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <div className="text-gray-500 text-xs mb-1">Leads This Week</div>
                <div className="text-2xl font-bold text-cyan-400">{serviceLeads.filter(l => l.createdAt && new Date(l.createdAt) > new Date(Date.now() - 7 * 86400000)).length}</div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <div className="text-gray-500 text-xs mb-1">Avg Rating</div>
                <div className="text-2xl font-bold text-yellow-400">—</div>
                <div className="text-gray-500 text-[10px]">Connect Google</div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <div className="text-gray-500 text-xs mb-1">GC Contacts</div>
                <div className="text-2xl font-bold text-emerald-400">{gcContacts.length}</div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <div className="text-gray-500 text-xs mb-1">Stale Leads</div>
                <div className="text-2xl font-bold text-red-400">{staleLeads.length}</div>
                <div className="text-gray-500 text-[10px]">No contact 14+ days</div>
              </div>
            </div>

            {/* Lead Source Distribution */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <h4 className="text-gray-300 text-sm font-semibold mb-3">Lead Pipeline by Source</h4>
              {(() => {
                const sources: Record<string, number> = {}
                serviceLeads.forEach((l: any) => {
                  const src = l.source || l.lead_source || 'Direct'
                  sources[src] = (sources[src] || 0) + 1
                })
                const maxCount = Math.max(...Object.values(sources), 1)
                return Object.entries(sources).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([source, count]) => (
                      <div key={source} className="flex items-center gap-3">
                        <span className="text-gray-400 text-xs w-24 truncate">{source}</span>
                        <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-pink-500 rounded-full transition-all" style={{ width: `${(count / maxCount) * 100}%` }} />
                        </div>
                        <span className="text-gray-300 text-xs font-medium w-6 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No leads yet</p>
                )
              })()}
            </div>

            {/* Top Channel */}
            {(() => {
              const sources: Record<string, number> = {}
              serviceLeads.forEach((l: any) => {
                const src = l.source || l.lead_source || 'Direct'
                sources[src] = (sources[src] || 0) + 1
              })
              const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]
              return topSource ? (
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg p-3">
                  <span className="text-pink-400 text-xs font-medium">Top Channel:</span>
                  <span className="text-gray-200 text-sm ml-2">{topSource[0]} ({topSource[1]} leads)</span>
                </div>
              ) : null
            })()}
          </div>
        )}
        {activeTab === 'leads' && <LeadPipeline />}
        {activeTab === 'gc_relationships' && <GCDashboard />}
        {activeTab === 'campaigns' && <CampaignTracker />}
        {activeTab === 'reviews' && <ReviewManager />}
      </div>
    </div>
  )
}
