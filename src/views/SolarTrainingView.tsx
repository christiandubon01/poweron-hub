// @ts-nocheck
/**
 * SolarTrainingView.tsx — SOL1 Full Build
 *
 * 4-panel Solar Training System for Christian Dubon / Power On Solutions LLC.
 * Builds on INT-1 base (SolarQuizCard, NEM3Visualizer, SolarRetentionHeatmap).
 *
 * Panel A — Certification Tracker (top)
 * Panel B — Training Mode Selector (5 modes: Daily Rep, Full Consultation,
 *            Rescue, NABCEP Study, Field Debrief)
 * Panel C — Scores & Progress (rolling avg, streak, gap trend)
 * Panel D — Solar Rules Library (confirmed/unconfirmed, search, export)
 *
 * Tables: solar_certifications, solar_scenarios, solar_training_sessions,
 *         solar_rules, solar_study_queue, solar_debriefs
 *
 * AI: callNexus() from claudeProxy for all training modes.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  GraduationCap, Target, BookOpen, Star, CheckCircle2,
  Clock, TrendingUp, TrendingDown, AlertCircle, RefreshCw,
  ChevronDown, ChevronUp, Search, Download, Pencil, Trash2,
  Mic, MicOff, Send, Flame, Award, BarChart2, Plus, X,
  ExternalLink, Filter
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { callNexus } from '@/services/claudeProxy'

// ── Legacy INT-1 components (kept for backward compat) ───────────────────────
import NEM3Visualizer from '@/components/solarTraining/NEM3Visualizer'
import { SolarRetentionHeatmap } from '@/components/solarTraining/SolarRetentionHeatmap'
import { getSolarQuizEngine } from '@/services/solarTraining/SolarQuizEngine'
import { SolarQuizCard } from '@/components/solarTraining/SolarQuizCard'

// ── Constants ────────────────────────────────────────────────────────────────
const PROVIDER_COLORS = {
  Enphase: { bg: 'bg-orange-900/40', border: 'border-orange-600', text: 'text-orange-300', dot: 'bg-orange-500' },
  NABCEP:  { bg: 'bg-blue-900/40',   border: 'border-blue-600',   text: 'text-blue-300',   dot: 'bg-blue-500' },
  Tesla:   { bg: 'bg-red-900/40',    border: 'border-red-600',    text: 'text-red-300',    dot: 'bg-red-500' },
  Default: { bg: 'bg-gray-800/40',   border: 'border-gray-600',   text: 'text-gray-300',   dot: 'bg-gray-500' },
}

const NABCEP_DOMAINS = [
  'System Design',
  'Installation',
  'Commissioning',
  'Maintenance',
  'Safety',
  'Electricity Basics',
  'Solar Resource',
  'NEM/Interconnection',
]

const TRAINING_MODES = [
  { id: 'daily_rep',          label: 'Daily Rep',           emoji: '⚡', duration: '3 min',    color: 'yellow' },
  { id: 'full_consultation',  label: 'Full Consultation',   emoji: '🏠', duration: '15-30 min', color: 'blue' },
  { id: 'rescue',             label: 'Rescue Consultation', emoji: '🚨', duration: '20 min',   color: 'red' },
  { id: 'nabcep_study',       label: 'NABCEP Study',        emoji: '📚', duration: '15 min',   color: 'purple' },
  { id: 'field_debrief',      label: 'Field Debrief',       emoji: '🎙️', duration: 'open',     color: 'green' },
]

const MODE_COLOR_MAP = {
  yellow: { card: 'border-yellow-700 bg-yellow-900/10', btn: 'bg-yellow-700 hover:bg-yellow-600 text-white', badge: 'bg-yellow-800/60 text-yellow-200' },
  blue:   { card: 'border-blue-700 bg-blue-900/10',     btn: 'bg-blue-700 hover:bg-blue-600 text-white',     badge: 'bg-blue-800/60 text-blue-200' },
  red:    { card: 'border-red-700 bg-red-900/10',        btn: 'bg-red-700 hover:bg-red-600 text-white',       badge: 'bg-red-800/60 text-red-200' },
  purple: { card: 'border-purple-700 bg-purple-900/10', btn: 'bg-purple-700 hover:bg-purple-600 text-white', badge: 'bg-purple-800/60 text-purple-200' },
  green:  { card: 'border-green-700 bg-green-900/10',   btn: 'bg-green-700 hover:bg-green-600 text-white',   badge: 'bg-green-800/60 text-green-200' },
}

// Seed certs (inserted on first load if table is empty for user)
const CERT_SEED = [
  { cert_name: 'EES 4th Gen Sales',      provider: 'Enphase', status: 'completed',   progress_pct: 100, nabcep_ceus: null,  completed_date: '2026-02-16' },
  { cert_name: 'EES 4th Gen Design',     provider: 'Enphase', status: 'completed',   progress_pct: 100, nabcep_ceus: 1.5,   completed_date: '2026-02-17' },
  { cert_name: 'Solargraf Sales',        provider: 'Enphase', status: 'in_progress', progress_pct: 16,  nabcep_ceus: null,  completed_date: null },
  { cert_name: 'EES 4th Gen Installer',  provider: 'Enphase', status: 'in_progress', progress_pct: 43,  nabcep_ceus: null,  completed_date: null },
  { cert_name: 'IQ8 Installer',          provider: 'Enphase', status: 'in_progress', progress_pct: 10,  nabcep_ceus: null,  completed_date: null },
  { cert_name: 'NABCEP PV Associate',    provider: 'NABCEP',  status: 'pending',     progress_pct: 0,   nabcep_ceus: null,  target_date: null },
  { cert_name: 'Tesla Certified Installer', provider: 'Tesla', status: 'pending',    progress_pct: 0,   nabcep_ceus: null,  target_date: null },
]

// ── Utility ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

// ── Panel A — Certification Tracker ──────────────────────────────────────────
function CertificationTracker({ userId }) {
  const [certs, setCerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editPct, setEditPct] = useState('')
  const [saving, setSaving] = useState(false)

  async function loadCerts() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('solar_certifications')
        .select('*')
        .eq('user_id', userId)
        .order('status', { ascending: true })
      if (error) throw error

      // Seed if empty
      if (!data || data.length === 0) {
        const seedRows = CERT_SEED.map(c => ({ ...c, user_id: userId }))
        const { data: inserted } = await supabase
          .from('solar_certifications')
          .insert(seedRows)
          .select()
        setCerts(inserted || seedRows)
      } else {
        setCerts(data)
      }
    } catch (err) {
      console.warn('[CertTracker] Supabase error, using seed:', err)
      setCerts(CERT_SEED.map((c, i) => ({ ...c, id: `seed-${i}`, user_id: userId })))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (userId) loadCerts() }, [userId])

  async function saveProgress(certId, pct) {
    setSaving(true)
    try {
      const numPct = Math.min(100, Math.max(0, Number(pct)))
      const updates = {
        progress_pct: numPct,
        status: numPct >= 100 ? 'completed' : 'in_progress',
        ...(numPct >= 100 ? { completed_date: new Date().toISOString().split('T')[0] } : {}),
      }
      await supabase.from('solar_certifications').update(updates).eq('id', certId)
      setCerts(prev => prev.map(c => c.id === certId ? { ...c, ...updates } : c))
    } catch (err) {
      console.warn('[CertTracker] save error:', err)
    } finally {
      setSaving(false)
      setEditingId(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-24 text-gray-500 text-sm">
      <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading certifications…
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
          <Award className="w-4 h-4 text-yellow-400" /> Certification Tracker
        </h2>
        <span className="text-xs text-gray-500">{certs.filter(c => c.status === 'completed').length}/{certs.length} complete</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {certs.map(cert => {
          const colors = PROVIDER_COLORS[cert.provider] || PROVIDER_COLORS.Default
          const isCompleted = cert.status === 'completed'
          const isInProgress = cert.status === 'in_progress'
          return (
            <div key={cert.id} className={`rounded-lg border p-3 ${colors.bg} ${colors.border} flex flex-col gap-2`}>
              <div className="flex items-start justify-between gap-1">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className="text-xs font-semibold text-gray-300">{cert.provider}</span>
                  </div>
                  <p className="text-sm font-bold text-white leading-tight">{cert.cert_name}</p>
                </div>
                {isCompleted && <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />}
                {!isCompleted && isInProgress && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-800/60 text-yellow-300 flex-shrink-0">In Progress</span>
                )}
                {cert.status === 'pending' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 flex-shrink-0">Pending</span>
                )}
              </div>

              {/* Progress bar */}
              {!isCompleted && (
                <div>
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                    <span>{cert.progress_pct || 0}%</span>
                    {cert.target_date && <span className="text-gray-500">Target: {fmtDate(cert.target_date)}</span>}
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isInProgress ? 'bg-yellow-500' : 'bg-gray-600'}`}
                      style={{ width: `${cert.progress_pct || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Completed date / CEUs */}
              {isCompleted && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-green-400">✓ {fmtDate(cert.completed_date)}</span>
                  {cert.nabcep_ceus > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300">
                      {cert.nabcep_ceus} NABCEP CEUs
                    </span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-1">
                {isInProgress && (
                  <a
                    href="https://university.enphase.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 transition-colors"
                  >
                    Continue <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {editingId === cert.id ? (
                  <div className="flex items-center gap-1 w-full">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editPct}
                      onChange={e => setEditPct(e.target.value)}
                      className="w-14 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-xs text-white"
                      placeholder="%"
                    />
                    <button
                      onClick={() => saveProgress(cert.id, editPct)}
                      disabled={saving}
                      className="text-xs px-2 py-0.5 bg-green-700 hover:bg-green-600 text-white rounded"
                    >
                      {saving ? '…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-300">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingId(cert.id); setEditPct(String(cert.progress_pct || 0)) }}
                    className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
                  >
                    <Pencil className="w-3 h-3" /> Update %
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Panel B — Training Mode Selector ─────────────────────────────────────────
function TrainingModeSelector({ userId }) {
  const [activeMode, setActiveMode] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [selectedScenario, setSelectedScenario] = useState(null)
  const [selectedDomain, setSelectedDomain] = useState(NABCEP_DOMAINS[0])
  const [debriefText, setDebriefText] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [exchangeCount, setExchangeCount] = useState(0)
  const [conversation, setConversation] = useState([]) // { role, content }
  const [sessionId, setSessionId] = useState(null)
  const [graded, setGraded] = useState(null) // { technical, sales, gap, rule }
  const [savedRule, setSavedRule] = useState(null)

  // Load scenarios from Supabase
  useEffect(() => {
    supabase.from('solar_scenarios').select('*').eq('active', true)
      .then(({ data }) => setScenarios(data || []))
      .catch(() => setScenarios([]))
  }, [])

  function startSession(modeId) {
    setActiveMode(modeId)
    setResponse('')
    setConversation([])
    setExchangeCount(0)
    setGraded(null)
    setSavedRule(null)
    const sid = crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}`
    setSessionId(sid)
    // Create session record
    if (userId) {
      supabase.from('solar_training_sessions').insert({
        user_id: userId,
        mode: modeId,
        scenario_id: selectedScenario?.id || null,
        started_at: new Date().toISOString(),
        status: 'in_progress',
      }).then(() => {}).catch(() => {})
    }
  }

  async function runMode(modeId) {
    setLoading(true)
    try {
      let query = ''
      let systemOverride = ''

      if (modeId === 'daily_rep') {
        const cats = ['price objection', 'NEM 3.0 skeptic', 'think about it close', 'battery ROI', 'competitor comparison', 'financing terms', 'IID vs SCE rates']
        const cat = cats[Math.floor(Math.random() * cats.length)]
        query = `You are a solar training coach for Christian Dubon, an electrical contractor in Coachella Valley, CA with an RMO agreement with MTZ Solar Enterprise. Generate ONE realistic solar sales objection scenario from the category: "${cat}". Format: [Customer Profile] 2-3 sentences. [Their Objection] 1-2 sentences of actual customer dialogue. [Your Task] What Christian should focus on. Be realistic to Coachella Valley homeowners.`
        systemOverride = 'You are a solar sales training coach. Be direct, specific, and practical. Keep the scenario under 200 words.'
      }

      else if (modeId === 'full_consultation') {
        const sc = selectedScenario
        if (!sc) { setResponse('Please select a scenario first.'); setLoading(false); return }
        if (conversation.length === 0) {
          query = `You are roleplaying as a ${sc.customer_type || 'homeowner'} in Coachella Valley, CA considering solar. Scenario: "${sc.name}" — ${sc.system_size_kw ? sc.system_size_kw + 'kW system, ' : ''}${sc.utility_territory} territory, difficulty: ${sc.difficulty}. Known objections: ${JSON.parse(sc.objections || '[]').join(', ') || 'none listed'}. Stay in character as the customer. Start the roleplay — greet Christian as a homeowner would when he arrives for a solar consultation. Don't break character.`
        } else if (exchangeCount >= 20) {
          // Grade
          const histStr = conversation.map(m => `${m.role === 'user' ? 'Christian' : 'Customer'}: ${m.content}`).join('\n')
          query = `BREAK CHARACTER. Grade this solar consultation:\n\n${histStr}\n\nScore Technical knowledge 0-100 and Sales skill 0-100. Calculate Gap Score = |Technical - Sales|. Extract ONE actionable solar sales rule Christian should remember. Format your response EXACTLY as JSON:\n{"technical":85,"sales":72,"gap":13,"rule":"Always anchor battery ROI to TOU peak rates before mentioning price."}`
          systemOverride = 'You are a solar sales coach. Return ONLY valid JSON with keys: technical, sales, gap, rule.'
        } else {
          const lastUserMsg = conversation[conversation.length - 1]?.content || ''
          query = `Continue the roleplay. Previous conversation:\n${conversation.slice(-6).map(m => `${m.role === 'user' ? 'Christian' : 'Customer'}: ${m.content}`).join('\n')}\n\nCustomer responds to: "${lastUserMsg}"\n\nStay in character as the ${sc.customer_type} customer. Be realistic, raise objections naturally.`
        }
      }

      else if (modeId === 'rescue') {
        if (conversation.length === 0) {
          query = `You are roleplaying as an angry homeowner in the Coachella Valley. You had solar installed by Renova (now bankrupt). Your system was never activated. You've been paying your solar loan AND your full SCE bill for 3 months. You're furious. A new solar rep (Christian Dubon from Power On Solutions) just knocked on your door claiming he can help. Stay in character — be upset but not abusive. Start the scene.`
          systemOverride = 'You are a frustrated but rational homeowner. Stay in character.'
        } else {
          const lastUserMsg = conversation[conversation.length - 1]?.content || ''
          if (exchangeCount >= 15) {
            const histStr = conversation.map(m => `${m.role === 'user' ? 'Christian' : 'Customer'}: ${m.content}`).join('\n')
            query = `BREAK CHARACTER. Grade this Renova Rescue consultation:\n\n${histStr}\n\nScore: De-escalation (0-100), Diagnosis accuracy (0-100), Battery upsell opportunity captured (0-100). Extract ONE rule. Return ONLY JSON:\n{"deescalation":80,"diagnosis":70,"battery_upsell":60,"gap":20,"rule":"Lead with empathy and a clear action plan before mentioning upsell."}`
            systemOverride = 'Return ONLY valid JSON.'
          } else {
            query = `Continue the Renova Rescue roleplay. History:\n${conversation.slice(-6).map(m => `${m.role === 'user' ? 'Christian' : 'Customer'}: ${m.content}`).join('\n')}\n\nCustomer responds to: "${lastUserMsg}"\n\nStay in character. Gradually become more open if Christian demonstrates empathy and a real solution.`
          }
        }
      }

      else if (modeId === 'nabcep_study') {
        query = `You are a NABCEP PV Associate exam coach for Christian Dubon. Generate 3 study questions for the domain: "${selectedDomain}". For each question: provide the question, 4 multiple choice options (A-D), the correct answer, and a 2-3 sentence explanation why it's correct and why the others are wrong. Format clearly with Q1, Q2, Q3 labels.`
        systemOverride = 'You are an expert NABCEP exam coach. Be thorough with explanations. Focus on practical application in residential solar installs.'
      }

      else if (modeId === 'field_debrief') {
        if (!debriefText.trim()) { setResponse('Please describe your consultation or field interaction.'); setLoading(false); return }
        query = `Analyze this solar field interaction for Christian Dubon:\n\n"${debriefText}"\n\nEvaluate against the 5 real objections framework:\n1. Price (too expensive)\n2. Trust (why you/your company)\n3. Need (I don't need solar)\n4. Timing (not now)\n5. Authority (need to ask spouse/partner)\n\nIdentify which objection arose, how Christian handled it, what worked, what could improve, and extract ONE actionable rule as a quote-style sentence starting with "Always" or "Never" or "When [X], always/never [Y]".`
        systemOverride = 'You are a solar sales coach with 10 years of Coachella Valley residential experience. Be specific and practical.'
      }

      const result = await callNexus({
        query,
        userId: userId || undefined,
        systemPromptOverride: systemOverride || undefined,
        agentMode: 'standard',
      })

      const text = result.speak || result.response || ''

      // Handle grading for consultation/rescue modes
      if ((modeId === 'full_consultation' || modeId === 'rescue') && exchangeCount >= (modeId === 'rescue' ? 15 : 20)) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            setGraded(parsed)
            setSavedRule(parsed.rule || null)
            // Save rule to Supabase
            if (parsed.rule && userId) {
              supabase.from('solar_rules').insert({
                user_id: userId,
                rule_text: parsed.rule,
                source_scenario: selectedScenario?.name || (modeId === 'rescue' ? 'Renova Rescue' : 'Consultation'),
                confirmed: false,
              }).then(() => {}).catch(() => {})
            }
            // Complete session
            if (userId) {
              supabase.from('solar_training_sessions').update({
                completed_at: new Date().toISOString(),
                technical_score: parsed.technical || parsed.deescalation || 0,
                sales_score: parsed.sales || parsed.battery_upsell || 0,
                gap_score: parsed.gap || 0,
                lessons_extracted: parsed.rule ? [parsed.rule] : [],
                status: 'completed',
              }).eq('user_id', userId).eq('mode', modeId).eq('status', 'in_progress')
                .then(() => {}).catch(() => {})
            }
          }
        } catch { /* JSON parse failed — show raw text */ }
      }

      setResponse(text)
      setConversation(prev => [...prev, { role: 'assistant', content: text }])
      setExchangeCount(prev => prev + 1)

      // Save field debrief
      if (modeId === 'field_debrief' && userId) {
        const ruleMatch = text.match(/"([^"]+)"/g)
        const rule = ruleMatch ? ruleMatch[ruleMatch.length - 1].replace(/"/g, '') : null
        supabase.from('solar_debriefs').insert({
          user_id: userId,
          session_type: 'field_debrief',
          transcript: debriefText,
          lessons: rule ? [rule] : [],
          created_at: new Date().toISOString(),
        }).then(() => {}).catch(() => {})
        if (rule) {
          supabase.from('solar_rules').insert({
            user_id: userId,
            rule_text: rule,
            source_scenario: 'Field Debrief',
            confirmed: false,
          }).then(() => {}).catch(() => {})
          setSavedRule(rule)
        }
        // Track in study queue
        supabase.from('solar_study_queue').insert({
          user_id: userId,
          topic: 'Field debrief follow-up',
          domain: 'Sales',
          priority: 'normal',
          completed: false,
          notes: debriefText.slice(0, 120),
        }).then(() => {}).catch(() => {})
      }

      // Track NABCEP study
      if (modeId === 'nabcep_study' && userId) {
        supabase.from('solar_study_queue').insert({
          user_id: userId,
          topic: `${selectedDomain} — study session`,
          domain: selectedDomain,
          priority: 'normal',
          completed: true,
          notes: new Date().toISOString().split('T')[0],
        }).then(() => {}).catch(() => {})
      }

    } catch (err) {
      setResponse(`Error: ${err?.message || 'Failed to connect to NEXUS. Check your API key.'}`)
    } finally {
      setLoading(false)
    }
  }

  function handleUserReply(userMsg) {
    setConversation(prev => [...prev, { role: 'user', content: userMsg }])
    runMode(activeMode)
  }

  return (
    <div>
      <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-yellow-400" /> Training Mode Selector
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {TRAINING_MODES.map(mode => {
          const colors = MODE_COLOR_MAP[mode.color]
          const isActive = activeMode === mode.id
          return (
            <div key={mode.id} className={`rounded-lg border p-4 flex flex-col gap-3 transition-all ${colors.card} ${isActive ? 'ring-1 ring-white/20' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{mode.emoji}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{mode.label}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${colors.badge}`}>{mode.duration}</span>
                  </div>
                </div>
              </div>

              {/* Mode-specific controls */}
              {mode.id === 'full_consultation' && (
                <select
                  value={selectedScenario?.id || ''}
                  onChange={e => setSelectedScenario(scenarios.find(s => s.id === e.target.value) || null)}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
                >
                  <option value="">Select scenario…</option>
                  {scenarios.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.difficulty})</option>
                  ))}
                </select>
              )}

              {mode.id === 'nabcep_study' && (
                <select
                  value={selectedDomain}
                  onChange={e => setSelectedDomain(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
                >
                  {NABCEP_DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}

              {/* Customer profile card for full consultation */}
              {mode.id === 'full_consultation' && selectedScenario && isActive && (
                <div className="bg-gray-800/60 rounded p-2 text-xs text-gray-300 space-y-1">
                  <p><span className="text-gray-500">Territory:</span> {selectedScenario.utility_territory}</p>
                  {selectedScenario.system_size_kw && <p><span className="text-gray-500">System:</span> {selectedScenario.system_size_kw}kW</p>}
                  <p><span className="text-gray-500">Difficulty:</span> {selectedScenario.difficulty}</p>
                </div>
              )}

              {/* Button */}
              <button
                onClick={() => {
                  if (!isActive) { startSession(mode.id); runMode(mode.id) }
                  else { runMode(mode.id) }
                }}
                disabled={loading && isActive}
                className={`w-full py-1.5 rounded text-xs font-semibold transition-colors ${colors.btn} ${loading && isActive ? 'opacity-60 cursor-wait' : ''}`}
              >
                {loading && isActive ? (
                  <span className="flex items-center justify-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Thinking…</span>
                ) : mode.id === 'daily_rep' ? 'Start Today\'s Rep' :
                   mode.id === 'full_consultation' ? 'Begin Consultation' :
                   mode.id === 'rescue' ? 'Enter the Rescue' :
                   mode.id === 'nabcep_study' ? 'Start Study Session' :
                   'Submit Debrief'}
              </button>

              {/* Field debrief textarea */}
              {mode.id === 'field_debrief' && isActive && (
                <textarea
                  value={debriefText}
                  onChange={e => setDebriefText(e.target.value)}
                  placeholder="Describe your consultation or field interaction. What objection came up? How did you handle it? What happened?"
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-xs text-gray-200 resize-none"
                />
              )}

              {/* Response panel */}
              {isActive && response && (
                <div className="mt-1">
                  {graded ? (
                    <GradeCard graded={graded} savedRule={savedRule} mode={mode.id} />
                  ) : (
                    <div className="bg-gray-900/80 border border-gray-700 rounded p-3 text-xs text-gray-200 whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {response}
                    </div>
                  )}
                  {/* Conversation reply input for consultation/rescue */}
                  {(mode.id === 'full_consultation' || mode.id === 'rescue') && !graded && (
                    <ConversationReplyInput onSend={handleUserReply} loading={loading} />
                  )}
                  {savedRule && mode.id === 'field_debrief' && (
                    <div className="mt-2 p-2 bg-green-900/30 border border-green-700 rounded text-xs text-green-300">
                      📌 Rule extracted: "{savedRule}" — saved to your Rules Library.
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GradeCard({ graded, savedRule, mode }) {
  const techScore = graded.technical || graded.deescalation || 0
  const salesScore = graded.sales || graded.battery_upsell || 0
  const gap = graded.gap || Math.abs(techScore - salesScore)
  return (
    <div className="bg-gray-900/80 border border-gray-700 rounded p-3 space-y-3">
      <p className="text-xs font-bold text-white uppercase tracking-wider">Session Grade</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-blue-400">{techScore}</p>
          <p className="text-xs text-gray-500">{mode === 'rescue' ? 'De-Escalation' : 'Technical'}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-green-400">{salesScore}</p>
          <p className="text-xs text-gray-500">{mode === 'rescue' ? 'Battery Upsell' : 'Sales'}</p>
        </div>
        <div>
          <p className={`text-lg font-bold ${gap > 15 ? 'text-red-400' : gap > 8 ? 'text-yellow-400' : 'text-green-400'}`}>{gap}</p>
          <p className="text-xs text-gray-500">Gap Score</p>
        </div>
      </div>
      {savedRule && (
        <div className="p-2 bg-yellow-900/30 border border-yellow-700 rounded text-xs text-yellow-200">
          📌 New Rule: "{savedRule}"
        </div>
      )}
    </div>
  )
}

function ConversationReplyInput({ onSend, loading }) {
  const [text, setText] = useState('')
  function send() {
    if (!text.trim() || loading) return
    onSend(text.trim())
    setText('')
  }
  return (
    <div className="flex gap-2 mt-2">
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
        placeholder="Your response to the customer…"
        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
      />
      <button
        onClick={send}
        disabled={loading || !text.trim()}
        className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded disabled:opacity-40"
      >
        <Send className="w-3 h-3" />
      </button>
    </div>
  )
}

// ── Panel C — Scores & Progress ───────────────────────────────────────────────
function ScoresProgress({ userId }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [streak, setStreak] = useState(0)
  const [rulesCount, setRulesCount] = useState(0)
  const [certsProgress, setCertsProgress] = useState([])

  useEffect(() => {
    if (!userId) return
    async function load() {
      setLoading(true)
      try {
        const [sessRes, rulesRes, certsRes] = await Promise.all([
          supabase.from('solar_training_sessions').select('*').eq('user_id', userId).eq('status', 'completed').order('completed_at', { ascending: false }).limit(10),
          supabase.from('solar_rules').select('id').eq('user_id', userId),
          supabase.from('solar_certifications').select('cert_name,progress_pct,status').eq('user_id', userId),
        ])
        const sess = sessRes.data || []
        setSessions(sess)
        setRulesCount(rulesRes.data?.length || 0)
        setCertsProgress(certsRes.data || [])
        // Calculate streak
        const days = new Set(sess.map(s => s.completed_at?.split('T')[0]).filter(Boolean))
        let s = 0
        const today = new Date()
        for (let i = 0; i < 30; i++) {
          const d = new Date(today)
          d.setDate(d.getDate() - i)
          const key = d.toISOString().split('T')[0]
          if (days.has(key)) s++
          else if (i > 0) break
        }
        setStreak(s)
      } catch (err) {
        console.warn('[ScoresProgress] error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [userId])

  const techAvg = sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.technical_score || 0), 0) / sessions.length) : 0
  const salesAvg = sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.sales_score || 0), 0) / sessions.length) : 0
  const gapAvg = sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.gap_score || 0), 0) / sessions.length) : 0
  const inProgressCerts = certsProgress.filter(c => c.status === 'in_progress')
  const completedCerts = certsProgress.filter(c => c.status === 'completed')

  if (loading) return (
    <div className="flex items-center justify-center h-24 text-gray-500 text-sm">
      <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading scores…
    </div>
  )

  return (
    <div>
      <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 mb-3">
        <BarChart2 className="w-4 h-4 text-yellow-400" /> Scores & Progress
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <ScoreCard label="Technical Avg" value={techAvg} color="blue" suffix="/100" empty={sessions.length === 0} />
        <ScoreCard label="Sales Avg" value={salesAvg} color="green" suffix="/100" empty={sessions.length === 0} />
        <ScoreCard label="Gap Avg" value={gapAvg} color={gapAvg > 15 ? 'red' : gapAvg > 8 ? 'yellow' : 'green'} suffix=" pts" empty={sessions.length === 0} />
        <ScoreCard label="Training Streak" value={streak} color="orange" suffix=" days" icon={<Flame className="w-4 h-4 text-orange-400" />} />
      </div>

      {/* Gap trend */}
      {sessions.length > 1 && (
        <div className="mb-4 bg-gray-800/40 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-2">Gap Trend (last {sessions.length} sessions)</p>
          <div className="flex items-end gap-1 h-10">
            {sessions.slice().reverse().map((s, i) => {
              const h = Math.max(4, Math.min(40, (s.gap_score || 0) * 2))
              return (
                <div
                  key={i}
                  style={{ height: `${h}px` }}
                  title={`Gap: ${s.gap_score}`}
                  className={`flex-1 rounded-sm ${(s.gap_score || 0) > 15 ? 'bg-red-600' : (s.gap_score || 0) > 8 ? 'bg-yellow-600' : 'bg-green-600'}`}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Certs summary */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-gray-800/40 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-green-400">{completedCerts.length}</p>
          <p className="text-xs text-gray-500">Certs Complete</p>
        </div>
        <div className="bg-gray-800/40 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-yellow-400">{rulesCount}</p>
          <p className="text-xs text-gray-500">Solar Rules</p>
        </div>
      </div>

      {/* Next milestone */}
      {inProgressCerts.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
          <p className="text-xs font-semibold text-yellow-300 mb-2">🎯 Next Milestone</p>
          {inProgressCerts.sort((a, b) => b.progress_pct - a.progress_pct).slice(0, 2).map(c => (
            <div key={c.cert_name} className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-300">{c.cert_name}</span>
              <span className="text-yellow-400 font-semibold">{c.progress_pct}%</span>
            </div>
          ))}
        </div>
      )}

      {sessions.length === 0 && (
        <div className="text-center py-6 text-gray-600 text-xs">
          Complete a training session to see your scores here.
        </div>
      )}
    </div>
  )
}

function ScoreCard({ label, value, color, suffix, empty, icon }) {
  const colorMap = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    orange: 'text-orange-400',
  }
  return (
    <div className="bg-gray-800/40 rounded-lg p-3 text-center">
      {icon && <div className="flex justify-center mb-1">{icon}</div>}
      <p className={`text-2xl font-bold ${colorMap[color] || 'text-white'}`}>
        {empty ? '—' : value}{!empty && suffix}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

// ── Panel D — Solar Rules Library ────────────────────────────────────────────
function RulesLibrary({ userId }) {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')

  async function loadRules() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('solar_rules')
        .select('*')
        .eq('user_id', userId)
        .order('date_added', { ascending: false })
      setRules(data || [])
    } catch {
      setRules([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (userId) loadRules() }, [userId])

  async function confirmRule(id) {
    await supabase.from('solar_rules').update({ confirmed: true }).eq('id', id)
    setRules(prev => prev.map(r => r.id === id ? { ...r, confirmed: true } : r))
  }

  async function rejectRule(id) {
    await supabase.from('solar_rules').delete().eq('id', id)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  async function saveEdit(id) {
    await supabase.from('solar_rules').update({ rule_text: editText, confirmed: true }).eq('id', id)
    setRules(prev => prev.map(r => r.id === id ? { ...r, rule_text: editText, confirmed: true } : r))
    setEditingId(null)
  }

  function exportRules() {
    const txt = rules.map((r, i) => `${i + 1}. [${r.confirmed ? 'CONFIRMED' : 'UNCONFIRMED'}] ${r.rule_text} (from: ${r.source_scenario || 'unknown'}, added: ${fmtDate(r.date_added)})`).join('\n')
    const blob = new Blob([txt], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `solar-rules-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = rules.filter(r =>
    !search || r.rule_text?.toLowerCase().includes(search.toLowerCase()) ||
    r.source_scenario?.toLowerCase().includes(search.toLowerCase())
  )

  const unconfirmed = filtered.filter(r => !r.confirmed)
  const confirmed = filtered.filter(r => r.confirmed)

  if (loading) return (
    <div className="flex items-center justify-center h-24 text-gray-500 text-sm">
      <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading rules…
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-yellow-400" /> Solar Rules Library
          <span className="text-xs font-normal text-gray-500">({rules.length} total)</span>
        </h2>
        <button
          onClick={exportRules}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors"
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rules…"
          className="w-full bg-gray-800 border border-gray-700 rounded pl-7 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600"
        />
      </div>

      {/* Unconfirmed */}
      {unconfirmed.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Needs Review ({unconfirmed.length})
          </p>
          <div className="space-y-2">
            {unconfirmed.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                variant="unconfirmed"
                onConfirm={() => confirmRule(rule.id)}
                onReject={() => rejectRule(rule.id)}
                onEdit={() => { setEditingId(rule.id); setEditText(rule.rule_text) }}
                editingId={editingId}
                editText={editText}
                setEditText={setEditText}
                onSaveEdit={() => saveEdit(rule.id)}
                onCancelEdit={() => setEditingId(null)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Confirmed */}
      {confirmed.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-green-400 mb-2 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Confirmed ({confirmed.length})
          </p>
          <div className="space-y-2">
            {confirmed.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                variant="confirmed"
                onReject={() => rejectRule(rule.id)}
                onEdit={() => { setEditingId(rule.id); setEditText(rule.rule_text) }}
                editingId={editingId}
                editText={editText}
                setEditText={setEditText}
                onSaveEdit={() => saveEdit(rule.id)}
                onCancelEdit={() => setEditingId(null)}
              />
            ))}
          </div>
        </div>
      )}

      {rules.length === 0 && (
        <div className="text-center py-8 text-gray-600 text-xs">
          Complete a training session to extract your first solar rule.
        </div>
      )}
    </div>
  )
}

function RuleCard({ rule, variant, onConfirm, onReject, onEdit, editingId, editText, setEditText, onSaveEdit, onCancelEdit }) {
  const isEditing = editingId === rule.id
  return (
    <div className={`rounded-lg border p-3 ${variant === 'unconfirmed' ? 'border-amber-800 bg-amber-900/10' : 'border-green-800 bg-green-900/10'}`}>
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={3}
            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-xs text-gray-200 resize-none"
          />
          <div className="flex gap-2">
            <button onClick={onSaveEdit} className="text-xs px-2 py-0.5 bg-green-700 hover:bg-green-600 text-white rounded">Save</button>
            <button onClick={onCancelEdit} className="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-white rounded">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className={`text-sm font-medium ${variant === 'unconfirmed' ? 'text-amber-200' : 'text-green-200'} leading-snug mb-1`}>
            "{rule.rule_text}"
          </p>
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500 flex items-center gap-2">
              {rule.source_scenario && <span>📍 {rule.source_scenario}</span>}
              <span>{fmtDate(rule.date_added)}</span>
            </div>
            <div className="flex gap-1">
              {variant === 'unconfirmed' && onConfirm && (
                <button onClick={onConfirm} title="Confirm" className="p-0.5 text-green-400 hover:text-green-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={onEdit} title="Edit" className="p-0.5 text-gray-400 hover:text-gray-200">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={onReject} title="Delete" className="p-0.5 text-red-400 hover:text-red-300">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Legacy quiz section (kept from INT-1) ─────────────────────────────────────
function LegacyQuizSection() {
  const [question, setQuestion] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadQuestion() {
    setLoading(true)
    try {
      const engine = getSolarQuizEngine()
      const q = await engine.generateQuizQuestion('microinverter_sizing', 'beginner')
      setQuestion(q)
    } catch {
      setQuestion(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadQuestion() }, [])

  if (loading) return <div className="flex items-center justify-center h-48 text-gray-500 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading quiz…</div>
  if (!question) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3">
      <p className="text-gray-500 text-sm">Could not load quiz question.</p>
      <button onClick={loadQuestion} className="px-4 py-2 bg-yellow-700 text-white text-xs font-semibold rounded hover:bg-yellow-600">Retry</button>
    </div>
  )
  return <SolarQuizCard question={question} mode="learning" onAnswered={() => {}} onNext={loadQuestion} />
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type SolarTab = 'certifications' | 'training' | 'scores' | 'rules' | 'quiz' | 'nem3' | 'progress'

const TABS: { id: SolarTab; label: string; emoji: string; group: 'sol1' | 'int1' }[] = [
  { id: 'certifications', label: 'Certifications', emoji: '🏅', group: 'sol1' },
  { id: 'training',       label: 'Training Modes', emoji: '🎯', group: 'sol1' },
  { id: 'scores',         label: 'Scores',          emoji: '📊', group: 'sol1' },
  { id: 'rules',          label: 'Rules Library',   emoji: '📖', group: 'sol1' },
  { id: 'quiz',           label: 'Quick Quiz',      emoji: '⚡', group: 'int1' },
  { id: 'nem3',           label: 'NEM 3.0',         emoji: '☀️', group: 'int1' },
  { id: 'progress',       label: 'Retention',       emoji: '📈', group: 'int1' },
]

// ── Root View ─────────────────────────────────────────────────────────────────
export default function SolarTrainingView() {
  const [activeTab, setActiveTab] = useState<SolarTab>('certifications')
  const { profile } = useAuth()
  const userId = profile?.id ?? null

  return (
    <div className="w-full min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-2">
        <h1 className="text-xl font-bold text-yellow-400 flex items-center gap-2">
          <GraduationCap className="w-5 h-5" /> Solar Training System
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          Coachella Valley · RMO: MTZ Solar Enterprise · C-10 #1151468 · Target: 12 systems/month
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 px-6 pt-3 pb-0 border-b border-gray-800 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-semibold rounded-t whitespace-nowrap transition-colors flex-shrink-0 ${
              activeTab === tab.id
                ? 'bg-yellow-900/30 text-yellow-300 border-b-2 border-yellow-500'
                : 'text-gray-500 hover:text-gray-300'
            } ${tab.group === 'int1' ? 'opacity-70' : ''}`}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'certifications' && <CertificationTracker userId={userId} />}
        {activeTab === 'training'       && <TrainingModeSelector userId={userId} />}
        {activeTab === 'scores'         && <ScoresProgress userId={userId} />}
        {activeTab === 'rules'          && <RulesLibrary userId={userId} />}
        {activeTab === 'quiz'           && <LegacyQuizSection />}
        {activeTab === 'nem3'           && <NEM3Visualizer />}
        {activeTab === 'progress'       && <SolarRetentionHeatmap />}
      </div>
    </div>
  )
}
