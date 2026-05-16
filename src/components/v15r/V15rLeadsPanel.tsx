// @ts-nocheck
/**
 * V15rLeadsPanel — Leads with 3 tabs: GC Contacts, Service Leads, Weekly Reviews.
 * Faithfully ported from HTML renderLeads(), renderGCTable(), renderSvcTable(), renderWeeklyReview().
 *
 * Enhanced with:
 * - Quick Log Contact button per GC row with inline form (contact method, notes, auto-timestamp)
 * - AI Suggested Script button placeholder
 * - Follow-up overdue badge with red tint
 * - Next Best Action AI badge per GC
 * - Contact activity timeline (expandable row showing contactLog entries)
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Plus, Edit3, Trash2, ChevronDown, ChevronUp, ArrowRight, X, Copy, Phone, Mail, Mic } from 'lucide-react'
import { GoogleMap, MarkerF, InfoWindowF } from '@react-google-maps/api'
import { useAuth } from '@/hooks/useAuth'
import {
  getBackupData,
  loadFromSupabase,
  saveBackupData,
  saveBackupDataAndSync,
  saveBackupDataAndSyncNow,
  fmtK,
  fmt,
  num,
  resolveCanonicalCustomerName,
  daysSince,
  isActiveProject,
  isActiveServiceCall,
  type BackupGCContact,
} from '@/services/backupDataService'
import { nonCriticalWrite } from '@/services/writeDebounce'
import { pushState } from '@/services/undoRedoService'
import { linkEntityToAccount, upsertRelationshipAccount, upsertRelationshipEvent, deleteRelationshipAccount } from '@/services/relationshipAccountService'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import { GOOGLE_MAPS_BROWSER_KEY, useV15rGoogleMapsLoader } from '@/utils/googleMapsLoader'

// ── Phase colors ─────────────────────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  'Awarded': '#10b981',
  'Active Bidding': '#3b82f6',
  'Qualified': '#f59e0b',
  'Prospecting': '#6b7280',
  'First Contact': '#06b6d4',
  'Dormant': '#374151',
  'Converted': '#10b981',
}

const SVC_STATUS_COLORS: Record<string, string> = {
  'Advance': '#10b981',
  'Quoted': '#3b82f6',
  'Booked': '#06b6d4',
  'Park': '#f59e0b',
  'Kill': '#ef4444',
  'Converted': '#10b981',
}
const SVC_STATUS_CYCLE = ['Advance', 'Quoted', 'Booked', 'Park', 'Kill']
const MAP_CENTER = { lat: 33.7425, lng: -116.3089 }
const REL_ACCOUNT_TYPES = [
  'General Contractor',
  'Subcontractor',
  'Homeowner',
  'Property Manager',
  'Commercial Client',
  'Service Customer',
  'Other',
] as const

function today() {
  return new Date().toISOString().slice(0, 10)
}

function norm(v: any): string {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normPhone(v: any): string {
  return String(v || '').replace(/\D/g, '')
}

function normEmail(v: any): string {
  return String(v || '').toLowerCase().trim()
}
function firstMoneyValue(...values: any[]): number {
  const positive = values.find(v => num(v) > 0)
  return positive !== undefined ? num(positive) : 0
}

function projectQuoted(p: any): number {
  return firstMoneyValue(
    p?.contract,
    p?.contractAmount,
    p?.quoted,
    p?.quote,
    p?.totalQuote,
    p?.price
  )
}

function projectCollected(p: any): number {
  return firstMoneyValue(
    p?.paid,
    p?.collected,
    p?.amountPaid,
    p?.totalCollected,
    p?.received
  )
}

function projectOutstanding(p: any): number {
  return Math.max(0, projectQuoted(p) - projectCollected(p))
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function V15rLeadsPanel() {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [activeTab, setActiveTab] = useState<'gc' | 'svc' | 'weekly'>('gc')
  const [expandedGCId, setExpandedGCId] = useState<string | null>(null)
  const [openLogFormId, setOpenLogFormId] = useState<string | null>(null)
  const [logFormData, setLogFormData] = useState({ method: 'Call', notes: '' })
  const [aiOpen, setAiOpen] = useState(false)
  const [loggingContactId, setLoggingContactId] = useState<string | null>(null)
  const [logType, setLogType] = useState('Call')
  const [logNotes, setLogNotes] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [aiScriptContactId, setAiScriptContactId] = useState<string | null>(null)
  const [aiScriptText, setAiScriptText] = useState('')
  const [aiScriptLoading, setAiScriptLoading] = useState(false)
  const [aiScriptVariants, setAiScriptVariants] = useState<{ cold: string; voicemail: string; email: string } | null>(null)
  const [aiScriptTab, setAiScriptTab] = useState<'cold' | 'voicemail' | 'email'>('cold')
  const [accountSearch, setAccountSearch] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [mapFilter, setMapFilter] = useState<'all' | 'active' | 'unpaid' | 'high' | 'repeat' | 'service' | 'gc'>('all')
  const [accountTypeFilter, setAccountTypeFilter] = useState<'all' | string>('all')
  const [mapMode, setMapMode] = useState<'selected' | 'all_jobs'>('selected')
  const [activeClusterKey, setActiveClusterKey] = useState<string | null>(null)
  const [selectedClusterPointKey, setSelectedClusterPointKey] = useState<string | null>(null)
  const [selectedMapPointKey, setSelectedMapPointKey] = useState<string | null>(null)
  const [geoCache, setGeoCache] = useState<Record<string, { lat: number; lng: number }>>({})
  const [showAddRelationship, setShowAddRelationship] = useState(false)
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null)
  const [ignoredCleanupKeys, setIgnoredCleanupKeys] = useState<Record<string, boolean>>({})
  const [cleanupLinkSelection, setCleanupLinkSelection] = useState<Record<string, string>>({})
  const [pendingCleanupCreateGroupKey, setPendingCleanupCreateGroupKey] = useState<string | null>(null)
  const [cleanupBusyKey, setCleanupBusyKey] = useState<string | null>(null)
  const [addRelForm, setAddRelForm] = useState<any>({
    company: '',
    contact: '',
    role: 'General Contractor',
    phone: '',
    email: '',
    address: '',
    city: '',
    notes: '',
    tags: '',
  })
  const { isLoaded: mapLoaded, loadError: mapLoadError } = useV15rGoogleMapsLoader()

  let authProfile: any = null
  try { authProfile = useAuth().profile } catch { /* auth not available */ }

  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()
  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-64 bg-[var(--bg-secondary)]">
        <div className="text-gray-500 text-sm">No backup data. Import to view leads.</div>
      </div>
    )
  }

  const gcContacts = backup.gcContacts || []
  const serviceLeads = backup.serviceLeads || []
  const weeklyReviews = backup.weeklyReviews || []

  useEffect(() => {
    const handler = () => forceUpdate()
    window.addEventListener('storage', handler)
    window.addEventListener('poweron-data-saved', handler)
    window.addEventListener('poweron-relationship-accounts-hydrated', handler)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener('poweron-data-saved', handler)
      window.removeEventListener('poweron-relationship-accounts-hydrated', handler)
    }
  }, [forceUpdate])

  useEffect(() => {
  if (hasHydrated && isDemoMode) return

  let cancelled = false
  let refreshing = false

  const refreshFromLatestSavedState = async (source: string) => {
    if (refreshing) return
    refreshing = true

    try {
      const result = await loadFromSupabase(false)

      if (!cancelled && result.success) {
        console.log(`[Leads] Refreshed latest saved state on ${source}`)
        window.dispatchEvent(new Event('storage'))
        window.dispatchEvent(new Event('poweron-data-saved'))
        forceUpdate()
      }
    } catch (err) {
      console.warn(`[Leads] latest saved state refresh failed on ${source}`, err)
    } finally {
      refreshing = false
    }
  }

  void refreshFromLatestSavedState('panel-open')

  const handleFocus = () => {
    void refreshFromLatestSavedState('window-focus')
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void refreshFromLatestSavedState('visibility')
    }
  }

  window.addEventListener('focus', handleFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    cancelled = true
    window.removeEventListener('focus', handleFocus)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}, [forceUpdate, hasHydrated, isDemoMode])



  function persist() {
  const scrollTop = panelRef.current?.scrollTop ?? window.scrollY
  backup._lastSavedAt = new Date().toISOString()
  saveBackupDataAndSync(backup)
  window.dispatchEvent(new Event('storage'))
  window.dispatchEvent(new Event('poweron-data-saved'))
  forceUpdate()
  requestAnimationFrame(() => {
    if (panelRef.current) panelRef.current.scrollTop = scrollTop
    else window.scrollTo(0, scrollTop)
  })
}

  // ── GC Contacts CRUD ───────────────────────────────────────────────────

  function deleteGC(id: string) {
    if (!confirm('Delete this GC contact?')) return
    pushState(backup)
    backup.gcContacts = gcContacts.filter(c => c.id !== id)
    persist()
  }

  function editGC(id: string) {
    const c = gcContacts.find(x => x.id === id)
    if (!c) return
    const company = prompt('Company:', c.company)
    if (company === null) return
    pushState(backup)
    c.company = company
    const contact = prompt('Contact name:', c.contact)
    if (contact !== null) c.contact = contact
    const phone = prompt('Phone:', c.phone)
    if (phone !== null) c.phone = phone
    const phase = prompt('Phase (First Contact / Prospecting / Qualified / Active Bidding / Awarded / Dormant):', c.phase)
    if (phase !== null) c.phase = phase
    const action = prompt('Next action:', c.action)
    if (action !== null) c.action = action
    const due = prompt('Due date (YYYY-MM-DD):', c.due)
    if (due !== null) c.due = due
    persist()
  }

  function addGC() {
    const company = prompt('Company name:')
    if (!company) return
    const contact = prompt('Contact name:') || ''
    const newGC: any = {
      id: 'gc' + Date.now(),
      company,
      contact,
      role: '',
      phone: '',
      email: '',
      intro: '',
      sent: 0,
      awarded: 0,
      avg: 0,
      pay: '',
      phase: 'First Contact',
      fit: 0,
      action: '',
      due: '',
      notes: '',
      created: today(),
      contactLog: [],
      nextFollowup: '',
      lastContact: '',
    }
    pushState(backup)
    backup.gcContacts = [...gcContacts, newGC]
    persist()
  }

  function addContactLog(contactId: string) {
    const c = gcContacts.find(x => x.id === contactId)
    if (!c) return
    if (!c.contactLog) c.contactLog = []
    pushState(backup)
    c.contactLog.push({
      timestamp: new Date().toISOString(),
      method: logFormData.method,
      notes: logFormData.notes,
    })
    setOpenLogFormId(null)
    setLogFormData({ method: 'Call', notes: '' })
    persist()
  }

  // ── Lead-to-Project Conversion ───────────────────────────────────────────

  function convertGCToProject(gc: any) {
    if (!confirm(`Convert "${gc.company}" to a new project?`)) return
    const scrollTop = panelRef.current?.scrollTop ?? window.scrollY
    pushState(backup)
    const projId = 'proj' + Date.now() + Math.random().toString(36).slice(2, 6)
    const newProj: any = {
      id: projId, name: gc.company + (gc.contact ? ' — ' + gc.contact : ''),
      client: gc.company, type: 'Commercial', status: 'active',
      contract: num(gc.avg), billed: 0, paid: 0, mileRT: 0, miDays: 0,
      phases: { Planning: 0, Estimating: 0, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 },
      tasks: { Planning: [], Estimating: [], 'Site Prep': [], 'Rough-in': [], Trim: [], Finish: [] },
      laborRows: [], ohRows: [], matRows: [], mtoRows: [], rfis: [], coord: {}, logs: [], finance: {},
      lastMove: today(), notes: gc.notes || '', created: new Date().toISOString(),
      convertedFromLeadId: gc.id, convertedFromLeadType: 'gcContact',
    }
    backup.projects = [...(backup.projects || []), newProj]
    // Update GC contact phase to Converted and link
    gc.phase = 'Converted'
    gc.convertedProjectId = projId
    saveBackupDataAndSync(backup)
    forceUpdate()
    requestAnimationFrame(() => {
      if (panelRef.current) panelRef.current.scrollTop = scrollTop
      else window.scrollTo(0, scrollTop)
    })
    alert(`Project created: ${newProj.name}`)
  }

  function convertSvcLeadToProject(lead: any) {
    if (!confirm(`Convert service lead "${lead.customer}" to a new project?`)) return
    const scrollTop = panelRef.current?.scrollTop ?? window.scrollY
    pushState(backup)
    const projId = 'proj' + Date.now() + Math.random().toString(36).slice(2, 6)
    const newProj: any = {
      id: projId, name: lead.customer || 'Service Project',
      client: lead.customer, type: lead.type || 'Service', status: 'active',
      contract: num(lead.price || lead.totalQuote || 0), billed: 0, paid: 0, mileRT: num(lead.miles || lead.milesRT || 0), miDays: 0,
      phases: { Planning: 0, Estimating: 0, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 },
      tasks: { Planning: [], Estimating: [], 'Site Prep': [], 'Rough-in': [], Trim: [], Finish: [] },
      laborRows: [], ohRows: [], matRows: [], mtoRows: [], rfis: [], coord: {}, logs: [], finance: {},
      lastMove: today(), notes: lead.notes || '', created: new Date().toISOString(),
      convertedFromLeadId: lead.id, convertedFromLeadType: 'serviceLead',
    }
    backup.projects = [...(backup.projects || []), newProj]
    // Update service lead status to Converted and link
    lead.status = 'Converted'
    lead.convertedProjectId = projId
    saveBackupDataAndSync(backup)
    forceUpdate()
    requestAnimationFrame(() => {
      if (panelRef.current) panelRef.current.scrollTop = scrollTop
      else window.scrollTo(0, scrollTop)
    })
    alert(`Project created: ${newProj.name}`)
  }

  // ── AI Script Generation ───────────────────────────────────────────────

  function parseScriptVariants(text: string): { cold: string; voicemail: string; email: string } {
    const variants = { cold: '', voicemail: '', email: '' }
    const coldMatch = text.match(/---COLD CALL---([\s\S]*?)(?=---VOICEMAIL---|---EMAIL---|$)/i)
    const voicemailMatch = text.match(/---VOICEMAIL---([\s\S]*?)(?=---COLD CALL---|---EMAIL---|$)/i)
    const emailMatch = text.match(/---EMAIL---([\s\S]*?)(?=---COLD CALL---|---VOICEMAIL---|$)/i)
    if (coldMatch) variants.cold = coldMatch[1].trim()
    if (voicemailMatch) variants.voicemail = voicemailMatch[1].trim()
    if (emailMatch) variants.email = emailMatch[1].trim()
    if (!variants.cold && !variants.voicemail && !variants.email) {
      variants.cold = text // fallback: put entire response in cold
    }
    return variants
  }

  async function handleAIScript(contact: any) {
    setAiScriptContactId(contact.id)
    setAiScriptText('')
    setAiScriptVariants(null)
    setAiScriptTab('cold')
    setAiScriptLoading(true)
    try {
      const { processMessage } = await import('@/agents/nexus')
      if (!authProfile?.org_id) {
        setAiScriptText('Not authenticated — sign in first.')
        setAiScriptLoading(false)
        return
      }
      const message =
        `You are a sales coach for Power On Solutions LLC, a C-10 electrical contractor in Coachella Valley, CA. ` +
        `Generate THREE outreach script variations for contacting ${contact.contact || 'the decision maker'} at ${contact.company || 'this GC company'}.\n\n` +
        `Context:\n` +
        `- Phase: ${contact.phase || 'unknown'}\n` +
        `- Fit score: ${contact.fit || 0}/5\n` +
        `- Avg job size: $${num(contact.avg || 0).toLocaleString()}\n` +
        `- Notes: ${contact.notes || 'none'}\n` +
        `- Next action: ${contact.action || 'none'}\n\n` +
        `Format your response EXACTLY as follows (use the exact delimiters):\n\n` +
        `---COLD CALL---\n` +
        `[30-second cold call opening script — conversational, direct, referencing Power On's track record]\n\n` +
        `---VOICEMAIL---\n` +
        `[20-second follow-up voicemail — friendly, leaves curiosity, ends with callback number placeholder]\n\n` +
        `---EMAIL---\n` +
        `Subject: [compelling subject line]\n` +
        `[First paragraph of email — professional, specific to their phase and job size, includes a clear CTA]`
      const result = await processMessage({
        message,
        orgId: authProfile.org_id,
        userId: authProfile.id,
        userName: authProfile.full_name,
        conversationHistory: [],
        isVoiceCommand: false,
      })
      const rawText = result?.agent?.content || result?.conversationMessage?.content || 'No response generated.'
      setAiScriptText(rawText)
      setAiScriptVariants(parseScriptVariants(rawText))
    } catch (err: any) {
      console.error('[Leads] AI Script error:', err)
      setAiScriptText('Failed to generate script: ' + (err.message || 'unknown error'))
    } finally {
      setAiScriptLoading(false)
    }
  }

  // ── Service Leads CRUD ─────────────────────────────────────────────────

  function deleteSvcLead(id: string) {
    if (!confirm('Delete this service lead?')) return
    pushState(backup)
    backup.serviceLeads = serviceLeads.filter((l: any) => l.id !== id)
    persist()
  }

  function cycleSvcStatus(id: string) {
    const l = serviceLeads.find((x: any) => x.id === id)
    if (!l) return
    pushState(backup)
    const idx = SVC_STATUS_CYCLE.indexOf(l.status)
    l.status = SVC_STATUS_CYCLE[(idx + 1) % SVC_STATUS_CYCLE.length]
    persist()
  }

  function addSvcLead() {
    const customer = prompt('Customer name:')
    if (!customer) return
    pushState(backup)
    const newLead = {
      id: 'sl' + Date.now(),
      date: today(),
      source: '',
      customer,
      city: '',
      type: '',
      miles: 0,
      urgency: '',
      status: 'Advance',
      price: 0,
      followup: '',
      notes: '',
      created: today(),
    }
    backup.serviceLeads = [...serviceLeads, newLead]
    persist()
  }

  // ── Weekly Reviews CRUD ────────────────────────────────────────────────

  function deleteWeeklyReview(id: string) {
    if (!confirm('Delete this weekly review?')) return
    pushState(backup)
    backup.weeklyReviews = weeklyReviews.filter((w: any) => w.id !== id)
    persist()
  }

  function addWeeklyReview() {
    pushState(backup)
    const newReview = {
      id: 'wr' + Date.now(),
      date: today(),
      total: 0,
      advance: 0,
      park: 0,
      kill: 0,
      svc: 0,
      proj: 0,
      source: '',
      notes: '',
      created: today(),
    }
    backup.weeklyReviews = [...weeklyReviews, newReview]
    persist()
  }

  // ── Tab styling ────────────────────────────────────────────────────────

  const tabStyle = (key: string) => ({
    background: activeTab === key ? '#3b82f6' : '#1e2130',
    color: activeTab === key ? '#fff' : '#9ca3af',
    border: activeTab === key ? '1px solid transparent' : '1px solid #2e2e3a',
  })

  // ── GC Aggregation Function ────────────────────────────────────────────

  function getGCAggregation(gc: any, backup: any) {
    const companyLower = (gc.company || '').toLowerCase().trim()
    if (!companyLower) return { sent: gc.sent || 0, awarded: gc.awarded || 0, avg: gc.avg || 0, linkedLeads: [], linkedLogs: [] }

    const leads = (backup.serviceLeads || []).filter((l: any) =>
      (l.customer || '').toLowerCase().includes(companyLower) ||
      companyLower.includes((l.customer || '').toLowerCase())
    )
    const logs = (backup.serviceLogs || []).filter((l: any) =>
      (l.customer || '').toLowerCase().includes(companyLower) ||
      companyLower.includes((l.customer || '').toLowerCase())
    )

    const sent = Math.max(gc.sent || 0, leads.length)
    const awarded = Math.max(gc.awarded || 0, logs.length)
    const totalQuoted = logs.reduce((s: number, l: any) => s + num(l.quoted || 0), 0)
    const avg = logs.length > 0 ? totalQuoted / logs.length : num(gc.avg || 0)

    return { sent, awarded, avg, linkedLeads: leads, linkedLogs: logs }
  }

  // ── Lead Scoring ────────────────────────────────────────────────────────

  function calcLeadScore(gc: any): number {
    let score = 0

    // Fit score (0-5) × 15 = up to 75 pts
    const fit = Math.min(5, Math.max(0, num(gc.fit || 0)))
    score += fit * 15

    // Avg job size
    const avg = num(gc.avg || 0)
    if (avg > 10000) score += 15
    else if (avg >= 5000) score += 10
    else score += 5

    // Phase points
    const phase = gc.phase || ''
    if (phase === 'Qualified') score += 10
    else if (phase === 'Active Bidding') score += 8
    else if (phase === 'Awarded') score += 5

    // Days since last contact
    if (gc.lastContact) {
      const last = new Date(gc.lastContact).getTime()
      const diffDays = Math.floor((Date.now() - last) / (1000 * 60 * 60 * 24))
      if (diffDays < 7) score += 5
      else if (diffDays > 30) score -= 10
    } else {
      score -= 10
    }

    // Has notes
    if (gc.notes && gc.notes.trim().length > 0) score += 5

    return Math.max(0, Math.min(100, score))
  }

  function getScoreBadge(score: number) {
    const [bg, label] = score >= 80
      ? ['#10b981', 'Hot']
      : score >= 50
        ? ['#f59e0b', 'Warm']
        : ['#ef4444', 'Cold']
    return (
      <span
        className="text-[9px] px-2 py-0.5 rounded-full font-bold inline-block tabular-nums"
        style={{ background: bg + '22', color: bg, border: `1px solid ${bg}44` }}
      >
        {score} {label}
      </span>
    )
  }

  // ── Mark Contacted ──────────────────────────────────────────────────────

  function markContacted(id: string) {
    const c = gcContacts.find(x => x.id === id)
    if (!c) return
    pushState(backup)
    const future = new Date()
    future.setDate(future.getDate() + 7)
    c.nextFollowup = future.toISOString().slice(0, 10)
    c.lastContact = today()
    persist()
  }

  async function saveRelationshipAccount() {
    const company = String(addRelForm.company || '').trim()
    if (!company) return
    const payload: any = {
      company,
      contact: String(addRelForm.contact || '').trim(),
      role: addRelForm.role || 'General Contractor',
      phone: String(addRelForm.phone || '').trim(),
      email: String(addRelForm.email || '').trim(),
      address: String(addRelForm.address || '').trim(),
      city: String(addRelForm.city || '').trim(),
      notes: String(addRelForm.notes || '').trim(),
      tags: String(addRelForm.tags || '').trim(),
    }
    const editingExisting = editingRelationshipId
      ? gcContacts.find((gc: any) => String(gc.id) === String(editingRelationshipId))
      : null
    const savedId = editingRelationshipId || ('gc' + Date.now())
    const legacyBase = editingExisting || {
      id: savedId,
      intro: '',
      sent: 0,
      awarded: 0,
      avg: 0,
      pay: '',
      phase: 'First Contact',
      fit: 0,
      action: '',
      due: '',
      created: today(),
      contactLog: [],
      nextFollowup: '',
      lastContact: '',
    }
    const cleanupRowToLink = pendingCleanupCreateGroupKey
      ? cleanupRows.find((g: any) => g.key === pendingCleanupCreateGroupKey)
      : null
    const supabaseSaved = await upsertRelationshipAccount({
      orgId: authProfile?.org_id || null,
      ownerUserId: authProfile?.id || null,
      account: {
        id: String(savedId),
        role: payload.role,
        company: payload.company,
        contact: payload.contact,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        city: payload.city,
        notes: payload.notes,
        tags: payload.tags,
        legacy_gc_id: String(savedId),
        legacy_payload: { ...legacyBase, ...payload },
      },
    }).catch((err) => {
      console.warn('[V15rLeadsPanel] relationship account upsert failed', err)
      return null
    })
    if (!supabaseSaved) {
      alert('Cloud save failed. Relationship account was not saved to Supabase.')
      return
    }

    pushState(backup)
    if (editingRelationshipId) {
      backup.gcContacts = gcContacts.map((gc: any) => {
        if (gc.id !== editingRelationshipId) return gc
        return { ...gc, ...payload, id: String(savedId) }
      })
    } else {
      const newGC: any = {
        id: String(savedId),
        intro: '',
        sent: 0,
        awarded: 0,
        avg: 0,
        pay: '',
        phase: 'First Contact',
        fit: 0,
        action: '',
        due: '',
        created: today(),
        contactLog: [],
        nextFollowup: '',
        lastContact: '',
        ...payload,
      }
      backup.gcContacts = [...gcContacts, newGC]
    }
    backup._lastSavedAt = new Date().toISOString()
    saveBackupDataAndSync(backup, 'gcContacts')
    setShowAddRelationship(false)
    setEditingRelationshipId(null)
    setAddRelForm({
      company: '', contact: '', role: 'General Contractor', phone: '', email: '',
      address: '', city: '', notes: '', tags: '',
    })
    setSelectedAccountId(String(savedId))
    window.dispatchEvent(new Event('storage'))
    if (cleanupRowToLink) {
      void linkCleanupRowToExisting(cleanupRowToLink, String(savedId))
    }
  }

  function startEditRelationship(accountId: string) {
    const gc = gcContacts.find((x: any) => x.id === accountId)
    if (!gc) return
    setEditingRelationshipId(gc.id)
    setAddRelForm({
      company: String(gc.company || ''),
      contact: String(gc.contact || ''),
      role: String(gc.role || 'General Contractor') || 'General Contractor',
      phone: String(gc.phone || ''),
      email: String(gc.email || ''),
      address: String(gc.address || ''),
      city: String(gc.city || ''),
      notes: String(gc.notes || ''),
      tags: String(gc.tags || ''),
    })
    setShowAddRelationship(true)
  }

  function closeRelationshipModal() {
    setShowAddRelationship(false)
    setEditingRelationshipId(null)
    setPendingCleanupCreateGroupKey(null)
    setAddRelForm({
      company: '', contact: '', role: 'General Contractor', phone: '', email: '',
      address: '', city: '', notes: '', tags: '',
    })
  }

  function inferAccountForRecord(record: any, accountList: any[] = gcContacts): any | null {
    if (!record) return null
    const byId = String(record.accountId || record.customerId || '').trim()
    if (byId) {
      const exact = accountList.find((a: any) => String(a.id) === byId)
      if (exact) return exact
    }
    const recName = norm(record.company || record.customer || record.client || record.contact || record.name || record.title)
    const recPhone = normPhone(record.phone || record.contactPhone || record.contact_phone)
    const recEmail = normEmail(record.email || record.contactEmail || record.contact_email)
    const recAddr = norm(record.address || record.location)
    const recCity = norm(record.city)

    if (recName) {
      const exactName = accountList.find((a: any) => {
        const c1 = norm(a.company)
        const c2 = norm(a.contact)
        return recName === c1 || recName === c2
      })
      if (exactName) return exactName
    }
    if (recPhone) {
      const exactPhone = accountList.find((a: any) => normPhone(a.phone) && normPhone(a.phone) === recPhone)
      if (exactPhone) return exactPhone
    }
    if (recEmail) {
      const exactEmail = accountList.find((a: any) => normEmail(a.email) && normEmail(a.email) === recEmail)
      if (exactEmail) return exactEmail
    }
    if (recAddr || recCity) {
      const addrMatch = accountList.find((a: any) => {
        const aAddr = norm(a.address)
        const aCity = norm(a.city)
        if (!aAddr && !aCity) return false
        return (!!recAddr && recAddr === aAddr) || (!!recAddr && !!recCity && recAddr === aAddr && recCity === aCity)
      })
      if (addrMatch) return addrMatch
    }
    return null
  }

  function isRecordForAccount(record: any, account: any, accountList: any[] = gcContacts): boolean {
    if (!record || !account) return false
    const explicitId = String(record.accountId || record.customerId || '').trim()
    if (explicitId && explicitId === String(account.id)) return true
    const inferred = inferAccountForRecord(record, accountList)
    return !!inferred && String(inferred.id) === String(account.id)
  }

  function getCanonicalAccountNameById(accountId: any, accountList: any[] = gcContacts): string {
    const id = String(accountId || '').trim()
    if (!id) return ''
    const acc = accountList.find((a: any) => String(a?.id || '') === id)
    if (!acc) return ''
    return String(acc.company || acc.contact || '').trim()
  }

  function resolveRecordCustomerName(record: any, accountList: any[] = gcContacts): string {
    return resolveCanonicalCustomerName(record, accountList)
  }

  function getRecordsForAccount(account: any, accountList: any[] = gcContacts) {
    const projects = (backup.projects || []).filter((p: any) => isActiveProject(p) && isRecordForAccount(p, account, accountList))
    const serviceLogs = (backup.serviceLogs || []).filter((s: any) => isActiveServiceCall(s) && isRecordForAccount(s, account, accountList))
    const serviceEstimates = (backup.serviceEstimates || []).filter((s: any) => isActiveServiceCall(s) && isRecordForAccount(s, account, accountList))
    const activeServiceCalls = (backup.activeServiceCalls || []).filter((s: any) => isActiveServiceCall(s) && isRecordForAccount(s, account, accountList))
    const serviceLeadsForAccount = (serviceLeads || []).filter((s: any) => isRecordForAccount(s, account, accountList))
    const interactions = account.contactLog || []

    const timelineItems: any[] = []
    projects.forEach((p: any) => {
      timelineItems.push({
        date: p.created || p.lastMove || '',
        type: 'Project',
        title: p.name || 'Project',
        location: [p.address, p.city].filter(Boolean).join(', ') || [account.address, account.city].filter(Boolean).join(', '),
        quoted: projectQuoted(p),
        collected: projectCollected(p),
        status: p.status || '—',
        notes: p.notes || '',
        accountId: account.id,
      })
    })
    activeServiceCalls.forEach((s: any) => {
      const canonicalCustomer = resolveRecordCustomerName(s, accountList)
      timelineItems.push({
        date: s.date || s.created || '',
        type: 'Service Call',
        title: `${canonicalCustomer || 'Service Call'}${s.type ? ` — ${s.type}` : ''}`,
        location: [s.address, s.city].filter(Boolean).join(', ') || [account.address, account.city].filter(Boolean).join(', '),
        quoted: num(s.price || s.totalQuote || s.quoted || 0),
        collected: num(s.collected || 0),
        status: s.status || '—',
        notes: s.notes || '',
        accountId: account.id,
      })
    })
    serviceLogs.forEach((l: any) => {
      const canonicalCustomer = resolveRecordCustomerName(l, accountList)
      timelineItems.push({
        date: l.date || '',
        type: 'Service Call',
        title: `${canonicalCustomer || 'Service Call'}${l.jtype ? ` — ${l.jtype}` : ''}`,
        location: [l.address, l.city].filter(Boolean).join(', ') || [account.address, account.city].filter(Boolean).join(', '),
        quoted: num(l.quoted || 0),
        collected: num(l.collected || 0),
        status: l.payStatus || '—',
        notes: l.notes || '',
        accountId: account.id,
      })
    })
    serviceEstimates.forEach((l: any) => {
      const canonicalCustomer = resolveRecordCustomerName(l, accountList)
      timelineItems.push({
        date: l.date || l.createdAt || '',
        type: 'Estimate',
        title: `${canonicalCustomer || 'Estimate'}${l.jobType ? ` — ${l.jobType}` : ''}`,
        location: [l.address, l.city].filter(Boolean).join(', ') || [account.address, account.city].filter(Boolean).join(', '),
        quoted: num(l.totalQuote || 0),
        collected: 0,
        status: l.status || 'open',
        notes: l.notes || '',
        accountId: account.id,
      })
    })
    interactions.forEach((i: any) => {
      timelineItems.push({
        date: i.date || i.timestamp || '',
        type: 'Interaction',
        title: i.type || i.method || 'Interaction',
        location: [account.address, account.city].filter(Boolean).join(', '),
        quoted: 0,
        collected: 0,
        status: 'Logged',
        notes: i.notes || '',
        accountId: account.id,
      })
    })

    const totals = {
      projectCount: projects.length,
      serviceLogCount: serviceLogs.length,
      serviceEstimateCount: serviceEstimates.length,
      activeServiceCallCount: activeServiceCalls.length,
      serviceLeadCount: serviceLeadsForAccount.length,
      totalQuoted:
        projects.reduce((s: number, p: any) => s + projectQuoted(p), 0) +
        serviceLogs.reduce((s: number, l: any) => s + num(l.quoted || 0), 0) +
        serviceEstimates.reduce((s: number, l: any) => s + num(l.totalQuote || 0), 0),
      totalCollected:
        projects.reduce((s: number, p: any) => s + projectCollected(p), 0) +
        serviceLogs.reduce((s: number, l: any) => s + num(l.collected || 0), 0),
      outstanding:
        projects.reduce((s: number, p: any) => s + projectOutstanding(p), 0) +
        serviceLogs.reduce((s: number, l: any) => s + Math.max(0, num(l.quoted || 0) - num(l.collected || 0)), 0),
      repeatCount: projects.length + serviceLogs.length + activeServiceCalls.length,
      openBids:
        serviceLeadsForAccount.filter((s: any) => ['Quoted', 'Advance'].includes(String(s.status || ''))).length +
        serviceEstimates.filter((s: any) => String(s.status || '').toLowerCase() === 'open').length,
      activeJobs:
        projects.filter((p: any) => String(p.status || '').toLowerCase() === 'active').length +
        activeServiceCalls.length +
        serviceLeadsForAccount.filter((s: any) => ['Advance', 'Quoted', 'Booked'].includes(String(s.status || ''))).length,
    }

    return { projects, serviceLogs, serviceEstimates, activeServiceCalls, serviceLeads: serviceLeadsForAccount, timelineItems, totals }
  }

  const accounts = useMemo(() => {
    const relationshipPool = gcContacts
    return relationshipPool.map((gc: any) => {
      const matched = getRecordsForAccount(gc, relationshipPool)
      const lastLog = (gc.contactLog || []).slice().sort((a: any, b: any) => String(b.date || b.timestamp).localeCompare(String(a.date || a.timestamp)))[0]
      return {
        id: gc.id,
        name: gc.company || 'Unnamed Account',
        type: gc.role || (gc.role?.toLowerCase().includes('gc') ? 'General Contractor' : (matched.serviceLeads.length > 0 || matched.serviceLogs.length > 0 ? 'Service Customer' : 'Commercial Client')),
        contact: gc.contact || '',
        phone: gc.phone || '',
        email: gc.email || '',
        projects: matched.projects,
        serviceCalls: [...matched.serviceLeads, ...matched.activeServiceCalls],
        linkedLogs: matched.serviceLogs,
        linkedEstimates: matched.serviceEstimates,
        activeServiceCalls: matched.activeServiceCalls,
        timelineItems: matched.timelineItems,
        interactions: gc.contactLog || [],
        totals: matched.totals,
        lifetimeRevenue: matched.totals.totalCollected,
        outstanding: matched.totals.outstanding,
        repeatCount: matched.totals.repeatCount,
        openBids: matched.totals.openBids,
        activeJobs: matched.totals.activeJobs,
        lastInteraction: (lastLog?.date || lastLog?.timestamp || gc.lastContact || gc.created || ''),
        address: gc.address || matched.serviceLeads[0]?.address || matched.activeServiceCalls[0]?.address || matched.projects[0]?.address || matched.serviceLogs[0]?.address || '',
        city: gc.city || matched.serviceLeads[0]?.city || matched.activeServiceCalls[0]?.city || matched.projects[0]?.city || matched.serviceLogs[0]?.city || '',
        notes: gc.notes || '',
        tags: gc.tags || '',
      }
    })
  }, [gcContacts, serviceLeads, backup])

  useEffect(() => {
    if (!mapLoaded) return
    const g = (window as any).google
    if (!g?.maps) return
    const geocoder = new g.maps.Geocoder()
    accounts.forEach((a: any) => {
      const accountQuery = [a.address, a.city, 'CA'].filter(Boolean).join(', ')
      const accountKey = `${a.id}::0::${accountQuery}`
      if (accountQuery && !geoCache[accountKey]) {
        geocoder.geocode({ address: accountQuery }, (results: any, status: any) => {
          if (status !== 'OK' || !results?.[0]) return
          const loc = results[0].geometry.location
          setGeoCache(prev => ({ ...prev, [accountKey]: { lat: loc.lat(), lng: loc.lng() } }))
        })
      }
      a.serviceCalls.forEach((s: any, idx: number) => {
        const q = [s.address, s.city, 'CA'].filter(Boolean).join(', ')
        const key = `${a.id}::${idx + 1}::${q}`
        if (!q || geoCache[key]) return
        geocoder.geocode({ address: q }, (results: any, status: any) => {
          if (status !== 'OK' || !results?.[0]) return
          const loc = results[0].geometry.location
          setGeoCache(prev => ({ ...prev, [key]: { lat: loc.lat(), lng: loc.lng() } }))
        })
      })
      ;(a.linkedLogs || []).forEach((s: any, idx: number) => {
        const q = [s.address, s.city, 'CA'].filter(Boolean).join(', ')
        const key = `${a.id}::log::${idx}::${q}`
        if (!q || geoCache[key]) return
        geocoder.geocode({ address: q }, (results: any, status: any) => {
          if (status !== 'OK' || !results?.[0]) return
          const loc = results[0].geometry.location
          setGeoCache(prev => ({ ...prev, [key]: { lat: loc.lat(), lng: loc.lng() } }))
        })
      })
      ;(a.linkedEstimates || []).forEach((s: any, idx: number) => {
        const q = [s.address, s.city, 'CA'].filter(Boolean).join(', ')
        const key = `${a.id}::est::${idx}::${q}`
        if (!q || geoCache[key]) return
        geocoder.geocode({ address: q }, (results: any, status: any) => {
          if (status !== 'OK' || !results?.[0]) return
          const loc = results[0].geometry.location
          setGeoCache(prev => ({ ...prev, [key]: { lat: loc.lat(), lng: loc.lng() } }))
        })
      })
      a.projects.forEach((p: any, idx: number) => {
        const q = [p.address, p.city, 'CA'].filter(Boolean).join(', ')
        const key = `${a.id}::proj::${idx}::${q}`
        if (!q || geoCache[key]) return
        geocoder.geocode({ address: q }, (results: any, status: any) => {
          if (status !== 'OK' || !results?.[0]) return
          const loc = results[0].geometry.location
          setGeoCache(prev => ({ ...prev, [key]: { lat: loc.lat(), lng: loc.lng() } }))
        })
      })
    })
  }, [accounts, mapLoaded, geoCache])

  const accountTypeOptions = useMemo(() => {
    const dynamic = new Set<string>()
    accounts.forEach((a: any) => {
      const t = String(a?.type || '').trim()
      if (t) dynamic.add(t)
    })
    REL_ACCOUNT_TYPES.forEach((t) => dynamic.add(t))
    return Array.from(dynamic)
      .filter((t) => {
        const normalized = String(t || '').trim().toLowerCase()
        return normalized !== 'gc' && normalized !== 'owner'
      })
      .sort((a, b) => a.localeCompare(b))
  }, [accounts])

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.toLowerCase().trim()
    return accounts.filter((a: any) => {
      const searchMatch = !q || a.name.toLowerCase().includes(q) || a.contact.toLowerCase().includes(q) || a.city.toLowerCase().includes(q) || String(a.tags || '').toLowerCase().includes(q)
      const typeMatch = accountTypeFilter === 'all' ? true : a.type === accountTypeFilter
      const filterMatch =
        mapFilter === 'all' ? true :
        mapFilter === 'active' ? a.activeJobs > 0 :
        mapFilter === 'unpaid' ? a.outstanding > 0 :
        mapFilter === 'high' ? a.lifetimeRevenue >= 10000 :
        mapFilter === 'repeat' ? a.repeatCount > 1 :
        mapFilter === 'service' ? a.serviceCalls.length > 0 :
        mapFilter === 'gc' ? a.type === 'General Contractor' : true
      return searchMatch && typeMatch && filterMatch
    })
  }, [accounts, accountSearch, mapFilter, accountTypeFilter])

  const selectedAccount = filteredAccounts.find((a: any) => a.id === selectedAccountId) || null

  const mapScopedAccounts = useMemo(() => {
    if (mapMode === 'selected') return selectedAccount ? [selectedAccount] : []
    return filteredAccounts
  }, [mapMode, selectedAccount, filteredAccounts])

  const pointPalette = ['#22d3ee', '#f59e0b', '#10b981', '#e879f9', '#60a5fa', '#f43f5e', '#f97316', '#84cc16']
  const dateMs = (v: any): number => {
    const s = String(v || '').trim()
    if (!s) return Number.POSITIVE_INFINITY
    const t = new Date(s).getTime()
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
  }

  const mapPoints = useMemo(() => {
    const pts: Array<any> = []
    mapScopedAccounts.forEach((a: any) => {
      const baseKey = `${a.id}::0::${[a.address, a.city, 'CA'].filter(Boolean).join(', ')}`
      if (geoCache[baseKey]) {
        pts.push({
          pointKey: `${a.id}|account|anchor`,
          accountId: a.id,
          accountName: a.name,
          lat: geoCache[baseKey].lat,
          lng: geoCache[baseKey].lng,
          label: a.name,
          gc: a.type === 'General Contractor',
          kind: 'Account',
          entityType: 'account',
          entityId: String(a.id || 'account-anchor'),
          displayTitle: a.name,
          title: a.name,
          jobType: '',
          sourceBucket: 'account',
          sequenceNumber: null,
          status: a.activeJobs > 0 ? 'Active' : 'Idle',
          quoted: 0,
          collected: 0,
          outstanding: 0,
          notes: a.notes || '',
          date: '',
          location: [a.address, a.city].filter(Boolean).join(', '),
          pinColor: '#10b981',
        })
      }
      a.serviceCalls.forEach((s: any, idx: number) => {
        const key = `${a.id}::${idx + 1}::${[s.address, s.city, 'CA'].filter(Boolean).join(', ')}`
        const canonicalCustomer = resolveRecordCustomerName(s, gcContacts) || a.name
        if (geoCache[key]) {
          const quoted = num(s.price || s.totalQuote || 0)
          const collected = num(s.collected || 0)
          pts.push({
            pointKey: `${a.id}|service_call|${String(s.id || idx)}`,
            accountId: a.id,
            accountName: a.name,
            lat: geoCache[key].lat,
            lng: geoCache[key].lng,
            label: canonicalCustomer,
            gc: a.type === 'General Contractor',
            kind: 'Service Call',
            entityType: 'service_call',
            entityId: String(s.id || `service_call_${idx}`),
            displayTitle: s.name || s.type || canonicalCustomer || 'Service Call',
            title: s.type || canonicalCustomer || 'Service Call',
            jobType: s.type || '',
            sourceBucket: 'service_call',
            sequenceNumber: null,
            status: s.status || '—',
            quoted,
            collected,
            outstanding: Math.max(0, quoted - collected),
            notes: s.notes || '',
            date: s.date || '',
            location: [s.address, s.city].filter(Boolean).join(', ') || [a.address, a.city].filter(Boolean).join(', '),
            pinColor: '#10b981',
          })
        }
      })
      ;(a.linkedLogs || []).forEach((s: any, idx: number) => {
        const key = `${a.id}::log::${idx}::${[s.address, s.city, 'CA'].filter(Boolean).join(', ')}`
        const canonicalCustomer = resolveRecordCustomerName(s, gcContacts) || a.name
        if (geoCache[key]) {
          const quoted = num(s.quoted || 0)
          const collected = num(s.collected || 0)
          pts.push({
            pointKey: `${a.id}|service_log|${String(s.id || idx)}`,
            accountId: a.id,
            accountName: a.name,
            lat: geoCache[key].lat,
            lng: geoCache[key].lng,
            label: canonicalCustomer,
            gc: a.type === 'General Contractor',
            kind: 'Service Call',
            entityType: 'service_log',
            entityId: String(s.id || `service_log_${idx}`),
            displayTitle: s.jtype || canonicalCustomer || 'Service Call',
            title: s.jtype || canonicalCustomer || 'Service Call',
            jobType: s.jtype || '',
            sourceBucket: 'service_log',
            sequenceNumber: null,
            status: s.payStatus || '—',
            quoted,
            collected,
            outstanding: Math.max(0, quoted - collected),
            notes: s.notes || '',
            date: s.date || '',
            location: [s.address, s.city].filter(Boolean).join(', ') || [a.address, a.city].filter(Boolean).join(', '),
            pinColor: '#10b981',
          })
        }
      })
      ;(a.linkedEstimates || []).forEach((s: any, idx: number) => {
        const key = `${a.id}::est::${idx}::${[s.address, s.city, 'CA'].filter(Boolean).join(', ')}`
        const canonicalCustomer = resolveRecordCustomerName(s, gcContacts) || a.name
        if (geoCache[key]) {
          const quoted = num(s.totalQuote || 0)
          const collected = num(s.collected || 0)
          pts.push({
            pointKey: `${a.id}|service_estimate|${String(s.id || idx)}`,
            accountId: a.id,
            accountName: a.name,
            lat: geoCache[key].lat,
            lng: geoCache[key].lng,
            label: canonicalCustomer,
            gc: a.type === 'General Contractor',
            kind: 'Estimate',
            entityType: 'service_estimate',
            entityId: String(s.id || `service_estimate_${idx}`),
            displayTitle: s.jobType || canonicalCustomer || 'Estimate',
            title: s.jobType || canonicalCustomer || 'Estimate',
            jobType: s.jobType || '',
            sourceBucket: 'service_estimate',
            sequenceNumber: null,
            status: s.status || 'open',
            quoted,
            collected,
            outstanding: Math.max(0, quoted - collected),
            notes: s.notes || '',
            date: s.date || s.createdAt || '',
            location: [s.address, s.city].filter(Boolean).join(', ') || [a.address, a.city].filter(Boolean).join(', '),
            pinColor: '#10b981',
          })
        }
      })
      a.projects.forEach((p: any, idx: number) => {
        const key = `${a.id}::proj::${idx}::${[p.address, p.city, 'CA'].filter(Boolean).join(', ')}`
        if (geoCache[key]) {
          const quoted = projectQuoted(p)
          const collected = projectCollected(p)
          pts.push({
            pointKey: `${a.id}|project|${String(p.id || idx)}`,
            accountId: a.id,
            accountName: a.name,
            lat: geoCache[key].lat,
            lng: geoCache[key].lng,
            label: p.name || a.name,
            gc: a.type === 'General Contractor',
            kind: 'Project',
            entityType: 'project',
            entityId: String(p.id || `project_${idx}`),
            displayTitle: p.name || 'Project',
            title: p.name || 'Project',
            jobType: p.type || '',
            sourceBucket: 'project',
            sequenceNumber: null,
            status: p.status || '—',
            quoted,
            collected,
            outstanding: Math.max(0, quoted - collected),
            notes: p.notes || '',
            date: p.created || '',
            location: [p.address, p.city].filter(Boolean).join(', ') || [a.address, a.city].filter(Boolean).join(', '),
            pinColor: '#22d3ee',
          })
        }
      })
    })
    const selectedId = selectedAccount?.id ? String(selectedAccount.id) : ''
    const multiSelected = mapMode === 'selected' && !!selectedId
    if (multiSelected) {
      const selectedPts = pts.filter((p: any) => String(p.accountId) === selectedId && p.kind !== 'Account')
      const shouldStyle = selectedPts.length > 1
      const ordered = [...selectedPts].sort((a: any, b: any) => {
        const da = dateMs(a.date)
        const db = dateMs(b.date)
        if (da !== db) return da - db
        return String(a.pointKey || '').localeCompare(String(b.pointKey || ''))
      })
      const total = ordered.length
      const seqMap = new Map<string, number>()
      ordered.forEach((p: any, i: number) => seqMap.set(String(p.pointKey), i + 1))
      return pts.map((p: any) => {
        if (String(p.accountId) !== selectedId || p.kind === 'Account') return p
        const seq = seqMap.get(String(p.pointKey)) || null
        const pinColor = shouldStyle && seq ? pointPalette[(seq - 1) % pointPalette.length] : p.pinColor
        const seqPrefix = seq ? `${seq} of ${total}` : ''
        return {
          ...p,
          sequenceNumber: seq,
          sequenceTotal: total,
          pinColor,
          label: seqPrefix ? `${seqPrefix} • ${p.accountName}` : p.label,
          title: seqPrefix ? `${seqPrefix} • ${p.displayTitle || p.title || p.kind}` : (p.displayTitle || p.title || p.kind),
        }
      })
    }
    return pts
  }, [mapScopedAccounts, geoCache, mapMode, selectedAccount?.id])

  const clusteredPoints = useMemo(() => {
    const clusters = new Map<string, any[]>()
    mapPoints.forEach((p: any) => {
      const key = `${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`
      if (!clusters.has(key)) clusters.set(key, [])
      clusters.get(key)!.push(p)
    })
    return Array.from(clusters.entries()).map(([key, arr]) => {
      const p = arr[0]
      return { key, lat: p.lat, lng: p.lng, count: arr.length, points: arr, primaryAccountId: p.accountId, gc: arr.some((x: any) => x.gc) }
    })
  }, [mapPoints])

  const activeCluster = useMemo(() => {
    if (!activeClusterKey) return null
    return clusteredPoints.find((c: any) => c.key === activeClusterKey) || null
  }, [activeClusterKey, clusteredPoints])

  const activeClusterPoints = useMemo(() => {
    if (!activeCluster) return []
    return [...(activeCluster.points || [])]
      .sort((a: any, b: any) => {
        const as = num(a.sequenceNumber || 0)
        const bs = num(b.sequenceNumber || 0)
        if (as > 0 && bs > 0 && as !== bs) return as - bs
        const da = dateMs(a.date)
        const db = dateMs(b.date)
        if (da !== db) return da - db
        return String(a.pointKey || '').localeCompare(String(b.pointKey || ''))
      })
  }, [activeCluster])

  const selectedActivePoint = useMemo(() => {
    if (!activeClusterPoints.length) return null
    if (selectedMapPointKey) {
      return activeClusterPoints.find((p: any) => String(p.pointKey) === String(selectedMapPointKey)) || null
    }
    if (activeClusterPoints.length === 1) return activeClusterPoints[0]
    if (selectedClusterPointKey) {
      return activeClusterPoints.find((p: any) => String(p.pointKey) === String(selectedClusterPointKey)) || activeClusterPoints[0]
    }
    return activeClusterPoints.find((p: any) => p.kind !== 'Account') || activeClusterPoints[0]
  }, [activeClusterPoints, selectedClusterPointKey, selectedMapPointKey])

  const timelineEvents = useMemo(() => {
    const sourceAccounts = (mapMode === 'all_jobs' && !selectedAccount) ? mapScopedAccounts : (selectedAccount ? [selectedAccount] : [])
    const events: any[] = []
    sourceAccounts.forEach((a: any) => {
      ;(a.timelineItems || []).forEach((ev: any) => events.push(ev))
    })
    return events
      .filter(e => e.date || e.title || e.notes)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 80)
  }, [mapMode, selectedAccount, mapScopedAccounts])

  const cleanupRows = useMemo(() => {
    const isRelevantEstimateStatus = (status: any): boolean => {
      const s = String(status || '').trim().toLowerCase()
      return s === 'open' || s === 'active'
    }
    const accountById = new Map<string, any>()
    gcContacts.forEach((a: any) => {
      const id = String(a?.id || '').trim()
      if (id) accountById.set(id, a)
    })
    const toRows = (list: any[], kind: string) => list.map((r: any) => ({ ...r, _kind: kind }))
    const estimateRecords = (backup.serviceEstimates || []).filter((r: any) => isActiveServiceCall(r) && isRelevantEstimateStatus(r?.status))
    const records = [
      ...toRows(backup.projects || [], 'project'),
      ...toRows(backup.serviceLogs || [], 'service_log'),
      ...toRows(estimateRecords, 'service_estimate'),
    ]
    console.info('[RelationshipCleanup] scan counts', {
      projects: (backup.projects || []).length,
      serviceLogs: (backup.serviceLogs || []).length,
      serviceEstimates: estimateRecords.length,
      activeServiceCallsSkipped: (backup.activeServiceCalls || []).length,
    })
    return records.map((r: any, idx: number) => {
      const id = String(r?.id || '').trim()
      const linkedId = String(r?.accountId || r?.customerId || '').trim()
      const canonical = linkedId ? getCanonicalAccountNameById(linkedId, gcContacts) : ''
      const stored = String(r?.customer || r?.client || r?.name || '').trim()
      const missingId = !id
      const missingLink = !missingId && !linkedId
      const nameMismatch = !missingId && !!linkedId && !!canonical && !!stored && norm(canonical) !== norm(stored)
      const type = r?._kind === 'project' ? 'Project' : 'Service Call'
      const sourcePanel = r?._kind === 'project' ? 'Projects' : 'Field Log'
      return {
        key: `${String(r?._kind || 'unknown')}|${id || `missing-${idx}`}`,
        kind: String(r?._kind || ''),
        sourceBucket: String(r?._kind || ''),
        id,
        type,
        sourcePanel,
        storedName: stored || 'Unknown',
        linkedCustomerId: linkedId || '',
        linkedCustomerName: canonical || '',
        address: [r?.address, r?.city].filter(Boolean).join(', '),
        date: String(r?.date || r?.createdAt || r?.created || r?.lastMove || ''),
        quoted: r?._kind === 'project' ? projectQuoted(r) : num(r?.totalQuote || r?.quoted || r?.price || 0),
        collected: r?._kind === 'project' ? projectCollected(r) : num(r?.collected || 0),
        title: String(r?.name || r?.jobType || r?.jtype || r?.type || ''),
        raw: r,
        missingId,
        missingLink,
        nameMismatch,
        needsCleanup: missingId || missingLink || nameMismatch,
      }
    })
      .filter((r: any) => r.needsCleanup)
      .filter((r: any) => !ignoredCleanupKeys[r.key])
      .sort((a: any, b: any) => Number(b.nameMismatch) - Number(a.nameMismatch))
  }, [backup, gcContacts, ignoredCleanupKeys])

  const emptyRelationshipAccounts = useMemo(() => {
    return accounts.filter((a: any) => (a.projects?.length || 0) === 0 && (a.serviceCalls?.length || 0) === 0 && (a.linkedLogs?.length || 0) === 0 && (a.linkedEstimates?.length || 0) === 0)
  }, [accounts])

  function createRelationshipFromCleanupRow(row: any) {
    if (!row) return
    setPendingCleanupCreateGroupKey(String(row.key || ''))
    setEditingRelationshipId(null)
    setAddRelForm({
      company: String(row.storedName || ''),
      contact: '',
      role: 'Service Customer',
      phone: '',
      email: '',
      address: String((row.address || '').split(',')[0] || ''),
      city: String((row.address || '').split(',').slice(1).join(',').trim() || ''),
      notes: `Created from relationship cleanup (${row.type} ${row.id || 'missing-id'})`,
      tags: 'relationship-cleanup',
    })
    setShowAddRelationship(true)
  }

  async function linkCleanupRowToExisting(row: any, accountId: string) {
    if (!row || !accountId) return
    if (!row.id) {
      alert('Missing ID — cannot sync')
      return
    }
    const target = gcContacts.find((g: any) => String(g.id) === String(accountId))
    if (!target) return
    const canonicalName = String(target.company || target.contact || '').trim()
    const entityType = String(row.kind || '')
    setCleanupBusyKey(row.key)
    const linkRes = await linkEntityToAccount({
      orgId: authProfile?.org_id || null,
      accountId: String(accountId),
      entityType,
      entityId: String(row.id),
      entityLabel: canonicalName || row.title || row.storedName || 'Linked Record',
      legacyCustomerText: row.storedName || '',
      metadata: { source: 'relationship_cleanup_manual', legacy_payload: row.raw },
      createdBy: authProfile?.id || null,
    }).catch((err) => {
      console.warn('[V15rLeadsPanel] relationship link upsert failed', err)
      return null
    })
    if (!linkRes) {
      alert('Supabase link failed. Cleanup item was not completed.')
      setCleanupBusyKey(null)
      return
    }
    const eventRes = await upsertRelationshipEvent({
      orgId: authProfile?.org_id || null,
      accountId: String(accountId),
      entityType,
      entityId: String(row.id),
      title: canonicalName || row.title || 'Linked Record',
      description: 'Linked via Relationship Cleanup',
      quotedAmount: num(row.quoted || 0),
      collectedAmount: num(row.collected || 0),
      outstandingAmount: Math.max(0, num(row.quoted || 0) - num(row.collected || 0)),
      metadata: { source: 'relationship_cleanup_manual' },
      createdBy: authProfile?.id || null,
    }).catch((err) => {
      console.warn('[V15rLeadsPanel] relationship event upsert failed', err)
      return null
    })
    if (!eventRes) {
      alert('Supabase event write failed. Cleanup item was not completed.')
      setCleanupBusyKey(null)
      return
    }
    pushState(backup)
    if (row.kind === 'project') {
      backup.projects = (backup.projects || []).map((r: any) => r.id === row.id ? { ...r, accountId: target.id, client: canonicalName || r.client } : r)
    } else if (row.kind === 'service_log') {
      backup.serviceLogs = (backup.serviceLogs || []).map((r: any) => r.id === row.id ? { ...r, accountId: target.id, customer: canonicalName || r.customer } : r)
    } else if (row.kind === 'service_estimate') {
      backup.serviceEstimates = (backup.serviceEstimates || []).map((r: any) => r.id === row.id ? { ...r, accountId: target.id, customer: canonicalName || r.customer } : r)
    } else if (row.kind === 'active_service_call') {
      backup.activeServiceCalls = (backup.activeServiceCalls || []).map((r: any) => r.id === row.id ? { ...r, accountId: target.id, customer: canonicalName || r.customer } : r)
    }
    persist()
    setIgnoredCleanupKeys((prev) => ({ ...prev, [row.key]: true }))
    setCleanupBusyKey(null)
  }

  async function syncCleanupRowName(row: any) {
    if (!row?.id || !row?.linkedCustomerId || !row?.linkedCustomerName) return
    await linkCleanupRowToExisting(row, row.linkedCustomerId)
  }

  function openCleanupSourceRecord(record: any) {
    if (!record) return
    const entityType = String(record?._kind || '')
    const entityId = String(record?.id || '')
    if (!entityId) return
    const view = entityType === 'project' ? 'projects' : 'field-log'
    window.dispatchEvent(new CustomEvent('poweron:nav', { detail: { view } }))
    window.dispatchEvent(new CustomEvent('poweron-open-source-record', {
      detail: {
        tab: view === 'projects' ? 'projects' : 'fieldLog',
        entityType,
        entityId,
      },
    }))
  }

  async function deleteEmptyRelationshipAccount(accountId: string) {
  const acc = accounts.find((a: any) => a.id === accountId)
  if (!acc) return

  const hasHistory =
    (acc.projects?.length || 0) > 0 ||
    (acc.serviceCalls?.length || 0) > 0 ||
    (acc.linkedLogs?.length || 0) > 0 ||
    (acc.linkedEstimates?.length || 0) > 0

  if (hasHistory) return

  if (!confirm(`Delete empty relationship account "${acc.name}"? This will remove it from Supabase, app_state, and local backup.`)) return

  const normalize = (v: any) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const targetCompany = normalize(acc.name)
  const targetContact = normalize(acc.contact)

  const shouldRemove = (g: any) => {
    if (String(g?.id || '') === String(accountId)) return true

    const sameCompany = !!targetCompany && normalize(g?.company || g?.name) === targetCompany
    const sameContact = !!targetContact && normalize(g?.contact) === targetContact

    return sameCompany || sameContact
  }

  const deletedCloud = await deleteRelationshipAccount(accountId, authProfile?.org_id || null, {
    company: acc.name,
    contact: acc.contact,
  })

  if (!deletedCloud) {
    alert('Could not delete this relationship account from Supabase. Nothing was removed locally.')
    return
  }

  const tombstone = {
    id: String(accountId),
    company: String(acc.name || ''),
    contact: String(acc.contact || ''),
    deletedAt: new Date().toISOString(),
    source: 'empty_relationship_account_delete',
  }

  pushState(backup)

  const existingDeleted = Array.isArray((backup as any)._deletedRelationshipAccounts)
    ? (backup as any)._deletedRelationshipAccounts
    : []

  const alreadyDeleted = existingDeleted.some((d: any) => {
    const sameId = String(d?.id || '') === String(tombstone.id)
    const sameCompany = !!targetCompany && normalize(d?.company) === targetCompany
    const sameContact = !!targetContact && normalize(d?.contact) === targetContact
    return sameId || sameCompany || sameContact
  })

  ;(backup as any)._deletedRelationshipAccounts = alreadyDeleted
    ? existingDeleted
    : [...existingDeleted, tombstone]

  backup.gcContacts = gcContacts.filter((g: any) => !shouldRemove(g))
  backup._lastSavedAt = new Date().toISOString()

  try {
    Object.keys(localStorage)
      .filter((key) => key === 'poweron_backup_data' || key.startsWith('poweron_backup_data_'))
      .forEach((key) => {
        const raw = localStorage.getItem(key)
        if (!raw) return

        const cached = JSON.parse(raw)

        cached.gcContacts = (cached.gcContacts || []).filter((g: any) => !shouldRemove(g))

        const cachedDeleted = Array.isArray(cached._deletedRelationshipAccounts)
          ? cached._deletedRelationshipAccounts
          : []

        const cachedAlreadyDeleted = cachedDeleted.some((d: any) => {
          const sameId = String(d?.id || '') === String(tombstone.id)
          const sameCompany = !!targetCompany && normalize(d?.company) === targetCompany
          const sameContact = !!targetContact && normalize(d?.contact) === targetContact
          return sameId || sameCompany || sameContact
        })

        cached._deletedRelationshipAccounts = cachedAlreadyDeleted
          ? cachedDeleted
          : [...cachedDeleted, tombstone]

        cached._lastSavedAt = backup._lastSavedAt

        localStorage.setItem(key, JSON.stringify(cached))
      })
  } catch (err) {
    console.warn('[Leads] failed to sanitize local relationship cache', err)
  }

  const syncResult = await saveBackupDataAndSyncNow(backup, 'gcContacts')

  window.dispatchEvent(new Event('storage'))
  window.dispatchEvent(new Event('poweron-data-saved'))
  forceUpdate()

  if (!syncResult.success) {
    alert(`Deleted locally, but cloud sync failed: ${syncResult.error || 'Unknown sync error'}`)
  }
}

  function renderAccountsCenter() {
    const totalAccounts = filteredAccounts.length
    const activeJobs = filteredAccounts.reduce((s: number, a: any) => s + a.activeJobs, 0)
    const lifetimeRevenue = filteredAccounts.reduce((s: number, a: any) => s + a.lifetimeRevenue, 0)
    const outstanding = filteredAccounts.reduce((s: number, a: any) => s + a.outstanding, 0)
    const activeService = filteredAccounts.reduce((s: number, a: any) => s + num(a.totals?.activeServiceCallCount || 0), 0)
    const activeBids = filteredAccounts.reduce((s: number, a: any) => s + a.openBids, 0)
    const repeatClients = filteredAccounts.filter((a: any) => a.repeatCount > 1).length
    const gcAccounts = filteredAccounts.filter((a: any) => a.type === 'General Contractor').length

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-900/20 via-slate-900 to-indigo-900/20 p-4 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
          <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300">Customer Accounts Intelligence Center</div>
          <div className="text-xs text-gray-300 mt-1">Customer relationships, jobs, geography, and financial exposure in one workspace view.</div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {[
            ['Total Accounts', totalAccounts, '#67e8f9'],
            ['Active Jobs', activeJobs, '#86efac'],
            ['Lifetime Revenue', fmt(lifetimeRevenue), '#93c5fd'],
            ['Outstanding', fmt(outstanding), '#fdba74'],
            ['Active Service Calls', activeService, '#fcd34d'],
            ['Active Bids', activeBids, '#c4b5fd'],
            ['Repeat Clients', repeatClients, '#f9a8d4'],
            ['GC Accounts', gcAccounts, '#22d3ee'],
          ].map(([label, value, clr]: any) => (
            <div key={label} className="rounded-xl border border-gray-800 bg-[linear-gradient(180deg,rgba(17,24,39,0.95),rgba(2,6,23,0.95))] p-3">
              <div className="text-[9px] uppercase tracking-wide text-gray-500 font-bold">{label}</div>
              <div className="text-sm font-bold mt-1 font-mono" style={{ color: clr }}>{String(value)}</div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-cyan-900/30 bg-[var(--bg-card)] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold">Relationship Cleanup</div>
            <div className="text-[10px] text-gray-500">{cleanupRows.length} records need cleanup</div>
          </div>
          <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
            {cleanupRows.map((r: any) => (
              <div key={r.key} className={`rounded border p-2 ${r.missingId ? 'border-amber-900/40 bg-black/20' : r.nameMismatch ? 'border-rose-900/40 bg-black/20' : 'border-gray-800 bg-[var(--bg-secondary)]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-gray-100 font-semibold">{r.type} · ID: {r.id || 'Missing ID — cannot sync'}</div>
                    <div className="text-[10px] text-gray-500">Stored: {r.storedName || 'Unknown'} | Linked saved customer: {r.linkedCustomerName || 'None'}</div>
                    <div className="text-[10px] text-gray-500">{r.address || 'No address'} | {r.date || 'No date'} | Quoted {fmt(num(r.quoted || 0))} | Collected {fmt(num(r.collected || 0))} | {r.sourcePanel} | Source bucket: {r.sourceBucket}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    <select value={cleanupLinkSelection[r.key] || ''} onChange={(e) => setCleanupLinkSelection((prev) => ({ ...prev, [r.key]: e.target.value }))} className="px-2 py-1 rounded bg-gray-900 border border-gray-700 text-[10px] text-cyan-300" disabled={r.missingId || cleanupBusyKey === r.key}>
                      <option value="">Link to existing customer</option>
                      {gcContacts.map((c: any) => <option key={c.id} value={c.id}>{c.company || c.contact || c.id}</option>)}
                    </select>
                    <button onClick={() => void linkCleanupRowToExisting(r, cleanupLinkSelection[r.key])} className="px-2 py-1 rounded bg-cyan-700/40 text-cyan-300 text-[10px]" disabled={r.missingId || !cleanupLinkSelection[r.key] || cleanupBusyKey === r.key}>Link</button>
                    <button onClick={() => createRelationshipFromCleanupRow(r)} className="px-2 py-1 rounded bg-emerald-700/40 text-emerald-300 text-[10px]" disabled={r.missingId || cleanupBusyKey === r.key}>Create New Customer</button>
                    <button onClick={() => void syncCleanupRowName(r)} className="px-2 py-1 rounded bg-rose-700/40 text-rose-300 text-[10px]" disabled={r.missingId || !r.linkedCustomerId || !r.nameMismatch || cleanupBusyKey === r.key}>Sync Name</button>
                    <button onClick={() => openCleanupSourceRecord({ _kind: r.kind, id: r.id })} className="px-2 py-1 rounded bg-indigo-700/40 text-indigo-300 text-[10px]" disabled={!r.id}>Open Source</button>
                    <button onClick={() => setIgnoredCleanupKeys((prev) => ({ ...prev, [r.key]: true }))} className="px-2 py-1 rounded bg-gray-700 text-gray-300 text-[10px]">Ignore / Report Only</button>
                  </div>
                </div>
              </div>
            ))}
            {cleanupRows.length === 0 && <div className="text-xs text-gray-500">No records currently need relationship cleanup.</div>}
          </div>
          <div className="pt-1 border-t border-gray-800">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold mb-2">Empty Relationship Accounts</div>
            <div className="space-y-1.5 max-h-[120px] overflow-auto pr-1">
              {emptyRelationshipAccounts.map((a: any) => (
                <div key={a.id} className="rounded border border-gray-800 bg-[var(--bg-secondary)] px-2 py-1.5 flex items-center justify-between">
                  <div className="text-[11px] text-gray-300">{a.name}</div>
                  <button onClick={() => deleteEmptyRelationshipAccount(a.id)} className="px-2 py-0.5 rounded bg-red-700/30 text-red-300 text-[10px]">Delete</button>
                </div>
              ))}
              {emptyRelationshipAccounts.length === 0 && <div className="text-xs text-gray-500">No empty relationship accounts.</div>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-5 rounded-xl border border-gray-800 bg-[var(--bg-card)] p-3">
            <div className="flex gap-2 mb-2">
              <input value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="Search accounts, contact, city..." className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-xs text-gray-200" />
              <select value={mapFilter} onChange={(e) => setMapFilter(e.target.value as any)} className="px-2 py-2 rounded-lg bg-gray-900 border border-gray-700 text-xs text-cyan-300">
                <option value="all">All</option>
                <option value="active">Active Jobs</option>
                <option value="unpaid">Unpaid</option>
                <option value="high">High Value</option>
                <option value="repeat">Repeat</option>
                <option value="service">Service Calls</option>
                <option value="gc">GC Only</option>
              </select>
            </div>
            <div className="flex gap-2 mb-2">
              <select value={accountTypeFilter} onChange={(e) => setAccountTypeFilter(e.target.value as any)} className="flex-1 px-2 py-2 rounded-lg bg-gray-900 border border-gray-700 text-xs text-cyan-300">
                <option value="all">All Account Types</option>
                {accountTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                onClick={() => {
                  setEditingRelationshipId(null)
                  setShowAddRelationship(true)
                }}
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500"
              >
                + Add Relationship
              </button>
            </div>
            <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
              {filteredAccounts.map((a: any) => (
                <button key={a.id} onClick={() => setSelectedAccountId(a.id)} className={`w-full text-left rounded-lg border p-3 ${selectedAccount?.id === a.id ? 'border-cyan-500/60 bg-cyan-900/20' : 'border-gray-800 bg-[var(--bg-secondary)] hover:border-cyan-700/40'}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-100">{a.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-gray-800 text-cyan-300">{a.type}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          startEditRelationship(a.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            startEditRelationship(a.id)
                          }
                        }}
                        className="text-[9px] px-2 py-0.5 rounded border border-cyan-700/50 bg-cyan-900/30 text-cyan-200 hover:bg-cyan-800/40"
                      >
                        Edit
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{a.contact} {a.city ? `• ${a.city}` : ''}</div>
                  <div className="mt-2 grid grid-cols-5 gap-2 text-[10px]">
                    <div><span className="text-gray-500">Revenue</span><div className="text-emerald-400 font-mono">{fmt(a.lifetimeRevenue)}</div></div>
                    <div><span className="text-gray-500">Outstanding</span><div className="text-orange-400 font-mono">{fmt(a.outstanding)}</div></div>
                    <div><span className="text-gray-500">Open Jobs</span><div className="text-cyan-400 font-mono">{a.activeJobs}</div></div>
                    <div><span className="text-gray-500">Total Jobs</span><div className="text-blue-300 font-mono">{num(a.totals?.projectCount || 0) + num(a.totals?.serviceLogCount || 0) + num(a.totals?.serviceEstimateCount || 0) + num(a.totals?.activeServiceCallCount || 0)}</div></div>
                    <div><span className="text-gray-500">Total Projects</span><div className="text-violet-300 font-mono">{num(a.totals?.projectCount || 0)}</div></div>
                  </div>
                </button>
              ))}
              {filteredAccounts.length === 0 && <div className="text-xs text-gray-500 p-3">No accounts found for current filter.</div>}
            </div>
          </div>

          <div className="xl:col-span-7 rounded-xl border border-gray-800 bg-[var(--bg-card)] p-2">
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold">Live Customer Map</div>
              <div className="flex gap-1">
                <button
                  onClick={() => setMapMode('selected')}
                  className={`text-[10px] px-2.5 py-1 rounded ${mapMode === 'selected' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                >
                  Selected Account
                </button>
                <button
                  onClick={() => setMapMode('all_jobs')}
                  className={`text-[10px] px-2.5 py-1 rounded ${mapMode === 'all_jobs' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                >
                  All Jobs
                </button>
              </div>
            </div>
            <div className="h-[560px] rounded-lg overflow-hidden border border-cyan-900/30">
              {!GOOGLE_MAPS_BROWSER_KEY ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-500 bg-gray-900">VITE_GOOGLE_MAPS_BROWSER_KEY missing.</div>
              ) : mapLoadError ? (
                <div className="h-full flex items-center justify-center text-xs text-red-400 bg-gray-900">Map failed to load.</div>
              ) : !mapLoaded ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-500 bg-gray-900">Loading map...</div>
              ) : (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={selectedAccount ? (clusteredPoints.find((c: any) => c.primaryAccountId === selectedAccount.id) || MAP_CENTER) : (clusteredPoints[0] || MAP_CENTER)}
                  zoom={10}
                  options={{
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    styles: [
                      { elementType: 'geometry', stylers: [{ color: '#111827' }] },
                      { elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
                      { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1220' }] },
                      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
                      { featureType: 'water', stylers: [{ color: '#0b1020' }] },
                      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
                    ],
                  }}
                >
                  {clusteredPoints.map((c: any) => (
                    <MarkerF
                      key={c.key}
                      position={{ lat: c.lat, lng: c.lng }}
                      label={c.count > 1 ? { text: String(c.count), color: '#fff', fontWeight: '700' } : undefined}
                      onClick={() => {
                        setActiveClusterKey(c.key)
                        const singlePoint = c.count === 1 ? (c.points?.[0] || null) : null
                        if (singlePoint) {
                          setSelectedClusterPointKey(String(singlePoint.pointKey || ''))
                          setSelectedMapPointKey(String(singlePoint.pointKey || ''))
                          if (singlePoint.accountId) setSelectedAccountId(String(singlePoint.accountId))
                        } else {
                          setSelectedClusterPointKey(null)
                          setSelectedMapPointKey(null)
                        }
                      }}
                      title={c.count === 1 ? String(c.points?.[0]?.title || c.points?.[0]?.displayTitle || c.points?.[0]?.kind || 'Record') : `${c.count} records at location`}
                      icon={{
                        path: 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z',
                        fillColor: c.count === 1 ? (c.points?.[0]?.pinColor || (c.gc ? '#22d3ee' : '#10b981')) : (c.gc ? '#22d3ee' : '#10b981'),
                        fillOpacity: 0.9,
                        strokeColor: '#ffffff',
                        strokeWeight: 1.5,
                        scale: 1.1,
                        anchor: (window as any).google?.maps ? new (window as any).google.maps.Point(0, 0) : undefined,
                      }}
                    />
                  ))}
                  {activeCluster && selectedActivePoint && (
                    <InfoWindowF
                      position={{ lat: selectedActivePoint.lat, lng: selectedActivePoint.lng }}
                      onCloseClick={() => {
                        setActiveClusterKey(null)
                        setSelectedClusterPointKey(null)
                        setSelectedMapPointKey(null)
                      }}
                    >
                      <div style={{ minWidth: 300, maxWidth: 360 }}>
                        <div style={{ border: '1px solid #1f2937', borderRadius: 8, padding: '8px 10px', background: 'rgba(2,6,23,0.85)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#e5e7eb' }}>{selectedActivePoint.accountName || 'Account'}</div>
                            <div style={{ fontSize: 11, color: '#22d3ee', fontWeight: 700 }}>
                              {selectedActivePoint.sequenceNumber ? `${selectedActivePoint.sequenceNumber} of ${selectedActivePoint.sequenceTotal || activeClusterPoints.length}` : '—'}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: '#e2e8f0', marginTop: 4 }}>{selectedActivePoint.displayTitle || selectedActivePoint.title || 'Untitled'}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{selectedActivePoint.entityType || selectedActivePoint.kind}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Type: {selectedActivePoint.jobType || '—'}</div>
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{selectedActivePoint.location || 'No address'}</div>
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Date: {selectedActivePoint.date || '—'}</div>
                          <div style={{ fontSize: 10, color: '#93c5fd', marginTop: 4 }}>Quoted: <strong>{fmt(num(selectedActivePoint.quoted || 0))}</strong></div>
                          <div style={{ fontSize: 10, color: '#86efac' }}>Collected: <strong>{fmt(num(selectedActivePoint.collected || 0))}</strong></div>
                          <div style={{ fontSize: 10, color: '#fdba74' }}>Outstanding: <strong>{fmt(num(selectedActivePoint.outstanding || 0))}</strong></div>
                          <div style={{ fontSize: 10, color: '#cbd5e1' }}>Status: <strong>{selectedActivePoint.status || '—'}</strong></div>
                          {selectedActivePoint.notes && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>{selectedActivePoint.notes}</div>}
                          <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>Source: {selectedActivePoint.sourceBucket || '—'}</div>
                        </div>
                      </div>
                    </InfoWindowF>
                  )}
                </GoogleMap>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold mb-2">Relationship Timeline</div>
            <div className="space-y-2 max-h-[220px] overflow-auto pr-1">
              {timelineEvents.map((ev: any, i: number) => (
                <button key={i} onClick={() => setSelectedAccountId(ev.accountId)} className="w-full text-left rounded bg-[var(--bg-secondary)] border border-gray-800 p-2 hover:border-cyan-700/40">
                  <div className="text-[10px] text-gray-500">{ev.date || '—'} • {ev.type}</div>
                  <div className="text-xs text-gray-200 mt-0.5">{ev.title || 'Untitled'}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{ev.location || 'No location'}</div>
                  <div className="text-[10px] mt-1 flex gap-3 flex-wrap">
                    <span className="text-gray-400">Quoted: <span className="text-blue-300 font-mono">{fmt(ev.quoted || 0)}</span></span>
                    <span className="text-gray-400">Collected: <span className="text-emerald-300 font-mono">{fmt(ev.collected || 0)}</span></span>
                    <span className="text-gray-400">Status: <span className="text-cyan-300">{ev.status || '—'}</span></span>
                  </div>
                  {ev.notes && <div className="text-[10px] text-gray-400 mt-0.5">{ev.notes}</div>}
                </button>
              ))}
              {timelineEvents.length === 0 && (
                <div className="text-xs text-gray-500">
                  {mapMode === 'all_jobs' ? 'No job/activity history found for currently displayed accounts.' : 'No interactions/jobs found for selected account.'}
                </div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold mb-2">Account Intelligence</div>
            {(selectedAccount && mapMode === 'selected') ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Projects</div><div className="text-gray-100 font-semibold">{selectedAccount.totals?.projectCount ?? selectedAccount.projects.length}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Service Calls</div><div className="text-gray-100 font-semibold">{(selectedAccount.totals?.serviceLogCount || 0) + (selectedAccount.totals?.activeServiceCallCount || 0)}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Quoted</div><div className="text-blue-300 font-semibold font-mono">{fmt(selectedAccount.totals?.totalQuoted || 0)}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Collected</div><div className="text-emerald-400 font-semibold font-mono">{fmt(selectedAccount.totals?.totalCollected || selectedAccount.lifetimeRevenue)}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Outstanding</div><div className="text-orange-400 font-semibold font-mono">{fmt(selectedAccount.totals?.outstanding || selectedAccount.outstanding)}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Repeat History</div><div className="text-cyan-400 font-semibold">{selectedAccount.totals?.repeatCount || selectedAccount.repeatCount}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Active/Open Jobs</div><div className="text-violet-300 font-semibold">{selectedAccount.totals?.activeJobs || selectedAccount.activeJobs}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Last Interaction</div><div className="text-gray-200 font-semibold">{selectedAccount.lastInteraction || '—'}</div></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Accounts</div><div className="text-gray-100 font-semibold">{mapScopedAccounts.length}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Jobs/Projects</div><div className="text-gray-100 font-semibold">{mapScopedAccounts.reduce((s: number, a: any) => s + num(a.totals?.projectCount || 0), 0)}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Service Calls</div><div className="text-gray-100 font-semibold">{mapScopedAccounts.reduce((s: number, a: any) => s + num(a.totals?.serviceLogCount || 0) + num(a.totals?.activeServiceCallCount || 0), 0)}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Quoted</div><div className="text-blue-300 font-semibold font-mono">{fmt(mapScopedAccounts.reduce((s: number, a: any) => s + num(a.totals?.totalQuoted || 0), 0))}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Total Collected</div><div className="text-emerald-400 font-semibold font-mono">{fmt(mapScopedAccounts.reduce((s: number, a: any) => s + num(a.totals?.totalCollected || 0), 0))}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Outstanding</div><div className="text-orange-400 font-semibold font-mono">{fmt(mapScopedAccounts.reduce((s: number, a: any) => s + num(a.totals?.outstanding || 0), 0))}</div></div>
                <div className="rounded bg-[var(--bg-secondary)] border border-gray-800 p-2"><div className="text-gray-500 text-[10px]">Repeat Customers</div><div className="text-cyan-300 font-semibold">{mapScopedAccounts.filter((a: any) => num(a.totals?.repeatCount || 0) > 1).length}</div></div>
              </div>
            )}
          </div>
        </div>

        {showAddRelationship && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-2xl rounded-xl border border-cyan-500/30 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-cyan-300">{editingRelationshipId ? 'Edit Relationship Account' : 'Add Relationship Account'}</div>
                <button onClick={closeRelationshipModal} className="text-gray-400 hover:text-gray-200">✕</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <input value={addRelForm.company} onChange={(e) => setAddRelForm((f: any) => ({ ...f, company: e.target.value }))} placeholder="Account / company name" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                <input value={addRelForm.contact} onChange={(e) => setAddRelForm((f: any) => ({ ...f, contact: e.target.value }))} placeholder="Contact name" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                <select value={addRelForm.role} onChange={(e) => setAddRelForm((f: any) => ({ ...f, role: e.target.value }))} className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-cyan-300">
                  {REL_ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={addRelForm.phone} onChange={(e) => setAddRelForm((f: any) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                <input value={addRelForm.email} onChange={(e) => setAddRelForm((f: any) => ({ ...f, email: e.target.value }))} placeholder="Email" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                <input value={addRelForm.address} onChange={(e) => setAddRelForm((f: any) => ({ ...f, address: e.target.value }))} placeholder="Primary address" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                <input value={addRelForm.city} onChange={(e) => setAddRelForm((f: any) => ({ ...f, city: e.target.value }))} placeholder="City" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                <input value={addRelForm.tags} onChange={(e) => setAddRelForm((f: any) => ({ ...f, tags: e.target.value }))} placeholder="Tags / relationship notes" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                <textarea value={addRelForm.notes} onChange={(e) => setAddRelForm((f: any) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="md:col-span-2 px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200 h-24" />
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={closeRelationshipModal} className="px-3 py-2 rounded bg-gray-800 text-gray-300 text-xs">Cancel</button>
                <button onClick={saveRelationshipAccount} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold">{editingRelationshipId ? 'Save Changes' : 'Save Relationship'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Render GC Table ────────────────────────────────────────────────────

  function renderGCTable() {
    // ── Pipeline summary calculations ──
    const todayStr = today()
    const totalLeads = gcContacts.length
    const scoredContacts = gcContacts.map(c => ({ ...c, _score: calcLeadScore(c) }))
    const hotLeads = scoredContacts.filter(c => c._score >= 80)
    const hotAvgJob = hotLeads.length > 0
      ? hotLeads.reduce((s, c) => s + num(c.avg || 0), 0) / hotLeads.length
      : 0
    const overdueFollowups = gcContacts.filter(c => c.nextFollowup && c.nextFollowup < todayStr)
    const fitFactors: Record<number, number> = { 5: 1.0, 4: 0.8, 3: 0.6, 2: 0.4, 1: 0.2, 0: 0 }
    const pipelineValue = gcContacts.reduce((s, c) => {
      const ff = fitFactors[Math.min(5, Math.max(0, Math.round(num(c.fit || 0))))] || 0
      return s + num(c.avg || 0) * ff
    }, 0)

    // ── Sort: overdue first (most overdue first), then by score desc ──
    const sortedContacts = [...scoredContacts].sort((a, b) => {
      const aOv = a.nextFollowup && a.nextFollowup < todayStr
      const bOv = b.nextFollowup && b.nextFollowup < todayStr
      if (aOv && !bOv) return -1
      if (!aOv && bOv) return 1
      if (aOv && bOv) {
        // most overdue (earlier date) first
        return (a.nextFollowup || '').localeCompare(b.nextFollowup || '')
      }
      return b._score - a._score
    })

    return (
      <div>
        {/* ── Pipeline Summary Card ── */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-[var(--bg-card)] rounded-lg p-2.5 border border-gray-800">
            <div className="text-[8px] uppercase text-gray-500 font-bold">Total Leads</div>
            <div className="text-sm font-bold font-mono mt-1 text-gray-200">{totalLeads}</div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-lg p-2.5 border border-gray-800">
            <div className="text-[8px] uppercase text-gray-500 font-bold">Hot Leads (80+)</div>
            <div className="text-sm font-bold font-mono mt-1 text-emerald-400">{hotLeads.length}</div>
            {hotLeads.length > 0 && (
              <div className="text-[9px] text-gray-500 mt-0.5">Avg {fmtK(hotAvgJob)}</div>
            )}
          </div>
          <div className="bg-[var(--bg-card)] rounded-lg p-2.5 border border-gray-800">
            <div className="text-[8px] uppercase text-gray-500 font-bold">Overdue Follow-ups</div>
            <div className={`text-sm font-bold font-mono mt-1 ${overdueFollowups.length > 0 ? 'text-red-400' : 'text-gray-400'}`}>
              {overdueFollowups.length}
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-lg p-2.5 border border-gray-800">
            <div className="text-[8px] uppercase text-gray-500 font-bold">Est. Pipeline Value</div>
            <div className="text-sm font-bold font-mono mt-1 text-blue-400">{fmtK(pipelineValue)}</div>
          </div>
        </div>

        <div className="flex justify-end mb-3">
          <button onClick={addGC} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">
            <Plus size={12} /> Add GC
          </button>
        </div>
        {gcContacts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-700">
                  <th className="text-left py-2 px-2 font-bold">Company / Contact</th>
                  <th className="text-left py-2 px-2 font-bold">Role</th>
                  <th className="text-left py-2 px-2 font-bold">Phone</th>
                  <th className="text-right py-2 px-2 font-bold">Sent</th>
                  <th className="text-right py-2 px-2 font-bold">Awarded</th>
                  <th className="text-right py-2 px-2 font-bold">Avg Job</th>
                  <th className="text-left py-2 px-2 font-bold">Pay</th>
                  <th className="text-left py-2 px-2 font-bold">Phase</th>
                  <th className="text-right py-2 px-2 font-bold">Fit</th>
                  <th className="text-left py-2 px-2 font-bold">Action / Due</th>
                  <th className="text-center py-2 px-2 font-bold">Score</th>
                  <th className="text-left py-2 px-2 font-bold">Next Follow-up</th>
                  <th className="text-center py-2 px-2 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedContacts.map(c => {
                  const phaseClr = PHASE_COLORS[c.phase] || '#6b7280'
                  const fitClr = c.fit >= 4 ? '#10b981' : c.fit >= 3 ? '#f59e0b' : '#ef4444'
                  const isOverdue = c.due && c.due < todayStr
                  const isFollowupOverdue = c.nextFollowup && c.nextFollowup < todayStr
                  const isExpanded = expandedGCId === c.id
                  const agg = getGCAggregation(c, backup)
                  const score = c._score

                  return (
                    <tbody key={c.id}>
                      <tr className={`border-b border-gray-800/50 hover:bg-gray-700/20 ${isFollowupOverdue ? 'bg-red-900/10' : ''}`}>
                        <td className="py-2 px-2">
                          <div className="font-semibold text-gray-200">{c.company}</div>
                          <div className="text-gray-500">{c.contact}</div>
                          {c.lastContact && (
                            <span className="text-[9px] text-gray-500">Last: {c.lastContact}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-gray-400">{c.role}</td>
                        <td className="py-2 px-2 text-gray-400">{c.phone}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-300">{agg.sent}</td>
                        <td className="py-2 px-2 text-right font-mono text-emerald-400">{agg.awarded}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-300">{fmtK(agg.avg)}</td>
                        <td className="py-2 px-2 text-gray-400">{(c.pay || '').split('(')[0]}</td>
                        <td className="py-2 px-2">
                          <span className="text-[9px] px-2 py-0.5 rounded font-semibold" style={{ background: phaseClr + '22', color: phaseClr }}>
                            {c.phase}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-bold" style={{ color: fitClr }}>{c.fit}</td>
                        <td className="py-2 px-2">
                          <div className="text-gray-300">{c.action}</div>
                          {c.due && (
                            <div className={`text-[9px] ${isOverdue ? 'text-red-400 font-bold' : 'text-gray-500'}`}>
                              {isOverdue && <span className="bg-red-600 text-white px-1 rounded text-[8px] mr-1">{Math.ceil((new Date(c.due).getTime() - new Date(todayStr).getTime()) / (1000*60*60*24))} days</span>}
                              {c.due}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">{getScoreBadge(score)}</td>
                        <td className="py-2 px-2">
                          {c.nextFollowup ? (
                            <div className={`text-[9px] font-mono ${isFollowupOverdue ? 'text-red-400 font-bold' : 'text-gray-400'}`}>
                              {isFollowupOverdue && <span className="bg-red-600 text-white px-1 rounded text-[8px] mr-1">OVERDUE</span>}
                              {c.nextFollowup}
                            </div>
                          ) : (
                            <span className="text-[9px] text-gray-600">—</span>
                          )}
                          <button
                            onClick={() => markContacted(c.id)}
                            className="mt-0.5 text-[8px] px-1.5 py-0.5 rounded bg-cyan-700/40 text-cyan-300 hover:bg-cyan-700/60 block"
                          >
                            ✓ Mark Contacted
                          </button>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex gap-1 justify-center flex-wrap">
                            {c.phase === 'Awarded' && !c.convertedProjectId && (
                              <button onClick={() => convertGCToProject(c)} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-700/50 text-emerald-300 hover:text-emerald-200 font-semibold" title="Convert to Project">→Proj</button>
                            )}
                            {c.convertedProjectId && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Converted</span>
                            )}
                            <button
                              onClick={() => handleAIScript(c)}
                              disabled={aiScriptLoading && aiScriptContactId === c.id}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-purple-700/50 text-purple-300 hover:text-purple-200 disabled:opacity-50"
                            >
                              {aiScriptLoading && aiScriptContactId === c.id ? '…' : '🤖'}
                            </button>
                            <button onClick={() => editGC(c.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300">✎</button>
                            <button onClick={() => deleteGC(c.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300">✕</button>
                            <button onClick={() => setExpandedGCId(isExpanded ? null : c.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded row: Contact Log + Quick Log Form + Next Best Action */}
                      {isExpanded && (
                        <tr className="border-b border-gray-800/50 bg-gray-800/30">
                          <td colSpan={13} className="py-3 px-4">
                            <div className="space-y-4">
                              {/* Next Best Action AI Chip */}
                              <div className="flex gap-2">
                                <button onClick={() => alert('AI: Analyze - NEXUS will recommend next best action')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-600/30 text-cyan-300 text-xs font-semibold hover:bg-cyan-600/40">
                                  🤖 Next Best Action
                                </button>
                              </div>

                              {/* Contact Log Timeline */}
                              <div className="mt-3 space-y-2">
                                <div className="flex justify-between items-center">
                                  <h5 className="text-xs font-medium text-gray-400">Contact Log</h5>
                                  <button
                                    onClick={() => {
                                      setLoggingContactId(c.id)
                                      setLogType('Call')
                                      setLogNotes('')
                                    }}
                                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                                  >
                                    <Plus className="w-3 h-3" /> Log Interaction
                                  </button>
                                </div>

                                {/* Add interaction form */}
                                {loggingContactId === c.id && (
                                  <div className="p-3 bg-gray-900/50 border border-gray-700/50 rounded-lg space-y-2">
                                    <select
                                      value={logType}
                                      onChange={(e) => setLogType(e.target.value)}
                                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs"
                                    >
                                      <option>Call</option>
                                      <option>Email</option>
                                      <option>Meeting</option>
                                      <option>Site Visit</option>
                                      <option>Bid Submitted</option>
                                    </select>
                                    <textarea
                                      value={logNotes}
                                      onChange={(e) => setLogNotes(e.target.value)}
                                      placeholder="Notes..."
                                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs h-16"
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => {
                                          const logEntry = {
                                            id: `cl_${Date.now()}`,
                                            date: new Date().toISOString().slice(0, 10),
                                            type: logType,
                                            notes: logNotes,
                                          }
                                          const updatedContacts = (backup.gcContacts || []).map(gc =>
                                            gc.id === c.id
                                              ? { ...gc, contactLog: [...(gc.contactLog || []), logEntry], lastContact: logEntry.date }
                                              : gc
                                          )
                                          saveBackupData({ ...backup, gcContacts: updatedContacts })
                                          setLoggingContactId(null)
                                          forceUpdate()
                                        }}
                                        className="px-3 py-1 bg-cyan-600/20 text-cyan-400 rounded text-xs"
                                      >
                                        Save
                                      </button>
                                      <button onClick={() => setLoggingContactId(null)} className="px-3 py-1 bg-gray-700 text-gray-400 rounded text-xs">Cancel</button>
                                    </div>
                                  </div>
                                )}

                                {/* Log entries */}
                                {(c.contactLog || []).slice().reverse().map((log: any) => (
                                  <div key={log.id || log.date} className="flex items-start gap-2 pl-3 border-l-2 border-gray-700">
                                    <div>
                                      <span className="text-xs text-gray-300">{log.date}</span>
                                      <span className="text-xs text-cyan-400 ml-2">{log.type}</span>
                                      {log.notes && <p className="text-xs text-gray-400 mt-0.5">{log.notes}</p>}
                                    </div>
                                  </div>
                                ))}

                                {(c.contactLog || []).length === 0 && (
                                  <p className="text-gray-600 text-xs">No interactions logged yet</p>
                                )}
                              </div>

                              {/* Quick Log Contact Form */}
                              {openLogFormId === c.id ? (
                                <div className="bg-[var(--bg-secondary)] rounded p-3 border border-gray-700 space-y-2">
                                  <div className="text-xs font-bold text-gray-400">Quick Log Contact</div>
                                  <select
                                    value={logFormData.method}
                                    onChange={(e) => setLogFormData({...logFormData, method: e.target.value})}
                                    className="w-full text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-100 border border-gray-700"
                                  >
                                    <option>Call</option>
                                    <option>Text</option>
                                    <option>Email</option>
                                  </select>
                                  <textarea
                                    placeholder="Notes (optional)"
                                    value={logFormData.notes}
                                    onChange={(e) => setLogFormData({...logFormData, notes: e.target.value})}
                                    className="w-full text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-100 border border-gray-700 h-12"
                                  />
                                  <div className="flex gap-1">
                                    <button onClick={() => addContactLog(c.id)} className="flex-1 px-2 py-1 bg-emerald-600 text-white text-xs rounded font-semibold hover:bg-emerald-700">Save</button>
                                    <button onClick={() => setOpenLogFormId(null)} className="flex-1 px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded font-semibold hover:bg-gray-600">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => setOpenLogFormId(c.id)} className="px-3 py-1.5 bg-blue-600/30 text-blue-300 text-xs rounded font-semibold hover:bg-blue-600/40">
                                  + Quick Log Contact
                                </button>
                              )}

                              {/* Linked Jobs Section */}
                              <div className="bg-[var(--bg-secondary)] rounded p-3 border border-gray-700 space-y-3">
                                <div className="text-xs font-bold text-gray-400">Linked Jobs</div>

                                {/* Linked Service Leads */}
                                {agg.linkedLeads.length > 0 && (
                                  <div>
                                    <div className="text-[9px] font-semibold text-gray-500 mb-2">Service Leads ({agg.linkedLeads.length})</div>
                                    <div className="space-y-1.5">
                                      {agg.linkedLeads.map((lead: any) => {
                                        const statusClr = SVC_STATUS_COLORS[lead.status] || '#6b7280'
                                        return (
                                          <div key={lead.id} className="bg-[var(--bg-card)] rounded p-2 border border-gray-800 text-[9px] space-y-1">
                                            <div className="flex justify-between">
                                              <span className="text-gray-400">{lead.date}</span>
                                              <span className="text-gray-500">{lead.customer}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                              <span className="text-gray-400">{lead.type || '—'}</span>
                                              <span className="text-[8px] px-1.5 py-0.5 rounded font-semibold" style={{ background: statusClr + '22', color: statusClr }}>
                                                {lead.status}
                                              </span>
                                            </div>
                                            {lead.price > 0 && <div className="text-gray-400">Price: {fmtK(lead.price)}</div>}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Linked Service Logs */}
                                {agg.linkedLogs.length > 0 && (
                                  <div>
                                    <div className="text-[9px] font-semibold text-gray-500 mb-2">Service Logs ({agg.linkedLogs.length})</div>
                                    <div className="space-y-1.5">
                                      {agg.linkedLogs.map((log: any) => (
                                        <div key={log.id} className="bg-[var(--bg-card)] rounded p-2 border border-gray-800 text-[9px] space-y-1">
                                          <div className="flex justify-between">
                                            <span className="text-gray-400">{log.date}</span>
                                            <span className="text-gray-500">{resolveRecordCustomerName(log, gcContacts) || log.customer}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-gray-400">{log.jtype || '—'}</span>
                                            <span className="text-gray-400">{log.payStatus || '—'}</span>
                                          </div>
                                          <div className="flex justify-between text-gray-400">
                                            <span>Quoted: {fmtK(log.quoted || 0)}</span>
                                            <span>Collected: {fmtK(log.collected || 0)}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {agg.linkedLeads.length === 0 && agg.linkedLogs.length === 0 && (
                                  <div className="text-xs text-gray-500">No linked service jobs found</div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* AI Script response row — tabbed 3-variant UI */}
                      {aiScriptContactId === c.id && (aiScriptLoading || aiScriptText) && (
                        <tr>
                          <td colSpan={13} className="p-0">
                            <div className="mx-4 my-2 p-3 bg-purple-900/20 border border-purple-500/30 rounded-lg">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-bold text-purple-400 uppercase">AI Script — {c.company}</span>
                                <button onClick={() => { setAiScriptContactId(null); setAiScriptText(''); setAiScriptVariants(null) }} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
                              </div>
                              {aiScriptLoading ? (
                                <div className="text-xs text-gray-400 animate-pulse">Generating 3 script variations…</div>
                              ) : aiScriptVariants ? (
                                <div>
                                  {/* Tab switcher */}
                                  <div className="flex gap-1 mb-3">
                                    {([
                                      { key: 'cold', label: '📞 Cold Call', icon: 'cold' },
                                      { key: 'voicemail', label: '🎙 Voicemail', icon: 'voicemail' },
                                      { key: 'email', label: '✉ Email', icon: 'email' },
                                    ] as const).map(({ key, label }) => (
                                      <button
                                        key={key}
                                        onClick={() => setAiScriptTab(key)}
                                        className={`text-[10px] px-3 py-1 rounded font-semibold transition-colors ${aiScriptTab === key ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                  {/* Tab content */}
                                  <div className="relative">
                                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-900/50 rounded p-3 pr-10 min-h-[60px]">
                                      {aiScriptVariants[aiScriptTab] || '(No content for this variation)'}
                                    </pre>
                                    <button
                                      onClick={() => {
                                        const txt = aiScriptVariants[aiScriptTab]
                                        if (txt) navigator.clipboard?.writeText(txt).catch(() => {})
                                      }}
                                      className="absolute top-2 right-2 p-1 rounded bg-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-600"
                                      title="Copy to clipboard"
                                    >
                                      <Copy size={11} />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{aiScriptText}</pre>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-gray-500">No GC contacts yet.</div>
        )}
      </div>
    )
  }

  // ── Render Service Leads Table ─────────────────────────────────────────

  function renderSvcTable() {
    return (
      <div>
        <div className="flex justify-end mb-3">
          <button onClick={addSvcLead} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold">
            <Plus size={12} /> Add Lead
          </button>
        </div>
        {serviceLeads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-700">
                  <th className="text-left py-2 px-2 font-bold">Date</th>
                  <th className="text-left py-2 px-2 font-bold">Customer</th>
                  <th className="text-left py-2 px-2 font-bold">Type</th>
                  <th className="text-left py-2 px-2 font-bold">Source</th>
                  <th className="text-right py-2 px-2 font-bold">Miles</th>
                  <th className="text-left py-2 px-2 font-bold">Urgency</th>
                  <th className="text-left py-2 px-2 font-bold">Status</th>
                  <th className="text-right py-2 px-2 font-bold">Price</th>
                  <th className="text-left py-2 px-2 font-bold">Follow-up</th>
                  <th className="text-center py-2 px-2 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {serviceLeads.map((l: any) => {
                  const statusClr = SVC_STATUS_COLORS[l.status] || '#6b7280'
                  const urgClr = l.urgency === 'Emergency' ? '#ef4444' : l.urgency === 'This Week' ? '#f59e0b' : '#6b7280'
                  const isOverdue = l.followup && l.followup < today()

                  return (
                    <tr key={l.id} className={`border-b border-gray-800/50 hover:bg-gray-700/20 ${isOverdue ? 'bg-red-900/10' : ''}`}>
                      <td className="py-2 px-2 text-gray-500 font-mono">{l.date}</td>
                      <td className="py-2 px-2 text-gray-200 font-medium">{resolveRecordCustomerName(l, gcContacts) || l.customer}</td>
                      <td className="py-2 px-2 text-gray-400">{l.type}</td>
                      <td className="py-2 px-2 text-gray-500">{l.source}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">{l.miles}mi</td>
                      <td className="py-2 px-2">
                        <span style={{ color: urgClr }}>{l.urgency || '—'}</span>
                      </td>
                      <td className="py-2 px-2">
                        <span className="text-[9px] px-2 py-0.5 rounded font-semibold cursor-pointer" style={{ background: statusClr + '22', color: statusClr }} onClick={() => cycleSvcStatus(l.id)}>
                          {l.status}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">{l.price ? fmtK(l.price) : '—'}</td>
                      <td className="py-2 px-2">
                        <span className={isOverdue ? 'text-red-400 font-bold' : 'text-gray-500'}>
                          {l.followup || '—'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex gap-1 justify-center">
                          {l.status === 'Booked' && !l.convertedProjectId && (
                            <button onClick={() => convertSvcLeadToProject(l)} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-700/50 text-emerald-300 hover:text-emerald-200 font-semibold" title="Convert to Project">→Proj</button>
                          )}
                          {l.convertedProjectId && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Converted</span>
                          )}
                          <button onClick={() => cycleSvcStatus(l.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300">↻</button>
                          <button onClick={() => deleteSvcLead(l.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300">✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-gray-500">No service leads yet.</div>
        )}
      </div>
    )
  }

  // ── Render Weekly Reviews Table ────────────────────────────────────────

  function renderWeeklyTable() {
    // Summary stats (last 4 reviews)
    const last4 = weeklyReviews.slice(-4)
    const avg4Leads = last4.length > 0 ? last4.reduce((s: number, w: any) => s + num(w.total), 0) / last4.length : 0
    const avg4Advance = last4.length > 0 ? last4.reduce((s: number, w: any) => s + num(w.advance), 0) / last4.length : 0
    const convRate = avg4Leads > 0 ? ((avg4Advance / avg4Leads) * 100).toFixed(0) : '0'

    return (
      <div>
        {/* Summary KPIs */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { lbl: '4-Wk Avg Leads', val: avg4Leads.toFixed(1) },
            { lbl: '4-Wk Avg Advance', val: avg4Advance.toFixed(1), clr: '#10b981' },
            { lbl: 'Conversion Rate', val: convRate + '%', clr: Number(convRate) >= 30 ? '#10b981' : '#f59e0b' },
            { lbl: 'Total Reviews', val: String(weeklyReviews.length) },
          ].map((k, i) => (
            <div key={i} className="bg-[var(--bg-card)] rounded-lg p-2.5 border border-gray-800">
              <div className="text-[8px] uppercase text-gray-500 font-bold">{k.lbl}</div>
              <div className="text-sm font-bold font-mono mt-1" style={{ color: k.clr || '#e5e7eb' }}>{k.val}</div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mb-3">
          <button onClick={addWeeklyReview} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">
            <Plus size={12} /> Add Review
          </button>
        </div>

        {weeklyReviews.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-700">
                  <th className="text-left py-2 px-2 font-bold">Date</th>
                  <th className="text-right py-2 px-2 font-bold">Total</th>
                  <th className="text-right py-2 px-2 font-bold">Advance</th>
                  <th className="text-right py-2 px-2 font-bold">Park</th>
                  <th className="text-right py-2 px-2 font-bold">Kill</th>
                  <th className="text-right py-2 px-2 font-bold">Service ($)</th>
                  <th className="text-right py-2 px-2 font-bold">Projects ($)</th>
                  <th className="text-left py-2 px-2 font-bold">Notes</th>
                  <th className="text-center py-2 px-2 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {weeklyReviews.map((w: any) => (
                  <tr key={w.id} className="border-b border-gray-800/50 hover:bg-gray-700/20">
                    <td className="py-2 px-2 text-gray-500 font-mono">{w.date}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{w.total}</td>
                    <td className="py-2 px-2 text-right font-mono text-emerald-400">{w.advance}</td>
                    <td className="py-2 px-2 text-right font-mono text-yellow-400">{w.park}</td>
                    <td className="py-2 px-2 text-right font-mono text-red-400">{w.kill}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{fmt(w.svc)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{fmt(w.proj)}</td>
                    <td className="py-2 px-2 text-gray-500 max-w-[200px] truncate">{w.notes || '—'}</td>
                    <td className="py-2 px-2 text-center">
                      <button onClick={() => deleteWeeklyReview(w.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-gray-500">No weekly reviews yet.</div>
        )}
      </div>
    )
  }

  // ── Generate AI insights ────────────────────────────────────────────────

  const generateLeadsInsights = (): Insight[] => {
    const insights: Insight[] = []

    // Flag contacts with no activity in 30+ days
    const staleContacts = gcContacts.filter(gc => {
      const daysSinceContact = daysSince(gc.lastContactDate || '1970-01-01')
      return daysSinceContact >= 30
    })
    if (staleContacts.length > 0) {
      insights.push({
        icon: '⚠️',
        text: `${staleContacts.length} GC contact(s) dormant 30+ days. Reach out to stay warm.`,
        severity: 'warning',
      })
    }

    // Suggest next actions based on phase
    const awaitingBid = gcContacts.filter(gc => gc.phase === 'Active Bidding').length
    const qualified = gcContacts.filter(gc => gc.phase === 'Qualified').length
    if (awaitingBid > 0) {
      insights.push({
        icon: 'ℹ️',
        text: `${awaitingBid} bid(s) pending. Follow up if no response in 7 days.`,
        severity: 'info',
      })
    }
    if (qualified > 0) {
      insights.push({
        icon: 'ℹ️',
        text: `${qualified} contact(s) qualified. Push toward contract or set follow-up reminder.`,
        severity: 'info',
      })
    }

    // Highlight high-fit contacts not engaged
    const prospecting = gcContacts.filter(gc => gc.phase === 'Prospecting' && daysSince(gc.lastContactDate || '1970-01-01') > 7)
    if (prospecting.length > 0) {
      insights.push({
        icon: 'ℹ️',
        text: `${prospecting.length} prospective contact(s) ready for outreach.`,
        severity: 'info',
      })
    }

    if (insights.length === 0) {
      insights.push({
        icon: '✓',
        text: 'Leads and contacts engagement looks good.',
        severity: 'success',
      })
    }

    return insights
  }

  // ── Main return ────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} className="min-h-screen bg-[var(--bg-secondary)] p-6">
      {/* Tab switcher */}
      <div className="flex gap-2 mb-6 items-center">
        {[
          { key: 'gc' as const, label: 'GC / Relations' },
          { key: 'svc' as const, label: 'Service Pipeline' },
          { key: 'weekly' as const, label: 'Weekly Review' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={tabStyle(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto">
          <AskAIButton onClick={() => setAiOpen(true)} />
        </div>
      </div>

      {activeTab === 'gc' && renderAccountsCenter()}
      {activeTab === 'svc' && renderSvcTable()}
      {activeTab === 'weekly' && renderWeeklyTable()}

      <AskAIPanel
        panelName="Leads"
        insights={generateLeadsInsights()}
        dataContext={{
          gcContactCount: gcContacts.length,
          gcContacts: gcContacts.slice(0, 20).map(c => ({
            company: c.company, contact: c.contact, status: c.status,
            lastContact: c.lastContact, nextFollowUp: c.nextFollowUp,
          })),
          serviceLeadCount: serviceLeads.length,
          serviceLeads: serviceLeads.slice(0, 20).map(l => ({
            name: l.name, source: l.source, status: l.status,
            lastContact: l.lastContact, value: l.value,
          })),
          weeklyReviewCount: weeklyReviews.length,
        }}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}




