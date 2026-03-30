// @ts-nocheck

import { useState, useEffect } from 'react'
import { Calendar, Link2, Unlink, RefreshCw, Loader2, AlertTriangle, Clock, Zap } from 'lucide-react'
import clsx from 'clsx'
import { CalendarView } from './CalendarView'
import { CrewDispatch } from './CrewDispatch'
import { JobScheduler } from './JobScheduler'
import { useAuth } from '@/hooks/useAuth'
import {
  initiateGoogleAuth, isConnected, disconnect, fullSync, startAutoSync, stopAutoSync,
} from '@/services/googleCalendar'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'
import { getBackupData, num } from '@/services/backupDataService'
import { processChronoRequest, type ConflictAlert } from '@/agents/chrono'

type TabType = 'calendar' | 'crew' | 'agenda'

const tabs: { id: TabType; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'crew', label: 'Crew Dispatch' },
  { id: 'agenda', label: 'Agenda Tasks' },
]

export function SchedulePanel() {
  const [activeTab, setActiveTab] = useState<TabType>('calendar')
  const { user, profile } = useAuth()
  const userId = user?.id
  const orgId = profile?.org_id
  const [gcalConnected, setGcalConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [conflicts, setConflicts] = useState<ConflictAlert[]>([])
  const [idleSummary, setIdleSummary] = useState<string | null>(null)
  const [loading7Day, setLoading7Day] = useState(false)

  // ── Proactive AI data context ──────────────────────────────────────────────
  const backup = getBackupData()
  const employees = backup?.employees || []
  const logs = backup?.logs || []
  const recentLogs = logs.filter(l => l.date && new Date(l.date) > new Date(Date.now() - 30 * 86400000))
  const chronoContext = `Crew: ${employees.length} employees. ${recentLogs.length} field logs in past 30 days. Analyze scheduling patterns and recommend optimizations.`
  const chronoSystem = 'You are CHRONO, the scheduling optimization agent for Power On Solutions LLC. Analyze crew utilization, scheduling gaps, and workload balance. Be concise with specific recommendations.'
  const chrono = useProactiveAI('chrono', chronoSystem, chronoContext, employees.length > 0 || logs.length > 0)

  // ── Google Calendar connection ─────────────────────────────────────────────
  useEffect(() => {
    if (userId) {
      isConnected(userId).then(connected => {
        setGcalConnected(connected)
        // Start auto-sync if connected
        if (connected && orgId) {
          startAutoSync(userId, orgId)
        }
      })
    }
    return () => stopAutoSync()
  }, [userId, orgId])

  // ── Conflict scan on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return
    processChronoRequest({
      action: 'run_conflict_scan',
      orgId,
      userId: userId || '',
      params: { daysAhead: 2 },
    }).then(res => {
      setConflicts((res.data as ConflictAlert[]) || [])
    }).catch(() => {})
  }, [orgId, userId])

  // ── Idle slot detection on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return
    processChronoRequest({
      action: 'detect_idle_slots',
      orgId,
      userId: userId || '',
    }).then(res => {
      const data = res.data as any
      if (data?.totalIdleHours > 0) {
        setIdleSummary(data.suggestions?.join(' ') || `${Math.round(data.totalIdleHours)} idle hours found`)
      }
    }).catch(() => {})
  }, [orgId, userId])

  async function handleConnectGoogle() {
    initiateGoogleAuth()
  }

  async function handleDisconnect() {
    if (userId) {
      await disconnect(userId)
      setGcalConnected(false)
    }
  }

  async function handleSync() {
    if (!userId || !orgId) return
    setSyncing(true)
    try {
      const result = await fullSync(userId, orgId)
      console.log('[chrono] Sync result:', result)
    } catch (err) {
      console.error('[chrono] Sync failed:', err)
    }
    setSyncing(false)
  }

  const criticalConflicts = conflicts.filter(c => c.severity === 'critical')

  return (
    <div className="space-y-4">
      {/* Proactive AI Insight Card */}
      <ProactiveInsightCard
        agentName="CHRONO"
        agentColor="#f97316"
        response={chrono.response}
        loading={chrono.loading}
        error={chrono.error}
        onRefresh={chrono.refresh}
        emptyMessage="No schedule data yet. Add crew members and I'll help optimize your job scheduling."
        systemPrompt={chronoSystem}
      />

      {/* Conflict Warnings */}
      {criticalConflicts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400">
              {criticalConflicts.length} Critical Conflict{criticalConflicts.length !== 1 ? 's' : ''}
            </span>
          </div>
          {criticalConflicts.slice(0, 3).map((c, idx) => (
            <div key={idx} className="text-xs text-red-300 pl-6">
              {c.description}
              <div className="text-red-400/60 mt-0.5">{c.suggestedAction}</div>
            </div>
          ))}
        </div>
      )}

      {/* Idle Slot Summary */}
      {idleSummary && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-start gap-2">
          <Clock className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <span className="text-xs text-yellow-300">{idleSummary}</span>
        </div>
      )}

      {/* Header with CHRONO Badge + Google Calendar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 rounded-full">
          <Calendar className="w-4 h-4 text-orange-500" />
          <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">CHRONO</span>
          {conflicts.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-bold rounded-full">
              {conflicts.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {gcalConnected ? (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 text-xs font-medium transition-colors"
              >
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-red-400 text-xs transition-colors"
                title="Disconnect Google Calendar"
              >
                <Unlink size={12} />
              </button>
              <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                Google Connected (15min sync)
              </span>
            </>
          ) : (
            <button
              onClick={handleConnectGoogle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs font-medium transition-colors"
            >
              <Link2 size={12} />
              Connect Google Calendar
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'px-4 py-3 text-sm font-medium transition-all border-b-2',
              activeTab === tab.id
                ? 'text-orange-400 border-orange-500'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-gray-800/30 rounded-lg p-4">
        {activeTab === 'calendar' && <CalendarView conflicts={conflicts} />}
        {activeTab === 'crew' && <CrewDispatch />}
        {activeTab === 'agenda' && <JobScheduler />}
      </div>
    </div>
  )
}
