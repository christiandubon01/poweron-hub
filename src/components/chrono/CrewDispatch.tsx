// @ts-nocheck
'use client'

import { useState, useEffect } from 'react'
import { Calendar, Loader2, MapPin, Clock, AlertCircle, Send, Users, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import clsx from 'clsx'
import { processChronoRequest, type CrewDailyBriefing } from '@/agents/chrono'
import { submitProposal, runAutomatedReview } from '@/services/miroFish'

const statusColors: Record<string, string> = {
  available:   'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20',
  unavailable: 'bg-red-400/10 text-red-400 border border-red-400/20',
  vacation:    'bg-yellow-400/10 text-yellow-400 border border-yellow-400/20',
  sick:        'bg-orange-400/10 text-orange-400 border border-orange-400/20',
  pto:         'bg-purple-400/10 text-purple-400 border border-purple-400/20',
  training:    'bg-blue-400/10 text-blue-400 border border-blue-400/20',
}

export function CrewDispatch() {
  const { profile } = useAuth()
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [briefings, setBriefings] = useState<CrewDailyBriefing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sendingBriefing, setSendingBriefing] = useState<string | null>(null)
  const [expandedCrew, setExpandedCrew] = useState<string | null>(null)

  const orgId = profile?.org_id

  useEffect(() => {
    if (!orgId) { setLoading(false); return }

    const fetchBriefings = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await processChronoRequest({
          action: 'generate_daily_briefing',
          orgId,
          userId: '',
          params: { date: selectedDate },
        })
        setBriefings((result.data as CrewDailyBriefing[]) || [])
      } catch (err) {
        // Fallback to raw Supabase data if agent fails
        try {
          const { data: crewData } = await supabase
            .from('crew_availability' as never)
            .select('*')
            .eq('org_id', orgId)
            .eq('availability_date', selectedDate)

          // Convert to minimal briefing format
          const fallbackBriefings: CrewDailyBriefing[] = ((crewData || []) as any[]).map((crew: any) => ({
            employeeId: crew.employee_id,
            employeeName: crew.employee_id,
            totalJobs: 0,
            totalHours: 0,
            totalDriveMinutes: 0,
            idle: crew.availability_status === 'available',
            jobs: [],
            briefingText: `${crew.employee_id}: ${crew.availability_status}. ${crew.hours_available || 8}h available.`,
          }))
          setBriefings(fallbackBriefings)
        } catch {
          setError(err instanceof Error ? err.message : 'Failed to load crew dispatch')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchBriefings()
  }, [orgId, selectedDate])

  const handleSendBriefing = async (empId: string) => {
    if (!orgId) return
    setSendingBriefing(empId)

    const briefing = briefings.find(b => b.employeeId === empId)
    if (!briefing) { setSendingBriefing(null); return }

    try {
      // Submit through MiroFish for approval
      await submitProposal({
        orgId,
        proposingAgent: 'chrono',
        title: `Send crew briefing to ${briefing.employeeName}`,
        description: briefing.briefingText,
        category: 'scheduling',
        impactLevel: 'low',
        actionType: 'send_crew_briefing',
        actionPayload: {
          employeeId: empId,
          employeeName: briefing.employeeName,
          briefingText: briefing.briefingText,
          date: selectedDate,
        },
      }).then(proposal => runAutomatedReview(proposal.id!))

      console.log(`[CHRONO] Briefing for ${briefing.employeeName} submitted to MiroFish`)
    } catch (err) {
      console.error('[CHRONO] Send briefing error:', err)
    } finally {
      setSendingBriefing(null)
    }
  }

  const activeBriefings = briefings.filter(b => !b.idle)
  const idleBriefings = briefings.filter(b => b.idle)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header: Date picker + summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-emerald-400">
            <Users className="w-3.5 h-3.5" /> {activeBriefings.length} active
          </span>
          {idleBriefings.length > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <AlertCircle className="w-3.5 h-3.5" /> {idleBriefings.length} idle
            </span>
          )}
        </div>
      </div>

      {error && <div className="bg-red-400/10 border border-red-400/20 text-red-400 rounded p-3 text-sm">{error}</div>}

      {briefings.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Users className="w-12 h-12 text-gray-500 mb-3" />
          <p className="text-gray-400">No crew data for this date</p>
          <p className="text-xs text-gray-500 mt-1">Add employees in Team panel or set crew availability</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Crew */}
          {activeBriefings.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-emerald-400 mb-3 uppercase tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Active Crew — {activeBriefings.reduce((s, b) => s + b.totalJobs, 0)} jobs
              </h3>
              <div className="grid gap-3">
                {activeBriefings.map(briefing => (
                  <div key={briefing.employeeId} className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
                    {/* Crew Header */}
                    <button
                      onClick={() => setExpandedCrew(expandedCrew === briefing.employeeId ? null : briefing.employeeId)}
                      className="w-full flex items-center justify-between p-4 hover:bg-gray-800/80 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <span className="text-xs font-bold text-emerald-400">
                            {(briefing.employeeName || '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-semibold text-gray-100">{briefing.employeeName}</div>
                          <div className="text-xs text-gray-400">
                            {briefing.totalJobs} job{briefing.totalJobs !== 1 ? 's' : ''} · {briefing.totalHours}h · ~{briefing.totalDriveMinutes}min drive
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={clsx('w-4 h-4 text-gray-500 transition-transform', expandedCrew === briefing.employeeId && 'rotate-90')} />
                    </button>

                    {/* Expanded: Route + Jobs */}
                    {expandedCrew === briefing.employeeId && (
                      <div className="border-t border-gray-700 p-4 space-y-3">
                        {/* Route Visualization */}
                        <div className="space-y-2">
                          {briefing.jobs.map((job, idx) => (
                            <div key={idx} className="flex items-start gap-3">
                              {/* Route connector */}
                              <div className="flex flex-col items-center">
                                <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                                  idx === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400'
                                )}>
                                  {job.order}
                                </div>
                                {idx < briefing.jobs.length - 1 && (
                                  <div className="w-px h-8 bg-gray-600 my-1" />
                                )}
                              </div>

                              {/* Job details */}
                              <div className="flex-1 bg-gray-700/30 rounded p-3">
                                <div className="text-sm font-medium text-gray-100">{job.title}</div>
                                <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
                                  <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" /> {job.address || 'TBD'}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(job.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {job.hours}h
                                  </span>
                                </div>
                                {job.travelMinutesFromPrevious > 0 && (
                                  <div className="text-[10px] text-gray-500 mt-1">
                                    ~{job.travelMinutesFromPrevious}min travel from {idx === 0 ? 'office' : 'previous job'}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Briefing Text */}
                        <div className="bg-gray-900/50 border border-gray-700 rounded p-3 text-xs text-gray-300 font-mono">
                          {briefing.briefingText}
                        </div>

                        {/* Send Briefing Button → MiroFish */}
                        <button
                          onClick={() => handleSendBriefing(briefing.employeeId)}
                          disabled={sendingBriefing === briefing.employeeId}
                          className="flex items-center gap-2 px-3 py-2 bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded text-xs font-medium transition-colors"
                        >
                          {sendingBriefing === briefing.employeeId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          {sendingBriefing === briefing.employeeId ? 'Submitting...' : 'Send Briefing (MiroFish)'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Idle Crew */}
          {idleBriefings.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-yellow-400 mb-3 uppercase tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-400" /> Idle — {idleBriefings.length} crew with 0 jobs
              </h3>
              <div className="grid gap-2">
                {idleBriefings.map(briefing => (
                  <div key={briefing.employeeId} className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
                        <span className="text-xs font-bold text-yellow-400">
                          {(briefing.employeeName || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-100">{briefing.employeeName}</div>
                        <div className="text-xs text-yellow-400/70">No jobs scheduled today</div>
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                      Idle
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
