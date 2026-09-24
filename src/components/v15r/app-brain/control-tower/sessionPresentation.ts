import type { ControlTowerRunView } from '@/features/control-tower/controlTowerAdapter'
import type { Role } from './controlTowerTypes'

export type TowerSession = Omit<ControlTowerRunView, 'provenance'> & { provenance: 'Live' | 'Preview' }
export const isActiveSession = (run: TowerSession) => ['running', 'pending', 'paused'].includes(run.runState)
export const sessionTitle = (run: TowerSession) => {
  const title = run.title || run.objective || 'Untitled session'
  // Some older Hosts published the entire owner scope as the title. Use its
  // actual first task as a navigation label; retain the full scope in Details.
  return title.length > 160 && run.tasks[0]?.title ? run.tasks[0].title : title
}
export function conciseTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not reported'
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
export function sessionDuration(run: TowerSession, now = Date.now()) {
  const start = Date.parse(run.startedAt ?? '')
  // A terminal run without a completion timestamp must never keep counting.
  const end = run.completedAt ? Date.parse(run.completedAt) : isActiveSession(run) ? now : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  const seconds = Math.floor((end - start) / 1000)
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
export function roleResult(run: TowerSession, role: Role) {
  const tasks = run.tasks.filter(task => task.role === role)
  if (!tasks.length) return 'Not reported'
  if (tasks.some(task => task.state === 'failed')) return 'Failed'
  if (tasks.some(task => task.state === 'blocked')) return 'Blocked'
  if (tasks.some(task => task.state === 'running')) return 'Running'
  if (tasks.every(task => task.state === 'passed')) return 'Passed'
  if (tasks.some(task => task.state === 'cancelled')) return 'Cancelled'
  return 'Waiting'
}
