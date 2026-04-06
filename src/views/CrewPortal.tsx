// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Users, Clock, Briefcase, CheckSquare, Lock, Eye, Shield, UserPlus, ChevronDown, Copy, Check } from 'lucide-react';
import type { UserRole, CrewMember } from '../types';
import { mockCrewMembers } from '../mock';
import {
  ALL_ROLES,
  ROLE_LABELS,
  ROLE_COLORS,
  type AppRole,
} from '../config/rolePermissions';
import {
  getOrgMembers,
  assignRole,
  generateInviteLink,
  type OrgMember,
} from '../services/roleService';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MockTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MOCK_TASKS_TODAY: MockTask[] = [
  { id: 'task-001', title: 'Install sub-panel breakers – Beauty Salon Suite B', status: 'in_progress' },
  { id: 'task-002', title: 'Pull 12/2 to receptacles – Beauty Salon Suite C', status: 'pending' },
  { id: 'task-003', title: 'Pre-inspection walkthrough – Surgery Center Panel Room', status: 'pending' },
];

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
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    owner: 'text-green-400 bg-green-900/30 border-green-700/40',
    crew: 'text-blue-400 bg-blue-900/30 border-blue-700/40',
    guest: 'text-gray-400 bg-gray-800/40 border-gray-600/40',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${styles[role]}`}>
      {role}
    </span>
  );
}

function StatusDot({ hours }: { hours: number }) {
  const active = hours > 0;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
      <span className={`text-xs ${active ? 'text-green-400' : 'text-gray-500'}`}>
        {active ? 'Active' : 'Inactive'}
      </span>
    </span>
  );
}

// ─── Owner Panel ─────────────────────────────────────────────────────────────

function OwnerPanel() {
  // Replace with real Supabase query during integration
  const [crew, setCrew] = useState<CrewMember[]>(mockCrewMembers);

  const crewOnly = crew.filter((m) => m.role === 'crew');
  const totalHours = crew.reduce((sum, m) => sum + m.hoursThisWeek, 0);
  const avgHours =
    crewOnly.length > 0 ? (crewOnly.reduce((sum, m) => sum + m.hoursThisWeek, 0) / crewOnly.length).toFixed(1) : '0';

  function handleAddProject(memberId: string, project: string) {
    const trimmed = project.trim();
    if (!trimmed) return;
    setCrew((prev) =>
      prev.map((m) =>
        m.id === memberId && !m.assignedProjects.includes(trimmed)
          ? { ...m, assignedProjects: [...m.assignedProjects, trimmed] }
          : m
      )
    );
  }

  function handleRemoveProject(memberId: string, project: string) {
    setCrew((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? { ...m, assignedProjects: m.assignedProjects.filter((p) => p !== project) }
          : m
      )
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="flex gap-4">
        <div
          className="flex-1 rounded-lg px-4 py-3 border"
          style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
        >
          <p className="text-xs text-gray-500 mb-1">Total Crew Hours This Week</p>
          <p className="text-2xl font-bold text-green-400">{totalHours}h</p>
        </div>
        <div
          className="flex-1 rounded-lg px-4 py-3 border"
          style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
        >
          <p className="text-xs text-gray-500 mb-1">Avg Hours / Crew Member</p>
          <p className="text-2xl font-bold text-blue-400">{avgHours}h</p>
        </div>
        <div
          className="flex-1 rounded-lg px-4 py-3 border"
          style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
        >
          <p className="text-xs text-gray-500 mb-1">Active Members</p>
          <p className="text-2xl font-bold text-gray-200">{crew.length}</p>
        </div>
      </div>

      {/* Crew table */}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Name
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Role
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Assigned Projects
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Hours This Week
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {crew.map((member, idx) => (
              <tr
                key={member.id}
                style={{
                  backgroundColor: idx % 2 === 0 ? '#0a0b0f' : '#0c0d12',
                  borderBottom: '1px solid #1a1c23',
                }}
              >
                {/* Name */}
                <td className="px-4 py-3 font-medium text-gray-200">{member.name}</td>

                {/* Role */}
                <td className="px-4 py-3">
                  <RoleBadge role={member.role} />
                </td>

                {/* Projects — inline edit */}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 mb-1">
                    {(member.assignedProjects ?? []).map((proj) => (
                      <span
                        key={proj}
                        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                        style={{ backgroundColor: '#111827', borderColor: '#374151', color: '#9ca3af' }}
                      >
                        {proj}
                        <button
                          onClick={() => handleRemoveProject(member.id, proj)}
                          className="text-gray-600 hover:text-red-400 transition-colors ml-0.5"
                          title="Remove project"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements.namedItem('project') as HTMLInputElement;
                      handleAddProject(member.id, input.value);
                      input.value = '';
                    }}
                    className="flex gap-1"
                  >
                    <input
                      name="project"
                      placeholder="Add project…"
                      className="text-xs px-2 py-1 rounded border outline-none focus:border-green-600 transition-colors"
                      style={{ backgroundColor: '#0d0e14', borderColor: '#2d3140', color: '#9ca3af', width: 130 }}
                    />
                    <button
                      type="submit"
                      className="text-xs px-2 py-1 rounded border transition-colors hover:bg-green-900/30"
                      style={{ borderColor: '#16a34a33', color: '#4ade80' }}
                    >
                      +
                    </button>
                  </form>
                </td>

                {/* Hours */}
                <td className="px-4 py-3 text-gray-300 font-mono">{member.hoursThisWeek}h</td>

                {/* Status */}
                <td className="px-4 py-3">
                  <StatusDot hours={member.hoursThisWeek} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Crew Panel ──────────────────────────────────────────────────────────────

function CrewPanel() {
  // Replace with real Supabase query during integration — fetch authenticated crew member
  const marcus = mockCrewMembers.find((m) => m.name === 'Marcus R.')!;

  return (
    <div className="space-y-5 max-w-xl">
      {/* Header card */}
      <div
        className="flex items-center gap-4 rounded-lg px-5 py-4 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: '#1e3a5f', color: '#60a5fa' }}
        >
          MR
        </div>
        <div>
          <p className="font-semibold text-gray-100">{marcus.name}</p>
          <RoleBadge role={marcus.role} />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-gray-500">Hours This Week</p>
          <p className="text-xl font-bold text-blue-400">{marcus.hoursThisWeek}h</p>
        </div>
      </div>

      {/* Assigned projects */}
      <div
        className="rounded-lg px-5 py-4 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Briefcase size={14} className="text-green-500" />
          <p className="text-sm font-semibold text-gray-300">Assigned Projects</p>
        </div>
        <div className="space-y-2">
          {(marcus.assignedProjects ?? []).map((proj) => (
            <div
              key={proj}
              className="flex items-center gap-3 px-3 py-2 rounded border"
              style={{ backgroundColor: '#0a0b0f', borderColor: '#1a1c23' }}
            >
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <span className="text-sm text-gray-200">{proj}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tasks for today */}
      <div
        className="rounded-lg px-5 py-4 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <CheckSquare size={14} className="text-blue-400" />
          <p className="text-sm font-semibold text-gray-300">Tasks for Today</p>
        </div>
        <div className="space-y-2">
          {MOCK_TASKS_TODAY.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-3 px-3 py-2 rounded border"
              style={{ backgroundColor: '#0a0b0f', borderColor: '#1a1c23' }}
            >
              <span
                className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  task.status === 'done'
                    ? 'bg-green-500'
                    : task.status === 'in_progress'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-gray-600'
                }`}
              />
              <span className="text-sm text-gray-300 flex-1">{task.title}</span>
              <span
                className={`text-xs font-medium capitalize px-2 py-0.5 rounded-full border ${
                  task.status === 'done'
                    ? 'text-green-400 border-green-700/40 bg-green-900/20'
                    : task.status === 'in_progress'
                    ? 'text-yellow-400 border-yellow-700/40 bg-yellow-900/20'
                    : 'text-gray-500 border-gray-600/40 bg-gray-800/20'
                }`}
              >
                {task.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Log Hours button (stub) */}
      <button
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors hover:bg-blue-900/20"
        style={{ borderColor: '#1e40af55', color: '#60a5fa' }}
        onClick={() => alert('Log Hours — stub. Will connect to auth + backend in integration.')}
      >
        <Clock size={14} />
        Log Hours
      </button>
    </div>
  );
}

// ─── Guest Panel ─────────────────────────────────────────────────────────────

function GuestPanel() {
  const project = {
    name: 'Riverside Commercial Buildout',
    phase: 'Panel & Service',
    healthPercent: 65,
  };

  return (
    <div className="space-y-5 max-w-sm">
      {/* Read-only project card */}
      <div
        className="rounded-lg px-5 py-5 border"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Eye size={14} className="text-gray-500" />
          <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Project (Read-Only)</span>
        </div>

        <p className="text-lg font-semibold text-gray-100 mb-1">{project.name}</p>

        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">Phase:</span>
          <span className="text-xs font-medium text-blue-300 bg-blue-900/20 border border-blue-700/30 px-2 py-0.5 rounded-full">
            {project.phase}
          </span>
        </div>

        {/* Health bar */}
        <div className="mb-1">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Health</span>
            <span className="text-green-400 font-mono">{project.healthPercent}%</span>
          </div>
          <div className="h-2 w-full rounded-full" style={{ backgroundColor: '#1a1c23' }}>
            <div
              className="h-2 rounded-full"
              style={{ width: `${project.healthPercent}%`, backgroundColor: '#16a34a' }}
            />
          </div>
        </div>
      </div>

      {/* Restricted notice */}
      <div
        className="flex items-start gap-3 rounded-lg px-4 py-3 border"
        style={{ backgroundColor: '#111015', borderColor: '#2d1f1f' }}
      >
        <Lock size={14} className="text-gray-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-500 leading-relaxed">
          Financial data, crew information, and tasks are restricted. Request access to see more.
        </p>
      </div>

      {/* Request Access button (stub) */}
      <button
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors hover:bg-gray-800/40"
        style={{ borderColor: '#374151', color: '#9ca3af' }}
        onClick={() => alert('Request Access — stub. Will trigger owner notification in integration.')}
      >
        <Shield size={14} />
        Request Access
      </button>
    </div>
  );
}

// ─── Role Manager ────────────────────────────────────────────────────────────

const STUB_ORG_ID      = 'org-001';
const STUB_CURRENT_USER = 'user-001';  // owner in mock data

/** Small badge that renders role name with colour-coded styling */
function AppRoleBadge({ role }: { role: AppRole }) {
  const c = ROLE_COLORS[role];
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${c.text} ${c.bg} ${c.border}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

/** Dropdown to change a member's role */
function RoleDropdown({
  memberId,
  currentRole,
  onChange,
}: {
  memberId: string;
  currentRole: AppRole;
  onChange: (memberId: string, role: AppRole) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors hover:bg-gray-800/60"
        style={{ borderColor: '#2d3140', color: '#9ca3af' }}
      >
        {ROLE_LABELS[currentRole]}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-20 rounded-lg border overflow-hidden min-w-[140px]"
          style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128', boxShadow: '0 4px 16px #00000088' }}
        >
          {ALL_ROLES.map((role) => (
            <button
              key={role}
              onClick={() => {
                onChange(memberId, role);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-gray-800/60 flex items-center gap-2 ${
                role === currentRole ? 'text-green-400' : 'text-gray-300'
              }`}
            >
              {role === currentRole && <span className="text-green-500">✓</span>}
              {role !== currentRole && <span className="w-3" />}
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Invite modal / popover */
function InviteModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<AppRole>('crew');
  const [link, setLink]                 = useState<string | null>(null);
  const [copied, setCopied]             = useState(false);
  const [generating, setGenerating]     = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    const result = await generateInviteLink(STUB_ORG_ID, selectedRole, STUB_CURRENT_USER);
    setGenerating(false);
    if (result.success && result.data) {
      setLink(result.data.url);
    }
  }

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: '#00000088' }}>
      <div
        className="rounded-xl border p-6 w-full max-w-sm"
        style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <UserPlus size={15} className="text-green-500" />
            <span className="text-sm font-semibold text-gray-200">Invite Team Member</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-400 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Role selector */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-2">Pre-select role for invitee</p>
          <div className="grid grid-cols-2 gap-2">
            {ALL_ROLES.map((role) => {
              const c = ROLE_COLORS[role];
              return (
                <button
                  key={role}
                  onClick={() => { setSelectedRole(role); setLink(null); }}
                  className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                    selectedRole === role
                      ? `${c.text} ${c.bg} ${c.border}`
                      : 'text-gray-500 border-gray-700/40 hover:text-gray-300 hover:bg-gray-800/30'
                  }`}
                >
                  {ROLE_LABELS[role]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Generate link */}
        {!link ? (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors hover:bg-green-900/20"
            style={{ borderColor: '#16a34a55', color: generating ? '#4b5563' : '#4ade80' }}
          >
            {generating ? 'Generating…' : `Generate ${ROLE_LABELS[selectedRole]} Invite Link`}
          </button>
        ) : (
          <div className="space-y-3">
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ backgroundColor: '#0a0b0f', borderColor: '#2d3140' }}
            >
              <span className="text-xs text-gray-400 flex-1 truncate font-mono">{link}</span>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 text-gray-500 hover:text-green-400 transition-colors"
              >
                {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
              </button>
            </div>
            <p className="text-xs text-gray-600">Link expires in 7 days · {ROLE_LABELS[selectedRole]} access</p>
            <button
              onClick={() => setLink(null)}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors underline"
            >
              Generate new link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "View As" dropdown — owner-only feature to preview the app as any role */
function ViewAsDropdown({
  viewingAs,
  onChange,
}: {
  viewingAs: AppRole | null;
  onChange: (role: AppRole | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const label = viewingAs ? `Viewing as: ${ROLE_LABELS[viewingAs]}` : 'View As…';
  const c = viewingAs ? ROLE_COLORS[viewingAs] : null;

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
          {/* Reset option */}
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-gray-800/60 text-gray-500"
          >
            — Reset to Owner view
          </button>

          {ALL_ROLES.filter((r) => r !== 'owner').map((role) => (
            <button
              key={role}
              onClick={() => { onChange(role); setOpen(false); }}
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
  );
}

/** Main Role Manager panel — lists all org members, role change dropdowns, invite button */
function RoleManager({ isOwner }: { isOwner: boolean }) {
  const [members, setMembers]       = useState<OrgMember[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [viewingAs, setViewingAs]   = useState<AppRole | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    const result = await getOrgMembers(STUB_ORG_ID);
    if (result.success && result.data) {
      setMembers(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function handleRoleChange(memberId: string, newRole: AppRole) {
    // Optimistic UI update
    setMembers((prev) =>
      prev.map((m) => (m.user_id === memberId ? { ...m, role: newRole } : m))
    );
    await assignRole({
      userId: memberId,
      orgId: STUB_ORG_ID,
      role: newRole,
      assignedBy: STUB_CURRENT_USER,
    });
  }

  return (
    <div className="mt-8">
      {/* Header row */}
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
          {/* View As — owner only */}
          {isOwner && (
            <ViewAsDropdown viewingAs={viewingAs} onChange={setViewingAs} />
          )}
          {/* Invite button */}
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

      {/* View As banner */}
      {viewingAs && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg border mb-4 text-xs"
          style={{ backgroundColor: '#1a1200', borderColor: '#ca8a0444', color: '#fbbf24' }}
        >
          <Eye size={12} />
          Previewing app as <strong>{ROLE_LABELS[viewingAs]}</strong> — only panels visible to this role are shown below.
        </div>
      )}

      {/* Member table */}
      {loading ? (
        <p className="text-xs text-gray-600 py-4">Loading members…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Member</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Current Role</th>
                {isOwner && (
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Change Role</th>
                )}
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Since</th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((member, idx) => (
                <tr
                  key={member.user_id}
                  style={{
                    backgroundColor: idx % 2 === 0 ? '#0a0b0f' : '#0c0d12',
                    borderBottom: '1px solid #1a1c23',
                  }}
                >
                  {/* Avatar + Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: '#1e3a5f', color: '#60a5fa' }}
                      >
                        {member.avatarInitials ?? member.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-gray-200 font-medium text-xs">{member.name}</span>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 text-gray-500 text-xs">{member.email}</td>

                  {/* Role badge */}
                  <td className="px-4 py-3">
                    <AppRoleBadge role={member.role} />
                  </td>

                  {/* Role change dropdown — owner only, can't change own role */}
                  {isOwner && (
                    <td className="px-4 py-3">
                      {member.user_id === STUB_CURRENT_USER ? (
                        <span className="text-xs text-gray-700 italic">You</span>
                      ) : (
                        <RoleDropdown
                          memberId={member.user_id}
                          currentRole={member.role}
                          onChange={handleRoleChange}
                        />
                      )}
                    </td>
                  )}

                  {/* Assigned at */}
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {new Date(member.assigned_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-700 mt-2">
        V3-28 · Role Manager stub — mutations persist in-memory only. Wire to Supabase <code>user_roles</code> on integration.
      </p>

      {/* Invite modal */}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}

// ─── Permission Matrix ───────────────────────────────────────────────────────

function PermissionMatrix() {
  function Check({ allowed }: { allowed: boolean }) {
    return allowed ? (
      <span className="text-green-400 font-bold">✓</span>
    ) : (
      <span className="text-gray-700">—</span>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <Shield size={14} className="text-green-500" />
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Permission Matrix</h3>
      </div>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 w-1/2">
                Permission
              </th>
              <th className="text-center text-xs font-semibold text-green-600 uppercase tracking-wider px-4 py-3">
                Owner
              </th>
              <th className="text-center text-xs font-semibold text-blue-600 uppercase tracking-wider px-4 py-3">
                Crew
              </th>
              <th className="text-center text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">
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
                <td className="px-4 py-2.5 text-gray-300">{row.permission}</td>
                <td className="px-4 py-2.5 text-center">
                  <Check allowed={row.owner} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Check allowed={row.crew} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Check allowed={row.guest} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Role Switcher ───────────────────────────────────────────────────────────

const ROLE_TABS: { role: UserRole; label: string; icon: React.ReactNode }[] = [
  { role: 'owner', label: 'Owner View', icon: <Shield size={13} /> },
  { role: 'crew', label: 'Crew View', icon: <Users size={13} /> },
  { role: 'guest', label: 'Guest View', icon: <Eye size={13} /> },
];

// ─── Main View ───────────────────────────────────────────────────────────────

export default function CrewPortal() {
  const [activeRole, setActiveRole] = useState<UserRole>('owner');

  const roleStyles: Record<UserRole, { active: string; inactive: string }> = {
    owner: {
      active: 'border-green-600 text-green-400 bg-green-900/20',
      inactive: 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30',
    },
    crew: {
      active: 'border-blue-600 text-blue-400 bg-blue-900/20',
      inactive: 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30',
    },
    guest: {
      active: 'border-gray-500 text-gray-300 bg-gray-800/30',
      inactive: 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30',
    },
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Users size={18} className="text-green-500" />
          Crew Portal
        </h2>
        <p className="text-xs text-gray-600 mt-1">
          E14 · Role-based access prototype. Mock data only — no Supabase.
        </p>
      </div>

      {/* Role Switcher */}
      <div
        className="rounded-xl border p-4 mb-6"
        style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
      >
        <div className="flex gap-2 mb-3">
          {ROLE_TABS.map(({ role, label, icon }) => (
            <button
              key={role}
              onClick={() => setActiveRole(role)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                activeRole === role ? roleStyles[role].active : roleStyles[role].inactive
              }`}
              style={{ borderWidth: '1px' }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600">
          Role Switcher — Prototype Only. Real roles set via auth during integration.
        </p>
      </div>

      {/* Role panel */}
      <div
        className="rounded-xl border p-5 mb-2"
        style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
      >
        {/* Panel heading */}
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

      {/* Permission Matrix */}
      <PermissionMatrix />

      {/* Role Manager — V3-28 */}
      <RoleManager isOwner={activeRole === 'owner'} />
    </div>
  );
}
