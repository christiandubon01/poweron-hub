/**
 * Shared owner/admin Task Assignments workflow.
 *
 * Both the Team tab and Crew Portal mount this component. The calendar board,
 * details experience, and create/edit Work Order form are intentionally shared.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Loader2, Star } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  addQualityRating,
  getQualityRatings,
  type QualityRating,
} from '@/services/employeePerformanceService'
import {
  archiveTaskAssignment,
  buildTaskAssignmentWorkOrderDraft,
  buildTaskAssignmentWorkOrderDraftForEdit,
  createTaskAssignmentWithWorkOrderAndSnapshots,
  getProjectOnlyWorkOrdersBackendReadiness,
  listAdminWorkOrderAssignments,
  listAssignableEmployees,
  listAssignableProjects,
  listBlueprintsForProject,
  listWorkPackagesForBlueprint,
  restoreTaskAssignment,
  revokeTaskAssignment,
  updateTaskAssignmentWithWorkOrderAndSnapshots,
  type AssignableBlueprint,
  type AssignableProject,
  type AssignableWorkPackage,
  type EmployeeTaskAssignment,
  type ProjectOnlyBackendReadinessStatus,
} from '@/services/employeeTaskAssignmentService'
import { parseAssignedHoursInput } from '@/features/work-orders'
import type { AdminEmployeeProfile } from '@/services/adminTimecardService'
import {
  AdminWorkOrderAssignmentForm,
  type AdminWorkOrderAssignmentFormState,
} from './AdminWorkOrderAssignmentForm'
import { AdminWorkOrderAssignmentBoard } from './AdminWorkOrderAssignmentBoard'
import type { AdminAssignmentCalendarFilter } from './adminAssignmentCalendar'

const emptyForm = (): AdminWorkOrderAssignmentFormState => ({
  projectId: '',
  projectName: '',
  blueprintSetId: '',
  blueprintTitle: '',
  workPackageId: '',
  workPackageName: '',
  workOrderTitle: '',
  titleTouched: false,
  employeeIds: [],
  primaryEmployeeId: '',
  dueDate: '',
  status: 'assigned',
  assignedHours: '',
  workOrderInstructions: '',
})

const newRequestIds = (): { assignmentId: string; clientRequestId: string } => ({
  assignmentId: crypto.randomUUID(),
  clientRequestId: crypto.randomUUID(),
})

export default function AdminTaskDelegationPanel({ initialProjectId }: { initialProjectId?: string } = {}) {
  const { profile } = useAuth()
  const orgId = profile?.org_id || ''
  const [employees, setEmployees] = useState<AdminEmployeeProfile[]>([])
  const [assignments, setAssignments] = useState<EmployeeTaskAssignment[]>([])
  const [projects, setProjects] = useState<AssignableProject[]>([])
  const [blueprints, setBlueprints] = useState<AssignableBlueprint[]>([])
  const [workPackages, setWorkPackages] = useState<AssignableWorkPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [blueprintsLoading, setBlueprintsLoading] = useState(false)
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [boardError, setBoardError] = useState('')
  const [formError, setFormError] = useState('')
  const [filter, setFilter] = useState<AdminAssignmentCalendarFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeTaskAssignment | null>(null)
  const [form, setForm] = useState<AdminWorkOrderAssignmentFormState>(emptyForm)
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<string[]>([])
  const [requestIds, setRequestIds] = useState(newRequestIds)
  const [projectOnlyBackendStatus, setProjectOnlyBackendStatus] =
    useState<ProjectOnlyBackendReadinessStatus>('unknown')
  const autoOpenRef = useRef<string>()

  const ensureProjectOnlyBackendReadiness = useCallback(async () => {
    // Service caches ready/not_ready; unknown/network is not treated as ready and may retry on open.
    const readiness = await getProjectOnlyWorkOrdersBackendReadiness()
    setProjectOnlyBackendStatus(readiness.status)
    return readiness.status
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setBoardError('')
    try {
      const [employeeResult, assignmentResult] = await Promise.all([
        listAssignableEmployees(),
        listAdminWorkOrderAssignments(),
      ])
      if (!employeeResult.success) {
        setEmployees([])
        setBoardError(employeeResult.error || 'Could not load employees.')
      } else {
        setEmployees(employeeResult.data)
      }
      if (!assignmentResult.success) {
        setAssignments([])
        setBoardError(assignmentResult.error || 'Could not load assignments.')
      } else {
        setAssignments(assignmentResult.data)
      }
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : 'Could not load Task Assignments.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    const result = await listAssignableProjects()
    setProjectsLoading(false)
    if (!result.success) {
      setProjects([])
      setFormError(result.error || 'Could not load projects.')
      return []
    }
    setProjects(result.data)
    return result.data
  }, [])

  const loadBlueprints = useCallback((projectId: string) => {
    setBlueprintsLoading(true)
    const next = listBlueprintsForProject(projectId)
    setBlueprints(next)
    setBlueprintsLoading(false)
    return next
  }, [])

  const loadPackages = useCallback((blueprintSetId: string) => {
    setPackagesLoading(true)
    const next = listWorkPackagesForBlueprint(blueprintSetId)
    setWorkPackages(next)
    setPackagesLoading(false)
    return next
  }, [])

  const openCreate = useCallback(async (projectId?: string) => {
    setEditing(null)
    setForm(emptyForm())
    setSelectedSnapshotIds([])
    setBlueprints([])
    setWorkPackages([])
    setRequestIds(newRequestIds())
    setFormError('')
    setFormOpen(true)
    void ensureProjectOnlyBackendReadiness()
    const nextProjects = await loadProjects()
    if (projectId) {
      const project = nextProjects.find((row) => row.id === projectId)
      if (project) {
        setForm((current) => ({ ...current, projectId: project.id, projectName: project.name }))
        loadBlueprints(project.id)
      }
    }
  }, [ensureProjectOnlyBackendReadiness, loadBlueprints, loadProjects])

  useEffect(() => {
    if (!initialProjectId || loading || autoOpenRef.current === initialProjectId) return
    autoOpenRef.current = initialProjectId
    void openCreate(initialProjectId)
  }, [initialProjectId, loading, openCreate])

  const openEdit = useCallback(async (assignment: EmployeeTaskAssignment) => {
    if (assignment.archived_at) {
      setBoardError('Archived Work Orders cannot be edited. Restore the Work Order first.')
      return
    }
    setEditing(assignment)
    setForm({
      projectId: assignment.project_id || '',
      projectName: assignment.project_name || '',
      blueprintSetId: assignment.blueprint_set_id || '',
      blueprintTitle: assignment.blueprint_title || '',
      workPackageId: assignment.work_package_id || '',
      workPackageName: assignment.work_package_id ? assignment.work_package_name : '',
      workOrderTitle: assignment.work_package_name || '',
      titleTouched: true,
      employeeIds: [...(assignment.assigned_employee_ids || [])],
      primaryEmployeeId: assignment.lead_employee_id,
      dueDate: assignment.due_date || '',
      status: assignment.status,
      assignedHours:
        assignment.assigned_hours != null && Number.isFinite(Number(assignment.assigned_hours))
          ? String(assignment.assigned_hours)
          : '',
      workOrderInstructions: assignment.work_order_instructions || '',
    })
    setSelectedSnapshotIds([...(assignment.current_snapshot_ids || [])])
    setRequestIds({ assignmentId: assignment.id, clientRequestId: crypto.randomUUID() })
    setFormError('')
    setBoardError('')
    setFormOpen(true)
    void ensureProjectOnlyBackendReadiness()
    await loadProjects()
    if (assignment.project_id) loadBlueprints(assignment.project_id)
    if (assignment.blueprint_set_id) loadPackages(assignment.blueprint_set_id)
  }, [ensureProjectOnlyBackendReadiness, loadBlueprints, loadPackages, loadProjects])

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setEditing(null)
    setForm(emptyForm())
    setSelectedSnapshotIds([])
    setBlueprints([])
    setWorkPackages([])
    setFormError('')
    setRequestIds(newRequestIds())
  }

  const clearHierarchy = () => {
    setForm((current) => ({
      ...current,
      projectId: '',
      projectName: '',
      blueprintSetId: '',
      blueprintTitle: '',
      workPackageId: '',
      workPackageName: '',
      workOrderTitle: current.titleTouched ? current.workOrderTitle : '',
    }))
    setBlueprints([])
    setWorkPackages([])
    setSelectedSnapshotIds([])
  }

  const selectProject = (id: string, label: string) => {
    setForm((current) => ({
      ...current,
      projectId: id,
      projectName: label,
      blueprintSetId: '',
      blueprintTitle: '',
      workPackageId: '',
      workPackageName: '',
      workOrderTitle: current.titleTouched ? current.workOrderTitle : '',
    }))
    setWorkPackages([])
    setSelectedSnapshotIds([])
    if (id) loadBlueprints(id)
    else setBlueprints([])
  }

  const selectBlueprint = (id: string, label: string) => {
    setForm((current) => ({
      ...current,
      blueprintSetId: id,
      blueprintTitle: label,
      workPackageId: '',
      workPackageName: '',
      workOrderTitle: current.titleTouched ? current.workOrderTitle : '',
    }))
    setSelectedSnapshotIds([])
    if (id) loadPackages(id)
    else setWorkPackages([])
  }

  const selectWorkPackage = (id: string, label: string) => {
    setForm((current) => ({
      ...current,
      workPackageId: id,
      workPackageName: label,
      workOrderTitle: id
        ? (current.titleTouched ? current.workOrderTitle : label)
        : (current.titleTouched ? current.workOrderTitle : ''),
    }))
    setSelectedSnapshotIds([])
  }

  const submit = async () => {
    if (saving) return
    if (!orgId) {
      setFormError('Missing organization.')
      return
    }
    const workOrderTitle = form.workOrderTitle.trim().replace(/\s+/g, ' ')
    if (!form.projectId || !form.projectName) {
      setFormError('Select a Project.')
      return
    }
    if (!workOrderTitle) {
      setFormError('Enter a Work Order title.')
      return
    }
    if (form.workPackageId && !form.blueprintSetId) {
      setFormError('Select a Blueprint for the Work Package.')
      return
    }
    if (form.employeeIds.length === 0) {
      setFormError('Select at least one employee.')
      return
    }
    if (!form.primaryEmployeeId || !form.employeeIds.includes(form.primaryEmployeeId)) {
      setFormError('Choose a primary assignee from the selected employees.')
      return
    }
    if (selectedSnapshotIds.length > 0 && (!form.blueprintSetId || !form.workPackageId)) {
      setFormError('Snapshots require a Blueprint and Work Package. Clear snapshots or complete the source selection.')
      return
    }
    if (!form.workPackageId) {
      const readiness = await ensureProjectOnlyBackendReadiness()
      if (readiness !== 'ready') {
        setFormError(
          readiness === 'unknown'
            ? 'Could not verify Project-only Work Order backend readiness. Select a Work Package, or retry after reconnecting.'
            : 'Project-only Work Orders will be available after the Work Order backend update is deployed.',
        )
        return
      }
    }

    const hoursParse = parseAssignedHoursInput(form.assignedHours)
    if (!hoursParse.ok) {
      setFormError(hoursParse.error)
      return
    }

    const instructions = normalizeInstructions(form.workOrderInstructions)
    const draft = editing
      ? buildTaskAssignmentWorkOrderDraftForEdit({
          assignment: editing,
          projectId: form.projectId,
          projectName: form.projectName,
          blueprintSetId: form.blueprintSetId || null,
          blueprintTitle: form.blueprintTitle || null,
          workPackageId: form.workPackageId || null,
          workOrderTitle,
          dueDate: form.dueDate || null,
          workOrderInstructions: instructions,
          assignedHours: hoursParse.value,
        })
      : buildTaskAssignmentWorkOrderDraft({
          projectId: form.projectId,
          projectName: form.projectName,
          blueprintSetId: form.blueprintSetId || null,
          blueprintTitle: form.blueprintTitle || null,
          workPackageId: form.workPackageId || null,
          workOrderTitle,
          dueDate: form.dueDate || null,
          workOrderInstructions: instructions,
          assignedHours: hoursParse.value,
        })
    if (!draft.success) {
      setFormError(draft.error || 'Could not build Work Order.')
      return
    }

    setSaving(true)
    setFormError('')
    const result = editing
      ? await updateTaskAssignmentWithWorkOrderAndSnapshots({
          assignmentId: editing.id,
          clientRequestId: requestIds.clientRequestId,
          expectedUpdatedAt: editing.updated_at,
          expectedWorkOrderVersion: editing.current_work_order_version ?? 0,
          workPackageId: form.workPackageId || null,
          workPackageName: workOrderTitle,
          projectId: form.projectId,
          projectName: form.projectName,
          blueprintSetId: form.blueprintSetId || null,
          blueprintTitle: form.blueprintTitle || null,
          leadEmployeeId: form.primaryEmployeeId,
          assignedEmployeeIds: form.employeeIds,
          dueDate: form.dueDate || null,
          status: editing.status === 'completed' ? 'completed' : form.status,
          workOrderPayload: draft.data,
          snapshotIds: selectedSnapshotIds,
        })
      : await createTaskAssignmentWithWorkOrderAndSnapshots({
          assignmentId: requestIds.assignmentId,
          clientRequestId: requestIds.clientRequestId,
          orgId,
          workPackageId: form.workPackageId || null,
          workPackageName: workOrderTitle,
          projectId: form.projectId,
          projectName: form.projectName,
          blueprintSetId: form.blueprintSetId || null,
          blueprintTitle: form.blueprintTitle || null,
          leadEmployeeId: form.primaryEmployeeId,
          assignedEmployeeIds: form.employeeIds,
          dueDate: form.dueDate || null,
          status: form.status,
          workOrderPayload: draft.data,
          snapshotIds: selectedSnapshotIds,
        })
    setSaving(false)

    if (!result.success) {
      setFormError(result.error || (editing ? 'Could not save changes.' : 'Could not assign Work Order.'))
      return
    }

    setFormOpen(false)
    setEditing(null)
    setForm(emptyForm())
    setSelectedSnapshotIds([])
    setBlueprints([])
    setWorkPackages([])
    setRequestIds(newRequestIds())
    await load()
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-700 bg-[var(--bg-card)] p-3 sm:p-5">
      {boardError ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-300">{boardError}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin text-teal-400" />
          Loading Task Assignments…
        </div>
      ) : (
        <AdminWorkOrderAssignmentBoard
          assignments={assignments}
          employees={employees}
          filter={filter}
          onFilterChange={setFilter}
          onAssign={() => void openCreate()}
          onEdit={(assignment) => void openEdit(assignment)}
          onArchive={async (assignment) => {
            if (saving) return { success: false, error: 'Another Work Order action is already in progress.' }
            setSaving(true)
            setBoardError('')
            const result = await archiveTaskAssignment(assignment.id, assignment.updated_at)
            setSaving(false)
            if (!result.success) {
              setBoardError(result.error || 'Could not archive Work Order.')
              return { success: false, error: result.error }
            }
            await load()
            return { success: true }
          }}
          onRestore={async (assignment) => {
            if (saving) return { success: false, error: 'Another Work Order action is already in progress.' }
            setSaving(true)
            setBoardError('')
            const result = await restoreTaskAssignment(assignment.id, assignment.updated_at)
            setSaving(false)
            if (!result.success) {
              setBoardError(result.error || 'Could not restore Work Order.')
              return { success: false, error: result.error }
            }
            await load()
            return { success: true }
          }}
          onDelete={async (assignment) => {
            if (saving) return { success: false, error: 'Another Work Order action is already in progress.' }
            setSaving(true)
            setBoardError('')
            const result = await revokeTaskAssignment(assignment.id)
            setSaving(false)
            if (!result.success) {
              setBoardError(result.error || 'Could not permanently delete Work Order.')
              return { success: false, error: result.error }
            }
            await load()
            return { success: true }
          }}
          actionBusy={saving}
          renderRating={(assignment) => (
            <TaskCardRating assignmentId={assignment.id} leadEmployeeId={assignment.lead_employee_id} />
          )}
        />
      )}

      {formOpen ? (
        <AdminWorkOrderAssignmentForm
          mode={editing ? 'edit' : 'create'}
          value={form}
          onChange={setForm}
          projects={projects}
          blueprints={blueprints}
          workPackages={workPackages}
          employees={employees}
          selectedSnapshotIds={selectedSnapshotIds}
          onSelectedSnapshotIdsChange={setSelectedSnapshotIds}
          projectsLoading={projectsLoading}
          blueprintsLoading={blueprintsLoading}
          packagesLoading={packagesLoading}
          saving={saving}
          error={formError}
          projectOnlyBackendStatus={projectOnlyBackendStatus}
          onSelectProject={selectProject}
          onSelectBlueprint={selectBlueprint}
          onSelectWorkPackage={selectWorkPackage}
          onClearHierarchy={clearHierarchy}
          onCancel={closeForm}
          onSubmit={() => void submit()}
        />
      ) : null}
    </div>
  )
}

function normalizeInstructions(value: string): string | null {
  const trimmed = String(value || '').trim().slice(0, 4000)
  return trimmed || null
}

function TaskCardRating({ assignmentId, leadEmployeeId }: { assignmentId: string; leadEmployeeId: string }) {
  const [loading, setLoading] = useState(true)
  const [existing, setExisting] = useState<QualityRating | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [score, setScore] = useState(5)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getQualityRatings(leadEmployeeId).then((result) => {
      if (!active) return
      if (result.success) setExisting(result.data.find((rating) => rating.assignment_id === assignmentId) ?? null)
      setLoading(false)
    })
    return () => { active = false }
  }, [assignmentId, leadEmployeeId])

  const submitRating = async () => {
    setSubmitting(true)
    setError('')
    const result = await addQualityRating(leadEmployeeId, assignmentId, score, notes.trim() || null)
    setSubmitting(false)
    if (!result.success) {
      setError(result.error || 'Failed to save rating')
      return
    }
    setExisting(result.data)
    setOpen(false)
    setEditing(false)
  }

  if (loading) return <p className="flex items-center gap-1 text-xs text-gray-500"><Loader2 size={11} className="animate-spin" /> Loading rating…</p>
  if (existing && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StarRow value={existing.score} readOnly />
        <span className="text-xs text-gray-400">{existing.score}/5</span>
        <button type="button" onClick={() => { setScore(existing.score); setNotes(existing.notes ?? ''); setEditing(true) }} className="text-xs text-gray-400 underline hover:text-gray-200">Edit rating</button>
      </div>
    )
  }
  if (!open && !editing) {
    return <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300"><Star size={12} /> Rate quality</button>
  }
  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <StarRow value={score} onChange={setScore} />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Rating notes (optional)" className="w-full resize-y rounded-lg border border-gray-700 bg-transparent px-2 py-1.5 text-sm text-gray-200" />
      <div className="flex gap-2">
        <button type="button" onClick={() => void submitRating()} disabled={submitting} className="min-h-9 rounded-lg border border-amber-700/50 bg-amber-600/20 px-3 text-xs font-semibold text-amber-300 disabled:opacity-50">{submitting ? 'Saving…' : 'Save rating'}</button>
        <button type="button" onClick={() => { setOpen(false); setEditing(false) }} className="min-h-9 px-3 text-xs text-gray-400">Cancel</button>
      </div>
    </div>
  )
}

function StarRow({ value, onChange, readOnly }: { value: number; onChange?: (value: number) => void; readOnly?: boolean }) {
  return (
    <div className="flex gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} type="button" disabled={readOnly} onClick={() => onChange?.(star)} className={readOnly ? 'cursor-default' : 'hover:scale-110'}>
          <Star size={15} className={star <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-600'} />
        </button>
      ))}
    </div>
  )
}
