// @ts-nocheck
/**
 * OwnerSchedulePanel — Week grid view for owner schedule management.
 * EMS Phase 4 (Workstream 3).
 *
 * Shows Mon–Sun grid, each cell = one employee's items for that day.
 * Click cell → slide-out form to add/edit an item.
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import {
  createScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
  checkConflicts,
  type ScheduleItem,
  type ScheduleStatus,
} from '@/services/employeeScheduleService'
import {
  getOwnerCrewRoster,
  getActiveProjects,
  type CrewRosterMember,
  type ActiveProject,
} from '@/services/crewPortalService'
import {
  listOrgTaskAssignments,
  type EmployeeTaskAssignment,
} from '@/services/employeeTaskAssignmentService'
import GanttPanel, { type GanttOpenAddPrefill } from '@/components/admin/GanttPanel'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  return `${hr}:${String(m).padStart(2, '0')}${ampm}`
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface FormState {
  employeeProfileId: string
  workDate: string
  startTime: string
  endTime: string
  estimatedHours: string
  assignmentId: string
  workPackageName: string
  projectName: string
  notes: string
}

const EMPTY_FORM: FormState = {
  employeeProfileId: '',
  workDate: '',
  startTime: '',
  endTime: '',
  estimatedHours: '',
  assignmentId: '',
  workPackageName: '',
  projectName: '',
  notes: '',
}

function itemToForm(item: ScheduleItem): FormState {
  return {
    employeeProfileId: item.employee_profile_id,
    workDate: item.work_date,
    startTime: item.start_time ?? '',
    endTime: item.end_time ?? '',
    estimatedHours: item.estimated_minutes ? String(item.estimated_minutes / 60) : '',
    assignmentId: item.assignment_id ?? '',
    workPackageName: item.work_package_name ?? '',
    projectName: item.project_name ?? '',
    notes: item.notes ?? '',
  }
}

interface ScheduleFormPanelProps {
  employees: CrewRosterMember[]
  assignments: EmployeeTaskAssignment[]
  initial?: ScheduleItem | null
  prefill?: GanttOpenAddPrefill
  onSaved: () => void
  onCancel: () => void
}

function ScheduleFormPanel({
  employees,
  assignments,
  initial,
  prefill,
  onSaved,
  onCancel,
}: ScheduleFormPanelProps) {
  const [form, setForm] = useState<FormState>(() => {
    if (initial) return itemToForm(initial)
    return {
      ...EMPTY_FORM,
      employeeProfileId: prefill?.employeeProfileId ?? '',
      workDate: prefill?.workDate ?? '',
      projectName: prefill?.projectName ?? '',
    }
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<ScheduleItem[]>([])
  const conflictTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  // Fill name/project from selected assignment
  const handleAssignmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    setForm((prev) => ({ ...prev, assignmentId: id }))
    if (id) {
      const a = assignments.find((a) => a.id === id)
      if (a) {
        setForm((prev) => ({
          ...prev,
          assignmentId: id,
          workPackageName: a.work_package_name,
          projectName: a.project_name ?? '',
        }))
      }
    }
  }

  // Conflict check when times / employee / date change
  useEffect(() => {
    if (conflictTimer.current) clearTimeout(conflictTimer.current)
    if (!form.employeeProfileId || !form.workDate) {
      setConflicts([])
      return
    }
    conflictTimer.current = setTimeout(async () => {
      const result = await checkConflicts(
        form.employeeProfileId,
        form.workDate,
        form.startTime || null,
        form.endTime || null,
        initial?.id,
      )
      if (result.success) setConflicts(result.data)
    }, 400)
    return () => { if (conflictTimer.current) clearTimeout(conflictTimer.current) }
  }, [form.employeeProfileId, form.workDate, form.startTime, form.endTime, initial?.id])

  const empAssignments = assignments.filter(
    (a) =>
      a.assigned_employee_ids?.includes(form.employeeProfileId) ||
      a.lead_employee_id === form.employeeProfileId,
  )

  async function handleSave() {
    if (!form.employeeProfileId || !form.workDate) {
      setError('Employee and date are required.')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      employee_profile_id: form.employeeProfileId,
      work_date: form.workDate,
      start_time: form.startTime || null,
      end_time: form.endTime || null,
      estimated_minutes: form.estimatedHours ? Math.round(parseFloat(form.estimatedHours) * 60) : null,
      assignment_id: form.assignmentId || null,
      work_package_name: form.workPackageName.trim() || null,
      project_name: form.projectName.trim() || null,
      notes: form.notes.trim() || null,
    }
    const result = initial
      ? await updateScheduleItem(initial.id, payload)
      : await createScheduleItem(payload)

    if (result.success) {
      onSaved()
    } else {
      setError(result.error)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!initial) return
    setDeleting(true)
    const result = await deleteScheduleItem(initial.id)
    if (result.success) {
      onSaved()
    } else {
      setError(result.error)
    }
    setDeleting(false)
  }

  const inputCls = 'w-full rounded border text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const inputStyle = { backgroundColor: '#0a0b0f', borderColor: '#2d3140', color: '#e5e7eb' }
  const labelCls = 'block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1'

  return (
    <div
      className="fixed right-0 top-0 h-full w-full max-w-sm z-50 flex flex-col border-l shadow-2xl overflow-y-auto"
      style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10" style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}>
        <span className="text-sm font-semibold text-gray-200">
          {initial ? 'Edit Schedule Item' : 'Add Schedule Item'}
        </span>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 p-1 rounded">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-4">
        {/* Employee */}
        <div>
          <label className={labelCls}>Employee *</label>
          <select
            className={inputCls}
            style={inputStyle}
            value={form.employeeProfileId}
            onChange={set('employeeProfileId')}
            disabled={!!prefill?.employeeProfileId && !initial}
          >
            <option value="">— Select employee</option>
            {employees.filter((e) => e.active).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className={labelCls}>Date *</label>
          <input
            type="date"
            className={inputCls}
            style={inputStyle}
            value={form.workDate}
            onChange={set('workDate')}
          />
        </div>

        {/* Times */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Start time</label>
            <input type="time" className={inputCls} style={inputStyle} value={form.startTime} onChange={set('startTime')} />
          </div>
          <div>
            <label className={labelCls}>End time</label>
            <input type="time" className={inputCls} style={inputStyle} value={form.endTime} onChange={set('endTime')} />
          </div>
        </div>

        {/* Estimated hours */}
        <div>
          <label className={labelCls}>Estimated hours</label>
          <input
            type="number"
            min="0.25"
            max="24"
            step="0.25"
            placeholder="e.g. 4"
            className={inputCls}
            style={inputStyle}
            value={form.estimatedHours}
            onChange={set('estimatedHours')}
          />
        </div>

        {/* Link to assignment */}
        {form.employeeProfileId && (
          <div>
            <label className={labelCls}>Link to task assignment (optional)</label>
            <select
              className={inputCls}
              style={inputStyle}
              value={form.assignmentId}
              onChange={handleAssignmentChange}
            >
              <option value="">— None (use free-form below)</option>
              {empAssignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.work_package_name}{a.project_name ? ` · ${a.project_name}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Work package name */}
        <div>
          <label className={labelCls}>Work package name</label>
          <input
            type="text"
            placeholder="e.g. Rough-in electrical"
            className={inputCls}
            style={inputStyle}
            value={form.workPackageName}
            onChange={set('workPackageName')}
          />
        </div>

        {/* Project name */}
        <div>
          <label className={labelCls}>Project name</label>
          <input
            type="text"
            placeholder="e.g. 123 Main St"
            className={inputCls}
            style={inputStyle}
            value={form.projectName}
            onChange={set('projectName')}
          />
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            rows={3}
            placeholder="Any instructions…"
            className={inputCls}
            style={inputStyle}
            value={form.notes}
            onChange={set('notes')}
          />
        </div>

        {/* Conflict warning */}
        {conflicts.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs"
            style={{ backgroundColor: '#2c1600', borderColor: '#92400e55', color: '#fbbf24' }}>
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Time conflict</p>
              {conflicts.map((c) => (
                <p key={c.id} className="opacity-80">
                  {c.work_package_name || 'Item'} · {formatTime(c.start_time)}–{formatTime(c.end_time)}
                </p>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 rounded border border-red-800/40 px-3 py-2 bg-red-900/20">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t flex gap-2 sticky bottom-0" style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}>
        {initial && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium text-red-400 border-red-800/40 hover:bg-red-900/20 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border text-xs font-medium text-gray-400 border-gray-700/40 hover:bg-gray-800/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving && <Loader2 size={11} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function OwnerSchedulePanel() {
  const [employees,    setEmployees]    = useState<CrewRosterMember[]>([])
  const [projects,     setProjects]     = useState<ActiveProject[]>([])
  const [assignments,  setAssignments]  = useState<EmployeeTaskAssignment[]>([])
  const [bootstrapped, setBootstrapped] = useState(false)
  const [refreshKey,   setRefreshKey]   = useState(0)

  // Form state
  const [formOpen,    setFormOpen]    = useState(false)
  const [editItem,    setEditItem]    = useState<ScheduleItem | null>(null)
  const [formPrefill, setFormPrefill] = useState<GanttOpenAddPrefill | null>(null)

  // Boot: load employees, projects, assignments once (shared by GanttPanel + form)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const [empResult, projResult, taskResult] = await Promise.all([
        getOwnerCrewRoster(),
        getActiveProjects(),
        listOrgTaskAssignments(),
      ])
      if (!mounted) return
      if (empResult.success)  setEmployees(empResult.data)
      if (projResult.success) setProjects(projResult.data)
      if (taskResult.success) setAssignments(taskResult.data)
      setBootstrapped(true)
    })()
    return () => { mounted = false }
  }, [])

  function openAdd(prefill: GanttOpenAddPrefill) {
    setEditItem(null)
    setFormPrefill(prefill)
    setFormOpen(true)
  }

  function openEdit(item: ScheduleItem) {
    setEditItem(item)
    setFormPrefill(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditItem(null)
    setFormPrefill(null)
  }

  function handleSaved() {
    closeForm()
    setRefreshKey((k) => k + 1)
  }

  const activeEmployees = employees.filter((e) => e.active)

  if (!bootstrapped) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin text-green-500" />
        Loading schedule…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <GanttPanel
        employees={employees}
        projects={projects}
        refreshKey={refreshKey}
        onOpenAdd={openAdd}
        onOpenEdit={openEdit}
      />

      {formOpen && (
        <div className="fixed inset-0 z-40" onClick={closeForm} aria-hidden="true">
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}
      {formOpen && (
        <ScheduleFormPanel
          employees={activeEmployees}
          assignments={assignments}
          initial={editItem}
          prefill={formPrefill ?? undefined}
          onSaved={handleSaved}
          onCancel={closeForm}
        />
      )}
    </div>
  )
}
