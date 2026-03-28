// @ts-nocheck
'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Plus, Loader2, AlertCircle, ChevronDown, ChevronUp, Phone, Mail, MapPin } from 'lucide-react'
import clsx from 'clsx'

interface Lead {
  id: string
  org_id: string
  name: string
  phone?: string
  email?: string
  address?: string
  lead_source?: string
  source_detail?: string
  project_type?: string
  service_needed?: string
  estimated_value?: number
  urgency?: string
  status: 'new' | 'contacted' | 'estimate_scheduled' | 'estimate_delivered' | 'negotiating' | 'won' | 'lost'
  contacted_at?: string
  estimate_scheduled_at?: string
  closed_at?: string
  close_notes?: string
  follow_up_count?: number
  created_at: string
}

const STATUS_CONFIG = {
  new: { label: 'New', color: 'cyan' },
  contacted: { label: 'Contacted', color: 'blue' },
  estimate_scheduled: { label: 'Estimate Scheduled', color: 'purple' },
  estimate_delivered: { label: 'Estimate Delivered', color: 'yellow' },
  negotiating: { label: 'Negotiating', color: 'orange' },
  won: { label: 'Won', color: 'emerald' },
  lost: { label: 'Lost', color: 'red' },
}

type StatusKey = keyof typeof STATUS_CONFIG

const STATUS_FILTERS = ['all', 'new', 'contacted', 'estimate_scheduled', 'estimate_delivered', 'negotiating', 'won', 'lost'] as const

export function LeadPipeline() {
  const { user, profile } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<typeof STATUS_FILTERS[number]>('all')
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    lead_source: '',
    project_type: '',
    estimated_value: '',
  })

  const orgId = profile?.org_id

  useEffect(() => {
    if (!orgId) return
    fetchLeads()
  }, [orgId])

  const fetchLeads = async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('leads' as never)
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError
      setLeads(data as Lead[] || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch leads')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId || !user?.id) return

    try {
      const { error: insertError } = await supabase
        .from('leads' as never)
        .insert([
          {
            org_id: orgId,
            name: formData.name,
            phone: formData.phone || null,
            email: formData.email || null,
            lead_source: formData.lead_source || null,
            project_type: formData.project_type || null,
            estimated_value: formData.estimated_value ? parseFloat(formData.estimated_value) : null,
            status: 'new',
            created_at: new Date().toISOString(),
          },
        ])

      if (insertError) throw insertError

      setFormData({ name: '', phone: '', email: '', lead_source: '', project_type: '', estimated_value: '' })
      setShowForm(false)
      await fetchLeads()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lead')
    }
  }

  const [expandedLead, setExpandedLead] = useState<string | null>(null)

  const updateLeadStatus = async (leadId: string, newStatus: Lead['status']) => {
    try {
      const updateData: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'contacted') updateData.contacted_at = new Date().toISOString()
      if (newStatus === 'won' || newStatus === 'lost') updateData.closed_at = new Date().toISOString()

      const { error: updateError } = await supabase
        .from('leads' as never)
        .update(updateData)
        .eq('id', leadId)

      if (updateError) throw updateError
      setLeads(leads.map(l => l.id === leadId ? { ...l, status: newStatus, ...updateData } : l))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  const filteredLeads = activeFilter === 'all'
    ? leads
    : leads.filter(lead => lead.status === activeFilter)

  const getStatusColor = (status: StatusKey) => {
    const config = STATUS_CONFIG[status]
    return {
      cyan: 'bg-cyan-400/10 text-cyan-400',
      blue: 'bg-blue-400/10 text-blue-400',
      purple: 'bg-purple-400/10 text-purple-400',
      yellow: 'bg-yellow-400/10 text-yellow-400',
      orange: 'bg-orange-400/10 text-orange-400',
      emerald: 'bg-emerald-400/10 text-emerald-400',
      red: 'bg-red-400/10 text-red-400',
    }[config.color]
  }

  const formatCurrency = (value?: number) => {
    if (!value) return '-'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-800">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={clsx(
              'px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeFilter === filter
                ? 'bg-pink-500/20 text-pink-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            {filter === 'all' ? 'All' : STATUS_CONFIG[filter as StatusKey]?.label}
          </button>
        ))}
      </div>

      {/* Add Lead Button */}
      <div className="flex justify-between items-center">
        <h3 className="text-gray-100 font-semibold">Leads</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded-md text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Lead
        </button>
      </div>

      {/* Add Lead Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg space-y-3"
        >
          <input
            type="text"
            placeholder="Lead Name *"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <input
            type="tel"
            placeholder="Phone"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <input
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <input
            type="text"
            placeholder="Lead Source"
            value={formData.lead_source}
            onChange={(e) => setFormData({ ...formData, lead_source: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <input
            type="text"
            placeholder="Project Type"
            value={formData.project_type}
            onChange={(e) => setFormData({ ...formData, project_type: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <input
            type="number"
            placeholder="Estimated Value"
            value={formData.estimated_value}
            onChange={(e) => setFormData({ ...formData, estimated_value: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded-md font-medium transition-colors"
            >
              Create Lead
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex-1 px-4 py-2 bg-gray-700/50 text-gray-300 hover:bg-gray-700 rounded-md font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredLeads.length === 0 && (
        <div className="py-12 text-center">
          <div className="text-gray-500 text-sm">No leads found</div>
        </div>
      )}

      {/* Lead Cards */}
      <div className="space-y-3">
        {filteredLeads.map((lead) => {
          const isExpanded = expandedLead === lead.id
          return (
            <div
              key={lead.id}
              className="bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
            >
              {/* Card Header — clickable */}
              <button
                onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                className="w-full p-4 text-left"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-gray-100 font-semibold truncate">{lead.name}</h4>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                    </div>
                    <p className="text-gray-400 text-sm">{lead.lead_source || '-'}{lead.source_detail ? ` · ${lead.source_detail}` : ''}</p>
                  </div>
                  <span className={clsx('px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 ml-2', getStatusColor(lead.status as StatusKey))}>
                    {STATUS_CONFIG[lead.status as StatusKey]?.label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500 text-xs">Value</span>
                    <p className="text-gray-300">{formatCurrency(lead.estimated_value)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Type</span>
                    <p className="text-gray-300">{lead.project_type || lead.service_needed || '-'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Created</span>
                    <p className="text-gray-300">{formatDate(lead.created_at)}</p>
                  </div>
                </div>
              </button>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t border-gray-700 space-y-4">
                  {/* Contact Info */}
                  <div className="flex flex-wrap gap-4 pt-3 text-sm">
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300">
                        <Phone className="w-3.5 h-3.5" /> {lead.phone}
                      </a>
                    )}
                    {lead.email && (
                      <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300">
                        <Mail className="w-3.5 h-3.5" /> {lead.email}
                      </a>
                    )}
                    {lead.address && (
                      <span className="flex items-center gap-1.5 text-gray-400">
                        <MapPin className="w-3.5 h-3.5" /> {lead.address}
                      </span>
                    )}
                  </div>

                  {/* Timeline */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {lead.contacted_at && (
                      <div className="bg-gray-900/50 rounded p-2">
                        <span className="text-gray-500">Contacted</span>
                        <p className="text-gray-300">{formatDate(lead.contacted_at)}</p>
                      </div>
                    )}
                    {lead.estimate_scheduled_at && (
                      <div className="bg-gray-900/50 rounded p-2">
                        <span className="text-gray-500">Estimate Scheduled</span>
                        <p className="text-gray-300">{formatDate(lead.estimate_scheduled_at)}</p>
                      </div>
                    )}
                    {lead.closed_at && (
                      <div className="bg-gray-900/50 rounded p-2">
                        <span className="text-gray-500">Closed</span>
                        <p className="text-gray-300">{formatDate(lead.closed_at)}</p>
                      </div>
                    )}
                    {lead.follow_up_count != null && lead.follow_up_count > 0 && (
                      <div className="bg-gray-900/50 rounded p-2">
                        <span className="text-gray-500">Follow-ups</span>
                        <p className="text-gray-300">{lead.follow_up_count}</p>
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  {lead.close_notes && (
                    <div className="bg-gray-900/50 rounded p-3">
                      <span className="text-gray-500 text-xs block mb-1">Notes</span>
                      <p className="text-gray-300 text-sm">{lead.close_notes}</p>
                    </div>
                  )}

                  {/* Status Update */}
                  {lead.status !== 'won' && lead.status !== 'lost' && (
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-xs text-gray-500">Move to:</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {Object.entries(STATUS_CONFIG)
                          .filter(([key]) => key !== lead.status)
                          .map(([key, config]) => (
                            <button
                              key={key}
                              onClick={() => updateLeadStatus(lead.id, key as Lead['status'])}
                              className={clsx(
                                'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                                getStatusColor(key as StatusKey),
                                'hover:opacity-80'
                              )}
                            >
                              {config.label}
                            </button>
                          ))}
                      </div>
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
