// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Users,
  Clock,
  Briefcase,
  CheckSquare,
  Lock,
  Eye,
  Shield,
  UserPlus,
  ChevronDown,
  X,
  FolderOpen,
  ClipboardList,
  ChevronRight,
  BarChart2,
  Send,
  Link2,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import {
  ALL_ROLES,
  ROLE_LABELS,
  ROLE_COLORS,
  type AppRole,
} from '../config/rolePermissions'
import {
  getOrgMembers,
  assignRole,
  assignTradeRole,
  TRADE_ROLE_LABELS,
  TRADE_ROLE_BADGE_CLASS,
  TRADE_ROLE_OPTIONS,
  type OrgMember,
  type EmployeePortalRole,
  type EmployeeTradeRole,
} from '../services/roleService'
import {
  getOwnerCrewRoster,
  getCrewSelfView,
  getGuestProjectPlaceholder,
  getOwnerOrgId,
  getUnifiedCrewDirectory,
  getActiveProjects,
  type CrewRosterMember,
  type CrewSelfView,
  type GuestProjectView,
  type UnifiedCrewMember,
  type ActiveProject,
  type ProjectPhaseRow,
} from '../services/crewPortalService'
import AdminTaskDelegationPanel from '../components/admin/AdminTaskDelegationPanel'
import OwnerSchedulePanel from '../components/admin/OwnerSchedulePanel'
import OwnerPerformancePanel from '../components/admin/OwnerPerformancePanel'
import EmployeeInviteModal from '../components/admin/EmployeeInviteModal'
import EmployeeProfilePanel, { CostModelPill, PortalPill } from '../components/admin/EmployeeProfilePanel'
import RolesPermissionsModal from '../features/employee-roles/RolesPermissionsModal'
import {
  prepareEmployeeAccount,
  listUnlinkedPortalCandidates,
  linkExistingEmployeeAccount,
  type PortalLinkCandidate,
} from '../services/adminTimecardService'
import { resendEmployeeInvite } from '../services/employeeInviteService'

// ─── Types ───────────────────────────────────────────────────────────────────

type PortalViewRole = 'owner' | 'crew' | 'guest'

const PORTAL_ROLE_OPTIONS: EmployeePortalRole[] = ['employee', 'foreman']
const PORTAL_ROLE_LABELS: Record<EmployeePortalRole, string> = {
  employee: 'Employee',
  foreman: 'Foreman',
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PERMISSION_MATRIX = [
  {
    permission: 'Project Name & Phase',
    owner: true,
    crew: true,
    guest: true,
  },
  {
    permission: 'Project Health %',
    owner: true,
    crew: true,
    guest: true,
  },
  {
    permission: 'Own Tasks & Hours',
    owner: true,
    crew: true,
    guest: false,
  },
  {
    permission: 'Own Assigned Projects',
    owner: true,
    crew: true,
    guest: false,
  },
  {
    permission: 'Full Crew Table',
    owner: true,
    crew: false,
    guest: false,
  },
  {
    permission: 'Edit Crew Assignments',
    owner: true,
    crew: false,
    guest: false,
  },
  {
    permission: 'Financial Data',
    owner: true,
    crew: false,
    guest: false,
  },
  {
    permission: 'All Crew Hours Summary',
    owner: true,
    crew: false,
    guest: false,
  },
  {
    permission: 'Crew Management',
    owner: true,
    crew: false,
    guest: false,
  },
]

// ─── Sub-components ──────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const key = (role || '').toLowerCase()
  const styles: Record<string, string> = {
    owner: 'text-green-400 bg-green-900/30 border-green-700/40',
    crew: 'text-blue-400 bg-blue-900/30 border-blue-700/40',
    guest: 'text-gray-400 bg-gray-800/40 border-gray-600/40',
    employee: 'text-blue-400 bg-blue-900/30 border-blue-700/40',
    foreman: 'text-amber-400 bg-amber-900/30 border-amber-700/40',
  }
  const cls = styles[key] || 'text-gray-400 bg-gray-800/40 border-gray-600/40'
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${cls}`}>
      {role}
    </span>
  )
}

const PORTAL_ACCESS_LABELS: Record<string, string> = {
  time_tracking: 'Time Tracking',
}

function formatPortalAccessLabel(flag: string): string {
  return PORTAL_ACCESS_LABELS[flag]
    ?? flag
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
}

function PortalAccessChips({ access }: { access?: Record<string, unknown> | null }) {
  const enabled = Object.entries(access ?? {})
    .filter(([, value]) => value === true || value === 'true')
    .map(([flag]) => flag)

  if (enabled.length === 0) {
    return <span className="text-xs text-gray-700 italic">None</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {enabled.map((flag) => (
        <span
          key={flag}
          className="text-[11px] font-medium px-2 py-0.5 rounded-full border text-green-300 bg-green-900/20 border-green-700/40"
        >
          {formatPortalAccessLabel(flag)}
        </span>
      ))}
    </div>
  )
}

/** Prefer trade role badge when set; otherwise fall back to portal/system role. Never both. */
function MemberRoleBadge({
  employeeRole,
  fallbackRole,
}: {
  employeeRole?: EmployeeTradeRole | null
  fallbackRole: string
}) {
  if (employeeRole) {
    return (
      <span
        className={`text-xs font-medium px-2 py-0.5 rounded-full border ${TRADE_ROLE_BADGE_CLASS[employeeRole]}`}
      >
        {TRADE_ROLE_LABELS[employeeRole]}
      </span>
    )
  }
  return <RoleBadge role={fallbackRole} />
}

function ActiveStatusDot({ active }: { active: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
      <span className={`text-xs ${active ? 'text-green-400' : 'text-gray-500'}`}>
        {active ? 'Active' : 'Inactive'}
      </span>
    </span>
  )
}

function MemberStatusBadge({ active, isPendingInvite }: { active: boolean; isPendingInvite?: boolean }) {
  if (!active) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-gray-600" />
        <span className="text-xs text-gray-500">Inactive</span>
      </span>
    )
  }
  if (isPendingInvite) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-xs text-amber-400">Invitation Pending</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <span className="text-xs text-green-400">Active</span>
    </span>
  )
}

// ─── Directory row status dot (overall) ──────────────────────────────────────

function DirectoryStatusDot({ status }: { status: UnifiedCrewMember['status'] }) {
  if (status === 'active') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs text-green-400">Active</span>
      </span>
    )
  }
  if (status === 'pending_invite') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-xs text-amber-400">Pending</span>
      </span>
    )
  }
  if (status === 'cost_model_only') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-gray-600" />
        <span className="text-xs text-gray-500">No Portal</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-gray-700" />
      <span className="text-xs text-gray-600">Inactive</span>
    </span>
  )
}

// ─── Archived status badge ────────────────────────────────────────────────────

function ArchivedBadge() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-gray-700" />
      <span className="text-xs text-gray-600">Archived</span>
    </span>
  )
}

// ─── Unified Directory Panel ──────────────────────────────────────────────────

function UnifiedDirectoryPanel({
  onInviteClose,
  onNavigateToPerformance,
}: {
  onInviteClose?: () => void
  onNavigateToPerformance?: (profileId: string) => void
}) {
  const [members, setMembers] = useState<UnifiedCrewMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMember, setSelectedMember] = useState<UnifiedCrewMember | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await getUnifiedCrewDirectory(showArchived)
    if (result.success) {
      setMembers(result.data)
    } else {
      setError(result.error)
      setMembers([])
    }
    setLoading(false)
  }, [showArchived])

  useEffect(() => { void load() }, [load])

  function handleProfileBack() {
    setSelectedMember(null)
  }

  function handleProfileEvent() {
    setSelectedMember(null)
    void load()
    onInviteClose?.()
  }

  // Show full profile panel when a member is selected
  if (selectedMember) {
    return (
      <EmployeeProfilePanel
        member={selectedMember}
        onBack={handleProfileBack}
        onInviteSent={handleProfileEvent}
        onArchived={handleProfileEvent}
        onDeleted={handleProfileEvent}
        onNavigateToPerformance={onNavigateToPerformance}
      />
    )
  }

  const activeCount = members.filter((m) => m.status === 'active').length
  const portalCount = members.filter((m) => m.hasPortal && m.status !== 'inactive').length
  const totalHours = members.reduce((s, m) => s + (m.hoursThisWeek ?? 0), 0)

  return (
    <div className="space-y-5">
      {/* Summary row + archived toggle */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 rounded-lg px-6 py-5 border" style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}>
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Portal Members</p>
          <p className="text-3xl font-bold text-teal-400">{portalCount}</p>
        </div>
        <div className="flex-1 rounded-lg px-6 py-5 border" style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}>
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Active This Week</p>
          <p className="text-3xl font-bold text-green-400">{activeCount}</p>
        </div>
        <div className="flex-1 rounded-lg px-6 py-5 border" style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}>
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Total Hours This Week</p>
          <p className="text-3xl font-bold text-blue-400">{Number.isFinite(totalHours) ? totalHours : 0}h</p>
        </div>
      </div>

      {/* Archived toggle */}
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-gray-500">Show archived</span>
          <div
            className={`relative w-8 h-4 rounded-full transition-colors ${showArchived ? 'bg-gray-600' : 'bg-gray-800'} border border-gray-700`}
            onClick={() => setShowArchived((v) => !v)}
          >
            <span
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-gray-400 transition-transform ${showArchived ? 'translate-x-4' : 'translate-x-0.5'}`}
            />
          </div>
        </label>
      </div>

      {loading && <p className="text-xs text-gray-600 py-2">Loading crew directory…</p>}
      {error && <p className="text-xs text-red-400 py-2">{error}</p>}
      {!loading && !error && members.length === 0 && (
        <p className="text-xs text-gray-600 py-2">No team members found. Invite employees or add them via the Team cost model.</p>
      )}

      {!loading && members.length > 0 && (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-4">Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-4">Role</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-4">Registrations</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-4">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-4">Hours</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-4">Projects</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member, idx) => {
                const isArchived = member.status === 'inactive'
                return (
                  <tr
                    key={member.key}
                    className="cursor-pointer transition-colors"
                    style={{
                      backgroundColor: idx % 2 === 0 ? '#0a0b0f' : '#0c0d12',
                      borderBottom: '1px solid #1a1c23',
                      opacity: isArchived ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#101520' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = idx % 2 === 0 ? '#0a0b0f' : '#0c0d12' }}
                    onClick={() => setSelectedMember(member)}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: '#1e3a5f', color: '#60a5fa' }}
                        >
                          {(member.name || 'U').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-gray-200 font-semibold text-sm">{member.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {member.employeeRole
                        ? <MemberRoleBadge employeeRole={member.employeeRole} fallbackRole="employee" />
                        : <span className="text-xs text-gray-600">—</span>}
                    </td>
                    {/* Registrations — two pills, click stops row propagation */}
                    <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <CostModelPill
                          hasCostModel={member.hasCostModel}
                          onClick={member.hasCostModel ? () => setSelectedMember(member) : undefined}
                        />
                        <PortalPill
                          hasPortal={member.hasPortal}
                          portalStatus={member.portalStatus}
                          onClick={() => setSelectedMember(member)}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {isArchived
                        ? <ArchivedBadge />
                        : <DirectoryStatusDot status={member.status} />}
                    </td>
                    <td className="px-5 py-4 text-gray-300 font-mono text-sm font-semibold">
                      {member.hoursThisWeek > 0 ? `${member.hoursThisWeek}h` : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(member.assignedProjects ?? []).length === 0
                          ? <span className="text-xs text-gray-600">None</span>
                          : (member.assignedProjects ?? []).map((proj) => (
                            <span key={proj} className="text-xs px-2 py-0.5 rounded-full border"
                              style={{ backgroundColor: '#111827', borderColor: '#374151', color: '#9ca3af' }}>
                              {proj}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                      {member.hasPortal ? (
                        <button
                          className="text-xs px-3 py-1.5 rounded border transition-colors hover:bg-blue-900/20"
                          style={{ borderColor: '#1e40af55', color: '#60a5fa' }}
                          onClick={() => setSelectedMember(member)}
                        >
                          View Profile
                        </button>
                      ) : (
                        <button
                          className="text-xs px-3 py-1.5 rounded border transition-colors hover:bg-teal-900/20"
                          style={{ borderColor: '#134e4a55', color: '#2dd4bf' }}
                          onClick={() => setSelectedMember(member)}
                        >
                          Invite to Portal
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Active Projects Panel ────────────────────────────────────────────────────

const PHASE_STATUS_CHIP: Record<string, string> = {
  pending:     'text-gray-500 bg-gray-800/40 border-gray-700/40',
  in_progress: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  completed:   'text-green-400 bg-green-900/20 border-green-700/40',
  skipped:     'text-gray-600 bg-gray-900/40 border-gray-800/40',
}

function PhaseRow({ phase, onAssign }: { phase: ProjectPhaseRow; onAssign?: () => void }) {
  const items = Array.isArray(phase.checklist) ? phase.checklist : []
  const done = items.filter((i) => i?.completed === true).length
  const chipCls = PHASE_STATUS_CHIP[phase.status] || PHASE_STATUS_CHIP.pending

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded border" style={{ backgroundColor: '#0a0b0f', borderColor: '#1a1c23' }}>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize flex-shrink-0 ${chipCls}`}>
        {phase.status.replace('_', ' ')}
      </span>
      <span className="text-xs text-gray-300 flex-1 truncate">{phase.name}</span>
      {items.length > 0 && (
        <span className="text-xs text-gray-500 flex-shrink-0 font-mono">{done}/{items.length}</span>
      )}
      {onAssign && (phase.status === 'pending' || phase.status === 'in_progress') && (
        <button
          onClick={onAssign}
          className="text-[11px] px-2 py-0.5 rounded border flex-shrink-0 transition-colors hover:bg-blue-900/20"
          style={{ borderColor: '#1e40af55', color: '#60a5fa' }}
        >
          Assign
        </button>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  onAssignProject,
}: {
  project: ActiveProject
  onAssignProject: (projectId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visiblePhases = project.phases.filter((p) => p.status !== 'skipped')

  return (
    <div className="rounded-lg border" style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}>
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronRight
          size={13}
          className={`text-gray-500 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="text-sm font-medium text-gray-100 flex-1 truncate">{project.name}</span>

        {/* Status badge */}
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full border capitalize flex-shrink-0"
          style={{
            color: project.status === 'in_progress' ? '#fbbf24' : '#9ca3af',
            borderColor: project.status === 'in_progress' ? '#78350f55' : '#374151',
            backgroundColor: project.status === 'in_progress' ? '#451a0322' : '#11182733',
          }}
        >
          {project.status.replace(/_/g, ' ')}
        </span>

        {/* Health bar (inline) */}
        {project.healthPercent != null && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div
              className="w-16 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.07)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${project.healthPercent}%`,
                  background: 'linear-gradient(90deg, #16a34a, #4ade80)',
                }}
              />
            </div>
            <span className="text-xs text-green-400 font-mono">{project.healthPercent}%</span>
          </div>
        )}

        {/* Dates */}
        {(project.estimated_start || project.estimated_end) && (
          <span className="text-xs text-gray-600 flex-shrink-0 hidden sm:inline">
            {project.estimated_start ?? '?'} → {project.estimated_end ?? '?'}
          </span>
        )}
      </button>

      {/* Expanded phases */}
      {expanded && (
        <div className="px-4 pb-3 space-y-1.5 border-t" style={{ borderColor: '#1a1c23' }}>
          <p className="text-xs text-gray-600 pt-2 mb-2">
            Phases ({visiblePhases.length}) — click Assign to delegate a task
          </p>
          {visiblePhases.length === 0
            ? <p className="text-xs text-gray-600">No phases configured.</p>
            : visiblePhases.map((phase) => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                onAssign={() => onAssignProject(project.id)}
              />
            ))}
        </div>
      )}
    </div>
  )
}

function ActiveProjectsPanel({ onAssignProject }: { onAssignProject: (projectId: string) => void }) {
  const [projects, setProjects] = useState<ActiveProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const result = await getActiveProjects()
      if (cancelled) return
      if (result.success) {
        setProjects(result.data)
      } else {
        setError(result.error)
        setProjects([])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-3">
      {loading && <p className="text-xs text-gray-600 py-2">Loading active projects…</p>}
      {error && <p className="text-xs text-red-400 py-2">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <p className="text-xs text-gray-600 py-2">No active projects found.</p>
      )}
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} onAssignProject={onAssignProject} />
      ))}
    </div>
  )
}

// ─── Owner Panel (with sub-tabs) ──────────────────────────────────────────────

type OwnerTab = 'directory' | 'projects' | 'tasks' | 'schedule' | 'performance'

const OWNER_TABS: { id: OwnerTab; label: string; icon: React.ReactNode }[] = [
  { id: 'directory',   label: 'Crew Directory',  icon: <Users size={13} /> },
  { id: 'projects',    label: 'Active Projects',  icon: <FolderOpen size={13} /> },
  { id: 'tasks',       label: 'Task Delegation',  icon: <ClipboardList size={13} /> },
  { id: 'schedule',    label: 'Schedule',         icon: <Clock size={13} /> },
  { id: 'performance', label: 'Performance',      icon: <BarChart2 size={13} /> },
]

function OwnerPanel() {
  const [tab, setTab] = useState<OwnerTab>('directory')
  const [taskProjectId, setTaskProjectId] = useState<string | undefined>(undefined)
  const [initialPerfEmployeeId, setInitialPerfEmployeeId] = useState<string | undefined>(undefined)

  function handleAssignProject(projectId: string) {
    setTaskProjectId(projectId)
    setTab('tasks')
  }

  function handleNavigateToPerformance(profileId: string) {
    setInitialPerfEmployeeId(profileId)
    setTab('performance')
  }

  function handleNavigateToTask(_assignmentId: string) {
    setTab('tasks')
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {OWNER_TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => { setInitialPerfEmployeeId(undefined); setTab(id) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              tab === id
                ? 'border-green-600 text-green-400 bg-green-900/20'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === 'directory' && <UnifiedDirectoryPanel onNavigateToPerformance={handleNavigateToPerformance} />}
      {tab === 'projects' && <ActiveProjectsPanel onAssignProject={handleAssignProject} />}
      {tab === 'tasks' && <AdminTaskDelegationPanel initialProjectId={taskProjectId} />}
      {tab === 'schedule' && <OwnerSchedulePanel onNavigateToTask={handleNavigateToTask} />}
      {tab === 'performance' && <OwnerPerformancePanel initialEmployeeId={initialPerfEmployeeId} />}
    </div>
  )
}

// ─── Crew Panel ──────────────────────────────────────────────────────────────

function CrewPanel() {
  const [self, setSelf] = useState<CrewSelfView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const result = await getCrewSelfView()
      if (cancelled) return
      if (result.success) {
        setSelf(result.data)
      } else {
        setError(result.error)
        setSelf(null)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  function handleLogHours() {
    window.location.assign('/employee/login')
  }

  if (loading) {
    return <p className="text-xs text-gray-600 py-4">Loading your crew view…</p>
  }

  if (error) {
    return <p className="text-xs text-red-400 py-4">{error}</p>
  }

  if (!self) {
    return (
      <p className="text-xs text-gray-500 py-4">
        No employee profile linked to this account. Accept an employee invite to see Crew View data.
      </p>
    )
  }

  const hours = Number.isFinite(self.hoursThisWeek) ? self.hoursThisWeek : 0

  return (
    <div className="space-y-5">
      <div
        className="flex items-center gap-4 rounded-lg px-5 py-4 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: '#1e3a5f', color: '#60a5fa' }}
        >
          {(self.name ?? 'C').charAt(0).toUpperCase()}
          {(self.name ?? '').split(' ')[1]?.charAt(0) ?? ''}
        </div>
        <div>
          <p className="font-semibold text-gray-100">{self.name}</p>
          <MemberRoleBadge employeeRole={self.employeeRole} fallbackRole={self.role} />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-gray-500">Hours This Week</p>
          <p className="text-xl font-bold text-blue-400">{hours}h</p>
        </div>
      </div>

      <div
        className="rounded-lg px-5 py-4 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Briefcase size={14} className="text-green-500" />
          <p className="text-sm font-semibold text-gray-300">Assigned Projects</p>
        </div>
        <div className="space-y-2">
          {(self.assignedProjects ?? []).length === 0 ? (
            <p className="text-xs text-gray-600">No projects assigned yet.</p>
          ) : (
            (self.assignedProjects ?? []).map((proj) => (
              <div
                key={proj}
                className="flex items-center gap-3 px-3 py-2 rounded border"
                style={{ backgroundColor: '#0a0b0f', borderColor: '#1a1c23' }}
              >
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-sm text-gray-200">{proj}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div
        className="rounded-lg px-5 py-4 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <CheckSquare size={14} className="text-blue-400" />
          <p className="text-sm font-semibold text-gray-300">Tasks for Today</p>
        </div>
        <div className="space-y-2">
          {(self.tasksToday ?? []).length === 0 ? (
            <p className="text-xs text-gray-600">No open tasks for today.</p>
          ) : (
            (self.tasksToday ?? []).map((task) => (
              <div
                key={task.id}
                className="flex items-start gap-3 px-3 py-2 rounded border"
                style={{ backgroundColor: '#0a0b0f', borderColor: '#1a1c23' }}
              >
                <span
                  className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                    task.status === 'completed'
                      ? 'bg-green-500'
                      : task.status === 'in_progress'
                        ? 'bg-yellow-500 animate-pulse'
                        : 'bg-gray-600'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-300 block">{task.workPackageName}</span>
                  <span className="text-xs text-gray-600">{task.projectName}</span>
                </div>
                <span
                  className={`text-xs font-medium capitalize px-2 py-0.5 rounded-full border ${
                    task.status === 'completed'
                      ? 'text-green-400 border-green-700/40 bg-green-900/20'
                      : task.status === 'in_progress'
                        ? 'text-yellow-400 border-yellow-700/40 bg-yellow-900/20'
                        : 'text-gray-500 border-gray-600/40 bg-gray-800/20'
                  }`}
                >
                  {task.status.replace('_', ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <button
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors hover:bg-blue-900/20"
        style={{ borderColor: '#1e40af55', color: '#60a5fa' }}
        onClick={handleLogHours}
      >
        <Clock size={14} />
        Log Hours
      </button>
    </div>
  )
}

// ─── Guest Panel ─────────────────────────────────────────────────────────────

function GuestPanel() {
  const [project, setProject] = useState<GuestProjectView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const result = await getGuestProjectPlaceholder()
      if (cancelled) return
      if (result.success) {
        setProject(result.data)
      } else {
        setError(result.error)
        setProject(null)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-5">
      <div
        className="rounded-lg px-5 py-5 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Eye size={14} className="text-gray-500" />
          <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Project (Read-Only)</span>
        </div>

        {loading && <p className="text-xs text-gray-600">Loading project…</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!loading && !error && !project && (
          <p className="text-xs text-gray-600">No active projects available.</p>
        )}

        {project && (
          <>
            <p className="text-lg font-semibold text-gray-100 mb-1">{project.name}</p>

            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-gray-500">Phase:</span>
              <span className="text-xs font-medium text-blue-300 bg-blue-900/20 border border-blue-700/30 px-2 py-0.5 rounded-full">
                {project.phaseLabel}
              </span>
            </div>

            {/* Health bar — only when started phases exist (null = hide entirely) */}
            {project.healthPercent != null && (
              <div className="mb-1">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Health</span>
                  <span className="text-green-400 font-mono">{project.healthPercent}%</span>
                </div>
                <div
                  className="w-full h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${project.healthPercent}%`,
                      background: 'linear-gradient(90deg, #16a34a, #4ade80)',
                      boxShadow: project.healthPercent > 0 ? '0 0 6px rgba(52,211,153,0.45)' : 'none',
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div
        className="flex items-start gap-3 rounded-lg px-4 py-3 border"
        style={{ backgroundColor: '#111015', borderColor: '#2d1f1f' }}
      >
        <Lock size={14} className="text-gray-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-500 leading-relaxed">
          Financial data, crew information, and tasks are restricted. Request access to see more.
        </p>
      </div>

      {/* TO DO: Request Access — wire owner notification / invite flow */}
      <button
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors hover:bg-gray-800/40"
        style={{ borderColor: '#374151', color: '#9ca3af' }}
        onClick={() => {
          // TO DO: Request Access — stub until owner notification path is designed
        }}
      >
        <Shield size={14} />
        Request Access
      </button>
    </div>
  )
}

// ─── Role Manager ────────────────────────────────────────────────────────────

function AccessLevelDropdown({
  memberId,
  currentRole,
  onChange,
}: {
  memberId: string
  currentRole: EmployeePortalRole
  onChange: (memberId: string, role: EmployeePortalRole) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors hover:bg-gray-800/60"
        style={{ borderColor: '#2d3140', color: '#9ca3af' }}
      >
        {PORTAL_ROLE_LABELS[currentRole]}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-20 rounded-lg border overflow-hidden min-w-[140px]"
          style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128', boxShadow: '0 4px 16px #00000088' }}
        >
          {PORTAL_ROLE_OPTIONS.map((role) => (
            <button
              key={role}
              onClick={() => {
                onChange(memberId, role)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-gray-800/60 flex items-center gap-2 ${
                role === currentRole ? 'text-green-400' : 'text-gray-300'
              }`}
            >
              {role === currentRole && <span className="text-green-500">✓</span>}
              {role !== currentRole && <span className="w-3" />}
              {PORTAL_ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TradeRoleDropdown({
  memberId,
  currentRole,
  onChange,
}: {
  memberId: string
  currentRole: EmployeeTradeRole | null
  onChange: (memberId: string, role: EmployeeTradeRole | null) => void
}) {
  const [open, setOpen] = useState(false)
  const label = currentRole ? TRADE_ROLE_LABELS[currentRole] : 'Unassigned'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors hover:bg-gray-800/60"
        style={{ borderColor: '#2d3140', color: '#9ca3af' }}
      >
        {label}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-20 rounded-lg border overflow-hidden min-w-[140px]"
          style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128', boxShadow: '0 4px 16px #00000088' }}
        >
          {TRADE_ROLE_OPTIONS.map((role) => {
            const optionLabel = role ? TRADE_ROLE_LABELS[role] : 'Unassigned'
            const selected = role === currentRole
            return (
              <button
                key={role ?? 'unassigned'}
                onClick={() => {
                  onChange(memberId, role)
                  setOpen(false)
                }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-gray-800/60 flex items-center gap-2 ${
                  selected ? 'text-green-400' : 'text-gray-300'
                }`}
              >
                {selected ? <span className="text-green-500">✓</span> : <span className="w-3" />}
                {optionLabel}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** View As — local UI toggle for this page only (no auth change) */
function ViewAsDropdown({
  viewingAs,
  onChange,
}: {
  viewingAs: AppRole | null
  onChange: (role: AppRole | null) => void
}) {
  const [open, setOpen] = useState(false)

  const label = viewingAs ? `Viewing as: ${ROLE_LABELS[viewingAs]}` : 'View As…'
  const c = viewingAs ? ROLE_COLORS[viewingAs] : null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
          viewingAs ? `${c!.text} ${c!.bg} ${c!.border}` : 'text-gray-500 border-gray-700/40 hover:text-gray-300 hover:bg-gray-800/30'
        }`}
      >
        <Eye size={11} />
        {label}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 rounded-lg border overflow-hidden min-w-[160px]"
          style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128', boxShadow: '0 4px 16px #00000088' }}
        >
          <button
            onClick={() => { onChange(null); setOpen(false) }}
            className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-gray-800/60 text-gray-500"
          >
            — Reset to Owner view
          </button>

          {ALL_ROLES.filter((r) => r !== 'owner').map((role) => (
            <button
              key={role}
              onClick={() => { onChange(role); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-gray-800/60 flex items-center gap-2 ${
                role === viewingAs ? 'text-green-400' : 'text-gray-300'
              }`}
            >
              {role === viewingAs ? <span className="text-green-500">✓</span> : <span className="w-3" />}
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RoleManager({ isOwner }: { isOwner: boolean }) {
  const authUser = useAuthStore((s) => s.user)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [members, setMembers] = useState<UnifiedCrewMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [viewingAs, setViewingAs] = useState<AppRole | null>(null)
  const [rolesTarget, setRolesTarget] = useState<{ epId: string; displayName: string; orgId: string } | null>(null)

  // Prepare Account state (for cost_model_only entries)
  const [prepareTarget, setPrepareTarget] = useState<{ backupEmployeeId: string; displayName: string } | null>(null)
  const [prepareEmail, setPrepareEmail] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [prepareError, setPrepareError] = useState('')

  // Link Existing Account state (ROLE-2.2A — owner only)
  const [linkTarget, setLinkTarget] = useState<{
    backupEmployeeId: string
    displayName: string
    email: string | null
  } | null>(null)
  const [linkCandidates, setLinkCandidates] = useState<PortalLinkCandidate[]>([])
  const [selectedLinkProfileId, setSelectedLinkProfileId] = useState<string | null>(null)
  const [linkConfirmed, setLinkConfirmed] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [unlinkedCandidateCount, setUnlinkedCandidateCount] = useState(0)

  // Per-row invite state (for pending_invite entries with no invite token)
  const [inviteTarget, setInviteTarget] = useState<{ profileId: string; displayName: string } | null>(null)
  const [sendingInvite, setSendingInvite] = useState(false)
  const [sendInviteError, setSendInviteError] = useState('')

  const loadMembers = useCallback(async () => {
    setLoading(true)
    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) {
      setOrgId(null)
      setMembers([])
      setUnlinkedCandidateCount(0)
      setLoading(false)
      return
    }
    setOrgId(orgResult.data!)
    const [result, candidatesRes] = await Promise.all([
      getUnifiedCrewDirectory(),
      listUnlinkedPortalCandidates(orgResult.data!),
    ])
    if (result.success && result.data) {
      setMembers(result.data)
    } else {
      setMembers([])
    }
    setUnlinkedCandidateCount(
      candidatesRes.success && candidatesRes.data ? candidatesRes.data.length : 0,
    )
    setLoading(false)
  }, [])

  useEffect(() => { void loadMembers() }, [loadMembers])

  async function openLinkExisting(member: UnifiedCrewMember) {
    if (!orgId || !isOwner || !member.backupEmployeeId) return
    setLinkError('')
    setLinkConfirmed(false)
    setLinking(false)
    setLinkTarget({
      backupEmployeeId: member.backupEmployeeId,
      displayName: member.name,
      email: member.email,
    })
    const res = await listUnlinkedPortalCandidates(orgId, member.email)
    if (!res.success || !res.data) {
      setLinkCandidates([])
      setSelectedLinkProfileId(null)
      setLinkError(res.error || 'Could not load portal candidates')
      return
    }
    setLinkCandidates(res.data)
    const suggested = res.data.find(c => c.emailMatch) ?? (res.data.length === 1 ? res.data[0] : null)
    setSelectedLinkProfileId(suggested?.profileId ?? null)
  }

  async function handleLinkExistingAccount() {
    if (!linkTarget || !orgId || !selectedLinkProfileId || !linkConfirmed) return
    setLinking(true)
    setLinkError('')
    const result = await linkExistingEmployeeAccount(
      selectedLinkProfileId,
      linkTarget.backupEmployeeId,
      orgId,
    )
    setLinking(false)
    if (result.success) {
      setLinkTarget(null)
      setLinkCandidates([])
      setSelectedLinkProfileId(null)
      setLinkConfirmed(false)
      void loadMembers()
    } else {
      setLinkError(result.error || 'Could not link accounts')
    }
  }

  async function handleRoleChange(memberId: string, newRole: EmployeePortalRole) {
    if (!orgId || !isOwner) return
    setMembers((prev) =>
      prev.map((m) => (m.profileId === memberId ? { ...m, portalRole: newRole } : m)),
    )
    await assignRole({
      profileId: memberId,
      orgId,
      role: newRole,
      assignedBy: authUser?.id || '',
    })
  }

  async function handleTradeRoleChange(memberId: string, newRole: EmployeeTradeRole | null) {
    if (!orgId || !isOwner) return
    setMembers((prev) =>
      prev.map((m) => (m.profileId === memberId ? { ...m, employeeRole: newRole } : m)),
    )
    await assignTradeRole({
      profileId: memberId,
      orgId,
      employeeRole: newRole,
      assignedBy: authUser?.id || '',
    })
  }

  async function handlePrepareAccount() {
    if (!prepareTarget || !orgId) return
    setPreparing(true)
    setPrepareError('')
    const result = await prepareEmployeeAccount(
      prepareTarget.backupEmployeeId,
      prepareTarget.displayName,
      orgId,
      prepareEmail.trim() || undefined,
    )
    setPreparing(false)
    if (result.success) {
      setPrepareTarget(null)
      setPrepareEmail('')
      void loadMembers()
    } else {
      setPrepareError(result.error || 'Could not prepare account')
    }
  }

  async function handleSendInviteToProfile(profileId: string) {
    setSendingInvite(true)
    setSendInviteError('')
    const result = await resendEmployeeInvite(profileId)
    setSendingInvite(false)
    if (result.success) {
      setInviteTarget(null)
      void loadMembers()
    } else {
      setSendInviteError(result.error || 'Could not send invite')
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-green-500" />
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Role Manager</h3>
          {isOwner && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full border"
              style={{ color: '#4ade80', borderColor: '#16a34a33', backgroundColor: '#052e1688' }}
            >
              Owner Only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <ViewAsDropdown viewingAs={viewingAs} onChange={setViewingAs} />
          )}
          {isOwner && (
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors hover:bg-green-900/20"
              style={{ borderColor: '#16a34a55', color: '#4ade80' }}
            >
              <UserPlus size={12} />
              Invite
            </button>
          )}
        </div>
      </div>

      {viewingAs && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg border mb-4 text-xs"
          style={{ backgroundColor: '#1a1200', borderColor: '#ca8a0444', color: '#fbbf24' }}
        >
          <Eye size={12} />
          Previewing app as <strong>{ROLE_LABELS[viewingAs]}</strong> — local UI toggle only (no auth change).
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-600 py-4">Loading members…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Member</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Role</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
                {isOwner && (
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Portal Access</th>
                )}
                {isOwner && (
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Access Level</th>
                )}
                {isOwner && (
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Trade Role</th>
                )}
                {isOwner && (
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Permissions</th>
                )}
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).length === 0 ? (
                <tr>
                  <td colSpan={isOwner ? 9 : 5} className="px-4 py-4 text-xs text-gray-600">
                    No employees yet. Invite to add to the roster.
                  </td>
                </tr>
              ) : (
                (members ?? []).map((member, idx) => {
                  const isCostModelOnly = member.status === 'cost_model_only'
                  const isSelf = member.userId && member.userId === authUser?.id
                  const isPrepared = member.status === 'pending_invite' && member.profileId !== null
                  return (
                    <tr
                      key={member.key}
                      style={{
                        backgroundColor: idx % 2 === 0 ? '#0a0b0f' : '#0c0d12',
                        borderBottom: '1px solid #1a1c23',
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={isCostModelOnly
                              ? { backgroundColor: '#1a2a1f', color: '#4ade80' }
                              : { backgroundColor: '#1e3a5f', color: '#60a5fa' }
                            }
                          >
                            {member.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="text-gray-200 font-medium text-xs block">{member.name}</span>
                            {member.status === 'pending_invite' && (
                              <span className="text-[10px] text-amber-500">Pending invite</span>
                            )}
                            {isCostModelOnly && (
                              <span className="text-[10px] text-green-600">Cost model only</span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-gray-500 text-xs">{member.email || '—'}</td>

                      <td className="px-4 py-3">
                        <MemberRoleBadge
                          employeeRole={member.employeeRole}
                          fallbackRole={(member.portalRole as EmployeePortalRole) ?? member.backupRole ?? 'employee'}
                        />
                      </td>

                      <td className="px-4 py-3">
                        {isCostModelOnly ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-700" />
                            <span className="text-xs text-green-700">Cost Model Only</span>
                          </span>
                        ) : (
                          <MemberStatusBadge
                            active={member.status === 'active'}
                            isPendingInvite={member.status === 'pending_invite'}
                          />
                        )}
                      </td>

                      {isOwner && (
                        <td className="px-4 py-3">
                          {isCostModelOnly
                            ? <span className="text-xs text-gray-700 italic">—</span>
                            : <PortalAccessChips access={member.portalAccess} />
                          }
                        </td>
                      )}

                      {isOwner && (
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <span className="text-xs text-gray-700 italic">You</span>
                          ) : isCostModelOnly ? (
                            <span className="text-xs text-gray-700 italic">—</span>
                          ) : (
                            <AccessLevelDropdown
                              memberId={member.profileId!}
                              currentRole={(member.portalRole as EmployeePortalRole) ?? 'employee'}
                              onChange={handleRoleChange}
                            />
                          )}
                        </td>
                      )}

                      {isOwner && (
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <span className="text-xs text-gray-700 italic">—</span>
                          ) : isCostModelOnly ? (
                            <span className="text-xs text-gray-700 italic">—</span>
                          ) : (
                            <TradeRoleDropdown
                              memberId={member.profileId!}
                              currentRole={member.employeeRole}
                              onChange={handleTradeRoleChange}
                            />
                          )}
                        </td>
                      )}

                      {isOwner && (
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <span className="text-xs text-gray-700 italic">—</span>
                          ) : isCostModelOnly ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <button
                                onClick={() => {
                                  setPrepareTarget({ backupEmployeeId: member.backupEmployeeId!, displayName: member.name })
                                  setPrepareEmail(member.email ?? '')
                                  setPrepareError('')
                                }}
                                className="flex items-center gap-1 text-xs px-2 py-1 bg-green-900/30 text-green-400 rounded hover:bg-green-900/50 transition-colors"
                              >
                                <UserPlus size={11} />
                                Prepare Account
                              </button>
                              {unlinkedCandidateCount > 0 && (
                                <button
                                  onClick={() => { void openLinkExisting(member) }}
                                  className="flex items-center gap-1 text-xs px-2 py-1 bg-sky-900/30 text-sky-400 rounded hover:bg-sky-900/50 transition-colors"
                                >
                                  <Link2 size={11} />
                                  Link Existing Account
                                </button>
                              )}
                            </div>
                          ) : isPrepared && member.email ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <button
                                onClick={() => handleSendInviteToProfile(member.profileId!)}
                                disabled={sendingInvite}
                                className="flex items-center gap-1 text-xs px-2 py-1 bg-teal-900/30 text-teal-400 rounded hover:bg-teal-900/50 transition-colors disabled:opacity-50"
                              >
                                <Send size={11} />
                                Send Invite
                              </button>
                              <button
                                onClick={() => orgId && setRolesTarget({ epId: member.profileId!, displayName: member.name, orgId })}
                                className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-600/30 text-indigo-300 rounded hover:bg-indigo-600/40 transition-colors"
                              >
                                <Shield size={11} />
                                Roles
                              </button>
                            </div>
                          ) : isPrepared ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <button
                                onClick={() => setInviteTarget({ profileId: member.profileId!, displayName: member.name })}
                                className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-900/30 text-amber-400 rounded hover:bg-amber-900/50 transition-colors"
                              >
                                <Send size={11} />
                                Set Email & Invite
                              </button>
                              <button
                                onClick={() => orgId && setRolesTarget({ epId: member.profileId!, displayName: member.name, orgId })}
                                className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-600/30 text-indigo-300 rounded hover:bg-indigo-600/40 transition-colors"
                              >
                                <Shield size={11} />
                                Roles
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => orgId && setRolesTarget({ epId: member.profileId!, displayName: member.name, orgId })}
                              className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-600/30 text-indigo-300 rounded hover:bg-indigo-600/40 transition-colors"
                            >
                              <Shield size={11} />
                              Roles & Permissions
                            </button>
                          )}
                        </td>
                      )}

                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {member.acceptedAt
                          ? new Date(member.acceptedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-700 mt-2">
        Role Manager · employee_profiles · invite via sendEmployeeInvite (same as Team → Invite Employee).
      </p>

      {/* Identical invite path as Team page Timesheets / Invite Employee */}
      {showInvite && isOwner && (
        <EmployeeInviteModal
          onClose={() => {
            setShowInvite(false)
            void loadMembers()
          }}
        />
      )}

      {/* ── SET EMAIL & INVITE (for prepared accounts with no email stored) ── */}
      {inviteTarget && isOwner && (
        <EmployeeInviteModal
          profileId={inviteTarget.profileId}
          initialName={inviteTarget.displayName}
          onClose={() => {
            setInviteTarget(null)
            void loadMembers()
          }}
        />
      )}

      {/* ── PREPARE ACCOUNT CONFIRM DIALOG ─────────────────────────────────── */}
      {prepareTarget && isOwner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(e) => { if (e.target === e.currentTarget && !preparing) { setPrepareTarget(null); setPrepareEmail('') } }}
        >
          <div className="relative w-full max-w-sm bg-[var(--bg-card,#1e2433)] border border-gray-700 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                <UserPlus size={16} className="text-green-400" />
              </div>
              <h3 className="text-base font-bold text-gray-100">Prepare Account</h3>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Creates a portal profile for <strong className="text-gray-200">{prepareTarget.displayName}</strong> without sending an invite.
              You can assign roles immediately and invite later.
            </p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Email <span className="text-gray-600">(optional — required to send invite later)</span>
              </label>
              <input
                type="email"
                value={prepareEmail}
                onChange={(e) => setPrepareEmail(e.target.value)}
                disabled={preparing}
                placeholder="employee@example.com"
                className="w-full bg-[#11141c] border border-gray-600 rounded-xl px-4 py-2.5 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500 transition text-sm disabled:opacity-60"
              />
            </div>
            {prepareError && (
              <p className="text-xs text-red-400 mb-3">{prepareError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setPrepareTarget(null); setPrepareEmail(''); setPrepareError('') }}
                disabled={preparing}
                className="px-4 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm hover:bg-gray-600 transition disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handlePrepareAccount}
                disabled={preparing}
                className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm hover:bg-green-600 transition disabled:opacity-60 flex items-center gap-1.5"
              >
                {preparing ? 'Preparing…' : 'Prepare Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LINK EXISTING ACCOUNT CONFIRM DIALOG (ROLE-2.2A) ──────────────── */}
      {linkTarget && isOwner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !linking) {
              setLinkTarget(null)
              setLinkCandidates([])
              setSelectedLinkProfileId(null)
              setLinkConfirmed(false)
              setLinkError('')
            }
          }}
        >
          <div className="relative w-full max-w-md bg-[var(--bg-card,#1e2433)] border border-gray-700 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <Link2 size={16} className="text-sky-400" />
              </div>
              <h3 className="text-base font-bold text-gray-100">Link Existing Account</h3>
            </div>

            <div className="mb-4 rounded-xl border border-gray-700 bg-[#11141c] p-3 space-y-1.5">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Cost Model employee</p>
              <p className="text-sm text-gray-100 font-medium">{linkTarget.displayName}</p>
              <p className="text-xs text-gray-400">{linkTarget.email || 'No email on Cost Model record'}</p>
            </div>

            {linkCandidates.length === 0 ? (
              <p className="text-sm text-gray-400 mb-4">
                No unlinked portal profiles in this organization.
              </p>
            ) : (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-medium text-gray-400">Select portal profile to link</p>
                {linkCandidates.map((c) => (
                  <label
                    key={c.profileId}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                      selectedLinkProfileId === c.profileId
                        ? 'border-sky-500 bg-sky-900/20'
                        : 'border-gray-700 bg-[#11141c] hover:border-gray-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="link-candidate"
                      className="mt-1"
                      checked={selectedLinkProfileId === c.profileId}
                      onChange={() => { setSelectedLinkProfileId(c.profileId); setLinkConfirmed(false) }}
                      disabled={linking}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-100 font-medium">{c.displayName}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          c.status === 'Active'
                            ? 'text-green-400 border-green-700/50'
                            : c.status === 'Inactive'
                              ? 'text-gray-400 border-gray-600'
                              : 'text-amber-400 border-amber-700/50'
                        }`}>
                          {c.status}
                        </span>
                        {c.emailMatch && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border text-sky-300 border-sky-700/50">
                            Suggested email match
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{c.email || 'No email'}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="mb-4 rounded-xl border border-amber-700/40 bg-amber-950/30 px-3 py-2.5">
              <p className="text-xs text-amber-200/90 leading-relaxed">
                Records will be linked, not deleted. Portal status, hours, projects, assignments,
                role values, and auth linkage are preserved. No invite is sent.
              </p>
            </div>

            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={linkConfirmed}
                onChange={(e) => setLinkConfirmed(e.target.checked)}
                disabled={linking || !selectedLinkProfileId}
              />
              <span className="text-xs text-gray-300">
                I confirm I want to link these two existing records.
              </span>
            </label>

            {linkError && (
              <p className="text-xs text-red-400 mb-3">{linkError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setLinkTarget(null)
                  setLinkCandidates([])
                  setSelectedLinkProfileId(null)
                  setLinkConfirmed(false)
                  setLinkError('')
                }}
                disabled={linking}
                className="px-4 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm hover:bg-gray-600 transition disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleLinkExistingAccount() }}
                disabled={linking || !selectedLinkProfileId || !linkConfirmed || linkCandidates.length === 0}
                className="px-4 py-2 rounded-lg bg-sky-700 text-white text-sm hover:bg-sky-600 transition disabled:opacity-60 flex items-center gap-1.5"
              >
                {linking ? 'Linking…' : 'Confirm Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ROLES & PERMISSIONS MODAL (ROLE-2.1 Crew Portal entry point) ─── */}
      {rolesTarget && (
        <RolesPermissionsModal
          epId={rolesTarget.epId}
          displayName={rolesTarget.displayName}
          orgId={rolesTarget.orgId}
          onClose={() => setRolesTarget(null)}
        />
      )}

      {sendInviteError && (
        <p className="text-xs text-red-400 mt-2">{sendInviteError}</p>
      )}
    </div>
  )
}

// ─── Permission Matrix content (rendered inside modal) ───────────────────────

function PermissionMatrix() {
  function Check({ allowed }: { allowed: boolean }) {
    return allowed ? (
      <span className="text-green-400 font-bold">✓</span>
    ) : (
      <span className="text-gray-700">—</span>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3 w-1/2">
              Permission
            </th>
            <th className="text-center text-xs font-semibold text-green-600 uppercase tracking-wider px-6 py-3">
              Owner
            </th>
            <th className="text-center text-xs font-semibold text-blue-600 uppercase tracking-wider px-6 py-3">
              Crew
            </th>
            <th className="text-center text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3">
              Guest
            </th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_MATRIX.map((row, idx) => (
            <tr
              key={row.permission}
              style={{
                backgroundColor: idx % 2 === 0 ? '#0a0b0f' : '#0c0d12',
                borderBottom: '1px solid #1a1c23',
              }}
            >
              <td className="px-6 py-3 text-gray-300">{row.permission}</td>
              <td className="px-6 py-3 text-center"><Check allowed={row.owner} /></td>
              <td className="px-6 py-3 text-center"><Check allowed={row.crew} /></td>
              <td className="px-6 py-3 text-center"><Check allowed={row.guest} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Owner Preview Control ───────────────────────────────────────────────────

const PREVIEW_OPTIONS: { role: PortalViewRole; label: string }[] = [
  { role: 'owner', label: 'Owner' },
  { role: 'crew', label: 'Crew' },
  { role: 'guest', label: 'Guest' },
]

function OwnerPreviewControl({
  previewRole,
  onChange,
}: {
  previewRole: PortalViewRole
  onChange: (role: PortalViewRole) => void
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Eye size={11} className="text-gray-600 flex-shrink-0" />
      <span className="text-[11px] font-medium text-gray-600 select-none">Dev Preview:</span>
      <div className="flex items-center gap-0.5">
        {PREVIEW_OPTIONS.map(({ role, label }) => (
          <button
            key={role}
            onClick={() => onChange(role)}
            className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
              previewRole === role
                ? 'text-gray-300 bg-gray-800/70 border-gray-600/50'
                : 'text-gray-600 border-transparent hover:text-gray-400 hover:bg-gray-800/30'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="text-[9px] uppercase tracking-widest text-gray-700 select-none ml-1">preview only</span>
    </div>
  )
}

// ─── Main View ───────────────────────────────────────────────────────────────

export default function CrewPortal() {
  const authStatus = useAuthStore((s) => s.status)
  const authRole = useAuthStore((s) => s.role)
  const profileRole = useAuthStore((s) => s.profile?.role)
  const [previewRole, setPreviewRole] = useState<PortalViewRole>('owner')
  const [showPermissionModal, setShowPermissionModal] = useState(false)

  const isOwnerOrAdmin = authRole === 'owner' || profileRole === 'owner' || profileRole === 'admin'
  const realPortalRole: PortalViewRole = isOwnerOrAdmin
    ? 'owner'
    : authRole === 'employee'
      ? 'crew'
      : 'guest'
  const activeRole = isOwnerOrAdmin ? previewRole : realPortalRole

  if (authStatus === 'loading' || authStatus === 'hydrating_user_data') {
    return (
      <div className="px-4 py-6 w-full">
        <div
          className="rounded-xl border p-6 flex items-center gap-3 text-sm text-gray-500"
          style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
        >
          <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          Loading Crew Portal...
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 w-full">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Users size={18} className="text-green-500" />
            Crew Portal
          </h2>
          <p className="text-xs text-gray-600 mt-1">
            Live org data from employee_profiles, task assignments, and time entries.
          </p>
        </div>
        {isOwnerOrAdmin && (
          <button
            onClick={() => setShowPermissionModal(true)}
            className="flex items-center gap-2 rounded-full border border-gray-700/50 bg-slate-950/70 px-4 py-2 text-xs font-semibold text-gray-300 shadow-lg transition-colors hover:bg-gray-800/60 self-start"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-gray-600 flex-shrink-0" />
            <Shield size={13} className="flex-shrink-0" />
            Permission Matrix
          </button>
        )}
      </div>

      {isOwnerOrAdmin && (
        <OwnerPreviewControl previewRole={previewRole} onChange={setPreviewRole} />
      )}

      <div
        className="rounded-xl border p-6 mb-2 w-full"
        style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-5">
          {activeRole === 'owner' && <Shield size={15} className="text-green-500" />}
          {activeRole === 'crew' && <Users size={15} className="text-blue-400" />}
          {activeRole === 'guest' && <Eye size={15} className="text-gray-500" />}
          <h3 className="text-sm font-semibold text-gray-200 capitalize">{activeRole} Panel</h3>
          <RoleBadge role={activeRole} />
        </div>

        {activeRole === 'owner' && <OwnerPanel />}
        {activeRole === 'crew' && <CrewPanel />}
        {activeRole === 'guest' && <GuestPanel />}
      </div>

      {isOwnerOrAdmin && <RoleManager isOwner={isOwnerOrAdmin} />}

      {showPermissionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPermissionModal(false) }}
        >
          <div
            className="relative w-full max-w-lg rounded-xl border overflow-hidden shadow-2xl"
            style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: '#1e2128' }}
            >
              <div className="flex items-center gap-2">
                <Shield size={15} className="text-green-500" />
                <h3 className="text-sm font-semibold text-gray-200">Permission Matrix</h3>
              </div>
              <button
                onClick={() => setShowPermissionModal(false)}
                className="p-1.5 rounded-md hover:bg-gray-800/60 transition-colors"
              >
                <X size={14} className="text-gray-500" />
              </button>
            </div>
            <PermissionMatrix />
          </div>
        </div>
      )}
    </div>
  )
}
