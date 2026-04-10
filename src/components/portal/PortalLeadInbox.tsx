/**
 * PortalLeadInbox.tsx
 * 
 * Display portal leads inside PowerOn Hub for the owner.
 * Integrates with SPARK pipeline for lead management and conversion.
 * 
 * Features:
 * - Shows all portal_leads in the Hub (owner view only)
 * - Card per lead: name, service type, city, urgency, date submitted, status badge
 * - Status flow: New → Contacted → Quoted → Won/Lost
 * - Click to expand: full details, photos, description
 * - "Convert to Project" button → creates project in BLUEPRINT with pre-filled data
 * - "Call Now" button → opens phone dialer
 * - "Draft Response" button → generates Claude response email based on request
 * - Filter by: service type, status, date range
 * - Sort by: date (newest), urgency, service type
 */

import { useEffect, useState, useMemo } from 'react'
import { Mail, Phone, Plus, FileText, ChevronDown, ChevronUp, AlertCircle, Filter, ArrowUpDown } from 'lucide-react'
import { clsx } from 'clsx'
import {
  fetchPortalLeads,
  updateLeadStatus,
  convertToProject,
  generateResponseDraft,
  type PortalLead,
  type PortalLeadStatus,
  type ResponseDraft,
} from '@/services/portal/PortalLeadService'

// ── Types ─────────────────────────────────────────────────────────────────

interface FilterOptions {
  serviceType: string | null
  status: PortalLeadStatus | null
  dateRange: 'all' | '7days' | '30days' | '90days'
}

type SortBy = 'date-newest' | 'date-oldest' | 'urgency' | 'service-type'

// ── Status Badge Styles ───────────────────────────────────────────────────

const STATUS_COLORS: Record<
  PortalLeadStatus,
  { bg: string; text: string; label: string }
> = {
  New: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-800 dark:text-blue-200', label: 'New' },
  Contacted: { bg: 'bg-cyan-100 dark:bg-cyan-900', text: 'text-cyan-800 dark:text-cyan-200', label: 'Contacted' },
  Quoted: { bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800 dark:text-amber-200', label: 'Quoted' },
  Won: { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800 dark:text-green-200', label: 'Won' },
  Lost: { bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800 dark:text-red-200', label: 'Lost' },
}

const URGENCY_COLORS: Record<string, string> = {
  Low: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
  Medium: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
  High: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200',
  Critical: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
}

// ── Component ─────────────────────────────────────────────────────────────

export function PortalLeadInbox() {
  const [leads, setLeads] = useState<PortalLead[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterOptions>({
    serviceType: null,
    status: null,
    dateRange: 'all',
  })
  const [sortBy, setSortBy] = useState<SortBy>('date-newest')
  const [responseDrafts, setResponseDrafts] = useState<Record<string, ResponseDraft>>({})
  const [loadingDraft, setLoadingDraft] = useState<string | null>(null)

  // Load leads on mount
  useEffect(() => {
    loadLeads()
  }, [])

  async function loadLeads() {
    setLoading(true)
    const data = await fetchPortalLeads()
    setLeads(data)
    setLoading(false)
  }

  // Get unique service types for filter dropdown
  const serviceTypes = useMemo(
    () => Array.from(new Set(leads.map((l) => l.service_type).filter(Boolean))),
    [leads]
  )

  // Filter and sort leads
  const filteredLeads = useMemo(() => {
    let result = [...leads]

    // Apply service type filter
    if (filters.serviceType) {
      result = result.filter((l) => l.service_type === filters.serviceType)
    }

    // Apply status filter
    if (filters.status) {
      result = result.filter((l) => l.status === filters.status)
    }

    // Apply date range filter
    if (filters.dateRange !== 'all') {
      const now = new Date()
      const daysAgo = {
        '7days': 7,
        '30days': 30,
        '90days': 90,
      }[filters.dateRange] || 0

      const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)

      result = result.filter((l) => new Date(l.date_submitted) >= cutoffDate)
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date-newest':
          return new Date(b.date_submitted).getTime() - new Date(a.date_submitted).getTime()
        case 'date-oldest':
          return new Date(a.date_submitted).getTime() - new Date(b.date_submitted).getTime()
        case 'urgency': {
          const urgencyOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 }
          return (
            (urgencyOrder[a.urgency as keyof typeof urgencyOrder] ?? 999) -
            (urgencyOrder[b.urgency as keyof typeof urgencyOrder] ?? 999)
          )
        }
        case 'service-type':
          return a.service_type.localeCompare(b.service_type)
        default:
          return 0
      }
    })

    return result
  }, [leads, filters, sortBy])

  // Status flow handler
  const handleStatusChange = async (leadId: string, newStatus: PortalLeadStatus) => {
    const updated = await updateLeadStatus(leadId, newStatus)
    if (updated) {
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? updated : l))
      )
    }
  }

  // Convert to project handler
  const handleConvertToProject = async (lead: PortalLead) => {
    const projectId = await convertToProject({
      leadId: lead.id,
      name: lead.name,
      type: lead.service_type,
      contract: lead.estimated_value ?? 0,
      city: lead.city,
      address: lead.address,
      description: lead.description,
      serviceType: lead.service_type,
      urgency: lead.urgency,
    })

    if (projectId) {
      // Update status to Quoted
      await handleStatusChange(lead.id, 'Quoted')
      // Show success (could integrate with toast notification)
      console.log('[PortalLeadInbox] Project created:', projectId)
    }
  }

  // Generate response draft handler
  const handleGenerateResponse = async (lead: PortalLead) => {
    setLoadingDraft(lead.id)
    const draft = await generateResponseDraft(lead)
    if (draft) {
      setResponseDrafts((prev) => ({ ...prev, [lead.id]: draft }))
    }
    setLoadingDraft(null)
  }

  // Call handler
  const handleCall = (phone: string | undefined) => {
    if (phone) {
      window.location.href = `tel:${phone}`
    }
  }

  // Email handler
  const handleEmail = (email: string | undefined) => {
    if (email) {
      window.location.href = `mailto:${email}`
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading portal leads...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mb-2">Portal Leads</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage service inquiries from your portal. Convert to projects, draft responses, or reach out directly.
        </p>
      </div>

      {/* Filters & Sort */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {/* Service Type Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <Filter className="inline w-4 h-4 mr-2" />
            Service Type
          </label>
          <select
            value={filters.serviceType ?? ''}
            onChange={(e) => setFilters({ ...filters, serviceType: e.target.value || null })}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 px-3 py-2 text-sm"
          >
            <option value="">All Services</option>
            {serviceTypes.map((svc) => (
              <option key={svc} value={svc}>
                {svc}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
          <select
            value={filters.status ?? ''}
            onChange={(e) => setFilters({ ...filters, status: (e.target.value as PortalLeadStatus) || null })}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 px-3 py-2 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="New">New</option>
            <option value="Contacted">Contacted</option>
            <option value="Quoted">Quoted</option>
            <option value="Won">Won</option>
            <option value="Lost">Lost</option>
          </select>
        </div>

        {/* Date Range Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Date Range</label>
          <select
            value={filters.dateRange}
            onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as FilterOptions['dateRange'] })}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 px-3 py-2 text-sm"
          >
            <option value="all">All Time</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="90days">Last 90 Days</option>
          </select>
        </div>

        {/* Sort */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <ArrowUpDown className="inline w-4 h-4 mr-2" />
            Sort
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 px-3 py-2 text-sm"
          >
            <option value="date-newest">Newest First</option>
            <option value="date-oldest">Oldest First</option>
            <option value="urgency">Highest Urgency</option>
            <option value="service-type">Service Type</option>
          </select>
        </div>

        {/* Results Count */}
        <div className="flex items-end">
          <div className="w-full rounded-md bg-gray-100 dark:bg-gray-800 px-3 py-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Leads List */}
      {filteredLeads.length === 0 ? (
        <div className="rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 py-12 text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">No leads match your filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLeads.map((lead) => (
            <div
              key={lead.id}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              {/* Lead Card Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{lead.name}</h3>
                      <span
                        className={clsx(
                          'px-2 py-1 rounded-full text-xs font-semibold',
                          STATUS_COLORS[lead.status].bg,
                          STATUS_COLORS[lead.status].text
                        )}
                      >
                        {STATUS_COLORS[lead.status].label}
                      </span>
                      {lead.urgency && (
                        <span className={clsx('px-2 py-1 rounded text-xs font-medium', URGENCY_COLORS[lead.urgency])}>
                          {lead.urgency}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-sm text-gray-600 dark:text-gray-400">
                      <div>
                        <span className="font-medium">Service:</span> {lead.service_type}
                      </div>
                      <div>
                        <span className="font-medium">Location:</span> {lead.city}
                      </div>
                      <div>
                        <span className="font-medium">Submitted:</span>{' '}
                        {new Date(lead.date_submitted).toLocaleDateString()}
                      </div>
                      {lead.estimated_value && (
                        <div>
                          <span className="font-medium">Est. Value:</span> ${lead.estimated_value.toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expand/Collapse Icon */}
                  <div className="flex-shrink-0">
                    {expandedId === lead.id ? (
                      <ChevronUp className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {expandedId === lead.id && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
                  {/* Description */}
                  <div className="mb-6">
                    <h4 className="font-semibold text-gray-900 dark:text-gray-50 mb-2">Description</h4>
                    <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">{lead.description}</p>
                  </div>

                  {/* Additional Details */}
                  {(lead.address || lead.service_scope || lead.additional_notes) && (
                    <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                      {lead.address && (
                        <div>
                          <h4 className="font-semibold text-gray-900 dark:text-gray-50 mb-1">Full Address</h4>
                          <p className="text-gray-700 dark:text-gray-300 text-sm">{lead.address}</p>
                        </div>
                      )}
                      {lead.service_scope && (
                        <div>
                          <h4 className="font-semibold text-gray-900 dark:text-gray-50 mb-1">Scope</h4>
                          <p className="text-gray-700 dark:text-gray-300 text-sm">{lead.service_scope}</p>
                        </div>
                      )}
                      {lead.additional_notes && (
                        <div className="md:col-span-2">
                          <h4 className="font-semibold text-gray-900 dark:text-gray-50 mb-1">Notes</h4>
                          <p className="text-gray-700 dark:text-gray-300 text-sm">{lead.additional_notes}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Photos */}
                  {lead.photos && Array.isArray(lead.photos) && lead.photos.length > 0 && (
                    <div className="mb-6">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-50 mb-3">Photos</h4>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {lead.photos.map((photo, idx) => (
                          <img
                            key={idx}
                            src={photo}
                            alt={`Photo ${idx + 1}`}
                            className="w-full h-32 object-cover rounded-md border border-gray-300 dark:border-gray-600"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Contact & Action Buttons */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
                    {/* Contact Buttons */}
                    <div className="flex flex-wrap gap-2">
                      {lead.phone && (
                        <button
                          onClick={() => handleCall(lead.phone)}
                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-sm font-medium hover:bg-green-200 dark:hover:bg-green-800 transition-colors"
                        >
                          <Phone className="w-4 h-4" />
                          Call Now
                        </button>
                      )}
                      {lead.email && (
                        <button
                          onClick={() => handleEmail(lead.email)}
                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                        >
                          <Mail className="w-4 h-4" />
                          Email
                        </button>
                      )}
                    </div>

                    {/* Status Flow Buttons */}
                    <div className="flex flex-wrap gap-2">
                      {lead.status !== 'Contacted' && (
                        <button
                          onClick={() => handleStatusChange(lead.id, 'Contacted')}
                          className="px-3 py-2 rounded-md bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200 text-sm font-medium hover:bg-cyan-200 dark:hover:bg-cyan-800 transition-colors"
                        >
                          Mark Contacted
                        </button>
                      )}
                    </div>

                    {/* Response Draft */}
                    <div>
                      <button
                        onClick={() => handleGenerateResponse(lead)}
                        disabled={loadingDraft === lead.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-md bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 text-sm font-medium hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors disabled:opacity-50"
                      >
                        <FileText className="w-4 h-4" />
                        {loadingDraft === lead.id ? 'Generating...' : 'Draft Response'}
                      </button>

                      {responseDrafts[lead.id] && (
                        <div className="mt-3 p-3 rounded-md bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600">
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Subject:</p>
                          <p className="text-sm text-gray-800 dark:text-gray-200 mb-3">{responseDrafts[lead.id].subject}</p>
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Body:</p>
                          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                            {responseDrafts[lead.id].body}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Convert to Project */}
                    {lead.status !== 'Won' && lead.status !== 'Lost' && (
                      <button
                        onClick={() => handleConvertToProject(lead)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm font-semibold hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Convert to Project
                      </button>
                    )}
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
