// @ts-nocheck
/**
 * AdminTaskDelegationPanel — owner/admin task assignment UI (Feature 1 WS2 + Feature 2 picker).
 *
 * Functional layout only. Assigns BackupData work packages to portal employees.
 * Primary assignee is private (admin-only control; never labeled on employee UI).
 *
 * Feature 2: three-step cascading picker — Project (SQL) → Blueprint (BackupData) → Work package.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, Loader2, AlertCircle, Plus, Trash2, Pencil, X, ChevronDown, RotateCcw, Star } from 'lucide-react'
import {
  addQualityRating,
  getQualityRatings,
  type QualityRating,
} from '@/services/employeePerformanceService'
import { useAuth } from '@/hooks/useAuth'
import {
  listAssignableProjects,
  listBlueprintsForProject,
  listWorkPackagesForBlueprint,
  listAssignableEmployees,
  listOrgTaskAssignments,
  buildTaskAssignmentWorkOrderDraft,
  createTaskAssignmentWithWorkOrder,
  updateTaskAssignment,
  revokeTaskAssignment,
  type AssignableProject,
  type AssignableBlueprint,
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
  projectId: string
  projectName: string
  blueprintSetId: string
  blueprintTitle: string
  workPackageId: string
  workPackageName: string
  employeeIds: string[]
  primaryEmployeeId: string
  dueDate: string
  status: TaskAssignmentStatus
}

const emptyForm = (): FormState => ({
  projectId: '',
  projectName: '',
  blueprintSetId: '',
  blueprintTitle: '',
  workPackageId: '',
  workPackageName: '',
  employeeIds: [],
  primaryEmployeeId: '',
  dueDate: '',
  status: 'assigned',
})

const createAttemptIds = () => ({
  assignmentId: crypto.randomUUID(),
  clientRequestId: crypto.randomUUID(),
})

// ── Searchable picker (filterable list — used when lists can exceed ~10) ───────

interface SearchablePickerOption {
  id: string
  label: string
  sublabel?: string
}

function SearchablePicker({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  loading,
  emptyMessage,
  mutedHint,
}: {
  label: string
  placeholder: string
  options: SearchablePickerOption[]
  value: string
  onChange: (id: string, option: SearchablePickerOption | null) => void
  disabled?: boolean
  loading?: boolean
  emptyMessage?: string
  mutedHint?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)

  const selected = options.find((o) => o.id === value) || null

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel || '').toLowerCase().includes(q),
    )
  }, [options, query])

  const muted = !!disabled

  return (
    <div ref={rootRef} className={`relative ${muted ? 'opacity-50 pointer-events-none' : ''}`}>
      <label className="block text-xs font-semibold text-gray-400 uppercase mb-1.5">{label}</label>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl bg-[var(--bg-secondary)] border border-gray-600 text-left px-3 py-3 text-sm text-gray-100 disabled:cursor-not-allowed"
        style={{ fontSize: 16, minHeight: 44 }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={`truncate ${selected ? 'text-gray-100' : 'text-gray-500'}`}>
          {loading ? 'Loading…' : selected ? selected.label : placeholder}
        </span>
        {loading
          ? <Loader2 size={16} className="animate-spin text-teal-400 flex-shrink-0" />
          : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
      </button>

      {mutedHint && muted && (
        <p className="text-[11px] text-gray-500 mt-1">{mutedHint}</p>
      )}

      {open && !disabled && !loading && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-600 bg-[var(--bg-card,#1e2433)] shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-700/60">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg bg-[var(--bg-secondary)] border border-gray-600 text-gray-100 px-3 py-2"
              style={{ fontSize: 16, minHeight: 40 }}
            />
          </div>
          <ul className="max-h-48 overflow-y-auto" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-gray-500">
                {emptyMessage || (options.length === 0 ? 'No options' : 'No matches')}
              </li>
            ) : (
              filtered.map((opt) => (
                <li key={opt.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={opt.id === value}
                    onClick={() => {
                      onChange(opt.id, opt)
                      setOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2.5 hover:bg-gray-700/50 ${
                      opt.id === value ? 'bg-teal-600/20 text-teal-200' : 'text-gray-200'
                    }`}
                  >
                    <span className="block text-sm font-medium truncate">{opt.label}</span>
                    {opt.sublabel ? (
                      <span className="block text-[11px] text-gray-500 truncate">{opt.sublabel}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Quality rating on completed task cards ────────────────────────────────────

function StarRow({ value, onChange, readonly }: { value: number; onChange?: (n: number) => void; readonly?: boolean }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(n)}
          className={`transition-transform ${readonly ? 'cursor-default' : 'hover:scale-110'}`}
        >
          <Star
            size={15}
            className={n <= value ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}
          />
        </button>
      ))}
    </div>
  )
}

function TaskCardRating({
  assignmentId,
  leadEmployeeId,
}: {
  assignmentId: string
  leadEmployeeId: string
}) {
  const [loading, setLoading] = useState(true)
  const [existing, setExisting] = useState<QualityRating | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [score, setScore] = useState(5)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    getQualityRatings(leadEmployeeId).then((res) => {
      if (res.success) {
        setExisting(res.data.find((r) => r.assignment_id === assignmentId) ?? null)
      }
      setLoading(false)
    })
  }, [assignmentId, leadEmployeeId])

  const handleSubmit = async () => {
    setSubmitting(true)
    setErr(null)
    const res = await addQualityRating(leadEmployeeId, assignmentId, score, notes.trim() || null)
    setSubmitting(false)
    if (!res.success) { setErr(res.error || 'Failed to save rating'); return }
    setExisting(res.data)
    setOpen(false)
    setEditing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1 mt-2 text-xs text-gray-600">
        <Loader2 size={10} className="animate-spin" /> Loading rating…
      </div>
    )
  }

  if (existing && !editing) {
    return (
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <StarRow value={existing.score} readonly />
        <span className="text-xs text-gray-400">{existing.score}/5</span>
        <button
          type="button"
          onClick={() => { setScore(existing.score); setNotes(existing.notes ?? ''); setEditing(true) }}
          className="text-xs text-gray-500 hover:text-gray-300 underline ml-1"
        >
          Edit rating
        </button>
      </div>
    )
  }

  if (!open && !editing) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 mt-2 text-xs text-amber-400 hover:text-amber-300 font-semibold"
      >
        <Star size={11} className="text-amber-400" />
        Rate quality
      </button>
    )
  }

  return (
    <div className="mt-2 space-y-2 border-t border-gray-700/40 pt-2">
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex items-center gap-3">
        <StarRow value={score} onChange={setScore} />
        <span className="text-xs text-gray-400">{score} / 5</span>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full rounded-lg border border-gray-700 bg-transparent text-gray-300 px-2 py-1.5 text-xs resize-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600/20 border border-amber-700/50 text-amber-300 disabled:opacity-50"
          style={{ minHeight: 32 }}
        >
          {submitting ? <Loader2 size={10} className="animate-spin" /> : <Star size={10} />}
          {submitting ? 'Saving…' : 'Save rating'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setEditing(false) }}
          className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-300"
          style={{ minHeight: 32 }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

type CompletionFilter = 'all' | 'pending' | 'completed'

export default function AdminTaskDelegationPanel({ initialProjectId }: { initialProjectId?: string } = {}) {
  const { profile } = useAuth()
  const orgId = profile?.org_id || ''

  const [projects, setProjects] = useState<AssignableProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [employees, setEmployees] = useState<AdminEmployeeProfile[]>([])
  const [assignments, setAssignments] = useState<EmployeeTaskAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [blueprintsLoading, setBlueprintsLoading] = useState(false)
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [blueprints, setBlueprints] = useState<AssignableBlueprint[]>([])
  const [workPackages, setWorkPackages] = useState<AssignableWorkPackage[]>([])
  const [createIds, setCreateIds] = useState(createAttemptIds)

  const empById = useMemo(() => {
    const map = new Map<string, AdminEmployeeProfile>()
    for (const e of employees) map.set(e.id, e)
    return map
  }, [employees])

  const projectOptions = useMemo(
    () => projects.map((p) => ({
      id: p.id,
      label: p.name,
      sublabel: p.status ? p.status.replace(/_/g, ' ') : undefined,
    })),
    [projects],
  )

  const blueprintOptions = useMemo(
    () => blueprints.map((b) => ({
      id: b.blueprintSetId,
      label: b.title,
    })),
    [blueprints],
  )

  const packageOptions = useMemo(
    () => workPackages.map((p) => ({
      id: p.workPackageId,
      label: p.workPackageName,
    })),
    [workPackages],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
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

  const loadBlueprintsFor = useCallback((projectId: string) => {
    setBlueprintsLoading(true)
    // Sync BackupData read — brief loading tick for UX consistency.
    window.setTimeout(() => {
      setBlueprints(listBlueprintsForProject(projectId))
      setBlueprintsLoading(false)
    }, 0)
  }, [])

  // When initialProjectId is provided, auto-open the create form pre-filtered to that project.
  const autoOpenRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialProjectId || loading || autoOpenRef.current === initialProjectId) return
    autoOpenRef.current = initialProjectId
    setEditingId(null)
    setForm(emptyForm())
    setCreateIds(createAttemptIds())
    setBlueprints([])
    setWorkPackages([])
    setFormOpen(true)
    setError('')
    setProjectsLoading(true)
    listAssignableProjects().then((res) => {
      setProjectsLoading(false)
      if (!res.success) return
      setProjects(res.data)
      const match = res.data.find((p) => p.id === initialProjectId)
      if (match) {
        setForm((f) => ({ ...f, projectId: match.id, projectName: match.name }))
        loadBlueprintsFor(match.id)
      }
    })
  }, [initialProjectId, loading, loadBlueprintsFor])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    const res = await listAssignableProjects()
    setProjectsLoading(false)
    if (!res.success) {
      setProjects([])
      setError(res.error || 'Could not load projects.')
      return
    }
    setProjects(res.data)
  }, [])

  const loadPackagesFor = useCallback((blueprintSetId: string) => {
    setPackagesLoading(true)
    window.setTimeout(() => {
      setWorkPackages(listWorkPackagesForBlueprint(blueprintSetId))
      setPackagesLoading(false)
    }, 0)
  }, [])

  const resetPickerSteps = () => {
    setForm((f) => ({
      ...f,
      projectId: '',
      projectName: '',
      blueprintSetId: '',
      blueprintTitle: '',
      workPackageId: '',
      workPackageName: '',
    }))
    setBlueprints([])
    setWorkPackages([])
    setBlueprintsLoading(false)
    setPackagesLoading(false)
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setCreateIds(createAttemptIds())
    setBlueprints([])
    setWorkPackages([])
    setFormOpen(true)
    setError('')
    loadProjects()
  }

  const openEdit = (row: EmployeeTaskAssignment) => {
    setEditingId(row.id)
    setForm({
      projectId: row.project_id || '',
      projectName: row.project_name || '',
      blueprintSetId: row.blueprint_set_id || '',
      blueprintTitle: '',
      workPackageId: row.work_package_id,
      workPackageName: row.work_package_name,
      employeeIds: [...(row.assigned_employee_ids || [])],
      primaryEmployeeId: row.lead_employee_id,
      dueDate: row.due_date || '',
      status: row.status,
    })
    setBlueprints([])
    setWorkPackages([])
    setFormOpen(true)
    setError('')
  }

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm())
    setCreateIds(createAttemptIds())
    setBlueprints([])
    setWorkPackages([])
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

  const selectProject = (id: string, option: SearchablePickerOption | null) => {
    setForm((f) => ({
      ...f,
      projectId: id,
      projectName: option?.label || '',
      blueprintSetId: '',
      blueprintTitle: '',
      workPackageId: '',
      workPackageName: '',
    }))
    setWorkPackages([])
    if (id) loadBlueprintsFor(id)
    else setBlueprints([])
  }

  const selectBlueprint = (id: string, option: SearchablePickerOption | null) => {
    setForm((f) => ({
      ...f,
      blueprintSetId: id,
      blueprintTitle: option?.label || '',
      workPackageId: '',
      workPackageName: '',
    }))
    if (id) loadPackagesFor(id)
    else setWorkPackages([])
  }

  const selectWorkPackage = (id: string, option: SearchablePickerOption | null) => {
    setForm((f) => ({
      ...f,
      workPackageId: id,
      workPackageName: option?.label || '',
    }))
  }

  const submit = async () => {
    if (saving) return
    if (!orgId) {
      setError('Missing organization.')
      return
    }
    if (!editingId) {
      if (!form.projectId || !form.projectName) {
        setError('Select a project.')
        return
      }
      if (!form.blueprintSetId) {
        setError('Select a blueprint.')
        return
      }
      if (!form.workPackageId || !form.workPackageName) {
        setError('Select a work package.')
        return
      }
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
      })
      setSaving(false)
      if (!res.success) {
        setError(res.error || 'Could not update assignment.')
        return
      }
    } else {
      const draft = buildTaskAssignmentWorkOrderDraft({
        projectId: form.projectId,
        projectName: form.projectName,
        blueprintSetId: form.blueprintSetId,
        blueprintTitle: form.blueprintTitle,
        workPackageId: form.workPackageId,
      })
      if (!draft.success) {
        setSaving(false)
        setError(draft.error || 'Could not build Work Order.')
        return
      }

      const res = await createTaskAssignmentWithWorkOrder({
        assignmentId: createIds.assignmentId,
        clientRequestId: createIds.clientRequestId,
        orgId,
        workPackageId: form.workPackageId,
        workPackageName: form.workPackageName,
        projectId: form.projectId,
        projectName: form.projectName,
        blueprintSetId: form.blueprintSetId,
        blueprintTitle: form.blueprintTitle,
        leadEmployeeId: form.primaryEmployeeId,
        assignedEmployeeIds: form.employeeIds,
        dueDate: form.dueDate || null,
        status: form.status,
        workOrderPayload: draft.data,
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
    setCreateIds(createAttemptIds())
    setBlueprints([])
    setWorkPackages([])
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

  const canSubmitCreate =
    !!form.projectId &&
    !!form.blueprintSetId &&
    !!form.workPackageId &&
    form.employeeIds.length > 0 &&
    !!form.primaryEmployeeId

  const noBlueprints =
    !!form.projectId && !blueprintsLoading && blueprints.length === 0
  const noPackages =
    !!form.blueprintSetId && !packagesLoading && workPackages.length === 0

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

      {/* Filter tabs */}
      {!loading && assignments.length > 0 && (
        <div className="flex gap-1 border-b border-gray-700/60 pb-0">
          {(['all', 'pending', 'completed'] as CompletionFilter[]).map((f) => {
            const count = f === 'all'
              ? assignments.length
              : f === 'pending'
                ? assignments.filter((a) => a.status !== 'completed').length
                : assignments.filter((a) => a.status === 'completed').length
            return (
              <button
                key={f}
                type="button"
                onClick={() => setCompletionFilter(f)}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors capitalize ${
                  completionFilter === f
                    ? 'bg-[var(--bg-secondary)] text-teal-300 border border-b-0 border-gray-700/60'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {f} <span className="text-xs opacity-70">({count})</span>
              </button>
            )
          })}
        </div>
      )}

      {!loading && assignments.length === 0 && (
        <p className="text-sm text-gray-500 py-4 text-center">
          No assignments yet. Assign a work package to one or more employees.
        </p>
      )}

      {!loading && assignments.length > 0 && (() => {
        const visible = assignments.filter((row) => {
          if (completionFilter === 'pending') return row.status !== 'completed'
          if (completionFilter === 'completed') return row.status === 'completed'
          return true
        })
        if (visible.length === 0) {
          return (
            <p className="text-sm text-gray-500 py-4 text-center">
              No {completionFilter} assignments.
            </p>
          )
        }
        return (
          <div className="space-y-3">
            {visible.map((row) => {
              const names = (row.assigned_employee_ids || [])
                .map((id) => empById.get(id)?.display_name || 'Employee')
                .join(', ')
              const completedByName = row.completed_by
                ? (empById.get(row.completed_by)?.display_name || 'Employee')
                : null
              const completedDate = row.completed_at
                ? new Date(row.completed_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                : null
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
                      {row.status === 'completed' && completedByName && (
                        <p className="text-xs text-green-400/80 mt-1">
                          Completed by {completedByName}{completedDate ? ` · ${completedDate}` : ''}
                          {row.hours_spent != null ? ` · ${row.hours_spent}h` : ''}
                        </p>
                      )}
                      {row.completion_notes ? (
                        <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{row.completion_notes}</p>
                      ) : null}
                      {row.status === 'completed' && (
                        <TaskCardRating
                          assignmentId={row.id}
                          leadEmployeeId={row.lead_employee_id}
                        />
                      )}
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
        )
      })()}

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
              {/* Work package selection — create: 3-step cascade; edit: locked summary */}
              {editingId ? (
                <div className="rounded-xl bg-[var(--bg-secondary)] border border-gray-700/60 px-3 py-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Work package</p>
                  <p className="text-sm font-bold text-gray-100">{form.workPackageName || '—'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {form.projectName || 'Project'}
                    {form.blueprintSetId ? ` · Blueprint ${form.blueprintSetId.slice(0, 8)}…` : ''}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase">Work package</p>
                    <button
                      type="button"
                      onClick={resetPickerSteps}
                      className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-gray-200 px-2 py-1 rounded-lg"
                      style={{ minHeight: 32 }}
                    >
                      <RotateCcw size={12} />
                      Clear
                    </button>
                  </div>

                  <SearchablePicker
                    label="1. Project"
                    placeholder="Select project…"
                    options={projectOptions}
                    value={form.projectId}
                    onChange={selectProject}
                    loading={projectsLoading}
                    emptyMessage="No active projects found"
                  />

                  <SearchablePicker
                    label="2. Blueprint / document"
                    placeholder={form.projectId ? 'Select blueprint…' : 'Select a project first'}
                    options={blueprintOptions}
                    value={form.blueprintSetId}
                    onChange={selectBlueprint}
                    disabled={!form.projectId || noBlueprints}
                    loading={!!form.projectId && blueprintsLoading}
                    emptyMessage="No blueprints found for this project"
                    mutedHint={!form.projectId ? 'Select a project to load blueprints' : undefined}
                  />
                  {noBlueprints && (
                    <p className="text-sm text-amber-300/90 -mt-1">No blueprints found for this project</p>
                  )}

                  <SearchablePicker
                    label="3. Work package"
                    placeholder={
                      !form.blueprintSetId
                        ? 'Select a blueprint first'
                        : 'Select work package…'
                    }
                    options={packageOptions}
                    value={form.workPackageId}
                    onChange={selectWorkPackage}
                    disabled={!form.blueprintSetId || noPackages || noBlueprints}
                    loading={!!form.blueprintSetId && packagesLoading}
                    emptyMessage="No work packages found"
                    mutedHint={!form.blueprintSetId ? 'Select a blueprint to load work packages' : undefined}
                  />
                  {noPackages && (
                    <p className="text-sm text-amber-300/90 -mt-1">No work packages found</p>
                  )}
                </div>
              )}

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
                disabled={saving || (!editingId && (!canSubmitCreate || noPackages || noBlueprints))}
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
