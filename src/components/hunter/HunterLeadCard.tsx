// @ts-nocheck
/**
 * HunterLeadCard — Expandable lead card component
 * 
 * Displays lead information in collapsed or expanded state:
 * 
 * Collapsed view:
 * - Score badge (color by tier)
 * - Contact name
 * - Job type chip
 * - One-line pitch preview
 * - Distance
 * - Date
 * 
 * Expanded view:
 * - Full card anatomy with multiple sections
 * - Header with lead ID, source tag, score with tier
 * - Contact info (name, phone, email, company, best contact method)
 * - Job Intel (trigger reason, estimated scope, value range, margin, comparable jobs)
 * - Pitch Script (full generated script)
 * - Pitch Angle (applied angles with reasoning)
 * - Actions row (Call, Copy Pitch, Practice, Won/Lost/Defer, Notes)
 */

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Phone, Mail, MapPin, Copy, Zap, BookOpen, CheckCircle, XCircle, Clock, Edit2 } from 'lucide-react'
import clsx from 'clsx'
import { HunterScoreBadge, type ScoreFactor } from './HunterScoreBadge'

export interface HunterLead {
  id: string
  score: number
  scoringFactors?: ScoreFactor[]
  contactName: string
  jobType: string
  jobTypeCategory?: string
  pitchPreview: string
  distance?: number
  dateDiscovered: string
  sourceTag: string
  freshness?: string
  
  // Contact details
  phone?: string
  email?: string
  company?: string
  bestContactMethod?: 'phone' | 'email' | 'text'
  
  // Job Intel
  triggerReason?: string
  estimatedScope?: string
  valueRange?: { min: number; max: number }
  marginEstimate?: number
  comparableJobs?: Array<{
    id: string
    name: string
    value: number
    margin: number
  }>
  
  // Pitch Script
  pitchScript?: {
    opener: string
    valueProp: string
    socialProof: string
    softAsk: string
    objectionAnticipation: string
    close: string
  }
  
  // Pitch Angles
  pitchAngles?: Array<{
    angle: 'urgency' | 'pain' | 'opportunity' | 'efficiency' | 'safety'
    applied: boolean
    reasoning?: string
  }>
  
  // Status and notes
  status?: 'new' | 'contacted' | 'won' | 'lost' | 'deferred'
  notes?: string
  lastActivity?: string
}

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
  const jobTypeColor = getJobTypeColor(lead.jobTypeCategory)

  const handleCopyPitch = () => {
    const scriptText = lead.pitchScript
      ? `${lead.pitchScript.opener}\n\n${lead.pitchScript.valueProp}\n\n${lead.pitchScript.socialProof}\n\n${lead.pitchScript.softAsk}\n\n${lead.pitchScript.objectionAnticipation}\n\n${lead.pitchScript.close}`
      : lead.pitchPreview
    
    if (onCopyPitch) onCopyPitch(scriptText)
    navigator.clipboard.writeText(scriptText)
  }

  const handleSaveNotes = () => {
    if (onNotesChange) onNotesChange(lead.id, notes)
    setEditingNotes(false)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden hover:border-gray-700 transition-colors">
      {/* COLLAPSED VIEW */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full p-4 text-left hover:bg-gray-800 transition-colors"
        >
          <div className="flex items-start gap-4">
            {/* Score Badge */}
            <HunterScoreBadge
              score={lead.score}
              factors={lead.scoringFactors}
              size="md"
            />

            {/* Lead Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-semibold text-white truncate">
                  {lead.contactName}
                </h3>
                <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded whitespace-nowrap">
                  {lead.sourceTag}
                </span>
              </div>

              {/* Job Type Chip */}
              <div className="mb-2">
                <span
                  className={clsx(
                    'inline-block text-xs font-medium px-2 py-0.5 rounded border',
                    jobTypeColor.bg,
                    jobTypeColor.text,
                    jobTypeColor.border
                  )}
                >
                  {lead.jobType}
                </span>
              </div>

              {/* Pitch Preview */}
              <p className="text-sm text-gray-300 truncate mb-2">
                {lead.pitchPreview}
              </p>

              {/* Footer Info */}
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {lead.distance !== undefined && (
                  <div className="flex items-center gap-1">
                    <MapPin size={12} />
                    <span>{lead.distance} mi</span>
                  </div>
                )}
                <span>{lead.dateDiscovered}</span>
              </div>
            </div>

            {/* Expand Button */}
            <button
              className="text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0 mt-1"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(true)
              }}
            >
              <ChevronDown size={20} />
            </button>
          </div>
        </button>
      )}

      {/* EXPANDED VIEW */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between pb-4 border-b border-gray-700">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-gray-500">ID: {lead.id}</span>
                <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded">
                  {lead.sourceTag}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white">{lead.contactName}</h3>
            </div>
            <div className="flex items-center gap-3">
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

          {/* Contact Section */}
          {(lead.phone || lead.email || lead.company || lead.bestContactMethod) && (
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
                {lead.company && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <span className="font-medium">{lead.company}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Job Intel Section */}
          {(lead.triggerReason || lead.estimatedScope || lead.valueRange) && (
            <div className="space-y-2 p-3 bg-gray-800 rounded">
              <h4 className="text-sm font-semibold text-gray-200">Job Intel</h4>
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
                      {job.name}: ${job.value.toLocaleString()} ({job.margin}% margin)
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
                    title={angle.reasoning}
                  >
                    {angle.angle}
                    {angle.reasoning && ' 💡'}
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

            {/* Status Change Buttons */}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => onStatusChange && onStatusChange(lead.id, 'won')}
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
                onClick={() => onStatusChange && onStatusChange(lead.id, 'lost')}
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
                onClick={() => onStatusChange && onStatusChange(lead.id, 'deferred')}
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
    </div>
  )
}

export default HunterLeadCard
