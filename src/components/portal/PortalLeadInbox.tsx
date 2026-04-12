// @ts-nocheck
/**
 * PortalLeadInbox — Shows all portal_leads in the Hub (owner view only)
 *
 * Features:
 * - Card per lead: name, service type, city, urgency, date submitted, status badge
 * - Status flow: New → Contacted → Quoted → Won/Lost
 * - Click to expand: full details, photos, description
 * - "Convert to Project" button → creates project in BLUEPRINT with pre-filled data
 * - "Call Now" button → opens phone dialer
 * - "Draft Response" button → generates Claude response email based on request
 * - Filter by: service type, status, date range
 * - Sort by: date (newest), urgency, service type
 *
 * Integrates with SPARK pipeline for lead automation.
 */

import { useEffect, useState, useCallback } from 'react'
import { Phone, FileText, CheckCircle, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'

import * as PortalLeadService from '@/services/portal/PortalLeadService'
import type { PortalLead, PortalLeadStatus } from '@/services/portal/PortalLeadService'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FilterOptions {
  serviceType: string | 'all'
  status: PortalLeadStatus | 'all'
  dateRange: 'all' | '7days' | '30days' | '90days'
}

interface SortOption {
  field: 'date' | 'urgency' | 'service_type'
  direction: 'asc' | 'desc'
}

// ── Status badge styles ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<PortalLeadStatus, { bg: string; text: string; label: string }> = {
  new: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-800 dark:text-blue-100', label: 'New Lead' },
  contacted: { bg: 'bg-yellow-100 dark:bg-yellow-900', text: 'text-yellow-800 dark:text-yellow-100', label: 'Contacted' },
  quoted: { bg: 'bg-purple-100 dark:bg-purple-900', text: 'text-purple-800 dark:text-purple-100', label: 'Quoted' },
  won: { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800 dark:text-green-100', label: 'Won' },
  lost: { bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800 dark:text-red-100', label: 'Lost' },
}

const URGENCY_COLORS: Record<string, string> = {
  high: 'text-red-600 dark:text-red-400 font-bold',
  medium: 'text-orange-600 dark:text-orange-400',
  low: 'text-gray-600 dark:text-gray-400',
}

// ── PortalLeadInbox Component ─────────────────────────────────────────────────

export const PortalLeadInbox: React.FC = () => {
  const [leads, setLeads] = useState<PortalLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterOptions>({
    serviceType: 'all',
    status: 'all',
    dateRange: 'all',
  })
  const [sort, setSort] = useState<SortOption>({
    field: 'date',
    direction: 'desc',
  })
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [draftText, setDraftText] = useState<string>('')
  const [convertingId, setConvertingId] = useState<string | null>(null)

  // ── Load leads on mount ────────────────────────────────────────────────────

  useEffect(() => {
    loadLeads()
  }, [])

  const loadLeads = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await PortalLeadService.fetchPortalLeads()
      setLeads(data)
    } catch (err) {
      console.error('[PortalLeadInbox] Error loading leads:', err)
      setError('Failed to load portal leads')
    } finally {
      setLoading(false)
    }
  }

  // ── Filter and sort leads ──────────────────────────────────────────────────

  const filteredAndSorted = useCallback(() => {
    let result = [...leads]

    // Filter by service type
    if (filters.serviceType !== 'all') {
      result = result.filter((lead) => lead.service_type === filters.serviceType)
    }

    // Filter by status
    if (filters.status !== 'all') {
      result = result.filter((lead) => lead.status === filters.status)
    }

    // Filter by date range
    const now = new Date()
    if (filters.dateRange !== 'all') {
      const days = filters.dateRange === '7days' ? 7 : filters.dateRange === '30days' ? 30 : 90
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      result = result.filter((lead) => new Date(lead.date_submitted) >= cutoff)
    }

    // Sort
    result.sort((a, b) => {
      let aVal: any
      let bVal: any

      if (sort.field === 'date') {
        aVal = new Date(a.date_submitted).getTime()
        bVal = new Date(b.date_submitted).getTime()
      } else if (sort.field === 'urgency') {
        const urgencyOrder = { high: 3, medium: 2, low: 1 }
        aVal = urgencyOrder[a.urgency as keyof typeof urgencyOrder] || 0
        bVal = urgencyOrder[b.urgency as keyof typeof urgencyOrder] || 0
      } else if (sort.field === 'service_type') {
        aVal = a.service_type.toLowerCase()
        bVal = b.service_type.toLowerCase()
      }

      if (sort.direction === 'desc') {
        return bVal > aVal ? 1 : bVal < aVal ? -1 : 0
      } else {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
      }
    })

    return result
  }, [leads, filters, sort])

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleStatusChange = async (leadId: string, newStatus: PortalLeadStatus) => {
    const updated = await PortalLeadService.updateLeadStatus(leadId, newStatus)
    if (updated) {
      setLeads((prev) =>
        prev.map((lead) => (lead.id === leadId ? { ...lead, status: newStatus } : lead))
      )
    }
  }

  const handleCallNow = (phone: string | undefined) => {
    if (!phone) {
      alert('No phone number available')
      return
    }
    window.location.href = `tel:${phone}`
  }

  const handleDraftResponse = async (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId)
    if (!lead) return

    setDraftingId(leadId)
    try {
      const draft = await PortalLeadService.generateResponseDraft({
        leadId,
        leadData: lead,
      })
      if (draft) {
        setDraftText(draft)
        setExpandedId(leadId)
      } else {
        alert('Failed to generate draft response')
      }
    } finally {
      setDraftingId(null)
    }
  }

  const handleConvertToProject = async (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId)
    if (!lead) return

    setConvertingId(leadId)
    try {
      const projectId = await PortalLeadService.convertToProject({
        leadId,
        projectName: `${lead.name} - ${lead.service_type}`,
        projectType: lead.service_type,
        estimatedValue: 0,
      })

      if (projectId) {
        // Update local state to reflect the project link
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, project_id: projectId, status: 'quoted' } : l
          )
        )
        alert(`Project created successfully (ID: ${projectId})`)
      } else {
        alert('Failed to create project')
      }
    } finally {
      setConvertingId(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const filtered = filteredAndSorted()
  const uniqueServiceTypes = Array.from(new Set(leads.map((l) => l.service_type)))

  return (
    <div className="w-full max-w-6xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Portal Lead Inbox</h1>
        <p className="text-gray-600 dark:text-gray-300">
          {filtered.length} lead{filtered.length !== 1 ? 's' : ''} showing
        </p>
      </div>

      {/* Filter & Sort Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Service Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Service Type
            </label>
            <select
              value={filters.serviceType}
              onChange={(e) => setFilters({ ...filters, serviceType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All Services</option>
              {uniqueServiceTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All Statuses</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="quoted">Quoted</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>

          {/* Date Range Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Date Range
            </label>
            <select
              value={filters.dateRange}
              onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All Time</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="90days">Last 90 Days</option>
            </select>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Sort By
            </label>
            <select
              value={sort.field}
              onChange={(e) => setSort({ ...sort, field: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="date">Date (Newest)</option>
              <option value="urgency">Urgency</option>
              <option value="service_type">Service Type</option>
            </select>
          </div>
        </div>
      </div>

      {/* Loading / Error States */}
      {loading && <div className="text-center py-8 text-gray-600 dark:text-gray-400">Loading leads...</div>}
      {error && (
        <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-4 text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Leads List */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-600 dark:text-gray-400">
          <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No leads found matching your filters</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((lead) => (
            <div
              key={lead.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Lead Card Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{lead.name}</h3>
                      <span
                        className={clsx(
                          'text-xs px-2 py-1 rounded-full font-medium',
                          STATUS_COLORS[lead.status].bg,
                          STATUS_COLORS[lead.status].text
                        )}
                      >
                        {STATUS_COLORS[lead.status].label}
                      </span>
                      <span className={clsx('text-xs font-semibold', URGENCY_COLORS[lead.urgency])}>
                        {lead.urgency.toUpperCase()}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 dark:text-gray-400">
                      <div>
                        <span className="font-medium">Service:</span> {lead.service_type}
                      </div>
                      <div>
                        <span className="font-medium">City:</span> {lead.city}
                      </div>
                      <div>
                        <span className="font-medium">Submitted:</span>{' '}
                        {new Date(lead.date_submitted).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-2">
                    {expandedId === lead.id ? <ChevronUp /> : <ChevronDown />}
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedId === lead.id && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900 space-y-4">
                  {/* Full Description */}
                  {lead.description && (
                    <div>
                      <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Description</h4>
                      <p className="text-gray-700 dark:text-gray-300">{lead.description}</p>
                    </div>
                  )}

                  {/* Contact Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {lead.email && (
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">Email:</span>
                        <p className="text-gray-600 dark:text-gray-400">{lead.email}</p>
                      </div>
                    )}
                    {lead.phone && (
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">Phone:</span>
                        <p className="text-gray-600 dark:text-gray-400">{lead.phone}</p>
                      </div>
                    )}
                  </div>

                  {/* Address */}
                  {lead.address && (
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Address:</span>
                      <p className="text-gray-600 dark:text-gray-400">{lead.address}</p>
                    </div>
                  )}

                  {/* Draft Response Area */}
                  {draftText && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded p-3">
                      <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Draft Response</h4>
                      <p className="text-blue-800 dark:text-blue-200 text-sm whitespace-pre-wrap">{draftText}</p>
                    </div>
                  )}

                  {/* Notes */}
                  {lead.notes && (
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Notes:</span>
                      <p className="text-gray-600 dark:text-gray-400">{lead.notes}</p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                    {/* Status Buttons */}
                    <button
                      onClick={() => handleStatusChange(lead.id, 'contacted')}
                      disabled={lead.status === 'contacted' || lead.status === 'won' || lead.status === 'lost'}
                      className="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors"
                    >
                      Mark Contacted
                    </button>

                    <button
                      onClick={() => handleStatusChange(lead.id, 'quoted')}
                      disabled={lead.status === 'quoted' || lead.status === 'won' || lead.status === 'lost'}
                      className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors"
                    >
                      Mark Quoted
                    </button>

                    <button
                      onClick={() => handleStatusChange(lead.id, 'won')}
                      disabled={lead.status === 'won' || lead.status === 'lost'}
                      className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors flex items-center gap-1"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Won
                    </button>

                    <button
                      onClick={() => handleStatusChange(lead.id, 'lost')}
                      disabled={lead.status === 'lost'}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors"
                    >
                      Lost
                    </button>

                    {/* Call Now Button */}
                    <button
                      onClick={() => handleCallNow(lead.phone)}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors flex items-center gap-1"
                    >
                      <Phone className="w-4 h-4" />
                      Call Now
                    </button>

                    {/* Draft Response Button */}
                    <button
                      onClick={() => handleDraftResponse(lead.id)}
                      disabled={draftingId === lead.id}
                      className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors flex items-center gap-1"
                    >
                      <FileText className="w-4 h-4" />
                      {draftingId === lead.id ? 'Generating...' : 'Draft Response'}
                    </button>

                    {/* Convert to Project Button */}
                    <button
                      onClick={() => handleConvertToProject(lead.id)}
                      disabled={convertingId === lead.id || !!lead.project_id}
                      className="px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors flex items-center gap-1"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {lead.project_id ? 'Project Created' : convertingId === lead.id ? 'Creating...' : 'Convert to Project'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PortalLeadInbox
