// @ts-nocheck
/**
 * SparkPanel — Phase E Full Automation UI
 *
 * Three-tab layout:
 *   Reviews  — Google Business reviews with AI draft response + MiroFish approval
 *   Leads    — Kanban columns (New | Contacted | Quoted | Won | Lost) + Add Lead
 *   Campaigns — Email campaign list + New Campaign creation → MiroFish send flow
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Star, MessageSquare, Plus, Send, ChevronRight, Loader2,
  RefreshCw, User, Phone, Mail, Tag, Calendar, AlertCircle,
  CheckCircle2, Clock, XCircle, Zap
} from 'lucide-react'
import clsx from 'clsx'
import {
  getReviews,
  draftReviewResponse,
  createLead,
  getLeads,
  scheduleFollowUp,
  updateLeadStatus,
  createCampaign,
  SparkReview,
  SparkLead,
  LeadStatus,
  SparkCampaign,
} from '@/services/sparkService'
import { processSparkRequest } from '@/agents/spark'
import { useAuth } from '@/hooks/useAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'reviews' | 'leads' | 'campaigns'

// ── Star rating display ───────────────────────────────────────────────────────

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={13}
          className={n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-zinc-600'}
        />
      ))}
    </span>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<LeadStatus, string> = {
  new:       'bg-blue-500/15 text-blue-400 border-blue-500/30',
  contacted: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  quoted:    'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  won:       'bg-green-500/15 text-green-400 border-green-500/30',
  lost:      'bg-red-500/15 text-red-400 border-red-500/30',
}

const SOURCE_COLORS: Record<string, string> = {
  google:   'bg-blue-400/10 text-blue-300',
  website:  'bg-cyan-400/10 text-cyan-300',
  referral: 'bg-green-400/10 text-green-300',
  manual:   'bg-zinc-400/10 text-zinc-300',
  ad:       'bg-orange-400/10 text-orange-300',
}

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded border font-medium', STATUS_COLORS[status])}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ── LEAD KANBAN COLUMNS ───────────────────────────────────────────────────────

const COLUMNS: { key: LeadStatus; label: string }[] = [
  { key: 'new',       label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'quoted',    label: 'Quoted' },
  { key: 'won',       label: 'Won' },
  { key: 'lost',      label: 'Lost' },
]

// ── ADD LEAD FORM ─────────────────────────────────────────────────────────────

function AddLeadForm({ onCreated, onCancel }: { onCreated: (lead: SparkLead) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name:              '',
    phone:             '',
    email:             '',
    source:            'manual' as SparkLead['source'],
    service_requested: '',
    notes:             '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    const lead = await createLead({ ...form })
    setSaving(false)
    if (lead) {
      onCreated(lead)
    } else {
      setError('Failed to create lead — check console')
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3"
    >
      <h3 className="text-sm font-semibold text-white">New Lead</h3>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle size={13} /> {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Name *</label>
          <input
            className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            placeholder="Customer name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Phone</label>
          <input
            className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            placeholder="(760) 555-0000"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Email</label>
          <input
            type="email"
            className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            placeholder="customer@email.com"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Source</label>
          <select
            className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            value={form.source}
            onChange={e => setForm(f => ({ ...f, source: e.target.value as any }))}
          >
            <option value="manual">Manual</option>
            <option value="google">Google</option>
            <option value="website">Website</option>
            <option value="referral">Referral</option>
            <option value="ad">Ad</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400 mb-1 block">Service Requested</label>
          <input
            className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            placeholder="Panel upgrade, EV charger, etc."
            value={form.service_requested}
            onChange={e => setForm(f => ({ ...f, service_requested: e.target.value }))}
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400 mb-1 block">Notes</label>
          <textarea
            className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
            rows={2}
            placeholder="Any additional notes…"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {saving ? 'Saving…' : 'Add Lead'}
        </button>
      </div>
    </form>
  )
}

// ── REVIEWS TAB ───────────────────────────────────────────────────────────────

function ReviewsTab({ orgId }: { orgId: string }) {
  const [reviews,    setReviews]    = useState<SparkReview[]>([])
  const [loading,    setLoading]    = useState(true)
  const [drafting,   setDrafting]   = useState<Record<string, boolean>>({})
  const [drafts,     setDrafts]     = useState<Record<string, string>>({})
  const [submitted,  setSubmitted]  = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getReviews()
    setReviews(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleDraft = async (review: SparkReview) => {
    if (!review.comment) return
    setDrafting(d => ({ ...d, [review.reviewId]: true }))
    const text = await draftReviewResponse(review.comment)
    setDrafts(d => ({ ...d, [review.reviewId]: text }))
    setDrafting(d => ({ ...d, [review.reviewId]: false }))
  }

  const handleSubmitApproval = async (review: SparkReview) => {
    const draft = drafts[review.reviewId]
    if (!draft) return
    setSubmitting(s => ({ ...s, [review.reviewId]: true }))
    // Route through SPARK agent → MiroFish proposal
    await processSparkRequest({
      action: 'draft_response' as any,
      orgId,
      userId: 'christian',
      params: { reviewText: review.comment, reviewId: review.reviewId },
    })
    setSubmitted(s => ({ ...s, [review.reviewId]: true }))
    setSubmitting(s => ({ ...s, [review.reviewId]: false }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
        <span className="ml-2 text-sm text-zinc-500">Loading reviews…</span>
      </div>
    )
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <Star size={32} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No reviews found — check GOOGLE_BUSINESS_API_KEY</p>
        <button onClick={load} className="mt-3 text-xs text-blue-400 hover:text-blue-300">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{reviews.length} recent reviews</p>
        <button
          onClick={load}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {reviews.map(review => (
        <div
          key={review.reviewId}
          className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{review.reviewer.displayName}</span>
                <Stars rating={review.starRating} />
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                {new Date(review.createTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            {review.reviewReply && (
              <span className="flex items-center gap-1 text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">
                <CheckCircle2 size={11} /> Responded
              </span>
            )}
          </div>

          {/* Review text */}
          <p className="text-sm text-zinc-300 leading-relaxed">{review.comment || '(No text)'}</p>

          {/* Existing reply */}
          {review.reviewReply && (
            <div className="bg-zinc-900/60 rounded-lg p-3 border border-zinc-700/50">
              <p className="text-xs text-zinc-500 mb-1">Your response:</p>
              <p className="text-xs text-zinc-300">{review.reviewReply.comment}</p>
            </div>
          )}

          {/* Draft area */}
          {!review.reviewReply && (
            <div className="space-y-2">
              {drafts[review.reviewId] ? (
                <>
                  <label className="text-xs text-zinc-400">Drafted response (edit if needed):</label>
                  <textarea
                    className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                    rows={3}
                    value={drafts[review.reviewId]}
                    onChange={e => setDrafts(d => ({ ...d, [review.reviewId]: e.target.value }))}
                  />
                  {submitted[review.reviewId] ? (
                    <p className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Sent to MiroFish — awaiting your approval in the Proposal Queue
                    </p>
                  ) : (
                    <button
                      onClick={() => handleSubmitApproval(review)}
                      disabled={submitting[review.reviewId]}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium transition-colors disabled:opacity-50"
                    >
                      {submitting[review.reviewId]
                        ? <><Loader2 size={12} className="animate-spin" /> Submitting…</>
                        : <><Send size={12} /> Submit for Approval</>
                      }
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => handleDraft(review)}
                  disabled={drafting[review.reviewId] || !review.comment}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white transition-colors disabled:opacity-40"
                >
                  {drafting[review.reviewId]
                    ? <><Loader2 size={12} className="animate-spin" /> Drafting…</>
                    : <><Zap size={12} /> Draft Response</>
                  }
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── LEADS TAB ─────────────────────────────────────────────────────────────────

function LeadsTab({ orgId }: { orgId: string }) {
  const [leads,      setLeads]      = useState<SparkLead[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [moving,     setMoving]     = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getLeads()
    setLeads(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (lead: SparkLead, newStatus: LeadStatus) => {
    if (lead.status === newStatus) return
    setMoving(m => ({ ...m, [lead.id!]: true }))
    const updated = await updateLeadStatus(lead.id!, newStatus)
    setMoving(m => ({ ...m, [lead.id!]: false }))
    if (updated) {
      setLeads(ls => ls.map(l => l.id === lead.id ? updated : l))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
        <span className="ml-2 text-sm text-zinc-500">Loading leads…</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Add Lead button */}
      <div className="flex justify-between items-center">
        <p className="text-xs text-zinc-500">{leads.length} total leads</p>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
        >
          <Plus size={12} />
          {showAdd ? 'Cancel' : 'Add Lead'}
        </button>
      </div>

      {showAdd && (
        <AddLeadForm
          onCreated={lead => { setLeads(ls => [lead, ...ls]); setShowAdd(false) }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Kanban columns */}
      <div className="grid grid-cols-5 gap-3">
        {COLUMNS.map(col => {
          const colLeads = leads.filter(l => l.status === col.key)
          return (
            <div key={col.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={clsx('text-xs font-medium px-2 py-0.5 rounded border', STATUS_COLORS[col.key])}>
                  {col.label}
                </span>
                <span className="text-xs text-zinc-500">{colLeads.length}</span>
              </div>
              <div className="space-y-2 min-h-16">
                {colLeads.map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    isMoving={!!moving[lead.id!]}
                    onStatusChange={handleStatusChange}
                  />
                ))}
                {colLeads.length === 0 && (
                  <div className="h-12 border border-dashed border-zinc-700 rounded-lg" />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LeadCard({
  lead,
  isMoving,
  onStatusChange,
}: {
  lead: SparkLead
  isMoving: boolean
  onStatusChange: (lead: SparkLead, status: LeadStatus) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const statusOrder: LeadStatus[] = ['new', 'contacted', 'quoted', 'won', 'lost']
  const currentIdx = statusOrder.indexOf(lead.status)

  return (
    <div
      className={clsx(
        'bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs space-y-2 cursor-pointer transition-opacity',
        isMoving && 'opacity-50',
        'hover:border-zinc-600'
      )}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Name + source */}
      <div className="flex items-start justify-between gap-1">
        <span className="text-sm font-medium text-white leading-tight">{lead.name}</span>
        {lead.source && (
          <span className={clsx('text-xs px-1.5 py-0.5 rounded shrink-0', SOURCE_COLORS[lead.source] || SOURCE_COLORS.manual)}>
            {lead.source}
          </span>
        )}
      </div>

      {lead.service_requested && (
        <p className="text-zinc-400 leading-tight">{lead.service_requested}</p>
      )}

      {lead.follow_up_date && (
        <div className="flex items-center gap-1 text-yellow-400">
          <Calendar size={11} />
          <span>Follow-up: {lead.follow_up_date}</span>
        </div>
      )}

      {/* Expanded actions */}
      {expanded && (
        <div className="pt-1 space-y-2 border-t border-zinc-700">
          {lead.phone && (
            <div className="flex items-center gap-1 text-zinc-400">
              <Phone size={11} /><span>{lead.phone}</span>
            </div>
          )}
          {lead.email && (
            <div className="flex items-center gap-1 text-zinc-400">
              <Mail size={11} /><span>{lead.email}</span>
            </div>
          )}
          {lead.notes && (
            <p className="text-zinc-500 italic leading-tight">{lead.notes}</p>
          )}
          {/* Status move buttons */}
          <div className="flex flex-wrap gap-1 pt-1">
            {statusOrder
              .filter(s => s !== lead.status)
              .map(s => (
                <button
                  key={s}
                  onClick={e => { e.stopPropagation(); onStatusChange(lead, s) }}
                  className={clsx(
                    'text-xs px-2 py-0.5 rounded border transition-colors',
                    STATUS_COLORS[s],
                    'hover:opacity-80'
                  )}
                >
                  → {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ── CAMPAIGNS TAB ─────────────────────────────────────────────────────────────

function CampaignsTab({ orgId }: { orgId: string }) {
  const [campaigns,  setCampaigns]  = useState<SparkCampaign[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showNew,    setShowNew]    = useState(false)
  const [sending,    setSending]    = useState<Record<string, boolean>>({})
  const [sent,       setSent]       = useState<Record<string, boolean>>({})
  const [newForm,    setNewForm]    = useState({ subject: '', body: '', segment: '' })
  const [creating,   setCreating]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { supabase } = await import('@/lib/supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data } = await supabase
      .from('email_campaigns')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    setCampaigns((data || []) as SparkCampaign[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newForm.subject || !newForm.body) return
    setCreating(true)
    const campaign = await createCampaign(newForm.subject, newForm.body, newForm.segment || undefined)
    setCreating(false)
    if (campaign) {
      setCampaigns(cs => [campaign, ...cs])
      setNewForm({ subject: '', body: '', segment: '' })
      setShowNew(false)
    }
  }

  const handleSend = async (campaign: SparkCampaign) => {
    if (!campaign.id) return
    setSending(s => ({ ...s, [campaign.id!]: true }))
    // Route through SPARK agent → MiroFish — does NOT send directly
    await processSparkRequest({
      action:  'send_campaign' as any,
      orgId,
      userId:  'christian',
      params:  { campaignId: campaign.id },
    })
    setSent(s => ({ ...s, [campaign.id!]: true }))
    setSending(s => ({ ...s, [campaign.id!]: false }))
  }

  const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
    draft:     'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    scheduled: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    sent:      'bg-green-500/15 text-green-400 border-green-500/30',
    cancelled: 'bg-red-500/15 text-red-400 border-red-500/30',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
        <span className="ml-2 text-sm text-zinc-500">Loading campaigns…</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <p className="text-xs text-zinc-500">{campaigns.length} campaigns</p>
        <button
          onClick={() => setShowNew(v => !v)}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
        >
          <Plus size={12} />
          {showNew ? 'Cancel' : 'New Campaign'}
        </button>
      </div>

      {/* New Campaign form */}
      {showNew && (
        <form
          onSubmit={handleCreate}
          className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-white">New Email Campaign</h3>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Subject *</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              placeholder="Campaign subject line"
              value={newForm.subject}
              onChange={e => setNewForm(f => ({ ...f, subject: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Body *</label>
            <textarea
              className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
              rows={5}
              placeholder="Email body (plain text or HTML)…"
              value={newForm.body}
              onChange={e => setNewForm(f => ({ ...f, body: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Recipient Segment (email or segment name)</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              placeholder="e.g. past_clients, team@poweronsolutions.com"
              value={newForm.segment}
              onChange={e => setNewForm(f => ({ ...f, segment: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {creating ? 'Saving…' : 'Save Draft'}
            </button>
          </div>
        </form>
      )}

      {/* Campaign list */}
      {campaigns.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <Send size={28} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No campaigns yet — create your first one above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(campaign => (
            <div
              key={campaign.id}
              className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-white truncate">{campaign.subject}</h4>
                  {campaign.recipient_segment && (
                    <p className="text-xs text-zinc-500 mt-0.5">Segment: {campaign.recipient_segment}</p>
                  )}
                </div>
                <span className={clsx('text-xs px-2 py-0.5 rounded border font-medium shrink-0', CAMPAIGN_STATUS_COLORS[campaign.status] || CAMPAIGN_STATUS_COLORS.draft)}>
                  {campaign.status}
                </span>
              </div>

              {/* Body preview */}
              <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{campaign.body}</p>

              {/* Stats */}
              {(campaign.open_count! > 0 || campaign.click_count! > 0) && (
                <div className="flex gap-4 text-xs text-zinc-500">
                  <span>Opens: {campaign.open_count}</span>
                  <span>Clicks: {campaign.click_count}</span>
                </div>
              )}

              {/* Send action */}
              {campaign.status === 'draft' && (
                <>
                  {sent[campaign.id!] ? (
                    <p className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Routed to MiroFish — awaiting your approval before sending
                    </p>
                  ) : (
                    <button
                      onClick={() => handleSend(campaign)}
                      disabled={sending[campaign.id!]}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50"
                    >
                      {sending[campaign.id!]
                        ? <><Loader2 size={12} className="animate-spin" /> Routing…</>
                        : <><Send size={12} /> Send Campaign</>
                      }
                    </button>
                  )}
                </>
              )}

              {campaign.sent_at && (
                <p className="text-xs text-zinc-600">
                  Sent: {new Date(campaign.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── MAIN SPARKPANEL ───────────────────────────────────────────────────────────

export default function SparkPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('reviews')
  const { user } = useAuth()

  // Use user.id as orgId for Supabase queries; fall back to 'default'
  const orgId = user?.id || 'default'

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'reviews',   label: 'Reviews',   icon: <Star size={14} /> },
    { key: 'leads',     label: 'Leads',     icon: <User size={14} /> },
    { key: 'campaigns', label: 'Campaigns', icon: <Send size={14} /> },
  ]

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-white">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={18} className="text-yellow-400" />
          <h2 className="text-lg font-bold text-white">SPARK</h2>
          <span className="text-xs text-zinc-500 font-normal">Marketing & Sales Automation</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {activeTab === 'reviews'   && <ReviewsTab   orgId={orgId} />}
        {activeTab === 'leads'     && <LeadsTab     orgId={orgId} />}
        {activeTab === 'campaigns' && <CampaignsTab orgId={orgId} />}
      </div>
    </div>
  )
}
