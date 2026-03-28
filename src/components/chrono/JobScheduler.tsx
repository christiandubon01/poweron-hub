// @ts-nocheck
'use client'

import { useState, useEffect } from 'react'
import { Plus, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import clsx from 'clsx'

interface AgendaTask {
  id: string
  title: string
  task_type: 'standup' | 'follow_up' | 'reminder' | 'deadline' | 'escalation'
  priority: 'urgent' | 'high' | 'medium' | 'low'
  due_date: string
  status: 'pending' | 'in_progress' | 'completed'
  assigned_to?: string
  org_id: string
}

const taskTypeColors = {
  standup: 'bg-blue-400/10 text-blue-400',
  follow_up: 'bg-cyan-400/10 text-cyan-400',
  reminder: 'bg-yellow-400/10 text-yellow-400',
  deadline: 'bg-red-400/10 text-red-400',
  escalation: 'bg-orange-400/10 text-orange-400',
}

const statusColors = {
  pending: 'bg-gray-400/10 text-gray-400',
  in_progress: 'bg-blue-400/10 text-blue-400',
  completed: 'bg-emerald-400/10 text-emerald-400',
}

const priorityDots = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-gray-500',
}

export function JobScheduler() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState<AgendaTask[]>([])
  const [filteredTasks, setFilteredTasks] = useState<AgendaTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    task_type: 'reminder' as const,
    due_date: '',
    priority: 'medium' as const,
  })

  const orgId = profile?.org_id

  useEffect(() => {
    if (!orgId) return

    const fetchTasks = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase
          .from('agenda_tasks' as never)
          .select('*')
          .eq('org_id', orgId)
          .order('due_date', { ascending: true })

        if (err) throw err
        setTasks(data || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks')
      } finally {
        setLoading(false)
      }
    }

    fetchTasks()
  }, [orgId])

  // Filter tasks based on active filter
  useEffect(() => {
    let filtered = tasks

    if (activeFilter !== 'all') {
      filtered = tasks.filter((task) => task.status === activeFilter)
    }

    setFilteredTasks(filtered)
  }, [tasks, activeFilter])

  const handleAddTask = async () => {
    if (!orgId || !formData.title || !formData.due_date) return

    try {
      const { error: err } = await supabase.from('agenda_tasks' as never).insert([
        {
          org_id: orgId,
          title: formData.title,
          task_type: formData.task_type,
          due_date: formData.due_date,
          priority: formData.priority,
          status: 'pending',
        },
      ])

      if (err) throw err

      setFormData({
        title: '',
        task_type: 'reminder',
        due_date: '',
        priority: 'medium',
      })
      setShowAddForm(false)

      // Refetch tasks
      const { data } = await supabase
        .from('agenda_tasks' as never)
        .select('*')
        .eq('org_id', orgId)
        .order('due_date', { ascending: true })

      setTasks(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add task')
    }
  }

  const updateTaskStatus = async (taskId: string, newStatus: AgendaTask['status']) => {
    try {
      const { error: err } = await supabase
        .from('agenda_tasks' as never)
        .update({ status: newStatus })
        .eq('id', taskId)

      if (err) throw err

      setTasks(tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task')
    }
  }

  const isOverdue = (task: AgendaTask) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dueDate = new Date(task.due_date)
    dueDate.setHours(0, 0, 0, 0)
    return dueDate < today && task.status === 'pending'
  }

  const overdueTasks = tasks.filter(isOverdue)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with Overdue Count */}
      <div className="flex items-center justify-between">
        <div>
          {overdueTasks.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400 font-medium">
                {overdueTasks.length} overdue task{overdueTasks.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Task
        </button>
      </div>

      {/* Add Task Form */}
      {showAddForm && (
        <div className="bg-gray-800/50 border border-gray-700 rounded p-4 space-y-3">
          <input
            type="text"
            placeholder="Task title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 placeholder-gray-500 rounded px-3 py-2 text-sm"
          />
          <select
            value={formData.task_type}
            onChange={(e) => setFormData({ ...formData, task_type: e.target.value as any })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
          >
            <option value="standup">Standup</option>
            <option value="follow_up">Follow Up</option>
            <option value="reminder">Reminder</option>
            <option value="deadline">Deadline</option>
            <option value="escalation">Escalation</option>
          </select>
          <input
            type="date"
            value={formData.due_date}
            onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
          />
          <select
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleAddTask}
              className="flex-1 px-3 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-sm font-medium"
            >
              Save Task
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="flex-1 px-3 py-2 bg-gray-700/50 text-gray-300 hover:bg-gray-700 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-400/10 border border-red-400/20 text-red-400 rounded p-3 text-sm">{error}</div>}

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-gray-700 pb-3">
        {(['all', 'pending', 'in_progress', 'completed'] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={clsx(
              'px-3 py-2 text-sm font-medium rounded-t transition-all',
              activeFilter === filter
                ? 'bg-gray-800/50 border border-gray-700 border-b-orange-500 text-orange-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            {filter === 'in_progress' ? 'In Progress' : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <AlertCircle className="w-12 h-12 text-gray-500 mb-3" />
          <p className="text-gray-400">
            {activeFilter === 'all'
              ? 'No tasks yet. Create one to get started!'
              : `No ${activeFilter.replace('_', ' ')} tasks`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              className={clsx(
                'bg-gray-800/50 border border-gray-700 rounded p-4 transition-all',
                isOverdue(task) && 'border-red-400/30 bg-red-400/5'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={clsx('w-2 h-2 rounded-full', priorityDots[task.priority])} />
                    <span className={clsx('px-2 py-1 rounded text-xs font-medium', taskTypeColors[task.task_type])}>
                      {task.task_type}
                    </span>
                    {isOverdue(task) && (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-red-400/10 text-red-400">
                        Overdue
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-100 mb-2 break-words">{task.title}</h3>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                    <div>Due: {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    {task.assigned_to && <div>Assigned: {task.assigned_to.slice(0, 8)}</div>}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={clsx('px-2 py-1 rounded text-xs font-medium whitespace-nowrap', statusColors[task.status])}>
                    {task.status === 'in_progress' ? 'In Progress' : task.status}
                  </span>
                  {task.status !== 'completed' && (
                    <select
                      value={task.status}
                      onChange={(e) => updateTaskStatus(task.id, e.target.value as AgendaTask['status'])}
                      className="text-xs bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-2 py-1"
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
