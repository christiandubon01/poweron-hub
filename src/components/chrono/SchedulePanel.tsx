// @ts-nocheck

import { useState, useEffect } from 'react'
import { Calendar, Link2, Unlink, RefreshCw, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { CalendarView } from './CalendarView'
import { CrewDispatch } from './CrewDispatch'
import { JobScheduler } from './JobScheduler'
import { useAuth } from '@/hooks/useAuth'
import {
  initiateGoogleAuth, isConnected, disconnect, fullSync
} from '@/services/googleCalendar'

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
  const [gcalConnected, setGcalConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (userId) {
      isConnected(userId).then(setGcalConnected)
    }
  }, [userId])

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
    if (!userId || !profile?.org_id) return
    setSyncing(true)
    try {
      const result = await fullSync(userId, profile.org_id)
      console.log('[chrono] Sync result:', result)
    } catch (err) {
      console.error('[chrono] Sync failed:', err)
    }
    setSyncing(false)
  }

  return (
    <div className="space-y-4">
      {/* Header with CHRONO Badge + Google Calendar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 rounded-full">
          <Calendar className="w-4 h-4 text-orange-500" />
          <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">CHRONO</span>
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
              <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">Google Connected</span>
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
        {activeTab === 'calendar' && <CalendarView />}
        {activeTab === 'crew' && <CrewDispatch />}
        {activeTab === 'agenda' && <JobScheduler />}
      </div>
    </div>
  )
}
