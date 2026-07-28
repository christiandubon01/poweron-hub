// @ts-nocheck
/**
 * EmployeeProfilePanel — full profile view for a single crew member.
 * CREW-DIRECTORY-PROFILE-1: dual registration status, identity, portal + cost model sections.
 */

import React, { useState, useEffect } from 'react'
import {
  ArrowLeft,
  DollarSign,
  Mail,
  User,
  CheckCircle,
  Clock,
  Briefcase,
  Edit2,
  Check,
  X,
  Archive,
  Trash2,
  AlertTriangle,
  BarChart2,
  Star,
} from 'lucide-react'
import {
  getLatestSnapshot,
  getQualityRatings,
  getCompensationHistory,
  type PerformanceSnapshot,
  type CompensationEvent,
} from '@/services/employeePerformanceService'
import { type UnifiedCrewMember } from '@/services/crewPortalService'
import {
  updateEmployeeDisplayName,
  archiveEmployee,
  deleteEmployeePortalRecord,
} from '@/services/crewPortalService'
import { resendEmployeeInvite } from '@/services/employeeInviteService'
import EmployeeInviteModal from '@/components/admin/EmployeeInviteModal'
import { TRADE_ROLE_LABELS, TRADE_ROLE_BADGE_CLASS } from '@/services/roleService'

// ─── Registration pills (shared with directory row) ──────────────────────────

export function CostModelPill({
  hasCostModel,
  onClick,
}: {
  hasCostModel: boolean
  onClick?: () => void
}) {
  if (hasCostModel) {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors hover:bg-purple-900/30"
        style={{ color: '#c084fc', borderColor: '#7e22ce55', backgroundColor: '#3b0764aa' }}
        title="View cost model record"
      >
        <DollarSign size={10} />
        Cost Model
      </button>
    )
  }
  return (
    <span
      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border"
      style={{ color: '#4b5563', borderColor: '#374151', backgroundColor: 'transparent' }}
      title="Not in cost model"
    >
      <DollarSign size={10} />
      Cost Model
    </span>
  )
}

export function PortalPill({
  hasPortal,
  portalStatus,
  onClick,
}: {
  hasPortal: boolean
  portalStatus: 'active' | 'pending' | null
  onClick?: () => void
}) {
  if (!hasPortal) {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors hover:bg-teal-900/20"
        style={{ color: '#4b5563', borderColor: '#374151', backgroundColor: 'transparent' }}
        title="Invite to portal"
      >
        <Mail size={10} />
        Portal
      </button>
    )
  }
  if (portalStatus === 'pending') {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors hover:bg-amber-900/30"
        style={{ color: '#fbbf24', borderColor: '#78350f55', backgroundColor: '#451a0344' }}
        title="View portal record (invite pending)"
      >
        <Clock size={10} />
        Portal
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors hover:bg-teal-900/30"
      style={{ color: '#2dd4bf', borderColor: '#134e4a55', backgroundColor: '#042f2e44' }}
      title="View portal record"
    >
      <CheckCircle size={10} />
      Portal
    </button>
  )
}

// ─── Cost Model modal ─────────────────────────────────────────────────────────

function CostModelModal({
  member,
  onClose,
}: {
  member: UnifiedCrewMember
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-xl border p-6 w-full max-w-md"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128', boxShadow: '0 8px 32px #000000aa' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <DollarSign size={14} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Cost Model Record</h3>
        </div>

        <div className="space-y-3">
          <Row label="Name" value={member.name} />
          <Row label="Role" value={member.backupRole || '—'} />
          <Row
            label="Bill Rate"
            value={member.backupBillRate != null ? `$${member.backupBillRate}/hr` : '—'}
          />
          <Row
            label="Cost Rate"
            value={member.backupCostRate != null ? `$${member.backupCostRate}/hr` : '—'}
          />
          <Row label="ID" value={member.backupEmployeeId || '—'} dim />
        </div>

        <p className="text-[11px] text-gray-700 mt-5">Read only — edit rates in the Team cost model.</p>
      </div>
    </div>
  )
}

// ─── Portal modal ─────────────────────────────────────────────────────────────

function PortalModal({
  member,
  onClose,
  onResent,
}: {
  member: UnifiedCrewMember
  onClose: () => void
  onResent?: () => void
}) {
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleResend() {
    if (!member.profileId) return
    setResending(true)
    setResendMsg(null)
    const res = await resendEmployeeInvite(member.profileId)
    setResending(false)
    setResendMsg({
      ok: res.success,
      text: res.success
        ? `Invite resent to ${res.email || member.email || 'employee'}`
        : (res.error || 'Failed to resend'),
    })
    if (res.success) onResent?.()
  }

  const joinedDate = member.acceptedAt
    ? new Date(member.acceptedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-xl border p-6 w-full max-w-md"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128', boxShadow: '0 8px 32px #000000aa' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <Mail size={14} className="text-teal-400" />
          <h3 className="text-sm font-semibold text-gray-200">Portal Record</h3>
          {member.portalStatus === 'pending' && (
            <span className="text-[11px] text-amber-400 bg-amber-900/20 border border-amber-700/40 px-2 py-0.5 rounded-full">
              Pending Invite
            </span>
          )}
          {member.portalStatus === 'active' && (
            <span className="text-[11px] text-green-400 bg-green-900/20 border border-green-700/40 px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>

        <div className="space-y-3">
          <Row label="Email" value={member.email || '—'} />
          <Row label="Portal Role" value={member.portalRole || '—'} />
          {member.employeeRole && (
            <Row label="Trade Role" value={TRADE_ROLE_LABELS[member.employeeRole] || member.employeeRole} />
          )}
          <Row label="Employment Type" value={formatEmploymentType(member.employmentType)} />
          <Row label="Joined" value={joinedDate || '—'} />
        </div>

        {member.portalAccess && (
          <div className="mt-4">
            <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Portal Access</p>
            <PortalAccessList access={member.portalAccess} />
          </div>
        )}

        {member.portalStatus === 'pending' && member.profileId && (
          <div className="mt-5 pt-4 border-t" style={{ borderColor: '#1e2128' }}>
            <button
              className="text-xs px-3 py-1.5 rounded border transition-colors hover:bg-amber-900/20 disabled:opacity-50"
              style={{ borderColor: '#78350f55', color: '#fbbf24' }}
              disabled={resending}
              onClick={handleResend}
            >
              {resending ? 'Sending…' : 'Resend Invite'}
            </button>
            {resendMsg && (
              <p
                className="text-xs mt-2"
                style={{ color: resendMsg.ok ? '#4ade80' : '#f87171' }}
              >
                {resendMsg.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-gray-500 flex-shrink-0 w-28">{label}</span>
      <span className={`text-xs font-medium text-right ${dim ? 'text-gray-600 font-mono' : 'text-gray-200'}`}>
        {value}
      </span>
    </div>
  )
}

function formatEmploymentType(type: string | null): string {
  if (!type) return '—'
  const map: Record<string, string> = {
    full_time: 'Full Time',
    part_time: 'Part Time',
    subcontractor: 'Subcontractor',
    helper: 'Helper',
  }
  return map[type] || type
}

function PortalAccessList({ access }: { access: Record<string, unknown> | null }) {
  const enabled = Object.entries(access ?? {})
    .filter(([, v]) => v === true || v === 'true')
    .map(([k]) => k.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '))

  if (enabled.length === 0) {
    return <span className="text-xs text-gray-700 italic">None</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {enabled.map((label) => (
        <span
          key={label}
          className="text-[11px] font-medium px-2 py-0.5 rounded-full border text-green-300 bg-green-900/20 border-green-700/40"
        >
          {label}
        </span>
      ))}
    </div>
  )
}

// ─── Editable display name ────────────────────────────────────────────────────

function EditableName({
  name,
  profileId,
  onSaved,
}: {
  name: string
  profileId: string | null
  onSaved: (newName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!profileId) return
    setSaving(true)
    setError(null)
    const res = await updateEmployeeDisplayName(profileId, draft)
    setSaving(false)
    if (res.success) {
      onSaved(draft.trim())
      setEditing(false)
    } else {
      setError(res.error)
    }
  }

  function cancel() {
    setDraft(name)
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          className="text-xl font-bold text-gray-100 bg-transparent border-b border-green-600 focus:outline-none w-48"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') cancel()
          }}
        />
        <button
          onClick={() => void save()}
          disabled={saving}
          className="text-green-400 hover:text-green-300 disabled:opacity-40"
          title="Save"
        >
          <Check size={14} />
        </button>
        <button onClick={cancel} className="text-gray-500 hover:text-gray-300" title="Cancel">
          <X size={14} />
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <h2 className="text-xl font-bold text-gray-100">{name}</h2>
      {profileId && (
        <button
          onClick={() => { setDraft(name); setEditing(true) }}
          className="text-gray-600 hover:text-gray-400 mt-0.5"
          title="Edit display name"
        >
          <Edit2 size={13} />
        </button>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Inline confirm bar ───────────────────────────────────────────────────────

function ConfirmBar({
  message,
  confirmLabel,
  confirmRed,
  onConfirm,
  onCancel,
  busy,
  errorMsg,
}: {
  message: string
  confirmLabel: string
  confirmRed?: boolean
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
  errorMsg?: string | null
}) {
  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{ backgroundColor: '#150a0a', borderColor: '#7f1d1d55' }}
    >
      <p className="text-xs text-gray-300 leading-relaxed">{message}</p>
      {errorMsg && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle size={11} />
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={onConfirm}
          className="text-xs px-3 py-1.5 rounded border disabled:opacity-50 transition-colors"
          style={confirmRed
            ? { borderColor: '#7f1d1d', color: '#f87171', backgroundColor: '#450a0a' }
            : { borderColor: '#78350f55', color: '#fbbf24', backgroundColor: '#451a0344' }}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <button
          disabled={busy}
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Performance summary helpers ─────────────────────────────────────────────

function PerfMini({ label, value, color = 'text-gray-200' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg px-3 py-2 border" style={{ backgroundColor: '#090a0e', borderColor: '#1e2128' }}>
      <p className="text-[11px] text-gray-600">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  )
}

function perfRateColor(rate: number | null): string {
  if (rate === null) return 'text-gray-500'
  if (rate >= 80) return 'text-green-400'
  if (rate >= 60) return 'text-amber-400'
  return 'text-red-400'
}

function perfFmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

function PerformanceSummarySection({
  profileId,
  onNavigateToPerformance,
}: {
  profileId: string
  onNavigateToPerformance?: () => void
}) {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null)
  const [avgRating, setAvgRating] = useState<number | null>(null)
  const [latestEvent, setLatestEvent] = useState<CompensationEvent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setSnapshot(null)
    setAvgRating(null)
    setLatestEvent(null)
    Promise.all([
      getLatestSnapshot(profileId),
      getQualityRatings(profileId),
      getCompensationHistory(profileId),
    ]).then(([snapRes, ratingsRes, eventsRes]) => {
      if (snapRes.success) setSnapshot(snapRes.data)
      if (ratingsRes.success && ratingsRes.data.length > 0) {
        const sum = ratingsRes.data.reduce((acc, r) => acc + r.score, 0)
        setAvgRating(Math.round((sum / ratingsRes.data.length) * 10) / 10)
      }
      if (eventsRes.success && eventsRes.data.length > 0) setLatestEvent(eventsRes.data[0])
      setLoading(false)
    })
  }, [profileId])

  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <BarChart2 size={13} className="text-blue-400" />
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Performance</h4>
        </div>
        {onNavigateToPerformance && (
          <button
            onClick={onNavigateToPerformance}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {snapshot ? 'View Full Report →' : 'Go to Performance Tab →'}
          </button>
        )}
      </div>

      {loading && <p className="text-xs text-gray-600">Loading…</p>}

      {!loading && !snapshot && (
        <p className="text-xs text-gray-600">
          No performance report generated yet.{' '}
          {onNavigateToPerformance && (
            <button
              onClick={onNavigateToPerformance}
              className="text-blue-400 hover:text-blue-300 underline transition-colors"
            >
              Generate one in the Performance tab.
            </button>
          )}
        </p>
      )}

      {!loading && snapshot && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {perfFmtDate(snapshot.period_start)} – {perfFmtDate(snapshot.period_end)}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <PerfMini label="Hours Worked" value={`${(snapshot.paid_minutes / 60).toFixed(1)}h`} />
            <PerfMini label="Tasks Completed" value={`${snapshot.tasks_completed} / ${snapshot.tasks_assigned}`} />
            <PerfMini
              label="On-Time Rate"
              value={snapshot.on_time_rate != null ? `${snapshot.on_time_rate}%` : '—'}
              color={perfRateColor(snapshot.on_time_rate)}
            />
            <PerfMini
              label="Avg Daily Hours"
              value={snapshot.avg_daily_hours != null ? `${snapshot.avg_daily_hours}h` : '—'}
            />
          </div>
          {avgRating != null && (
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    size={12}
                    className={n <= Math.round(avgRating) ? 'text-amber-400 fill-amber-400' : 'text-gray-700'}
                  />
                ))}
              </div>
              <span className="text-xs text-gray-500">{avgRating} avg quality rating</span>
            </div>
          )}
        </div>
      )}

      {!loading && latestEvent && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: '#1a1c23' }}>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Latest Compensation</p>
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-xs font-medium capitalize text-gray-300">{latestEvent.event_type}</span>
            {latestEvent.amount != null && (
              <span className="text-xs text-green-400 font-semibold">
                ${Number(latestEvent.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            )}
            <span className="text-xs text-gray-600 ml-auto">
              Eff. {perfFmtDate(latestEvent.effective_date)}
            </span>
          </div>
          {latestEvent.reason && (
            <p className="text-xs text-gray-500 mt-1">{latestEvent.reason}</p>
          )}
          {onNavigateToPerformance && (
            <button
              onClick={onNavigateToPerformance}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-2 underline"
            >
              View History
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Props & main component ───────────────────────────────────────────────────

interface EmployeeProfilePanelProps {
  member: UnifiedCrewMember
  onBack: () => void
  onInviteSent?: () => void
  onArchived?: () => void
  onDeleted?: () => void
  onNavigateToPerformance?: (profileId: string) => void
}

export default function EmployeeProfilePanel({
  member: initialMember,
  onBack,
  onInviteSent,
  onArchived,
  onDeleted,
  onNavigateToPerformance,
}: EmployeeProfilePanelProps) {
  const [member, setMember] = useState(initialMember)
  const [showCostModal, setShowCostModal] = useState(false)
  const [showPortalModal, setShowPortalModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)

  // Archive confirm state
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  // Delete confirm state
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function handleNameSaved(newName: string) {
    setMember((m) => ({ ...m, name: newName }))
  }

  async function handleArchive() {
    if (!member.profileId) return
    setArchiving(true)
    setArchiveError(null)
    const res = await archiveEmployee(member.profileId)
    setArchiving(false)
    if (res.success) {
      setConfirmArchive(false)
      onArchived?.()
      onBack()
    } else {
      setArchiveError(res.error)
    }
  }

  async function handleDelete() {
    if (!member.profileId) return
    setDeleting(true)
    setDeleteError(null)
    const res = await deleteEmployeePortalRecord(member.profileId)
    setDeleting(false)
    if (res.success) {
      setConfirmDelete(false)
      onDeleted?.()
      onBack()
    } else {
      setDeleteError(res.error)
    }
  }

  const initials = member.name
    .split(' ')
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')

  const isActiveEmployee = member.hasPortal && !!member.userId && member.status !== 'inactive'
  const canDelete = member.hasPortal && (member.portalStatus === 'pending' || member.status === 'inactive')

  return (
    <div className="space-y-5">
      {/* Back link */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        <ArrowLeft size={13} />
        Back to Directory
      </button>

      {/* ── SECTION 1: Identity ── */}
      <div
        className="rounded-xl border p-5"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
            style={{ backgroundColor: '#1e3a5f', color: '#60a5fa' }}
          >
            {initials || <User size={20} />}
          </div>

          {/* Name + type + pills */}
          <div className="flex-1 min-w-0">
            <EditableName
              name={member.name}
              profileId={member.profileId}
              onSaved={handleNameSaved}
            />

            {/* Employment type badge */}
            {member.employmentType && (
              <span
                className="inline-block mt-1 text-[11px] font-medium px-2 py-0.5 rounded-full border"
                style={{ color: '#9ca3af', borderColor: '#374151', backgroundColor: '#111827' }}
              >
                {formatEmploymentType(member.employmentType)}
              </span>
            )}

            {/* Registration pills */}
            <div className="flex items-center gap-2 mt-3">
              <CostModelPill
                hasCostModel={member.hasCostModel}
                onClick={member.hasCostModel ? () => setShowCostModal(true) : undefined}
              />
              <PortalPill
                hasPortal={member.hasPortal}
                portalStatus={member.portalStatus}
                onClick={member.hasPortal
                  ? () => setShowPortalModal(true)
                  : () => setShowInviteModal(true)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Portal Details ── */}
      {member.hasPortal && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Mail size={13} className="text-teal-400" />
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Portal Account</h4>
            {member.portalStatus === 'pending' && (
              <span className="text-[11px] text-amber-400 bg-amber-900/20 border border-amber-700/30 px-1.5 py-0.5 rounded-full">
                Pending
              </span>
            )}
            {member.status === 'inactive' && (
              <span className="text-[11px] text-gray-500 bg-gray-800/40 border border-gray-700/40 px-1.5 py-0.5 rounded-full">
                Archived
              </span>
            )}
          </div>
          <div className="space-y-2.5">
            <Row label="Email" value={member.email || '—'} />
            <Row label="Portal Role" value={member.portalRole || '—'} />
            {member.employeeRole && (
              <Row label="Trade Role" value={TRADE_ROLE_LABELS[member.employeeRole] || member.employeeRole} />
            )}
            <Row label="Employment Type" value={formatEmploymentType(member.employmentType)} />
            <Row
              label="Joined"
              value={member.acceptedAt
                ? new Date(member.acceptedAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })
                : '—'}
            />
          </div>

          {member.portalAccess && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: '#1a1c23' }}>
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Portal Access</p>
              <PortalAccessList access={member.portalAccess} />
            </div>
          )}

          {/* Resend invite (pending only) */}
          {member.portalStatus === 'pending' && member.profileId && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: '#1a1c23' }}>
              <ResendInviteButton profileId={member.profileId} email={member.email} />
            </div>
          )}
        </div>
      )}

      {/* ── SECTION 3: Cost Model Details ── */}
      {member.hasCostModel && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={13} className="text-purple-400" />
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cost Model</h4>
          </div>
          <div className="space-y-2.5">
            <Row label="Role" value={member.backupRole || '—'} />
            <Row
              label="Bill Rate"
              value={member.backupBillRate != null ? `$${member.backupBillRate}/hr` : '—'}
            />
            <Row
              label="Cost Rate"
              value={member.backupCostRate != null ? `$${member.backupCostRate}/hr` : '—'}
            />
          </div>
          <p className="text-[11px] text-gray-700 mt-4">Read only — edit rates in the Team cost model.</p>
        </div>
      )}

      {/* ── SECTION 4: Performance Summary (portal employees only) ── */}
      {member.hasPortal && member.profileId && (
        <PerformanceSummarySection
          profileId={member.profileId}
          onNavigateToPerformance={
            onNavigateToPerformance
              ? () => onNavigateToPerformance(member.profileId!)
              : undefined
          }
        />
      )}

      {/* ── SECTION 5: Actions ── */}
      <div
        className="rounded-xl border p-5 space-y-3"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Briefcase size={13} className="text-gray-500" />
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</h4>
        </div>

        {/* Invite to Portal (no portal record) */}
        {!member.hasPortal && (
          <button
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-colors hover:bg-teal-900/20"
            style={{ borderColor: '#134e4a55', color: '#2dd4bf' }}
            onClick={() => setShowInviteModal(true)}
          >
            <Mail size={12} />
            Invite to Portal
          </button>
        )}

        {/* Archive Employee (all portal employees that aren't already archived) */}
        {member.hasPortal && member.status !== 'inactive' && !confirmArchive && (
          <button
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-colors hover:bg-orange-900/20"
            style={{ borderColor: '#78350f55', color: '#fb923c' }}
            onClick={() => { setConfirmArchive(true); setConfirmDelete(false) }}
          >
            <Archive size={12} />
            Archive Employee
          </button>
        )}

        {confirmArchive && (
          <ConfirmBar
            message={`Archive ${member.name}? They will be hidden from the active directory but their records are preserved. You can restore them by contacting support.`}
            confirmLabel="Archive"
            onConfirm={() => void handleArchive()}
            onCancel={() => { setConfirmArchive(false); setArchiveError(null) }}
            busy={archiving}
            errorMsg={archiveError}
          />
        )}

        {/* Delete Portal Record (pending or archived only) */}
        {canDelete && !confirmDelete && (
          <button
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-colors hover:bg-red-900/20"
            style={{ borderColor: '#7f1d1d55', color: '#f87171' }}
            onClick={() => { setConfirmDelete(true); setConfirmArchive(false) }}
          >
            <Trash2 size={12} />
            Delete Portal Record
          </button>
        )}

        {/* Guard message: active employee cannot be deleted */}
        {isActiveEmployee && !canDelete && member.hasPortal && (
          <p className="text-xs text-gray-600 flex items-center gap-1.5 pt-1">
            <AlertTriangle size={11} className="text-gray-700" />
            Archive this employee before deleting their portal record.
          </p>
        )}

        {confirmDelete && (
          <ConfirmBar
            message={`Permanently delete ${member.name}'s portal record? This cannot be undone. Their time tracking history will be lost.`}
            confirmLabel="Delete"
            confirmRed
            onConfirm={() => void handleDelete()}
            onCancel={() => { setConfirmDelete(false); setDeleteError(null) }}
            busy={deleting}
            errorMsg={deleteError}
          />
        )}
      </div>

      {/* ── Modals ── */}
      {showCostModal && (
        <CostModelModal member={member} onClose={() => setShowCostModal(false)} />
      )}
      {showPortalModal && (
        <PortalModal
          member={member}
          onClose={() => setShowPortalModal(false)}
          onResent={() => setShowPortalModal(false)}
        />
      )}
      {showInviteModal && (
        <EmployeeInviteModal
          initialName={member.name}
          onClose={() => {
            setShowInviteModal(false)
            onInviteSent?.()
          }}
        />
      )}
    </div>
  )
}

// ─── Inline resend button (used in portal section) ────────────────────────────

function ResendInviteButton({ profileId, email }: { profileId: string; email: string | null }) {
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleResend() {
    setSending(true)
    setMsg(null)
    const res = await resendEmployeeInvite(profileId)
    setSending(false)
    setMsg({
      ok: res.success,
      text: res.success
        ? `Invite resent to ${res.email || email || 'employee'}`
        : (res.error || 'Failed to resend'),
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        className="self-start text-xs px-3 py-1.5 rounded border transition-colors hover:bg-amber-900/20 disabled:opacity-50"
        style={{ borderColor: '#78350f55', color: '#fbbf24' }}
        disabled={sending}
        onClick={handleResend}
      >
        {sending ? 'Sending…' : 'Resend Invite'}
      </button>
      {msg && (
        <p className="text-xs" style={{ color: msg.ok ? '#4ade80' : '#f87171' }}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
