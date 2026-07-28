// @ts-nocheck
/**
 * AdminTaskDelegationPanel — owner/admin task assignment UI (Feature 1 WS2).
 *
 * Functional layout only. Assigns BackupData work packages to portal employees.
 * Primary assignee is private (admin-only control; never labeled on employee UI).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Loader2, AlertCircle, Plus, Trash2, Pencil, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  listAssignableWorkPackages,
  listAssignableEmployees,
  listOrgTaskAssignments,
  createTaskAssignment,
  updateTaskAssignment,
  revokeTaskAssignment,
  type AssignableWorkPackage,
  type EmployeeTaskAssignment,
  type TaskAssignmentStatus,
} from '@/services/employeeTaskAssignmentService'
import type { AdminEmployeeProfile } from '@/services/adminTimecardService'

const STATUS_OPTIONS: TaskAssignmentStatus[] = ['assigned', 'in_progress', 'completed']

const STATUS_PILL: Record<TaskAssignmentStatus, string> = {
  assigned:    'bg-gray-700/60 text-gray-300 border-gray-600',
  in_progress: 'bg-amber-600/20 text-amber-300 border-amber-700/50',
  completed:   'bg-green-600/20 text-green-300 border-green-700/50',
}

function formatDue(date: string | null | undefined): string {
  if (!date) return '—'
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

interface FormState {
  workPackageKey: string
  employeeIds: string[]
  primaryEmployeeId: string
  dueDate: string
  status: TaskAssignmentStatus
}

const emptyForm = (): FormState => ({
  workPackageKey: '',
  employeeIds: [],
  primaryEmployeeId: '',
  dueDate: '',
  status: 'assigned',
})

function packageKey(pkg: AssignableWorkPackage): string {
  return `${pkg.blueprintSetId}::${pkg.workPackageId}`
}

export default function AdminTaskDelegationPanel() {
  const { profile } = useAuth()
  const orgId = profile?.org_id || ''

  const [packages, setPackages] = useState<AssignableWorkPackage[]>([])
  const [employees, setEmployees] = useState<AdminEmployeeProfile[]>([])
  const [assignments, setAssignments] = useState<EmployeeTaskAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  const empById = useMemo(() => {
    const map = new Map<string, AdminEmployeeProfile>()
    for (const e of employees) map.set(e.id, e)
    return map
  }, [employees])

  const pkgByKey = useMemo(() => {
    const map = new Map<string, AssignableWorkPackage>()
    for (const p of packages) map.set(packageKey(p), p)
    return map
  }, [packages])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPackages(listAssignableWorkPackages())
      const [empRes, asgRes] = await Promise.all([
        listAssignableEmployees(),
        listOrgTaskAssignments(),
      ])
      if (!empRes.success) {
        setError(empRes.error || 'Could not load employees.')
        setEmployees([])
      } else {
        setEmployees(empRes.data)
      }
      if (!asgRes.success) {
        setError(asgRes.error || 'Could not load assignments.')
        setAssignments([])
      } else {
        setAssignments(asgRes.data)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setFormOpen(true)
    setError('')
  }

  const openEdit = (row: EmployeeTaskAssignment) => {
    const key =
      packages.find(
        (p) => p.workPackageId === row.work_package_id && p.blueprintSetId === (row.blueprint_set_id || p.blueprintSetId),
      ) || packages.find((p) => p.workPackageId === row.work_package_id)
    setEditingId(row.id)
    setForm({
      workPackageKey: key ? packageKey(key) : '',
      employeeIds: [...(row.assigned_employee_ids || [])],
      primaryEmployeeId: row.lead_employee_id,
      dueDate: row.due_date || '',
      status: row.status,
    })
    setFormOpen(true)
    setError('')
  }

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm())
  }

  const toggleEmployee = (id: string) => {
    setForm((prev) => {
      const has = prev.employeeIds.includes(id)
      const employeeIds = has ? prev.employeeIds.filter((x) => x !== id) : [...prev.employeeIds, id]
      let primaryEmployeeId = prev.primaryEmployeeId
      if (has && primaryEmployeeId === id) {
        primaryEmployeeId = employeeIds[0] || ''
      } else if (!has && !primaryEmployeeId) {
        primaryEmployeeId = id
      }
      return { ...prev, employeeIds, primaryEmployeeId }
    })
  }

  const submit = async () => {
    if (!orgId) {
      setError('Missing organization.')
      return
    }
    const pkg = pkgByKey.get(form.workPackageKey)
    if (!pkg && !editingId) {
      setError('Select a work package.')
      return
    }
    if (form.employeeIds.length === 0) {
      setError('Select at least one employee.')
      return
    }
    if (!form.primaryEmployeeId || !form.employeeIds.includes(form.primaryEmployeeId)) {
      setError('Choose a primary assignee from the selected employees.')
      return
    }

    setSaving(true)
    setError('')

    if (editingId) {
      const res = await updateTaskAssignment(editingId, {
        leadEmployeeId: form.primaryEmployeeId,
        assignedEmployeeIds: form.employeeIds,
        dueDate: form.dueDate || null,
        status: form.status,
        ...(pkg
          ? {
              workPackageName: pkg.workPackageName,
              projectName: pkg.projectName,
            }
          : {}),
      })
      setSaving(false)
      if (!res.success) {
        setError(res.error || 'Could not update assignment.')
        return
      }
    } else if (pkg) {
      const res = await createTaskAssignment({
        orgId,
        workPackageId: pkg.workPackageId,
        workPackageName: pkg.workPackageName,
        projectId: pkg.projectId,
        projectName: pkg.projectName,
        blueprintSetId: pkg.blueprintSetId,
        leadEmployeeId: form.primaryEmployeeId,
        assignedEmployeeIds: form.employeeIds,
        dueDate: form.dueDate || null,
        status: form.status,
      })
      setSaving(false)
      if (!res.success) {
        setError(res.error || 'Could not create assignment.')
        return
      }
    }

    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm())
    await load()
  }

  const handleRevoke = async (id: string) => {
    if (!window.confirm('Revoke this assignment? Employees will no longer see it.')) return
    setSaving(true)
    setError('')
    const res = await revokeTaskAssignment(id)
    setSaving(false)
    if (!res.success) {
      setError(res.error || 'Could not revoke assignment.')
      return
    }
    await load()
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-teal-400" />
          <h2 className="text-lg font-bold text-gray-100">Task Assignments</h2>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={loading || saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition disabled:opacity-60"
          style={{ minHeight: 44 }}
        >
          <Plus className="w-4 h-4" />
          Assign work package
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <Loader2 size={16} className="animate-spin text-teal-400" />
          Loading assignments…
        </div>
      )}

      {!loading && packages.length === 0 && (
        <p className="text-sm text-gray-500">
          No work packages found in project blueprints yet. Create scope packages on a blueprint first.
        </p>
      )}

      {!loading && assignments.length === 0 && packages.length > 0 && (
        <p className="text-sm text-gray-500 py-4 text-center">
          No assignments yet. Assign a work package to one or more employees.
        </p>
      )}

      {!loading && assignments.length > 0 && (
        <div className="space-y-3">
          {assignments.map((row) => {
            const names = (row.assigned_employee_ids || [])
              .map((id) => empById.get(id)?.display_name || 'Employee')
              .join(', ')
            return (
              <div
                key={row.id}
                className="bg-[var(--bg-secondary)] border border-gray-700/60 rounded-xl p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-100">{row.work_package_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {row.project_name || 'Project'} · Due {formatDue(row.due_date)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Assigned: {names || '—'}</p>
                    {row.completion_notes ? (
                      <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{row.completion_notes}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${STATUS_PILL[row.status]}`}>
                      {row.status.replace('_', ' ')}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200"
                        aria-label="Edit assignment"
                        style={{ minHeight: 44, minWidth: 44 }}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevoke(row.id)}
                        className="p-2 rounded-lg bg-red-900/40 hover:bg-red-800/50 text-red-300"
                        aria-label="Revoke assignment"
                        style={{ minHeight: 44, minWidth: 44 }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeForm() }}
        >
          <div className="w-full max-w-lg bg-[var(--bg-card,#1e2433)] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/60">
              <h3 className="text-base font-bold text-gray-100">
                {editingId ? 'Edit assignment' : 'Assign work package'}
              </h3>
              <button type="button" onClick={closeForm} className="text-gray-500 hover:text-gray-300 p-2" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1.5">Work package</label>
                <select
                  value={form.workPackageKey}
                  onChange={(e) => setForm((f) => ({ ...f, workPackageKey: e.target.value }))}
                  disabled={!!editingId}
                  className="w-full rounded-xl bg-[var(--bg-secondary)] border border-gray-600 text-gray-100 px-3 py-3 text-sm"
                  style={{ fontSize: 16, minHeight: 44 }}
                >
                  <option value="">Select…</option>
                  {packages.map((p) => (
                    <option key={packageKey(p)} value={packageKey(p)}>
                      {p.projectName} — {p.workPackageName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1.5">Employees</label>
                {employees.length === 0 ? (
                  <p className="text-sm text-gray-500">No accepted portal employees yet.</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {employees.map((emp) => {
                      const checked = form.employeeIds.includes(emp.id)
                      const isPrimary = form.primaryEmployeeId === emp.id
                      return (
                        <li
                          key={emp.id}
                          className="flex items-center gap-3 bg-[var(--bg-secondary)] border border-gray-700/60 rounded-xl px-3 py-2"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEmployee(emp.id)}
                            className="w-4 h-4"
                            id={`emp-${emp.id}`}
                          />
                          <label htmlFor={`emp-${emp.id}`} className="flex-1 text-sm text-gray-200 cursor-pointer">
                            {emp.display_name}
                          </label>
                          {checked && (
                            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                              <input
                                type="radio"
                                name="primary-assignee"
                                checked={isPrimary}
                                onChange={() => setForm((f) => ({ ...f, primaryEmployeeId: emp.id }))}
                              />
                              Primary
                            </label>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Primary is private — employees never see who is primary vs collaborator.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase mb-1.5">Due date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                    className="w-full rounded-xl bg-[var(--bg-secondary)] border border-gray-600 text-gray-100 px-3 py-3 text-sm"
                    style={{ fontSize: 16, minHeight: 44 }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase mb-1.5">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskAssignmentStatus }))}
                    className="w-full rounded-xl bg-[var(--bg-secondary)] border border-gray-600 text-gray-100 px-3 py-3 text-sm"
                    style={{ fontSize: 16, minHeight: 44 }}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-700/60 flex gap-2">
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold"
                style={{ minHeight: 44 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="flex-1 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ minHeight: 44 }}
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                {editingId ? 'Save' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
