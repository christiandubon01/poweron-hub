import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, RotateCcw, X } from 'lucide-react'
import type {
  AssignableBlueprint,
  AssignableProject,
  AssignableWorkPackage,
  TaskAssignmentStatus,
} from '@/services/employeeTaskAssignmentService'
import type { AdminEmployeeProfile } from '@/services/adminTimecardService'
import { SnapshotAssignmentPicker } from '@/features/blueprint-snapshots'

export interface AdminWorkOrderAssignmentFormState {
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
  workOrderInstructions: string
}

interface AssignmentFormProps {
  mode: 'create' | 'edit'
  value: AdminWorkOrderAssignmentFormState
  onChange: React.Dispatch<React.SetStateAction<AdminWorkOrderAssignmentFormState>>
  projects: AssignableProject[]
  blueprints: AssignableBlueprint[]
  workPackages: AssignableWorkPackage[]
  employees: AdminEmployeeProfile[]
  selectedSnapshotIds: string[]
  onSelectedSnapshotIdsChange: React.Dispatch<React.SetStateAction<string[]>>
  projectsLoading: boolean
  blueprintsLoading: boolean
  packagesLoading: boolean
  saving: boolean
  error: string
  onSelectProject: (id: string, label: string) => void
  onSelectBlueprint: (id: string, label: string) => void
  onSelectWorkPackage: (id: string, label: string) => void
  onClearHierarchy: () => void
  onCancel: () => void
  onSubmit: () => void
}

const STATUS_OPTIONS: TaskAssignmentStatus[] = ['assigned', 'in_progress', 'completed']

export function AdminWorkOrderAssignmentForm({
  mode,
  value,
  onChange,
  projects,
  blueprints,
  workPackages,
  employees,
  selectedSnapshotIds,
  onSelectedSnapshotIdsChange,
  projectsLoading,
  blueprintsLoading,
  packagesLoading,
  saving,
  error,
  onSelectProject,
  onSelectBlueprint,
  onSelectWorkPackage,
  onClearHierarchy,
  onCancel,
  onSubmit,
}: AssignmentFormProps) {
  const projectOptions = useMemo(
    () => projects.map((project) => ({ id: project.id, label: project.name, sublabel: project.status.replace(/_/g, ' ') })),
    [projects],
  )
  const blueprintOptions = useMemo(
    () => blueprints.map((blueprint) => ({ id: blueprint.blueprintSetId, label: blueprint.title })),
    [blueprints],
  )
  const packageOptions = useMemo(
    () => workPackages.map((workPackage) => ({ id: workPackage.workPackageId, label: workPackage.workPackageName })),
    [workPackages],
  )
  const noBlueprints = !!value.projectId && !blueprintsLoading && blueprints.length === 0
  const noPackages = !!value.blueprintSetId && !packagesLoading && workPackages.length === 0
  const canSubmit =
    !!value.projectId &&
    !!value.blueprintSetId &&
    !!value.workPackageId &&
    value.employeeIds.length > 0 &&
    !!value.primaryEmployeeId

  const toggleEmployee = (id: string) => {
    onChange((previous) => {
      const selected = previous.employeeIds.includes(id)
      const employeeIds = selected
        ? previous.employeeIds.filter((employeeId) => employeeId !== id)
        : [...previous.employeeIds, id]
      let primaryEmployeeId = previous.primaryEmployeeId
      if (selected && primaryEmployeeId === id) primaryEmployeeId = employeeIds[0] || ''
      else if (!selected && !primaryEmployeeId) primaryEmployeeId = id
      return { ...previous, employeeIds, primaryEmployeeId }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-3 sm:items-center" onClick={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-[var(--bg-card,#1e2433)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-700/60 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-400">Task Assignments</p>
            <h3 className="text-lg font-bold text-gray-100">
              {mode === 'create' ? 'Assign Work Order' : 'Edit Work Order Assignment'}
            </h3>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-11 min-w-11 rounded-lg p-2 text-gray-500 hover:bg-gray-700/50 hover:text-gray-200" aria-label={`Close ${mode === 'create' ? 'Assign Work Order' : 'Edit Work Order Assignment'}`}>
            <X className="mx-auto h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-xl border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">{error}</p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase text-gray-400">Work Order source</p>
            <button type="button" onClick={onClearHierarchy} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-gray-400 hover:bg-gray-700/40 hover:text-gray-200">
              <RotateCcw size={12} /> Clear
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SearchablePicker
              label="Project"
              placeholder="Select project…"
              options={projectOptions}
              value={value.projectId}
              onChange={onSelectProject}
              loading={projectsLoading}
              emptyMessage="No active projects found"
            />
            <SearchablePicker
              label="Blueprint / Document"
              placeholder={value.projectId ? 'Select Blueprint…' : 'Select a project first'}
              options={blueprintOptions}
              value={value.blueprintSetId}
              onChange={onSelectBlueprint}
              loading={!!value.projectId && blueprintsLoading}
              disabled={!value.projectId || noBlueprints}
              emptyMessage="No Blueprints found"
            />
            <SearchablePicker
              label="Work Package"
              placeholder={value.blueprintSetId ? 'Select Work Package…' : 'Select a Blueprint first'}
              options={packageOptions}
              value={value.workPackageId}
              onChange={onSelectWorkPackage}
              loading={!!value.blueprintSetId && packagesLoading}
              disabled={!value.blueprintSetId || noPackages || noBlueprints}
              emptyMessage="No Work Packages found"
            />
          </div>
          {noBlueprints || noPackages ? (
            <p className="text-sm text-amber-300/90">
              {noBlueprints ? 'No Blueprints found for this project.' : 'No Work Packages found for this Blueprint.'}
            </p>
          ) : null}

          <SnapshotAssignmentPicker
            projectId={value.projectId}
            blueprintSetId={value.blueprintSetId}
            workPackageId={value.workPackageId}
            projectName={value.projectName}
            blueprintName={value.blueprintTitle}
            workPackageName={value.workPackageName}
            selectedIds={selectedSnapshotIds}
            onChange={onSelectedSnapshotIdsChange}
          />

          <section>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-400">Assigned employees</label>
            {employees.length === 0 ? (
              <p className="text-sm text-gray-500">No accepted portal employees yet.</p>
            ) : (
              <ul className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                {employees.map((employee) => {
                  const checked = value.employeeIds.includes(employee.id)
                  const primary = value.primaryEmployeeId === employee.id
                  return (
                    <li key={employee.id} className="flex items-center gap-3 rounded-xl border border-gray-700/60 bg-[var(--bg-secondary)] px-3 py-2">
                      <input id={`assignment-employee-${employee.id}`} type="checkbox" checked={checked} onChange={() => toggleEmployee(employee.id)} className="h-4 w-4" />
                      <label htmlFor={`assignment-employee-${employee.id}`} className="min-w-0 flex-1 cursor-pointer truncate text-sm text-gray-200">{employee.display_name}</label>
                      {checked ? (
                        <label className="flex cursor-pointer items-center gap-1 text-[11px] text-gray-400">
                          <input type="radio" name="assignment-primary" checked={primary} onChange={() => onChange((current) => ({ ...current, primaryEmployeeId: employee.id }))} />
                          Primary
                        </label>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-gray-500">Primary is private; employees do not see primary/collaborator metadata.</p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-400">Due date</label>
              <input type="date" value={value.dueDate} onChange={(event) => onChange((current) => ({ ...current, dueDate: event.target.value }))} className="min-h-11 w-full rounded-xl border border-gray-600 bg-[var(--bg-secondary)] px-3 text-base text-gray-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-400">Status</label>
              <select value={value.status} onChange={(event) => onChange((current) => ({ ...current, status: event.target.value as TaskAssignmentStatus }))} className="min-h-11 w-full rounded-xl border border-gray-600 bg-[var(--bg-secondary)] px-3 text-base capitalize text-gray-100">
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status} disabled={status === 'completed' && value.status !== 'completed'}>
                    {status.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-400">Work Order Instructions</label>
            <textarea
              value={value.workOrderInstructions}
              onChange={(event) => onChange((current) => ({ ...current, workOrderInstructions: event.target.value }))}
              rows={5}
              maxLength={4000}
              placeholder="Add assignment-specific field instructions…"
              className="w-full resize-y rounded-xl border border-gray-600 bg-[var(--bg-secondary)] px-3 py-3 text-base leading-relaxed text-gray-100"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Instructions specific to this employee Work Order. Work Package Crew Notes remain separate.
            </p>
          </div>
        </div>

        <div className="flex gap-2 border-t border-gray-700/60 px-5 py-4">
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-11 flex-1 rounded-xl bg-gray-700 text-sm font-semibold text-gray-200 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving || !canSubmit || noBlueprints || noPackages}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
            aria-label={mode === 'create' ? 'Assign Work Order' : 'Save Changes'}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {saving ? (mode === 'create' ? 'Assigning Work Order…' : 'Saving Changes…') : (mode === 'create' ? 'Assign' : 'Save Changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface SearchOption {
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
  loading,
  disabled,
  emptyMessage,
}: {
  label: string
  placeholder: string
  options: SearchOption[]
  value: string
  onChange: (id: string, label: string) => void
  loading?: boolean
  disabled?: boolean
  emptyMessage: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.id === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? options.filter((option) => `${option.label} ${option.sublabel || ''}`.toLowerCase().includes(needle))
      : options
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={root} className={`relative ${disabled ? 'opacity-50' : ''}`}>
      <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-400">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled || loading}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-gray-600 bg-[var(--bg-secondary)] px-3 text-left text-base text-gray-100 disabled:cursor-not-allowed"
        aria-expanded={open}
      >
        <span className={`truncate ${selected ? 'text-gray-100' : 'text-gray-500'}`}>{loading ? 'Loading…' : selected?.label || placeholder}</span>
        {loading ? <Loader2 size={15} className="shrink-0 animate-spin text-teal-400" /> : <ChevronDown size={15} className="shrink-0 text-gray-500" />}
      </button>
      {open && !disabled && !loading ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-gray-600 bg-[var(--bg-card,#1e2433)] shadow-xl">
          <div className="border-b border-gray-700 p-2">
            <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label}…`} className="min-h-10 w-full rounded-lg border border-gray-600 bg-[var(--bg-secondary)] px-3 text-base text-gray-100" />
          </div>
          <ul className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? <li className="px-3 py-3 text-sm text-gray-500">{emptyMessage}</li> : filtered.map((option) => (
              <li key={option.id}>
                <button type="button" onClick={() => { onChange(option.id, option.label); setOpen(false); setQuery('') }} className={`w-full px-3 py-2.5 text-left hover:bg-gray-700/50 ${option.id === value ? 'bg-teal-600/20 text-teal-200' : 'text-gray-200'}`}>
                  <span className="block truncate text-sm font-medium">{option.label}</span>
                  {option.sublabel ? <span className="block truncate text-[11px] text-gray-500">{option.sublabel}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
