import { supabase } from '@/lib/supabase'

export interface AgendaTask {
  id: string
  org_id: string
  title: string
  task_type: 'standup' | 'follow_up' | 'reminder' | 'deadline' | 'escalation'
  assigned_to?: string
  due_date: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  created_at: string
}

export async function getAgendaTasks(
  orgId: string,
  filters?: { status?: string; dueDate?: string; assignedTo?: string }
): Promise<AgendaTask[]> {
  let query = supabase
    .from('agenda_tasks' as never)
    .select('*')
    .eq('org_id', orgId)
    .order('due_date', { ascending: true })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.dueDate) query = query.eq('due_date', filters.dueDate)
  if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as AgendaTask[]
}

export async function createAgendaTask(orgId: string, task: Partial<AgendaTask>): Promise<AgendaTask> {
  const { data, error } = await supabase
    .from('agenda_tasks' as never)
    .insert({
      org_id: orgId,
      title: task.title,
      task_type: task.task_type || 'follow_up',
      assigned_to: task.assigned_to || null,
      due_date: task.due_date || new Date().toISOString().split('T')[0],
      status: 'pending',
      priority: task.priority || 'medium',
    } as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as AgendaTask
}

export async function updateAgendaTask(taskId: string, updates: Partial<AgendaTask>): Promise<AgendaTask> {
  const { data, error } = await supabase
    .from('agenda_tasks' as never)
    .update(updates as never)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error
  return data as unknown as AgendaTask
}

export async function getDailyStandup(orgId: string, date: string): Promise<{
  tasks: AgendaTask[]
  overdue: AgendaTask[]
  completedToday: AgendaTask[]
}> {
  // Get tasks due today
  const tasks = await getAgendaTasks(orgId, { dueDate: date, status: 'pending' })

  // Get overdue tasks
  const { data: overdueData, error: overdueError } = await supabase
    .from('agenda_tasks' as never)
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .lt('due_date', date)
    .order('due_date', { ascending: true })

  if (overdueError) throw overdueError
  const overdue = (overdueData ?? []) as unknown as AgendaTask[]

  // Get completed today
  const completedToday = await getAgendaTasks(orgId, { dueDate: date, status: 'completed' })

  return { tasks, overdue, completedToday }
}

export async function scheduleReminder(
  orgId: string,
  eventTitle: string,
  clientName: string,
  eventTime: string,
  reminderType: '24h' | '2h' | 'post_job'
): Promise<AgendaTask> {
  const eventDate = new Date(eventTime)
  let dueDate: string
  let title: string

  switch (reminderType) {
    case '24h':
      dueDate = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      title = `24h Reminder: ${clientName} - ${eventTitle}`
      break
    case '2h':
      dueDate = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000).toISOString().split('T')[0]
      title = `2h Reminder: ${clientName} - ${eventTitle}`
      break
    case 'post_job':
      dueDate = new Date(eventDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      title = `Post-Job Follow-up: ${clientName} - ${eventTitle}`
      break
  }

  return createAgendaTask(orgId, {
    title,
    task_type: 'reminder',
    due_date: dueDate,
    priority: reminderType === '24h' ? 'high' : 'medium',
  })
}
