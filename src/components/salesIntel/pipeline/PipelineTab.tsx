/**
 * Sales Intelligence Pipeline Tab Component
 *
 * Three-column kanban layout for leads:
 * ADVANCE | PARK | KILL
 *
 * Features:
 * - Drag-and-drop between columns (or tap to move)
 * - Lead cards with score, temperature, days since contact, next action
 * - Pipeline value display (total $ in ADVANCE)
 * - Filters: source, job type, date range
 */

import React, { useState, useMemo } from 'react'
import { DollarSign, Filter, X, Trash2, TrendingUp } from 'lucide-react'
import LeadTemperature, { calculateTemperature, type LeadTemperatureData } from './LeadTemperature'

export interface PipelineLead {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  score: number // 0-100
  estimatedValue?: number
  source?: string
  jobType?: string
  status: 'advance' | 'park' | 'kill'
  daysSinceLastContact: number
  nextActionDue?: string // ISO date
  lastContactDate?: string
  temperatureData?: LeadTemperatureData
  notes?: string
}

export interface PipelineFilters {
  source?: string[]
  jobType?: string[]
  dateRange?: { from: string; to: string }
  scoreMin?: number
}

export interface PipelineTabProps {
  leads: PipelineLead[]
  onLeadMove?: (leadId: string, newStatus: 'advance' | 'park' | 'kill') => void
  onLeadSelect?: (leadId: string) => void
  onLeadDelete?: (leadId: string) => void
  isLoading?: boolean
}

/**
 * Get column header by status
 */
function getColumnHeader(status: 'advance' | 'park' | 'kill'): { title: string; description: string; color: string } {
  const headers: Record<'advance' | 'park' | 'kill', { title: string; description: string; color: string }> = {
    advance: {
      title: 'ADVANCE',
      description: 'Actively pursued — sorted by follow-up urgency',
      color: 'border-green-400 bg-green-50',
    },
    park: {
      title: 'PARK',
      description: 'On hold — sorted by re-engagement date',
      color: 'border-yellow-400 bg-yellow-50',
    },
    kill: {
      title: 'KILL',
      description: 'Rejected — archived for pattern analysis',
      color: 'border-red-400 bg-red-50',
    },
  }
  return headers[status]
}

/**
 * Calculate total value in ADVANCE column
 */
function calculatePipelineValue(leads: PipelineLead[]): number {
  return leads
    .filter(l => l.status === 'advance')
    .reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0)
}

/**
 * Score badge component
 */
function ScoreBadge({ score }: { score: number }) {
  let bgColor = 'bg-green-600'
  if (score < 40) bgColor = 'bg-red-600'
  else if (score < 60) bgColor = 'bg-yellow-600'
  else if (score < 80) bgColor = 'bg-blue-600'

  return (
    <span className={`${bgColor} text-white text-xs font-bold px-2 py-1 rounded-full inline-block`}>
      {score}%
    </span>
  )
}

/**
 * Lead Card Component
 */
function LeadCard({
  lead,
  onMove,
  onSelect,
  onDelete,
}: {
  lead: PipelineLead
  onMove?: (newStatus: 'advance' | 'park' | 'kill') => void
  onSelect?: () => void
  onDelete?: () => void
}) {
  const [showActions, setShowActions] = useState(false)
  const temperatureData = lead.temperatureData || {
    daysSinceLastResponse: lead.daysSinceLastContact,
  }

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Header: Name and Score */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h4 className="font-bold text-gray-900 truncate">{lead.name}</h4>
          {lead.company && <p className="text-xs text-gray-500 truncate">{lead.company}</p>}
        </div>
        <ScoreBadge score={lead.score} />
      </div>

      {/* Temperature Indicator */}
      <div className="mb-3">
        <LeadTemperature leadId={lead.id} data={temperatureData} size="small" />
      </div>

      {/* Contact Info */}
      <div className="text-xs text-gray-600 mb-3 space-y-1">
        {lead.phone && (
          <p>
            <strong>Phone:</strong> {lead.phone}
          </p>
        )}
        {lead.jobType && (
          <p>
            <strong>Job Type:</strong> {lead.jobType}
          </p>
        )}
        {lead.source && (
          <p>
            <strong>Source:</strong> {lead.source}
          </p>
        )}
      </div>

      {/* Days Since Contact / Next Action Due */}
      <div className="text-xs text-gray-600 mb-3 p-2 bg-gray-100 rounded">
        <p>
          <strong>Last Contact:</strong> {lead.daysSinceLastContact} days ago
        </p>
        {lead.nextActionDue && (
          <p>
            <strong>Next Action:</strong> {new Date(lead.nextActionDue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        )}
      </div>

      {/* Estimated Value (if in ADVANCE) */}
      {lead.estimatedValue && lead.status === 'advance' && (
        <div className="text-xs font-semibold text-green-700 mb-3">
          <DollarSign size={12} className="inline mr-1" />
          {lead.estimatedValue.toLocaleString('en-US')}
        </div>
      )}

      {/* Notes Preview */}
      {lead.notes && <p className="text-xs text-gray-600 italic line-clamp-2 mb-3">{lead.notes}</p>}

      {/* Action Buttons (on hover) */}
      {showActions && (
        <div className="flex gap-1 mt-2 border-t pt-2">
          {lead.status !== 'advance' && (
            <button
              onClick={e => {
                e.stopPropagation()
                onMove?.('advance')
              }}
              className="text-xs px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded font-semibold"
              title="Move to ADVANCE"
            >
              → Advance
            </button>
          )}
          {lead.status !== 'park' && (
            <button
              onClick={e => {
                e.stopPropagation()
                onMove?.('park')
              }}
              className="text-xs px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 rounded font-semibold"
              title="Move to PARK"
            >
              ↔ Park
            </button>
          )}
          {lead.status !== 'kill' && (
            <button
              onClick={e => {
                e.stopPropagation()
                onMove?.('kill')
              }}
              className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded font-semibold"
              title="Move to KILL"
            >
              Kill ✗
            </button>
          )}
          <button
            onClick={e => {
              e.stopPropagation()
              onDelete?.()
            }}
            className="ml-auto text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded"
            title="Delete lead"
          >
            <Trash2 size={12} className="inline" />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Pipeline Column Component
 */
function PipelineColumn({
  status,
  leads,
  onLeadMove,
  onLeadSelect,
  onLeadDelete,
}: {
  status: 'advance' | 'park' | 'kill'
  leads: PipelineLead[]
  onLeadMove?: (leadId: string, newStatus: 'advance' | 'park' | 'kill') => void
  onLeadSelect?: (leadId: string) => void
  onLeadDelete?: (leadId: string) => void
}) {
  const header = getColumnHeader(status)
  const columnLeads = leads.filter(l => l.status === status)

  return (
    <div className={`flex-1 border-t-4 rounded-lg overflow-hidden flex flex-col ${header.color}`}>
      {/* Column Header */}
      <div className="bg-white px-4 py-3 border-b border-gray-200">
        <h3 className="font-bold text-gray-900 mb-1">{header.title}</h3>
        <p className="text-xs text-gray-600 mb-2">{header.description}</p>
        <div className="inline-block px-2 py-1 bg-gray-200 text-gray-700 text-xs font-semibold rounded">
          {columnLeads.length} leads
        </div>
      </div>

      {/* Lead Cards */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-opacity-30">
        {columnLeads.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <p className="text-sm">No leads</p>
          </div>
        ) : (
          columnLeads.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onMove={newStatus => onLeadMove?.(lead.id, newStatus)}
              onSelect={() => onLeadSelect?.(lead.id)}
              onDelete={() => onLeadDelete?.(lead.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * PipelineTab: Main pipeline kanban component
 */
export const PipelineTab: React.FC<PipelineTabProps> = ({
  leads,
  onLeadMove,
  onLeadSelect,
  onLeadDelete,
  isLoading = false,
}) => {
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<PipelineFilters>({})

  const allSources = useMemo(() => [...new Set(leads.map(l => l.source).filter((s): s is string => Boolean(s)))], [leads])
  const allJobTypes = useMemo(() => [...new Set(leads.map(l => l.jobType).filter((jt): jt is string => Boolean(jt)))], [leads])

  // Apply filters
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      if (filters.source?.length && !filters.source.includes(lead.source || '')) return false
      if (filters.jobType?.length && !filters.jobType.includes(lead.jobType || '')) return false
      if (filters.scoreMin && lead.score < filters.scoreMin) return false
      return true
    })
  }, [leads, filters])

  const pipelineValue = calculatePipelineValue(filteredLeads)

  // Sort leads within each column
  const sortedLeads = useMemo(() => {
    return [...filteredLeads].sort((a, b) => {
      if (a.status === 'advance' && b.status === 'advance') {
        // In ADVANCE, sort by next action due date (most urgent first)
        const aDue = a.nextActionDue ? new Date(a.nextActionDue).getTime() : Infinity
        const bDue = b.nextActionDue ? new Date(b.nextActionDue).getTime() : Infinity
        return aDue - bDue
      }
      if (a.status === 'park' && b.status === 'park') {
        // In PARK, sort by days since contact (oldest first, needs re-engagement)
        return b.daysSinceLastContact - a.daysSinceLastContact
      }
      return 0
    })
  }, [filteredLeads])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-white rounded-lg">
        <p className="text-gray-600">Loading pipeline...</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-gray-100 rounded-lg p-6">
      {/* Top Bar: Title, Pipeline Value, Filters */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Sales Pipeline</h2>

          {/* Pipeline Value Card */}
          <div className="px-4 py-3 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2">
              <DollarSign size={20} className="text-green-600" />
              <div>
                <p className="text-xs text-gray-600">Pipeline Value (ADVANCE)</p>
                <p className="text-lg font-bold text-green-700">${pipelineValue.toLocaleString('en-US')}</p>
              </div>
              <TrendingUp size={16} className="text-green-600 ml-2" />
            </div>
          </div>

          {/* Filter Button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Filter size={16} />
            Filters
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Filter by:</h3>
              <button
                onClick={() => {
                  setFilters({})
                  setShowFilters(false)
                }}
                className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
              >
                <X size={14} />
                Clear
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Source Filter */}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-2 block">Source</label>
                <div className="space-y-2">
                  {allSources.map(source => (
                    <label key={source} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.source?.includes(source) || false}
                        onChange={e => {
                          const newSources = e.target.checked
                            ? [...(filters.source || []), source]
                            : filters.source?.filter(s => s !== source) || []
                          setFilters({ ...filters, source: newSources.length > 0 ? newSources : undefined })
                        }}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{source}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Job Type Filter */}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-2 block">Job Type</label>
                <div className="space-y-2">
                  {allJobTypes.map(jobType => (
                    <label key={jobType} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.jobType?.includes(jobType) || false}
                        onChange={e => {
                          const newJobTypes = e.target.checked
                            ? [...(filters.jobType || []), jobType]
                            : filters.jobType?.filter(jt => jt !== jobType) || []
                          setFilters({
                            ...filters,
                            jobType: newJobTypes.length > 0 ? newJobTypes : undefined,
                          })
                        }}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{jobType}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Min Score Filter */}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-2 block">Min Score</label>
                <select
                  value={filters.scoreMin || ''}
                  onChange={e => {
                    const value = e.target.value ? parseInt(e.target.value) : undefined
                    setFilters({ ...filters, scoreMin: value })
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">Any Score</option>
                  <option value="40">40+</option>
                  <option value="60">60+</option>
                  <option value="80">80+</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Kanban Columns */}
      <div className="flex gap-6 h-[calc(100%-120px)]">
        <PipelineColumn
          status="advance"
          leads={sortedLeads}
          onLeadMove={onLeadMove}
          onLeadSelect={onLeadSelect}
          onLeadDelete={onLeadDelete}
        />
        <PipelineColumn
          status="park"
          leads={sortedLeads}
          onLeadMove={onLeadMove}
          onLeadSelect={onLeadSelect}
          onLeadDelete={onLeadDelete}
        />
        <PipelineColumn
          status="kill"
          leads={sortedLeads}
          onLeadMove={onLeadMove}
          onLeadSelect={onLeadSelect}
          onLeadDelete={onLeadDelete}
        />
      </div>
    </div>
  )
}

export default PipelineTab
