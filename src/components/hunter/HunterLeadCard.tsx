// @ts-nocheck
/**
 * HunterLeadCard — Expandable lead card component
 *
 * HUNTER-GEOCODING-DISTANCE-CARDS-APR25-2026-1 rebuild:
 *
 * Collapsed view (top to bottom):
 *   Row 1: contact_name (bold) | distance (big) + drive time
 *   Row 2: city + ZIP location | score badge
 *   Row 3: permit badges (permit_number, permit_status, permit_type_code, sqft)
 *   Row 4: description (2 lines, truncated)
 *   Row 5: action buttons (Open Estimate / Won / Lost / Deferred / Open in Maps)
 *
 * Expanded view:
 *   Full card with contact info, job intel, pitch script, pitch angles, notes, actions.
 *
 * CRITICAL: Won/Lost/Deferred/Delete/Notes behaviors all preserved.
 */

import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  MapPin,
  Copy,
  Zap,
  BookOpen,
  CheckCircle,
  XCircle,
  Clock,
  Edit2,
  Trash2,
  Navigation,
  ExternalLink,
} from 'lucide-react'
import clsx from 'clsx'
import { HunterScoreBadge, type ScoreFactor } from './HunterScoreBadge'
import { useHunterStore } from '@/store/hunterStore'
import { LostDebriefModal } from './LostDebriefModal'
import { formatDistance, formatDriveTime } from '@/services/geocoding/distance'

// Re-export canonical HunterLead so consumers (e.g. HunterPanel) can keep
// their existing 'import { type HunterLead } from ./HunterLeadCard' path.
// Source of truth: src/services/hunter/HunterTypes.ts
export type { HunterLead } from '@/services/hunter/HunterTypes'

export interface HunterLeadCardProps {
  lead: HunterLead
  onCall?: (lead: HunterLead) => void
  onCopyPitch?: (pitch: string) => void
  onPractice?: (lead: HunterLead) => void
  onStatusChange?: (leadId: string, status: 'won' | 'lost' | 'deferred') => void
  onNotesChange?: (leadId: string, notes: string) => void
}

const JOB_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  electrical: { bg: 'bg-blue-900', text: 'text-blue-200', border: 'border-blue-700' },
  hvac: { bg: 'bg-orange-900', text: 'text-orange-200', border: 'border-orange-700' },
  plumbing: { bg: 'bg-cyan-900', text: 'text-cyan-200', border: 'border-cyan-700' },
  solar: { bg: 'bg-yellow-900', text: 'text-yellow-200', border: 'border-yellow-700' },
  reno: { bg: 'bg-purple-900', text: 'text-purple-200', border: 'border-purple-700' },
  maintenance: { bg: 'bg-green-900', text: 'text-green-200', border: 'border-green-700' },
}

function getJobTypeColor(jobType?: string) {
  if (!jobType) return JOB_TYPE_COLORS.electrical
  const key = jobType.toLowerCase()
  return JOB_TYPE_COLORS[key] || JOB_TYPE_COLORS.electrical
}

/** Build Google Maps URL from lead address fields */
function buildMapsUrl(lead: any): string {
  const parts: string[] = []
  if (lead.address) parts.push(lead.address)
  if (lead.city) parts.push(lead.city)
  parts.push('CA')
  return `https://maps.google.com/?q=${encodeURIComponent(parts.join(', '))}`
}

/** Extract city display text from lead — handles TLMA leads where city may be on the address */
function getCityDisplay(lead: any): string {
  if (lead.city && lead.city.trim()) return lead.city.trim()

  // Attempt to extract city from address string for TLMA leads
  if (lead.address && lead.address.trim()) {
    const parts = lead.address.split(',')
    if (parts.length >= 2) {
      const possibleCity = parts[parts.length - 2]?.trim()
      if (possibleCity && possibleCity.length > 1) return possibleCity
    }
  }
  return 'Location unknown'
}

export function HunterLeadCard({
  lead,
  onCall,
  onCopyPitch,
  onPractice,
  onStatusChange,
  onNotesChange,
}: HunterLeadCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(lead.notes || '')
  const [lostModalOpen, setLostModalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const updateLeadStatus = useHunterStore((s) => s.updateLeadStatus)
  const deleteLead = useHunterStore((s) => s.deleteLead)

  const jobTypeColor = getJobTypeColor(lead.jobTypeCategory)

  // Distance display — prefer distanceFromBaseMiles (geocoded), fall back to legacy distance
  const distanceMiles: number | null | undefined =
    lead.distanceFromBaseMiles ?? (typeof lead.distance === 'number' ? lead.distance : undefined)

  const distanceDisplay = formatDistance(distanceMiles)
  const driveTimeDisplay = formatDriveTime(distanceMiles)

  const cityDisplay = getCityDisplay(lead)
  const hasLocation = !!(lead.address || lead.city)

  const handleCopyPitch = () => {
    const scriptText = lead.pitchScript
      ? `${lead.pitchScript.opener}\n\n${lead.pitchScript.valueProp}\n\n${lead.pitchScript.socialProof}\n\n${lead.pitchScript.softAsk}\n\n${lead.pitchScript.objectionAnticipation}\n\n${lead.pitchScript.close}`
      : lead.pitchPreview || ''

    if (onCopyPitch) onCopyPitch(scriptText)
    navigator.clipboard.writeText(scriptText)
  }

  const handleSaveNotes = () => {
    if (onNotesChange) onNotesChange(lead.id, notes)
    setEditingNotes(false)
  }

  const handleOpenMaps = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(buildMapsUrl(lead), '_blank', 'noopener noreferrer')
  }

  // ─── Permit metadata badges ──────────────────────────────────────────────
  const showPermitBadges =
    lead.source === 'tlma_riverside' ||
    lead.permit_number ||
    lead.permit_status ||
    lead.permit_type_code

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden hover:border-gray-700 transition-colors">
      {/* COLLAPSED VIEW */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full p-4 text-left hover:bg-gray-800 transition-colors"
        >
          {/* Row 1: Contact name + Distance */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-base font-bold text-white truncate">
                {lead.contactName || lead.contact_name || 'Unknown'}
              </h3>
              {lead.phone && (
                <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
                  <Phone size={11} />
                  <span className="hidden sm:inline">{lead.phone}</span>
                </div>
              )}
            </div>

            {/* Distance — prominent top-right */}
            <div className="text-right shrink-0">
              <div className={clsx(
                'text-sm font-bold',
                distanceMiles != null ? 'text-emerald-400' : 'text-gray-600'
              )}>
                {distanceDisplay}
              </div>
              {distanceMiles != null && distanceMiles >= 0 && (
                <div className="text-xs text-gray-500">{driveTimeDisplay}</div>
              )}
            </div>
          </div>

          {/* Row 2: City/Location + Score badge */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-400 min-w-0">
              <MapPin size={11} className="shrink-0" />
              <span className="truncate">{cityDisplay}</span>
            </div>
            <div className="shrink-0">
              <HunterScoreBadge
                score={lead.score}
                factors={lead.scoringFactors}
                size="sm"
              />
            </div>
          </div>

          {/* Row 3: Permit badges + sqft */}
          {showPermitBadges && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {lead.permit_number && (
                <span className="inline-flex items-center text-xs px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded border border-gray-700 font-mono">
                  #{lead.permit_number}
                </span>
              )}
              {lead.permit_status && (
                <span className={clsx(
                  'inline-flex items-center text-xs px-1.5 py-0.5 rounded border',
                  lead.permit_status === 'Issued'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : lead.permit_status === 'Applied'
                    ? 'bg-blue-950 text-blue-300 border-blue-800'
                    : 'bg-gray-800 text-gray-400 border-gray-700'
                )}>
                  {lead.permit_status}
                </span>
              )}
              {lead.permit_type_code && (
                <span className="inline-flex items-center text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded border border-gray-700">
                  {lead.permit_type_code}
                </span>
              )}
              {lead.total_sqft != null && lead.total_sqft > 0 && (
                <span className="inline-flex items-center text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded border border-gray-700">
                  {lead.total_sqft.toLocaleString()} sqft
                </span>
              )}
            </div>
          )}

          {/* Row 4: Description (2 lines truncated) */}
          {(lead.description || lead.pitchPreview) && (
            <p className="text-xs text-gray-400 line-clamp-2 mb-2">
              {lead.description || lead.pitchPreview}
            </p>
          )}

          {/* Row 5: Quick action buttons */}
          <div
            className="flex items-center gap-1.5 mt-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Won */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm('Mark this lead as Won? It will move to Pipeline.')) {
                  updateLeadStatus(lead.id, 'won').catch((err) => {
                    console.error('Failed to mark lead as Won:', err)
                  })
                }
              }}
              className={clsx(
                'flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs',
                lead.status === 'won'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              )}
              title="Mark as Won"
            >
              <CheckCircle size={12} />
              <span className="hidden sm:inline">Won</span>
            </button>

            {/* Lost */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setLostModalOpen(true)
              }}
              className={clsx(
                'flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs',
                lead.status === 'lost'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              )}
              title="Mark as Lost"
            >
              <XCircle size={12} />
              <span className="hidden sm:inline">Lost</span>
            </button>

            {/* Deferred */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                updateLeadStatus(lead.id, 'deferred').catch((err) => {
                  console.error('Failed to mark lead as Deferred:', err)
                })
              }}
              className={clsx(
                'flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs',
                lead.status === 'deferred'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              )}
              title="Defer to Study Queue"
            >
              <Clock size={12} />
              <span className="hidden sm:inline">Defer</span>
            </button>

            {/* Open in Maps */}
            {hasLocation && (
              <button
                onClick={handleOpenMaps}
                className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors text-xs ml-auto"
                title="Open in Google Maps"
              >
                <Navigation size={12} />
                <span className="hidden sm:inline">Maps</span>
              </button>
            )}

            {/* Expand */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(true)
              }}
              className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors text-xs"
              title="Expand lead details"
            >
              <ChevronDown size={12} />
              <span className="hidden sm:inline">More</span>
            </button>
          </div>
        </button>
      )}

      {/* EXPANDED VIEW */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between pb-4 border-b border-gray-700">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-gray-500">ID: {lead.id?.slice(0, 8)}</span>
                {lead.sourceTag && (
                  <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded">
                    {lead.sourceTag}
                  </span>
                )}
                {lead.source === 'tlma_riverside' && (
                  <span className="text-xs px-2 py-0.5 bg-blue-950 text-blue-300 rounded border border-blue-800">
                    TLMA
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-white">
                {lead.contactName || lead.contact_name || 'Unknown'}
              </h3>
              {/* Location + Distance */}
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <div className="flex items-center gap-1 text-sm text-gray-400">
                  <MapPin size={13} />
                  <span>{cityDisplay}</span>
                </div>
                {distanceMiles != null && (
                  <div className="flex items-center gap-1 text-sm font-semibold text-emerald-400">
                    <Navigation size={13} />
                    <span>{distanceDisplay}</span>
                    <span className="text-xs text-gray-500 font-normal">{driveTimeDisplay}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              <HunterScoreBadge
                score={lead.score}
                factors={lead.scoringFactors}
                size="lg"
              />
              <button
                onClick={() => setExpanded(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                <ChevronUp size={20} />
              </button>
            </div>
          </div>

          {/* Freshness Indicator */}
          {lead.freshness && (
            <div className="text-xs text-gray-400">
              🕐 {lead.freshness}
            </div>
          )}

          {/* Permit Metadata (TLMA) */}
          {showPermitBadges && (
            <div className="flex flex-wrap gap-1.5">
              {lead.permit_number && (
                <span className="inline-flex items-center text-xs px-2 py-1 bg-gray-800 text-gray-300 rounded border border-gray-700 font-mono">
                  Permit #{lead.permit_number}
                </span>
              )}
              {lead.permit_status && (
                <span className={clsx(
                  'inline-flex items-center text-xs px-2 py-1 rounded border',
                  lead.permit_status === 'Issued'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : lead.permit_status === 'Applied'
                    ? 'bg-blue-950 text-blue-300 border-blue-800'
                    : 'bg-gray-800 text-gray-400 border-gray-700'
                )}>
                  {lead.permit_status}
                </span>
              )}
              {lead.permit_type_code && (
                <span className="inline-flex items-center text-xs px-2 py-1 bg-gray-800 text-gray-400 rounded border border-gray-700">
                  {lead.permit_type_code}
                </span>
              )}
              {lead.total_sqft != null && lead.total_sqft > 0 && (
                <span className="inline-flex items-center text-xs px-2 py-1 bg-gray-800 text-gray-400 rounded border border-gray-700">
                  {lead.total_sqft.toLocaleString()} sqft
                </span>
              )}
            </div>
          )}

          {/* Contact Section */}
          {(lead.phone || lead.email || lead.company || lead.company_name || lead.contact_company || lead.bestContactMethod) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-200">Contact</h4>
              <div className="grid grid-cols-1 gap-1.5 text-sm text-gray-300">
                {lead.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={14} />
                    <span>{lead.phone}</span>
                    {lead.bestContactMethod === 'phone' && (
                      <span className="text-xs text-emerald-400">✓ Preferred</span>
                    )}
                  </div>
                )}
                {lead.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={14} />
                    <span>{lead.email}</span>
                    {lead.bestContactMethod === 'email' && (
                      <span className="text-xs text-emerald-400">✓ Preferred</span>
                    )}
                  </div>
                )}
                {(lead.company || lead.company_name || lead.contact_company) && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <span className="font-medium">
                      {lead.company || lead.company_name || lead.contact_company}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Address section */}
          {(lead.address || lead.city) && (
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-gray-200">Location</h4>
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  {lead.address && <div>{lead.address}</div>}
                  {lead.city && <div>{lead.city}</div>}
                </div>
                <button
                  onClick={handleOpenMaps}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors"
                >
                  <Navigation size={12} />
                  Open in Maps
                  <ExternalLink size={11} />
                </button>
              </div>
              {lead.geocodingStatus === 'success' && lead.latitude && (
                <div className="text-xs text-gray-600">
                  {lead.latitude.toFixed(4)}°N, {lead.longitude?.toFixed(4)}°W
                </div>
              )}
            </div>
          )}

          {/* Job Intel Section */}
          {(lead.triggerReason || lead.estimatedScope || lead.valueRange || lead.description) && (
            <div className="space-y-2 p-3 bg-gray-800 rounded">
              <h4 className="text-sm font-semibold text-gray-200">Job Intel</h4>
              {lead.description && (
                <div className="text-xs text-gray-300">
                  <span className="font-medium text-gray-200">Description:</span> {lead.description}
                </div>
              )}
              {lead.triggerReason && (
                <div className="text-xs text-gray-300">
                  <span className="font-medium text-gray-200">Trigger:</span> {lead.triggerReason}
                </div>
              )}
              {lead.estimatedScope && (
                <div className="text-xs text-gray-300">
                  <span className="font-medium text-gray-200">Scope:</span> {lead.estimatedScope}
                </div>
              )}
              {lead.valueRange && (
                <div className="text-xs text-gray-300">
                  <span className="font-medium text-gray-200">Value:</span> $
                  {lead.valueRange.min.toLocaleString()} - ${lead.valueRange.max.toLocaleString()}
                </div>
              )}
              {lead.marginEstimate !== undefined && (
                <div className="text-xs text-gray-300">
                  <span className="font-medium text-gray-200">Margin Estimate:</span> {lead.marginEstimate}%
                </div>
              )}
              {lead.comparableJobs && lead.comparableJobs.length > 0 && (
                <div className="text-xs text-gray-300 mt-2">
                  <span className="font-medium text-gray-200">Comparable:</span>
                  {lead.comparableJobs.map((job, i) => (
                    <div key={i} className="ml-2">
                      {job.name || job.description}: ${(job.value || 0).toLocaleString()} ({job.margin}% margin)
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pitch Script Section */}
          {lead.pitchScript && (
            <div className="space-y-2 p-3 bg-gray-800 rounded">
              <h4 className="text-sm font-semibold text-gray-200">Pitch Script</h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <div>
                  <span className="font-medium text-blue-300">Opener:</span>
                  <p className="mt-0.5">{lead.pitchScript.opener}</p>
                </div>
                <div>
                  <span className="font-medium text-blue-300">Value Prop:</span>
                  <p className="mt-0.5">{lead.pitchScript.valueProp}</p>
                </div>
                <div>
                  <span className="font-medium text-blue-300">Social Proof:</span>
                  <p className="mt-0.5">{lead.pitchScript.socialProof}</p>
                </div>
                <div>
                  <span className="font-medium text-blue-300">Soft Ask:</span>
                  <p className="mt-0.5">{lead.pitchScript.softAsk}</p>
                </div>
                <div>
                  <span className="font-medium text-blue-300">Objection:</span>
                  <p className="mt-0.5">{lead.pitchScript.objectionAnticipation}</p>
                </div>
                <div>
                  <span className="font-medium text-blue-300">Close:</span>
                  <p className="mt-0.5">{lead.pitchScript.close}</p>
                </div>
              </div>
            </div>
          )}

          {/* Pitch Angles Section */}
          {lead.pitchAngles && lead.pitchAngles.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-200">Pitch Angles</h4>
              <div className="flex flex-wrap gap-2">
                {lead.pitchAngles.map((angle, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'text-xs px-2 py-1 rounded border',
                      angle.applied
                        ? 'bg-emerald-900 border-emerald-700 text-emerald-200'
                        : 'bg-gray-800 border-gray-700 text-gray-400'
                    )}
                    title={angle.reasoning || angle.rationale}
                  >
                    {angle.angle}
                    {(angle.reasoning || angle.rationale) && ' 💡'}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes Section */}
          <div className="space-y-2 p-3 bg-gray-800 rounded">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-200">Notes</h4>
              <button
                onClick={() => setEditingNotes(!editingNotes)}
                className="text-gray-400 hover:text-gray-200 transition-colors"
              >
                <Edit2 size={14} />
              </button>
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="Add notes..."
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveNotes}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingNotes(false)
                      setNotes(lead.notes || '')
                    }}
                    className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-300">
                {notes || <span className="text-gray-500 italic">No notes yet</span>}
              </p>
            )}
          </div>

          {/* Actions Row */}
          <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-700">
            <button
              onClick={() => onCall && onCall(lead)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
            >
              <Phone size={14} />
              Call
            </button>

            <button
              onClick={handleCopyPitch}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors"
            >
              <Copy size={14} />
              Copy Pitch
            </button>

            <button
              onClick={() => onPractice && onPractice(lead)}
              className="flex items-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded transition-colors"
            >
              <BookOpen size={14} />
              Practice
            </button>

            {/* Open in Maps */}
            {hasLocation && (
              <button
                onClick={handleOpenMaps}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded transition-colors"
              >
                <Navigation size={14} />
                Maps
                <ExternalLink size={12} />
              </button>
            )}

            {/* Status Change Buttons */}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => {
                  if (window.confirm('Mark this lead as Won? It will move to Pipeline.')) {
                    updateLeadStatus(lead.id, 'won').catch((err) => {
                      console.error('Failed to mark lead as Won:', err)
                    })
                  }
                }}
                aria-label="Mark as Won"
                className={clsx(
                  'flex items-center gap-1 px-2 py-2 rounded transition-colors',
                  lead.status === 'won'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                )}
                title="Mark as Won"
              >
                <CheckCircle size={14} />
              </button>

              <button
                onClick={() => setLostModalOpen(true)}
                aria-label="Mark as Lost"
                className={clsx(
                  'flex items-center gap-1 px-2 py-2 rounded transition-colors',
                  lead.status === 'lost'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                )}
                title="Mark as Lost"
              >
                <XCircle size={14} />
              </button>

              <button
                onClick={() => {
                  updateLeadStatus(lead.id, 'deferred').catch((err) => {
                    console.error('Failed to mark lead as Deferred:', err)
                  })
                }}
                aria-label="Mark as Deferred"
                className={clsx(
                  'flex items-center gap-1 px-2 py-2 rounded transition-colors',
                  lead.status === 'deferred'
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                )}
                title="Defer to Study Queue"
              >
                <Clock size={14} />
              </button>

              <button
                onClick={() => setConfirmDelete(true)}
                className="p-2 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 transition"
                title="Delete lead (permanent)"
                aria-label="Delete lead"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {/* Last Activity */}
          {lead.lastActivity && (
            <div className="text-xs text-gray-500 text-right pt-2">
              Last activity: {lead.lastActivity}
            </div>
          )}
        </div>
      )}

      {lostModalOpen && (
        <LostDebriefModal
          lead={lead}
          isOpen={lostModalOpen}
          onClose={() => setLostModalOpen(false)}
        />
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="bg-gray-900 border border-red-800 rounded-lg p-6 max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-bold mb-2">Delete lead?</h3>
            <p className="text-sm text-gray-400 mb-4">
              This permanently removes the lead from HUNTER. Use Archive or Mark
              as Lost if you want to preserve history. This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 text-sm text-gray-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await deleteLead(lead.id)
                    setConfirmDelete(false)
                  } catch (err) {
                    console.error('Failed to delete lead:', err)
                  }
                }}
                className="px-3 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default HunterLeadCard
