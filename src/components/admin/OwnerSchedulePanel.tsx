// @ts-nocheck
/**
 * OwnerSchedulePanel — Week grid view for owner schedule management.
 * EMS Phase 4 (Workstream 3).
 *
 * Shows Mon–Sun grid, each cell = one employee's items for that day.
 * Click cell → slide-out form to add/edit an item.
 * Click existing chip → detail panel (with Edit + View Task Assignment link).
 * Multi-day drag → form pre-filled with date range, creates one item per day.
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  AlertTriangle,
  Loader2,
  Edit2,
  ExternalLink,
  Clock,
  Briefcase,
  User,
  CheckSquare,
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
  type TaskAssignmentStatus,
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

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  const [y, m, day] = iso.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  let cur = startDate
  while (cur <= endDate) {
    dates.push(cur)
    cur = addDays(cur, 1)
  }
  return dates
}

// ── Task Detail Panel ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  scheduled:   'Scheduled',
  in_progress: 'In Progress',
  done:        'Done',
  cancelled:   'Cancelled',
}

const TASK_STATUS_LABELS: Record<TaskAssignmentStatus, string> = {
  assigned:    'Assigned',
  in_progress: 'In Progress',
  completed:   'Completed',
}

const TASK_STATUS_CLS: Record<TaskAssignmentStatus, string> = {
  assigned:    'text-blue-300 bg-blue-900/30 border-blue-700/40',
  in_progress: 'text-amber-300 bg-amber-900/20 border-amber-700/40',
  completed:   'text-green-300 bg-green-900/20 border-green-700/40',
}

const SCHEDULE_STATUS_CLS: Record<ScheduleStatus, string> = {
  scheduled:   'text-blue-300 bg-blue-900/30 border-blue-700/40',
  in_progress: 'text-amber-300 bg-amber-900/20 border-amber-700/40',
  done:        'text-green-300 bg-green-900/20 border-green-700/40',
  cancelled:   'text-gray-500 bg-gray-800/20 border-gray-700/30',
}

interface TaskDetailPanelProps {
  item: ScheduleItem
  employees: CrewRosterMember[]
  assignments: EmployeeTaskAssignment[]
  onEdit: () => void
  onNavigateToTask?: (assignmentId: string) => void
  onClose: () => void
}

function TaskDetailPanel({
  item,
  employees,
  assignments,
  onEdit,
  onNavigateToTask,
  onClose,
}: TaskDetailPanelProps) {
  const emp = employees.find((e) => e.id === item.employee_profile_id)
  const empName = emp?.name ?? item.employee_name ?? 'Unknown Employee'
  const linkedAssignment = item.assignment_id
    ? assignments.find((a) => a.id === item.assignment_id)
    : null

  const rowCls = 'text-xs'
  const labelCls = 'text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5'

  return (
    <div
      className="fixed right-0 top-0 h-full w-full max-w-sm z-50 flex flex-col border-l shadow-2xl overflow-y-auto"
      style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10"
        style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
      >
        <span className="text-sm font-semibold text-gray-200">Schedule Detail</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border capitalize ${SCHEDULE_STATUS_CLS[item.status]}`}>
            {STATUS_LABELS[item.status]}
          </span>
        </div>

        {/* Employee */}
        <div>
          <p className={labelCls}>Employee</p>
          <div className="flex items-center gap-2">
            <User size={13} className="text-blue-400 flex-shrink-0" />
            <span className="text-gray-200 font-medium text-sm">{empName}</span>
          </div>
        </div>

        {/* Date & Time */}
        <div>
          <p className={labelCls}>Date</p>
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-gray-500 flex-shrink-0" />
            <span className={`${rowCls} text-gray-300`}>{formatDate(item.work_date)}</span>
          </div>
          {(item.start_time || item.end_time) && (
            <p className="text-xs text-gray-500 mt-1 pl-5">
              {formatTime(item.start_time)}{item.end_time ? ` – ${formatTime(item.end_time)}` : ''}
              {item.estimated_minutes ? ` · ${(item.estimated_minutes / 60).toFixed(1)}h est.` : ''}
            </p>
          )}
        </div>

        {/* Work Package & Project */}
        {(item.work_package_name || item.project_name) && (
          <div>
            <p className={labelCls}>Work Package</p>
            <div className="flex items-start gap-2">
              <Briefcase size={13} className="text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                {item.work_package_name && (
                  <p className="text-sm text-gray-200 font-medium">{item.work_package_name}</p>
                )}
                {item.project_name && (
                  <p className="text-xs text-gray-500 mt-0.5">{item.project_name}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        {item.notes && (
          <div>
            <p className={labelCls}>Notes</p>
            <p className="text-xs text-gray-400 leading-relaxed">{item.notes}</p>
          </div>
        )}

        {/* Linked Assignment */}
        {linkedAssignment && (
          <div
            className="rounded-lg border p-3 space-y-2"
            style={{ backgroundColor: '#0a0b10', borderColor: '#1e2940' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <CheckSquare size={12} className="text-blue-400" />
              <p className="text-[10px] font-semibold text-blue-300 uppercase tracking-wider">Linked Task Assignment</p>
            </div>

            <p className="text-sm text-gray-200 font-medium">{linkedAssignment.work_package_name}</p>
            {linkedAssignment.project_name && (
              <p className="text-xs text-gray-500">{linkedAssignment.project_name}</p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${TASK_STATUS_CLS[linkedAssignment.status]}`}>
                {TASK_STATUS_LABELS[linkedAssignment.status]}
              </span>
              {linkedAssignment.due_date && (
                <span className="text-[10px] text-gray-500">
                  Due {formatDate(linkedAssignment.due_date)}
                </span>
              )}
            </div>

            {linkedAssignment.completion_notes && (
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Completion Notes</p>
                <p className="text-xs text-gray-400 leading-relaxed">{linkedAssignment.completion_notes}</p>
              </div>
            )}

            {onNavigateToTask && (
              <button
                onClick={() => onNavigateToTask(linkedAssignment.id)}
                className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 transition-colors mt-1"
              >
                <ExternalLink size={11} />
                View Task Assignment
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-3 border-t flex gap-2 sticky bottom-0"
        style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border text-xs font-medium text-gray-400 border-gray-700/40 hover:bg-gray-800/40"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-green-700/30 border border-green-600/40 text-green-300 hover:bg-green-700/50"
        >
          <Edit2 size={11} />
          Edit
        </button>
      </div>
    </div>
  )
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

  const isMultiDay = !initial && !!prefill?.endWorkDate && prefill.endWorkDate > (prefill?.workDate ?? '')
  const multiDayDates = isMultiDay ? datesInRange(prefill!.workDate, prefill!.endWorkDate!) : []
  const multiDayCount = multiDayDates.length

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

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

  useEffect(() => {
    if (conflictTimer.current) clearTimeout(conflictTimer.current)
    if (!form.employeeProfileId || !form.workDate || isMultiDay) {
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
  }, [form.employeeProfileId, form.workDate, form.startTime, form.endTime, initial?.id, isMultiDay])

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

    const basePayload = {
      employee_profile_id: form.employeeProfileId,
      start_time: form.startTime || null,
      end_time: form.endTime || null,
      estimated_minutes: form.estimatedHours ? Math.round(parseFloat(form.estimatedHours) * 60) : null,
      assignment_id: form.assignmentId || null,
      work_package_name: form.workPackageName.trim() || null,
      project_name: form.projectName.trim() || null,
      notes: form.notes.trim() || null,
    }

    if (isMultiDay) {
      // Create one item per date in the range
      const results = await Promise.all(
        multiDayDates.map((date) =>
          createScheduleItem({ ...basePayload, work_date: date }),
        ),
      )
      const firstError = results.find((r) => !r.success)
      if (firstError) {
        setError(firstError.error)
        setSaving(false)
        return
      }
      onSaved()
    } else {
      const payload = { ...basePayload, work_date: form.workDate }
      const result = initial
        ? await updateScheduleItem(initial.id, payload)
        : await createScheduleItem(payload)
      if (result.success) {
        onSaved()
      } else {
        setError(result.error)
      }
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
          {initial ? 'Edit Schedule Item' : isMultiDay ? `Add ${multiDayCount} Schedule Items` : 'Add Schedule Item'}
        </span>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 p-1 rounded">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-4">
        {/* Multi-day range indicator */}
        {isMultiDay && (
          <div
            className="rounded-lg border px-3 py-2.5 text-xs"
            style={{ backgroundColor: '#0d1a2d', borderColor: '#1e40af55', color: '#93c5fd' }}
          >
            <p className="font-semibold mb-0.5">Multi-day schedule</p>
            <p className="opacity-80">
              {prefill!.workDate} → {prefill!.endWorkDate} ({multiDayCount} days)
            </p>
            <p className="opacity-60 mt-1 text-[10px]">One item will be created for each day in the range.</p>
          </div>
        )}

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

        {/* Date (single) or display range */}
        {!isMultiDay ? (
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
        ) : (
          <div>
            <label className={labelCls}>Date Range</label>
            <div
              className="w-full rounded border text-xs px-2.5 py-1.5"
              style={{ ...inputStyle, color: '#9ca3af' }}
            >
              {prefill!.workDate} → {prefill!.endWorkDate}
            </div>
          </div>
        )}

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
          <label className={labelCls}>Estimated hours {isMultiDay ? '(per day)' : ''}</label>
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
          <label className={labelCls}>Notes {isMultiDay ? '(applied to all days)' : ''}</label>
          <textarea
            rows={3}
            placeholder="Any instructions…"
            className={inputCls}
            style={inputStyle}
            value={form.notes}
            onChange={set('notes')}
          />
        </div>

        {/* Conflict warning (single-day only) */}
        {!isMultiDay && conflicts.length > 0 && (
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
          {saving ? 'Saving…' : isMultiDay ? `Create ${multiDayCount} Items` : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface OwnerSchedulePanelProps {
  onNavigateToTask?: (assignmentId: string) => void
}

export default function OwnerSchedulePanel({ onNavigateToTask }: OwnerSchedulePanelProps) {
  const [employees,    setEmployees]    = useState<CrewRosterMember[]>([])
  const [projects,     setProjects]     = useState<ActiveProject[]>([])
  const [assignments,  setAssignments]  = useState<EmployeeTaskAssignment[]>([])
  const [bootstrapped, setBootstrapped] = useState(false)
  const [refreshKey,   setRefreshKey]   = useState(0)

  // Detail panel state
  const [detailItem,  setDetailItem]  = useState<ScheduleItem | null>(null)

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
    setDetailItem(null)
    setEditItem(null)
    setFormPrefill(prefill)
    setFormOpen(true)
  }

  // Clicking an existing chip shows the detail panel first
  function openEdit(item: ScheduleItem) {
    setDetailItem(item)
    setFormOpen(false)
    setEditItem(null)
    setFormPrefill(null)
  }

  function openEditFromDetail() {
    if (!detailItem) return
    setEditItem(detailItem)
    setDetailItem(null)
    setFormPrefill(null)
    setFormOpen(true)
  }

  function closeAll() {
    setFormOpen(false)
    setEditItem(null)
    setFormPrefill(null)
    setDetailItem(null)
  }

  function handleSaved() {
    closeAll()
    setRefreshKey((k) => k + 1)
  }

  const activeEmployees = employees.filter((e) => e.active)
  const anyPanelOpen = formOpen || !!detailItem

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

      {/* Backdrop */}
      {anyPanelOpen && (
        <div className="fixed inset-0 z-40" onClick={closeAll} aria-hidden="true">
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}

      {/* Task Detail Panel */}
      {detailItem && (
        <TaskDetailPanel
          item={detailItem}
          employees={activeEmployees}
          assignments={assignments}
          onEdit={openEditFromDetail}
          onNavigateToTask={onNavigateToTask}
          onClose={closeAll}
        />
      )}

      {/* Schedule Form Panel */}
      {formOpen && (
        <ScheduleFormPanel
          employees={activeEmployees}
          assignments={assignments}
          initial={editItem}
          prefill={formPrefill ?? undefined}
          onSaved={handleSaved}
          onCancel={closeAll}
        />
      )}
    </div>
  )
}
