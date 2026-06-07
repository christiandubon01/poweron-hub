import type { AppBrainDirectoryFile } from '../generatedAppBrainDirectory'
import { APP_BRAIN_ACTIVE_SESSIONS, APP_BRAIN_TASK_REGISTRY } from './appBrainSeedData'

export const APP_BRAIN_DIRECTORY_ALL = 'all'

export interface AppBrainDirectoryFilters {
  search: string
  area: string
  extension: string
}

export interface RelatedActiveWork {
  sessionId: string
  agent: string
  task: string
  status: string
  fileStatus: string
}

export interface RelatedBacklogTask {
  taskId: string
  title: string
  domain: string
  status: string
  priority: string
  risk: string
}

export function normalizeDirectoryQuery(value: string): string {
  return value.trim().toLowerCase()
}

export function countDirectoryValues(
  files: readonly AppBrainDirectoryFile[],
  getValue: (file: AppBrainDirectoryFile) => string,
): Array<[string, number]> {
  const counts = new Map<string, number>()
  files.forEach((file) => {
    const value = getValue(file)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  })

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function directoryFileMatchesSearch(file: AppBrainDirectoryFile, query: string): boolean {
  const normalizedQuery = normalizeDirectoryQuery(query)
  if (!normalizedQuery) return true

  const haystack = [
    file.path,
    file.fileId,
    file.name,
    file.parentDirectory,
    file.area,
    file.extension,
    ...file.components,
    ...file.exports,
  ].join(' ').toLowerCase()

  return haystack.includes(normalizedQuery)
}

export function filterDirectoryFiles(
  files: readonly AppBrainDirectoryFile[],
  filters: AppBrainDirectoryFilters,
): AppBrainDirectoryFile[] {
  return files.filter((file) => {
    if (filters.area !== APP_BRAIN_DIRECTORY_ALL && file.area !== filters.area) return false
    if (filters.extension !== APP_BRAIN_DIRECTORY_ALL && file.extension !== filters.extension) return false
    return directoryFileMatchesSearch(file, filters.search)
  })
}

export function findDirectoryFile(
  files: readonly AppBrainDirectoryFile[],
  filePath: string | null,
): AppBrainDirectoryFile | null {
  if (!filePath) return null
  return files.find((file) => file.path === filePath) ?? null
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getDirectoryRiskPlaceholder(file: AppBrainDirectoryFile | null): string {
  if (!file) return 'Select a file to view static risk notes.'
  if (file.importedByCount >= 12) return 'Higher coordination risk: many files import this module.'
  if (file.area.includes('/services')) return 'Medium coordination risk: service changes can affect multiple views.'
  if (file.area.includes('/v15r') && file.name.includes('AppBrain')) return 'Medium risk: App Brain shell/control-tower UI.'
  return 'Low to medium risk placeholder until live dependency scoring is added.'
}

export function getSafeEditNotesPlaceholder(file: AppBrainDirectoryFile | null): string {
  if (!file) return 'Pick a file before planning edits.'
  if (file.importedByCount > 0) return 'Check imported-by callers before changing exported names or prop contracts.'
  if (file.importCount > 8) return 'This file has several imports; verify assumptions before moving or splitting it.'
  return 'Keep edits scoped and run the relevant build/typecheck path after changes.'
}

export function getCanarySuggestionPlaceholder(file: AppBrainDirectoryFile | null): string {
  if (!file) return 'No canary suggestion yet.'
  if (file.extension === '.tsx') return 'Open the owning view and verify render, selection, and responsive layout.'
  if (file.area.includes('/services')) return 'Run typecheck and verify the nearest consumer panel or query path.'
  return 'Run typecheck and inspect the nearest importing module.'
}

export function getRelatedActiveWork(file: AppBrainDirectoryFile | null): RelatedActiveWork[] {
  if (!file) return []

  return Object.values(APP_BRAIN_ACTIVE_SESSIONS.sessions).flatMap((session) => {
    const claimed = session.claimedFiles.find((claimedFile) => claimedFile.path === file.path)
    const touched = session.touchedFiles.includes(file.path)
    if (!claimed && !touched) return []

    return [{
      sessionId: session.sessionId,
      agent: session.agent,
      task: session.currentTask,
      status: session.status,
      fileStatus: claimed?.status ?? 'touched',
    }]
  })
}

export function getRelatedBacklogTasks(file: AppBrainDirectoryFile | null): RelatedBacklogTask[] {
  if (!file) return []

  return Object.values(APP_BRAIN_TASK_REGISTRY.domains).flatMap((bucket) =>
    bucket.tasks
      .filter((task) => task.relatedFiles.includes(file.path))
      .map((task) => ({
        taskId: task.taskId,
        title: task.title,
        domain: task.domain,
        status: task.status,
        priority: task.priority,
        risk: task.risk,
      })),
  )
}
