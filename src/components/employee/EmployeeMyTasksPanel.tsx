// @ts-nocheck
/**
 * EmployeeMyTasksPanel — employee-facing assigned work packages (Feature 1 WS2).
 *
 * Lead privacy: never shows lead_employee_id or any lead/collaborator badge.
 * can_complete (from RPC) gates notes + status controls without revealing why.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  getMyEmployeeTasks,
  updateMyEmployeeTask,
  type EmployeeMyTask,
  type TaskAssignmentStatus,
} from '@/services/employeeTaskAssignmentService'

const STATUS_PILL: Record<TaskAssignmentStatus, string> = {
  assigned:    'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  completed:   'bg-green-100 text-green-700 border-green-200',
}

function formatDue(date: string | null | undefined): string {
  if (!date) return 'No due date'
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function EmployeeMyTasksPanel() {
  const [tasks, setTasks] = useState<EmployeeMyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [draftStatus, setDraftStatus] = useState<Record<string, TaskAssignmentStatus>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await getMyEmployeeTasks()
    if (res.success) {
      setTasks(res.data)
      const notes: Record<string, string> = {}
      const statuses: Record<string, TaskAssignmentStatus> = {}
      for (const t of res.data) {
        notes[t.id] = t.completion_notes || ''
        statuses[t.id] = t.status
      }
      setDraftNotes(notes)
      setDraftStatus(statuses)
    } else {
      setTasks([])
      setError(res.error || 'Could not load your tasks.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveTask = async (task: EmployeeMyTask) => {
    if (!task.can_complete || savingId) return
    setSavingId(task.id)
    setError('')
    const res = await updateMyEmployeeTask({
      assignmentId: task.id,
      status: draftStatus[task.id] || task.status,
      completionNotes: draftNotes[task.id] ?? '',
    })
    setSavingId(null)
    if (!res.success) {
      setError(res.error || 'Could not update task.')
      return
    }
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardList className="w-5 h-5 text-green-600" />
          <h2 className="text-base font-bold text-gray-900">My Tasks</h2>
        </div>
        <p className="text-sm text-gray-500">Work packages assigned to you. Package details are read-only.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin text-green-600" />
          Loading your tasks…
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
          <p className="text-base font-bold text-gray-900">No tasks yet</p>
          <p className="text-sm text-gray-500 mt-2">When your team assigns work packages, they will show up here.</p>
        </div>
      )}

      {!loading && tasks.map((task) => {
        const busy = savingId === task.id
        return (
          <div key={task.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-gray-900">{task.work_package_name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{task.project_name || 'Project'}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDue(task.due_date)}</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize flex-shrink-0 ${STATUS_PILL[task.status]}`}>
                {task.status.replace('_', ' ')}
              </span>
            </div>

            {task.can_complete ? (
              <div className="space-y-3 border-t border-gray-100 pt-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5" htmlFor={`notes-${task.id}`}>
                    Completion notes
                  </label>
                  <textarea
                    id={`notes-${task.id}`}
                    value={draftNotes[task.id] ?? ''}
                    onChange={(e) => setDraftNotes((d) => ({ ...d, [task.id]: e.target.value }))}
                    rows={3}
                    disabled={busy}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                    style={{ minHeight: 88, fontSize: 16 }}
                    placeholder="What was completed?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5" htmlFor={`status-${task.id}`}>
                    Status
                  </label>
                  <select
                    id={`status-${task.id}`}
                    value={draftStatus[task.id] || task.status}
                    onChange={(e) => setDraftStatus((d) => ({ ...d, [task.id]: e.target.value as TaskAssignmentStatus }))}
                    disabled={busy}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-gray-900"
                    style={{ fontSize: 16, minHeight: 44 }}
                  >
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => saveTask(task)}
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-base disabled:opacity-60"
                  style={{ minHeight: 44 }}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {busy ? 'Saving…' : 'Save updates'}
                </button>
              </div>
            ) : (
              task.completion_notes ? (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.completion_notes}</p>
                </div>
              ) : null
            )}
          </div>
        )
      })}
    </div>
  )
}
