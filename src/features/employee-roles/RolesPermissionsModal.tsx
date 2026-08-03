/**
 * RolesPermissionsModal.tsx — ROLE-2 owner/admin interface for managing
 * an employee's roles and individual permissions.
 *
 * Three sections:
 *   A. Assigned Roles   — toggle role assignments for this employee
 *   B. Individual Permissions — tri-state per-permission overrides
 *   C. Manage Roles     — create / rename / set permissions / delete roles
 *
 * Plus an Effective Access summary at the bottom.
 *
 * Note: Role and permission assignments are saved immediately. Employee Portal
 * navigation will begin using these permissions in the next phase (ROLE-3).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  X,
  Shield,
  Plus,
  Trash2,
  Edit2,
  Check,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  XCircle,
  Minus,
} from 'lucide-react'
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  getPermissionsByCategory,
  type PermissionCategory,
} from './permissionCatalog'
import {
  loadOrgRoles,
  loadRolePermissions,
  loadEmployeeRoles,
  loadEmployeeOverrides,
  countRoleAssignments,
  createRole,
  renameRole,
  setRolePermissions,
  deleteRole,
  assignRole,
  removeRole,
  setOverride,
  deleteOverride,
  computeEffectiveAccess,
  titleCaseRoleName,
  type EmpRole,
  type EmpRoleAssignment,
  type EmpPermissionOverride,
  type EffectivePermission,
} from './roleManagementService'

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'assigned' | 'individual' | 'manage'
type OverrideState = 'inherit' | 'allow' | 'deny'
type LoadingState = 'idle' | 'loading' | 'error'

interface RoleWithPerms {
  role: EmpRole
  permKeys: string[]
}

interface Props {
  epId: string
  displayName: string
  orgId: string
  onClose: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tc(name: string) {
  return titleCaseRoleName(name)
}

// ── Tri-state override control ────────────────────────────────────────────────

function TriState({
  value,
  onChange,
  disabled,
}: {
  value: OverrideState
  onChange: (v: OverrideState) => void
  disabled?: boolean
}) {
  const cls = (v: OverrideState) => {
    const base = 'px-2 py-1 text-xs font-semibold rounded border transition-all select-none'
    if (disabled) return `${base} opacity-40 cursor-not-allowed`
    if (v === value) {
      if (v === 'deny') return `${base} bg-red-600 border-red-500 text-white cursor-default`
      if (v === 'allow') return `${base} bg-emerald-600 border-emerald-500 text-white cursor-default`
      return `${base} bg-gray-600 border-gray-500 text-gray-200 cursor-default`
    }
    return `${base} bg-transparent border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300 cursor-pointer`
  }

  const cycle = () => {
    if (disabled) return
    if (value === 'inherit') onChange('allow')
    else if (value === 'allow') onChange('deny')
    else onChange('inherit')
  }

  return (
    <div className="flex gap-1" role="group" aria-label="Permission override">
      {(['inherit', 'allow', 'deny'] as OverrideState[]).map(v => (
        <button
          key={v}
          type="button"
          className={cls(v)}
          onClick={() => !disabled && onChange(v)}
          aria-pressed={value === v}
          aria-label={v === 'inherit' ? 'Inherit default' : v === 'allow' ? 'Allow' : 'Deny'}
        >
          {v === 'inherit' ? '—' : v === 'allow' ? 'Allow' : 'Deny'}
        </button>
      ))}
    </div>
  )
}

// ── Effective access badge ────────────────────────────────────────────────────

function EffectiveBadge({ ep }: { ep: EffectivePermission }) {
  if (ep.state === 'denied_override') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400 font-semibold">
        <XCircle className="w-3 h-3" /> Denied
      </span>
    )
  }
  if (ep.state === 'allowed_override') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
        <CheckCircle className="w-3 h-3" /> Allowed
      </span>
    )
  }
  if (ep.state === 'allowed_role') {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-300 font-semibold">
        <Check className="w-3 h-3" /> Allowed
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-gray-600">
      <Minus className="w-3 h-3" /> No access
    </span>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function RolesPermissionsModal({ epId, displayName, orgId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('assigned')
  const [loadState, setLoadState] = useState<LoadingState>('loading')
  const [loadError, setLoadError] = useState('')

  // Data
  const [orgRoles, setOrgRoles] = useState<RoleWithPerms[]>([])
  const [assignments, setAssignments] = useState<EmpRoleAssignment[]>([])
  const [overrides, setOverrides] = useState<EmpPermissionOverride[]>([])

  // Mutation status
  const [mutating, setMutating] = useState<string | null>(null) // key of in-flight mutation
  const [mutError, setMutError] = useState('')
  const [mutSuccess, setMutSuccess] = useState('')

  // Manage Roles tab state
  const [manageMode, setManageMode] = useState<'list' | 'create' | 'edit-perms' | 'rename'>('list')
  const [editingRole, setEditingRole] = useState<RoleWithPerms | null>(null)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [editRoleName, setEditRoleName] = useState('')
  const [editRolePerms, setEditRolePerms] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [roleCounts, setRoleCounts] = useState<Map<string, number>>(new Map())
  const [expandedEditCats, setExpandedEditCats] = useState<Set<PermissionCategory>>(
    new Set(PERMISSION_CATEGORIES),
  )

  // Effective access
  const [effectiveAccess, setEffectiveAccess] = useState<EffectivePermission[]>([])

  // Category expand state for individual perms tab
  const [expandedCats, setExpandedCats] = useState<Set<PermissionCategory>>(
    new Set(PERMISSION_CATEGORIES),
  )

  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load all data ───────────────────────────────────────────────────────────

  const loadAll = useCallback(async (): Promise<RoleWithPerms[]> => {
    setLoadState('loading')
    setLoadError('')

    try {
      const [rolesRes, assignRes, overrideRes] = await Promise.all([
        loadOrgRoles(),
        loadEmployeeRoles(epId),
        loadEmployeeOverrides(epId),
      ])

      if (!rolesRes.success) throw new Error(rolesRes.error)
      if (!assignRes.success) throw new Error(assignRes.error)
      if (!overrideRes.success) throw new Error(overrideRes.error)

      const rawRoles = rolesRes.data ?? []

      // Load permissions for each role
      const rolesWithPerms: RoleWithPerms[] = await Promise.all(
        rawRoles.map(async role => {
          const permRes = await loadRolePermissions(role.id)
          return { role, permKeys: permRes.data ?? [] }
        }),
      )

      // Load assignee counts for Manage Roles display
      const counts = new Map<string, number>()
      await Promise.all(
        rawRoles.map(async role => {
          const res = await countRoleAssignments(role.id)
          counts.set(role.id, res.data ?? 0)
        }),
      )

      const currentAssignments = assignRes.data ?? []
      const currentOverrides = overrideRes.data ?? []

      setOrgRoles(rolesWithPerms)
      setAssignments(currentAssignments)
      setOverrides(currentOverrides)
      setRoleCounts(counts)

      // Compute effective access
      const rolePermMap = new Map(rolesWithPerms.map(r => [r.role.id, r.permKeys]))
      const roleNameMap = new Map(rawRoles.map(r => [r.id, r.name]))
      setEffectiveAccess(
        computeEffectiveAccess(
          PERMISSION_CATALOG.map(p => p.key),
          currentOverrides,
          currentAssignments,
          rolePermMap,
          roleNameMap,
        ),
      )

      setLoadState('idle')
      return rolesWithPerms
    } catch (err) {
      setLoadState('error')
      setLoadError(err instanceof Error ? err.message : 'Failed to load data')
      return []
    }
  }, [epId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── Mutation helpers ────────────────────────────────────────────────────────

  function showSuccess(msg: string) {
    setMutError('')
    setMutSuccess(msg)
    if (successTimer.current) clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => setMutSuccess(''), 2500)
  }

  async function runMutation(key: string, fn: () => Promise<void>) {
    if (mutating) return
    setMutating(key)
    setMutError('')
    try {
      await fn()
    } catch (err) {
      setMutError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setMutating(null)
    }
  }

  // ── A. Assigned Roles ───────────────────────────────────────────────────────

  function isAssigned(roleId: string) {
    return assignments.some(a => a.role_id === roleId)
  }

  async function handleAssignRole(role: EmpRole) {
    const key = `assign-${role.id}`
    if (mutating || isAssigned(role.id)) return
    await runMutation(key, async () => {
      const res = await assignRole(orgId, epId, role.id)
      if (!res.success) throw new Error(res.error || 'Could not assign role.')
      const verify = await loadEmployeeRoles(epId)
      if (!verify.success || !(verify.data ?? []).some(a => a.role_id === role.id)) {
        throw new Error(`Role "${tc(role.name)}" was assigned but did not appear after reload.`)
      }
      showSuccess(`Assigned role "${tc(role.name)}"`)
      await loadAll()
    })
  }

  async function handleRemoveRole(role: EmpRole) {
    const key = `assign-${role.id}`
    if (mutating || !isAssigned(role.id)) return
    await runMutation(key, async () => {
      const res = await removeRole(epId, role.id)
      if (!res.success) throw new Error(res.error || 'Could not remove role.')
      const verify = await loadEmployeeRoles(epId)
      if (!verify.success) throw new Error(verify.error || 'Could not verify role removal.')
      if ((verify.data ?? []).some(a => a.role_id === role.id)) {
        throw new Error(`Role "${tc(role.name)}" is still assigned after removal.`)
      }
      showSuccess(`Removed role "${tc(role.name)}"`)
      await loadAll()
    })
  }

  // ── B. Individual Permissions ───────────────────────────────────────────────

  function getOverrideState(permKey: string): OverrideState {
    const ov = overrides.find(o => o.permission_key === permKey)
    if (!ov) return 'inherit'
    return ov.is_deny ? 'deny' : 'allow'
  }

  function getRoleSource(permKey: string): string {
    for (const rwp of orgRoles) {
      if (!isAssigned(rwp.role.id)) continue
      if (rwp.permKeys.includes(permKey)) {
        return `Granted by ${tc(rwp.role.name)}`
      }
    }
    return 'No role grant'
  }

  async function handleOverrideChange(permKey: string, state: OverrideState) {
    const key = `ov-${permKey}`
    await runMutation(key, async () => {
      if (state === 'inherit') {
        const res = await deleteOverride(epId, permKey)
        if (!res.success) throw new Error(res.error)
      } else {
        const res = await setOverride(orgId, epId, permKey, state === 'deny')
        if (!res.success) throw new Error(res.error)
      }
      await loadAll()
    })
  }

  // ── C. Manage Roles ─────────────────────────────────────────────────────────

  async function handleCreateRole() {
    await runMutation('create-role', async () => {
      if (!newRoleName.trim()) throw new Error('Role name cannot be blank.')
      const res = await createRole(newRoleName, newRoleDesc)
      if (!res.success) throw new Error(res.error)
      if (!res.data?.id) throw new Error('Role insert returned no ID.')
      showSuccess(`Created role "${tc(res.data.name)}"`)
      setNewRoleName('')
      setNewRoleDesc('')
      // Fresh query after mutation — prove persistence before switching UI.
      const freshRoles = await loadAll()
      if (freshRoles.length === 0) {
        throw new Error('Role was saved but is not visible. Check that your account has SELECT permission on emp_roles.')
      }
      if (!freshRoles.some(r => r.role.id === res.data!.id)) {
        throw new Error(`Role "${tc(res.data.name)}" was created (id ${res.data.id}) but did not appear in the fresh roles query.`)
      }
      setManageMode('list')
    })
  }

  function startEditPermissions(rwp: RoleWithPerms) {
    setMutError('')
    setEditingRole(rwp)
    setEditRoleName(rwp.role.name)
    setEditRolePerms(new Set(rwp.permKeys))
    setExpandedEditCats(new Set(PERMISSION_CATEGORIES))
    setManageMode('edit-perms')
  }

  function startRenameRole(rwp: RoleWithPerms) {
    setMutError('')
    setEditingRole(rwp)
    setEditRoleName(rwp.role.name)
    setManageMode('rename')
  }

  async function handleSavePermissions() {
    if (!editingRole) return
    await runMutation('save-role', async () => {
      const selected = Array.from(editRolePerms)
      const res = await setRolePermissions(orgId, editingRole.role.id, selected)
      if (!res.success) throw new Error(res.error || 'Could not save permissions.')
      const savedKeys = res.data ?? []
      if (savedKeys.length !== selected.length) {
        throw new Error(
          `Save verification failed: expected ${selected.length} permission(s), found ${savedKeys.length}.`,
        )
      }
      // Fresh full reload before leaving the editor — prove card count will update.
      const freshRoles = await loadAll()
      const updated = freshRoles.find(r => r.role.id === editingRole.role.id)
      if (!updated) {
        throw new Error('Role permissions saved but the role is missing after reload.')
      }
      if (updated.permKeys.length !== selected.length) {
        throw new Error(
          `Role card would show ${updated.permKeys.length} permission(s) after save; expected ${selected.length}.`,
        )
      }
      showSuccess(
        `Saved ${selected.length} permission${selected.length !== 1 ? 's' : ''} on "${tc(editingRole.role.name)}"`,
      )
      setManageMode('list')
      setEditingRole(null)
    })
  }

  async function handleSaveRename() {
    if (!editingRole) return
    await runMutation('rename-role', async () => {
      if (!editRoleName.trim()) throw new Error('Role name cannot be blank.')
      if (editRoleName.trim().toLowerCase() === editingRole.role.name) {
        setManageMode('list')
        setEditingRole(null)
        return
      }
      const res = await renameRole(editingRole.role.id, editRoleName)
      if (!res.success) throw new Error(res.error || 'Could not rename role.')
      showSuccess(`Renamed role to "${tc(editRoleName)}"`)
      setManageMode('list')
      setEditingRole(null)
      await loadAll()
    })
  }

  async function handleDeleteRole(role: EmpRole) {
    await runMutation(`del-${role.id}`, async () => {
      const res = await deleteRole(role.id)
      if (!res.success) throw new Error(res.error)
      showSuccess(`Deleted role "${tc(role.name)}"`)
      setConfirmDeleteId(null)
      await loadAll()
    })
  }

  // ── Close behavior ──────────────────────────────────────────────────────────

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && manageMode === 'list' && !confirmDeleteId) {
      onClose()
    }
  }

  function handleEscape(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && manageMode === 'list' && !confirmDeleteId) {
      onClose()
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const tabCls = (t: Tab) =>
    `px-4 py-2.5 text-sm font-semibold rounded-lg transition border ${
      tab === t
        ? 'bg-indigo-600 border-indigo-500 text-white'
        : 'bg-transparent border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-700'
    }`

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={handleBackdropClick}
      onKeyDown={handleEscape}
      tabIndex={-1}
    >
      <div className="w-full max-w-2xl bg-[var(--bg-primary)] border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[88vh]">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-lg font-bold text-gray-100">
                Roles &amp; Permissions — {displayName}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Role and permission assignments are saved immediately. Employee Portal navigation
                will begin using these permissions in the next phase.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition ml-4 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 px-6 pt-4 shrink-0 border-b border-gray-800 pb-3">
          <button className={tabCls('assigned')} onClick={() => setTab('assigned')}>
            Assigned Roles
          </button>
          <button className={tabCls('individual')} onClick={() => setTab('individual')}>
            Individual Permissions
          </button>
          <button className={tabCls('manage')} onClick={() => setTab('manage')}>
            Manage Roles
          </button>
        </div>

        {/* ── Global status bar ──────────────────────────────────────────────── */}
        {(mutError || mutSuccess) && (
          <div
            className={`mx-6 mt-3 px-4 py-2 rounded text-sm font-medium shrink-0 ${
              mutError
                ? 'bg-red-900/40 border border-red-700/50 text-red-300'
                : 'bg-emerald-900/40 border border-emerald-700/50 text-emerald-300'
            }`}
          >
            {mutError || mutSuccess}
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

          {/* Loading / error */}
          {loadState === 'loading' && (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Loading…</span>
            </div>
          )}
          {loadState === 'error' && (
            <div className="flex flex-col items-center gap-3 py-12">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-red-400 text-sm">{loadError}</p>
              <button
                onClick={loadAll}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded text-sm hover:bg-gray-600 transition"
              >
                Retry
              </button>
            </div>
          )}

          {loadState === 'idle' && (
            <>
              {/* ══════════════════════════════════════════════════════════════
                  TAB A: ASSIGNED ROLES
              ══════════════════════════════════════════════════════════════ */}
              {tab === 'assigned' && (
                <div className="space-y-3">
                  <div className="bg-[var(--bg-card)] border border-gray-700/50 rounded-lg px-4 py-3 text-xs text-gray-400">
                    Assign one or more roles to this employee. The employee inherits the permissions
                    contained in those roles.
                  </div>

                  {orgRoles.length === 0 ? (
                    <div className="text-center py-10 bg-[var(--bg-card)] rounded-lg border border-dashed border-gray-700">
                      <Shield className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-400 text-sm font-medium">No roles created yet</p>
                      <p className="text-gray-600 text-xs mt-1">
                        Go to <strong>Manage Roles</strong> to create your first role.
                      </p>
                      <button
                        onClick={() => setTab('manage')}
                        className="mt-3 px-3 py-1.5 bg-indigo-600/30 text-indigo-300 rounded text-xs font-semibold hover:bg-indigo-600/50 transition"
                      >
                        Manage Roles →
                      </button>
                    </div>
                  ) : (
                    orgRoles.map(({ role, permKeys }) => {
                      const assigned = isAssigned(role.id)
                      const busy = mutating === `assign-${role.id}`
                      return (
                        <div
                          key={role.id}
                          className={`flex items-start gap-3 p-4 rounded-lg border transition ${
                            assigned
                              ? 'bg-indigo-900/20 border-indigo-600/50'
                              : 'bg-[var(--bg-card)] border-gray-700'
                          }`}
                        >
                          <div
                            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              assigned
                                ? 'bg-indigo-500 border-indigo-400'
                                : 'bg-transparent border-gray-600'
                            }`}
                            aria-hidden
                          >
                            {assigned && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-100 text-sm">{tc(role.name)}</span>
                              {assigned && (
                                <span className="text-xs px-1.5 py-0.5 bg-indigo-600/30 text-indigo-300 rounded">
                                  Assigned
                                </span>
                              )}
                              {busy && (
                                <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />
                              )}
                            </div>
                            {role.description && (
                              <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>
                            )}
                            <p className="text-xs text-gray-600 mt-1">
                              {permKeys.length === 0
                                ? '0 permissions'
                                : `${permKeys.length} permission${permKeys.length !== 1 ? 's' : ''}`}
                            </p>
                          </div>
                          <div className="shrink-0">
                            {assigned ? (
                              <button
                                type="button"
                                onClick={() => handleRemoveRole(role)}
                                disabled={!!mutating}
                                className="px-3 py-1.5 text-xs font-semibold rounded border border-red-700/50 bg-red-900/30 text-red-300 hover:bg-red-900/50 transition disabled:opacity-50"
                              >
                                {busy ? 'Removing…' : 'Remove'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAssignRole(role)}
                                disabled={!!mutating}
                                className="px-3 py-1.5 text-xs font-semibold rounded border border-indigo-600/50 bg-indigo-600/30 text-indigo-200 hover:bg-indigo-600/50 transition disabled:opacity-50"
                              >
                                {busy ? 'Assigning…' : 'Assign'}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════════
                  TAB B: INDIVIDUAL PERMISSIONS
              ══════════════════════════════════════════════════════════════ */}
              {tab === 'individual' && (
                <div className="space-y-3">
                  <div className="bg-[var(--bg-card)] border border-gray-700/50 rounded-lg px-4 py-3 text-xs text-gray-400">
                    Use Allow or Deny to override this employee’s inherited role permissions. Deny
                    always wins.
                  </div>

                  {PERMISSION_CATEGORIES.map(cat => {
                    const perms = getPermissionsByCategory(cat)
                    const expanded = expandedCats.has(cat)
                    return (
                      <div key={cat} className="bg-[var(--bg-card)] rounded-lg border border-gray-700 overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700/20 transition"
                          onClick={() => {
                            const next = new Set(expandedCats)
                            if (expanded) next.delete(cat)
                            else next.add(cat)
                            setExpandedCats(next)
                          }}
                        >
                          <span className="font-semibold text-sm text-gray-200">{cat}</span>
                          <span className="flex items-center gap-2 text-gray-500 text-xs">
                            <span>{perms.length} perm{perms.length !== 1 ? 's' : ''}</span>
                            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </span>
                        </button>

                        {expanded && (
                          <div className="border-t border-gray-700 divide-y divide-gray-700/50">
                            {perms.map(p => {
                              const state = getOverrideState(p.key)
                              const busy = mutating === `ov-${p.key}`
                              const roleSource = getRoleSource(p.key)
                              return (
                                <div key={p.key} className="px-4 py-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-medium text-gray-200">
                                          {p.label}
                                        </span>
                                        {p.sensitive && (
                                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/40 border border-amber-700/50 text-amber-400 rounded font-bold">
                                            SENSITIVE
                                          </span>
                                        )}
                                        {busy && (
                                          <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                                      <p className="text-[11px] text-gray-600 mt-1">
                                        {state === 'inherit' ? roleSource : ''}
                                      </p>
                                    </div>
                                    <div className="shrink-0">
                                      <TriState
                                        value={state}
                                        onChange={v => handleOverrideChange(p.key, v)}
                                        disabled={!!mutating}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════════
                  TAB C: MANAGE ROLES
              ══════════════════════════════════════════════════════════════ */}
              {tab === 'manage' && (
                <div className="space-y-4">
                  {manageMode === 'list' && (
                    <div className="bg-[var(--bg-card)] border border-gray-700/50 rounded-lg px-4 py-3 text-xs text-gray-400">
                      Choose the permissions included with each role.
                    </div>
                  )}

                  {/* Create role form */}
                  {manageMode === 'create' && (
                    <div className="bg-[var(--bg-card)] rounded-lg border border-indigo-700/40 p-4 space-y-3">
                      <h3 className="text-sm font-bold text-gray-100">Create New Role</h3>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">
                          Role Name
                        </label>
                        <input
                          type="text"
                          value={newRoleName}
                          onChange={e => setNewRoleName(e.target.value)}
                          placeholder="e.g. dispatcher, lead_tech, billing"
                          className="w-full bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-indigo-600"
                          maxLength={80}
                          autoFocus
                        />
                        <p className="text-xs text-gray-600 mt-1">Stored as lowercase. Letters, numbers, spaces, underscores.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">
                          Description (optional)
                        </label>
                        <input
                          type="text"
                          value={newRoleDesc}
                          onChange={e => setNewRoleDesc(e.target.value)}
                          placeholder="Short description of this role"
                          className="w-full bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-indigo-600"
                          maxLength={200}
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { setManageMode('list'); setNewRoleName(''); setNewRoleDesc('') }}
                          className="px-3 py-2 bg-gray-700/50 text-gray-300 rounded text-sm hover:bg-gray-700 transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateRole}
                          disabled={!!mutating || !newRoleName.trim()}
                          className="flex-1 px-3 py-2 bg-indigo-600/70 text-indigo-100 rounded text-sm font-semibold hover:bg-indigo-600 transition disabled:opacity-50"
                        >
                          {mutating === 'create-role' ? 'Creating…' : 'Create Role'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Rename role form */}
                  {manageMode === 'rename' && editingRole && (
                    <div className="bg-[var(--bg-card)] rounded-lg border border-indigo-700/40 p-4 space-y-3">
                      <h3 className="text-sm font-bold text-gray-100">Rename Role</h3>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">
                          Role Name
                        </label>
                        <input
                          type="text"
                          value={editRoleName}
                          onChange={e => setEditRoleName(e.target.value)}
                          className="w-full bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-indigo-600"
                          maxLength={80}
                          autoFocus
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setManageMode('list'); setEditingRole(null) }}
                          className="px-3 py-2 bg-gray-700/50 text-gray-300 rounded text-sm hover:bg-gray-700 transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveRename}
                          disabled={!!mutating || !editRoleName.trim()}
                          className="flex-1 px-3 py-2 bg-indigo-600/70 text-indigo-100 rounded text-sm font-semibold hover:bg-indigo-600 transition disabled:opacity-50"
                        >
                          {mutating === 'rename-role' ? 'Saving…' : 'Save Name'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Edit Permissions form */}
                  {manageMode === 'edit-perms' && editingRole && (
                    <div className="bg-[var(--bg-card)] rounded-lg border border-indigo-700/40 p-4 space-y-4">
                      <div>
                        <h3 className="text-sm font-bold text-gray-100">
                          Edit Permissions — {tc(editingRole.role.name)}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">
                          Select every permission this role should include. Changes are saved only
                          when you click Save Changes.
                        </p>
                      </div>

                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {PERMISSION_CATEGORIES.map(cat => {
                          const perms = getPermissionsByCategory(cat)
                          const expanded = expandedEditCats.has(cat)
                          return (
                            <div key={cat} className="bg-[var(--bg-secondary)] rounded border border-gray-700/60 overflow-hidden">
                              <button
                                type="button"
                                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-700/20 transition"
                                onClick={() => {
                                  const next = new Set(expandedEditCats)
                                  if (expanded) next.delete(cat)
                                  else next.add(cat)
                                  setExpandedEditCats(next)
                                }}
                              >
                                <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">{cat}</span>
                                <span className="flex items-center gap-2 text-gray-500 text-xs">
                                  <span>
                                    {perms.filter(p => editRolePerms.has(p.key)).length}/{perms.length}
                                  </span>
                                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </span>
                              </button>
                              {expanded && (
                                <div className="border-t border-gray-700/60 divide-y divide-gray-700/40">
                                  {perms.map(p => (
                                    <label
                                      key={p.key}
                                      className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-gray-700/10"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={editRolePerms.has(p.key)}
                                        onChange={e => {
                                          const next = new Set(editRolePerms)
                                          if (e.target.checked) next.add(p.key)
                                          else next.delete(p.key)
                                          setEditRolePerms(next)
                                        }}
                                        className="mt-0.5 w-3.5 h-3.5 rounded accent-indigo-500"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs font-medium text-gray-200">{p.label}</span>
                                          {p.sensitive && (
                                            <span className="text-[9px] px-1 py-0.5 bg-amber-900/40 border border-amber-700/50 text-amber-400 rounded font-bold">
                                              SENSITIVE
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[11px] text-gray-500 mt-0.5">{p.description}</p>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <p className="text-xs text-gray-500">
                        {editRolePerms.size} permission{editRolePerms.size !== 1 ? 's' : ''} selected
                      </p>

                      <div className="flex gap-2">
                        <button
                          onClick={() => { setManageMode('list'); setEditingRole(null); setMutError('') }}
                          disabled={mutating === 'save-role'}
                          className="px-3 py-2 bg-gray-700/50 text-gray-300 rounded text-sm hover:bg-gray-700 transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSavePermissions}
                          disabled={!!mutating}
                          className="flex-1 px-3 py-2 bg-indigo-600/70 text-indigo-100 rounded text-sm font-semibold hover:bg-indigo-600 transition disabled:opacity-50"
                        >
                          {mutating === 'save-role' ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Role list */}
                  {manageMode === 'list' && (
                    <>
                      <button
                        onClick={() => setManageMode('create')}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600/30 text-indigo-300 rounded-lg border border-indigo-600/30 hover:bg-indigo-600/50 transition text-sm font-semibold"
                      >
                        <Plus className="w-4 h-4" /> Create New Role
                      </button>

                      {orgRoles.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 text-sm">
                          No roles yet. Create your first role above.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {orgRoles.map(({ role, permKeys }) => {
                            const count = roleCounts.get(role.id) ?? 0
                            const isConfirmingDelete = confirmDeleteId === role.id
                            return (
                              <div
                                key={role.id}
                                className={`rounded-lg border p-4 ${
                                  isConfirmingDelete
                                    ? 'bg-red-900/20 border-red-700/50'
                                    : 'bg-[var(--bg-card)] border-gray-700'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-gray-100 text-sm">{tc(role.name)}</span>
                                  </div>
                                  {role.description ? (
                                    <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>
                                  ) : (
                                    <p className="text-xs text-gray-600 mt-0.5 italic">No description</p>
                                  )}
                                  <p className="text-xs text-gray-500 mt-1.5">
                                    {count} employee{count !== 1 ? 's' : ''}
                                    {' · '}
                                    {permKeys.length} permission{permKeys.length !== 1 ? 's' : ''}
                                  </p>
                                </div>

                                {!isConfirmingDelete && (
                                  <div className="flex flex-wrap gap-2 mt-3">
                                    <button
                                      type="button"
                                      onClick={() => startEditPermissions({ role, permKeys })}
                                      disabled={!!mutating}
                                      className="px-3 py-1.5 text-xs font-semibold rounded border border-indigo-600/40 bg-indigo-600/25 text-indigo-200 hover:bg-indigo-600/40 transition disabled:opacity-50"
                                    >
                                      Edit Permissions
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => startRenameRole({ role, permKeys })}
                                      disabled={!!mutating}
                                      className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-600 bg-gray-700/40 text-gray-300 hover:bg-gray-700 transition disabled:opacity-50 flex items-center gap-1"
                                    >
                                      <Edit2 className="w-3 h-3" /> Rename
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(role.id)}
                                      disabled={!!mutating}
                                      className="px-3 py-1.5 text-xs font-semibold rounded border border-red-700/40 bg-red-900/20 text-red-300 hover:bg-red-900/40 transition disabled:opacity-50 flex items-center gap-1"
                                    >
                                      <Trash2 className="w-3 h-3" /> Delete
                                    </button>
                                  </div>
                                )}

                                {isConfirmingDelete && (
                                  <div className="mt-3 border-t border-red-700/30 pt-3">
                                    {count > 0 ? (
                                      <p className="text-sm text-red-400">
                                        Cannot delete: this role is assigned to{' '}
                                        <strong>{count}</strong> employee{count !== 1 ? 's' : ''}.
                                        Remove all assignments first.
                                      </p>
                                    ) : (
                                      <p className="text-sm text-red-300">
                                        Delete <strong>{tc(role.name)}</strong>? This cannot be undone.
                                      </p>
                                    )}
                                    <div className="flex gap-2 mt-3">
                                      <button
                                        onClick={() => setConfirmDeleteId(null)}
                                        className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded text-xs font-semibold hover:bg-gray-600 transition"
                                      >
                                        Cancel
                                      </button>
                                      {count === 0 && (
                                        <button
                                          onClick={() => handleDeleteRole(role)}
                                          disabled={!!mutating}
                                          className="px-3 py-1.5 bg-red-700 text-red-100 rounded text-xs font-semibold hover:bg-red-600 transition disabled:opacity-50"
                                        >
                                          {mutating === `del-${role.id}` ? 'Deleting…' : 'Delete'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════════
                  EFFECTIVE ACCESS SUMMARY (always visible when data loaded)
              ══════════════════════════════════════════════════════════════ */}
              {tab !== 'manage' && effectiveAccess.length > 0 && (
                <div className="mt-4 bg-[var(--bg-secondary)] rounded-lg border border-gray-700/50 p-4">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">
                    Effective Access Preview — {displayName}
                  </h3>
                  <p className="text-[11px] text-gray-600 mb-3">
                    Preview only — the database resolver is the enforcement authority for the
                    signed-in employee.
                  </p>
                  <div className="space-y-1">
                    {effectiveAccess.map(ep => {
                      const catalog = PERMISSION_CATALOG.find(p => p.key === ep.key)
                      return (
                        <div key={ep.key} className="flex items-center justify-between gap-2 py-1">
                          <div className="min-w-0 flex-1">
                            <span className="text-xs text-gray-300">
                              {catalog?.label ?? ep.key}
                            </span>
                            <span className="text-[11px] text-gray-600 ml-2">{ep.source}</span>
                          </div>
                          <EffectiveBadge ep={ep} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-gray-700 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700/50 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
