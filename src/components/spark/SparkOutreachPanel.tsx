// @ts-nocheck
/**
 * SparkOutreachPanel — Cold outreach management UI
 *
 * Shows:
 *  - Due follow-ups with temperature badges and one-click mailto send
 *  - Pending follow-up queue with countdown days
 *  - All tracked leads with temperature status
 *  - Draft email generator form
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  generateColdEmail,
  scheduleFollowUpSequence,
  getPendingFollowUps,
  getDueFollowUps,
  updateLeadTemperature,
  markFollowUpSent,
  getAllLeadOutreachStates,
  buildMailtoLink,
  checkFollowUpNotifications,
  type OutreachContact,
  type LeadType,
  type LeadTemperature,
  type FollowUp,
  type LeadOutreachState,
  type GeneratedEmail,
} from '../../services/sparkLiveCall/SparkOutreach'

// ── Temperature badge styles ───────────────────────────────────────────────

const TEMP_BADGE: Record<LeadTemperature, { label: string; cls: string }> = {
  HOT: { label: '🔥 HOT', cls: 'bg-red-500/20 text-red-400 border border-red-500/40' },
  WARM: { label: '🌤 WARM', cls: 'bg-orange-500/20 text-orange-400 border border-orange-500/40' },
  COLD: { label: '❄️ COLD', cls: 'bg-sky-500/20 text-sky-400 border border-sky-500/40' },
  DEAD: { label: '💤 DEAD', cls: 'bg-zinc-700/40 text-zinc-400 border border-zinc-600/40' },
}

const STAGE_LABELS: Record<string, string> = {
  day3: 'Day 3 — Follow-up',
  day7: 'Day 7 — Value add',
  day14: 'Day 14 — Direct ask',
  day30: 'Day 30 — Final reach',
}

const LEAD_TYPE_OPTIONS: LeadType[] = ['GC', 'PM', 'homeowner', 'solar']
const TEMPERATURE_OPTIONS: LeadTemperature[] = ['HOT', 'WARM', 'COLD', 'DEAD']

// ── Helpers ────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TemperatureBadge({ temperature }: { temperature: LeadTemperature }) {
  const { label, cls } = TEMP_BADGE[temperature]
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  )
}

function FollowUpCard({
  followUp,
  toEmail,
  onMarkSent,
}: {
  followUp: FollowUp
  toEmail?: string
  onMarkSent: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const days = daysUntil(followUp.dueDate)
  const isDue = days <= 0
  const isOverdue = days < 0

  const dueBadge = isOverdue
    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40">{Math.abs(days)}d overdue</span>
    : isDue
    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">Due today</span>
    : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-700/40 text-zinc-400 border border-zinc-600/40">In {days}d — {formatDate(followUp.dueDate)}</span>

  return (
    <div className={`rounded-xl border p-4 mb-3 ${isDue || isOverdue ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-zinc-700/50 bg-zinc-800/30'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {dueBadge}
            <span className="text-xs text-zinc-400">{STAGE_LABELS[followUp.stage] ?? followUp.stage}</span>
          </div>
          <p className="text-sm font-semibold text-white truncate">
            {followUp.contactName} — {followUp.company}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{followUp.subject}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded border border-zinc-700/50 hover:border-zinc-500"
          >
            {expanded ? 'Hide' : 'Preview'}
          </button>
          {toEmail && (
            <a
              href={buildMailtoLink(followUp, toEmail)}
              className="text-xs font-semibold px-3 py-1 rounded bg-blue-600/20 text-blue-400 border border-blue-500/40 hover:bg-blue-600/40 transition-colors"
            >
              Open in Mail ↗
            </a>
          )}
          <button
            onClick={() => onMarkSent(followUp.id)}
            className="text-xs font-semibold px-3 py-1 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-600/40 transition-colors"
          >
            ✓ Mark Sent
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-700/40">
          <p className="text-xs font-semibold text-zinc-400 mb-1">Subject:</p>
          <p className="text-sm text-white mb-2">{followUp.subject}</p>
          <p className="text-xs font-semibold text-zinc-400 mb-1">Body:</p>
          <pre className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">{followUp.body}</pre>
        </div>
      )}
    </div>
  )
}

// ── Email Generator Form ───────────────────────────────────────────────────

function EmailGeneratorForm({ onGenerated }: { onGenerated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    company: '',
    role: '',
    leadType: 'GC' as LeadType,
    email: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [scheduleAfter, setScheduleAfter] = useState(false)
  const [result, setResult] = useState<GeneratedEmail | null>(null)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!form.name || !form.company) {
      setError('Contact name and company are required.')
      return
    }
    setError('')
    setLoading(true)
    setResult(null)

    try {
      const contact: OutreachContact = {
        id: `${Date.now()}-${form.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: form.name,
        company: form.company,
        role: form.role,
        leadType: form.leadType,
        email: form.email || undefined,
        notes: form.notes || undefined,
      }

      const email = await generateColdEmail(contact)
      setResult(email)

      if (scheduleAfter) {
        await scheduleFollowUpSequence(contact, form.notes || undefined)
      }

      onGenerated()
    } catch (e) {
      setError('Failed to generate email. Check Claude API connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-5">
      <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-blue-400">✉️</span> Generate Cold Email
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Contact Name *</label>
          <input
            className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
            placeholder="e.g. Mike Rodriguez"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Company *</label>
          <input
            className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
            placeholder="e.g. Desert Sun Construction"
            value={form.company}
            onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Role / Title</label>
          <input
            className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
            placeholder="e.g. Project Manager"
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Lead Type</label>
          <select
            className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            value={form.leadType}
            onChange={e => setForm(f => ({ ...f, leadType: e.target.value as LeadType }))}
          >
            {LEAD_TYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{t === 'GC' ? 'General Contractor' : t === 'PM' ? 'Property Manager' : t === 'homeowner' ? 'Homeowner' : 'Solar Partner'}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400 block mb-1">Email Address (for mailto link)</label>
          <input
            className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
            placeholder="e.g. mike@desertsunconstruction.com"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400 block mb-1">Notes / Context (optional)</label>
          <textarea
            className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50 resize-none"
            placeholder="How did you meet? Any specific context to personalize the email..."
            rows={2}
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 rounded accent-blue-500"
            checked={scheduleAfter}
            onChange={e => setScheduleAfter(e.target.checked)}
          />
          <span className="text-xs text-zinc-400">Also schedule Day 3/7/14/30 follow-up sequence</span>
        </label>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-blue-600/30 text-blue-300 border border-blue-500/40 text-sm font-semibold hover:bg-blue-600/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? '⏳ Generating with Claude...' : '✉️ Generate Cold Email'}
      </button>

      {result && (
        <div className="mt-4 p-4 rounded-lg bg-zinc-900/60 border border-emerald-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-emerald-400">✓ Email Generated</p>
            {form.email && (
              <a
                href={buildMailtoLink(result, form.email)}
                className="text-xs font-semibold px-3 py-1 rounded bg-blue-600/20 text-blue-400 border border-blue-500/40 hover:bg-blue-600/40 transition-colors"
              >
                Open in Mail ↗
              </a>
            )}
          </div>
          <p className="text-xs font-semibold text-zinc-400 mb-0.5">Subject:</p>
          <p className="text-sm text-white mb-2">{result.subject}</p>
          <p className="text-xs font-semibold text-zinc-400 mb-0.5">Body:</p>
          <pre className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">{result.body}</pre>
          {scheduleAfter && (
            <p className="text-xs text-blue-400 mt-3">✓ Day 3/7/14/30 follow-up sequence scheduled.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────

export function SparkOutreachPanel() {
  const [tab, setTab] = useState<'due' | 'pending' | 'leads' | 'generate'>('due')
  const [dueFollowUps, setDueFollowUps] = useState<FollowUp[]>([])
  const [pendingFollowUps, setPendingFollowUps] = useState<FollowUp[]>([])
  const [allStates, setAllStates] = useState<LeadOutreachState[]>([])
  const [notification, setNotification] = useState('')

  const refresh = useCallback(() => {
    setDueFollowUps(getDueFollowUps())
    setPendingFollowUps(getPendingFollowUps())
    setAllStates(getAllLeadOutreachStates())
    const { message } = checkFollowUpNotifications()
    setNotification(message)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleMarkSent = (id: string) => {
    markFollowUpSent(id)
    refresh()
  }

  const handleTempChange = (contactId: string, temp: LeadTemperature) => {
    updateLeadTemperature(contactId, temp)
    refresh()
  }

  // Find email for a contact from allStates (stored in the state if user entered it)
  // We don't store email in LeadOutreachState directly — we read from follow-up context
  // For mailto we show the link only if we have the email
  const getContactEmail = (_contactId: string): string | undefined => undefined

  const TABS = [
    { id: 'due', label: `Due${dueFollowUps.length > 0 ? ` (${dueFollowUps.length})` : ''}` },
    { id: 'pending', label: `Pending (${pendingFollowUps.length})` },
    { id: 'leads', label: `Leads (${allStates.length})` },
    { id: 'generate', label: '+ Generate Email' },
  ] as const

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-blue-400">📬</span> SPARK Outreach
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">Cold email generator · Follow-up sequencer · Lead temperature tracking</p>
        </div>
        <button
          onClick={refresh}
          className="text-xs text-zinc-400 hover:text-white transition-colors px-3 py-1.5 rounded border border-zinc-700/50 hover:border-zinc-500"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Notification banner */}
      {dueFollowUps.length > 0 && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-yellow-400">
            ⚡ {notification}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-900/50 rounded-xl border border-zinc-700/30">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
              tab === t.id
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Due Follow-Ups */}
      {tab === 'due' && (
        <div>
          {dueFollowUps.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm">No follow-ups due today.</p>
            </div>
          ) : (
            dueFollowUps.map(fu => (
              <FollowUpCard
                key={fu.id}
                followUp={fu}
                toEmail={getContactEmail(fu.contactId)}
                onMarkSent={handleMarkSent}
              />
            ))
          )}
        </div>
      )}

      {/* Pending Queue */}
      {tab === 'pending' && (
        <div>
          {pendingFollowUps.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-2xl mb-2">📭</p>
              <p className="text-sm">No pending follow-ups. Generate a cold email to start a sequence.</p>
            </div>
          ) : (
            pendingFollowUps.map(fu => (
              <FollowUpCard
                key={fu.id}
                followUp={fu}
                toEmail={getContactEmail(fu.contactId)}
                onMarkSent={handleMarkSent}
              />
            ))
          )}
        </div>
      )}

      {/* Leads */}
      {tab === 'leads' && (
        <div>
          {allStates.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm">No leads tracked yet. Generate your first cold email to start.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {allStates.map(state => (
                <div
                  key={state.contactId}
                  className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <TemperatureBadge temperature={state.temperature} />
                        {state.nextFollowUpDate && (
                          <span className="text-xs text-zinc-500">
                            Next touch: {formatDate(state.nextFollowUpDate)}
                          </span>
                        )}
                      </div>
                      {state.initialEmail && (
                        <p className="text-sm font-semibold text-white">
                          {/* Extract name from contactId heuristic */}
                          {state.contactId.split('-').slice(1).join(' ').replace(/-/g, ' ') || 'Contact'}
                        </p>
                      )}
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {state.followUps.length} follow-up{state.followUps.length !== 1 ? 's' : ''} scheduled
                        {' · '}{state.followUps.filter(f => f.sent).length} sent
                      </p>
                    </div>

                    {/* Temperature selector */}
                    <select
                      value={state.temperature}
                      onChange={e => handleTempChange(state.contactId, e.target.value as LeadTemperature)}
                      className="bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500/50"
                    >
                      {TEMPERATURE_OPTIONS.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* Follow-up progress bar */}
                  {state.followUps.length > 0 && (
                    <div className="flex gap-1">
                      {(['day3', 'day7', 'day14', 'day30'] as const).map(stage => {
                        const fu = state.followUps.find(f => f.stage === stage)
                        return (
                          <div
                            key={stage}
                            className={`flex-1 h-1.5 rounded-full ${
                              fu?.sent
                                ? 'bg-emerald-500/70'
                                : fu
                                ? 'bg-blue-500/40'
                                : 'bg-zinc-700/40'
                            }`}
                            title={`${STAGE_LABELS[stage]}${fu?.sent ? ' — Sent' : fu ? ' — Scheduled' : ' — Not scheduled'}`}
                          />
                        )
                      })}
                    </div>
                  )}
                  {state.followUps.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {(['day3', 'day7', 'day14', 'day30'] as const).map(stage => (
                        <div key={stage} className="flex-1 text-center">
                          <span className="text-[10px] text-zinc-600">
                            {stage === 'day3' ? 'D3' : stage === 'day7' ? 'D7' : stage === 'day14' ? 'D14' : 'D30'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {state.reEngageAfter && (
                    <p className="text-xs text-zinc-500 mt-2">
                      Re-engage after: {formatDate(state.reEngageAfter)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate Email */}
      {tab === 'generate' && (
        <EmailGeneratorForm onGenerated={() => { refresh(); setTab('due') }} />
      )}
    </div>
  )
}

export default SparkOutreachPanel
