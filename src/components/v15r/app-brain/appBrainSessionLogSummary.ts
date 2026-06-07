/**
 * App Brain Session Log Summary Module
 * 
 * Pure helper functions for analyzing and summarizing session execution logs.
 * No side effects, no UI integration. Data contract foundation only.
 * 
 * Last Updated: 2026-06-07
 */

import type {
  SessionLogEntry,
  SessionLogRegistry,
  AgentModel,
  SessionDomain,
  SessionStatus,
  BuildResult,
  TypecheckResult,
  QAResult,
  SessionLesson,
  LessonCategory,
} from './appBrainSessionLogTypes'

// ============================================================================
// SESSION COUNTING HELPERS
// ============================================================================

/**
 * Count sessions by agent model
 */
export function countSessionsByAgent(sessions: SessionLogEntry[]): Record<AgentModel, number> {
  const counts: Record<AgentModel, number> = {
    'claude-haiku': 0,
    'claude-sonnet': 0,
    'claude-opus': 0,
    'gemini': 0,
    'cursor': 0,
    'other': 0,
  }

  for (const session of sessions) {
    counts[session.agent]++
  }

  return counts
}

/**
 * Count sessions by domain
 */
export function countSessionsByDomain(sessions: SessionLogEntry[]): Record<SessionDomain, number> {
  const counts: Record<SessionDomain, number> = {
    'app-brain': 0,
    'visual-suite': 0,
    'neural-world': 0,
    'orb-lab': 0,
    'core-shell': 0,
    'integrations': 0,
    'governance': 0,
    'infrastructure': 0,
    'other': 0,
  }

  for (const session of sessions) {
    counts[session.domain]++
  }

  return counts
}

/**
 * Count sessions by status
 */
export function countSessionsByStatus(sessions: SessionLogEntry[]): Record<SessionStatus, number> {
  const counts: Record<SessionStatus, number> = {
    'started': 0,
    'in-progress': 0,
    'completed': 0,
    'completed-with-warnings': 0,
    'failed': 0,
    'aborted': 0,
  }

  for (const session of sessions) {
    counts[session.status]++
  }

  return counts
}

/**
 * Count sessions by build result
 */
export function countSessionsByBuildResult(sessions: SessionLogEntry[]): Record<BuildResult, number> {
  const counts: Record<BuildResult, number> = {
    'success': 0,
    'warning': 0,
    'error': 0,
    'skipped': 0,
    'unknown': 0,
  }

  for (const session of sessions) {
    counts[session.buildResult]++
  }

  return counts
}

/**
 * Count sessions by typecheck result
 */
export function countSessionsByTypecheckResult(sessions: SessionLogEntry[]): Record<TypecheckResult, number> {
  const counts: Record<TypecheckResult, number> = {
    'success': 0,
    'error': 0,
    'warning': 0,
    'skipped': 0,
    'unknown': 0,
  }

  for (const session of sessions) {
    counts[session.typecheckResult]++
  }

  return counts
}

/**
 * Count sessions by QA result
 */
export function countSessionsByQAResult(sessions: SessionLogEntry[]): Record<QAResult, number> {
  const counts: Record<QAResult, number> = {
    'pass': 0,
    'pass-with-notes': 0,
    'fail': 0,
    'skipped': 0,
    'unknown': 0,
  }

  for (const session of sessions) {
    counts[session.qaResult]++
  }

  return counts
}

/**
 * Count sessions that needed a repass
 */
export function countRepassNeeded(sessions: SessionLogEntry[]): number {
  return sessions.filter(s => s.repassNeeded).length
}

/**
 * Get reasons for repass (grouped by reason)
 */
export function getRepassReasons(sessions: SessionLogEntry[]): Record<string, number> {
  const reasons: Record<string, number> = {}

  for (const session of sessions) {
    if (session.repassNeeded && session.repassReason) {
      reasons[session.repassReason] = (reasons[session.repassReason] || 0) + 1
    }
  }

  return reasons
}

/**
 * Check canary status across sessions
 */
export function checkCanaryStatus(sessions: SessionLogEntry[]): {
  totalChecked: number
  totalPassed: number
  totalFailed: number
  failureRate: number
} {
  const sessionsWithCanaries = sessions.filter(s => s.canariesChecked && s.canariesChecked.length > 0)
  const totalChecked = sessionsWithCanaries.length
  const totalPassed = sessionsWithCanaries.filter(s => s.canariesPassed).length
  const totalFailed = totalChecked - totalPassed

  return {
    totalChecked,
    totalPassed,
    totalFailed,
    failureRate: totalChecked > 0 ? totalFailed / totalChecked : 0,
  }
}

// ============================================================================
// SESSION FILTERING HELPERS
// ============================================================================

/**
 * Find all sessions for a specific file
 */
export function findSessionsForFile(sessions: SessionLogEntry[], filePath: string): SessionLogEntry[] {
  return sessions.filter(s => s.filesChanged.includes(filePath))
}

/**
 * Find all sessions by a specific agent
 */
export function findSessionsByAgent(sessions: SessionLogEntry[], agent: AgentModel): SessionLogEntry[] {
  return sessions.filter(s => s.agent === agent)
}

/**
 * Find all sessions in a specific domain
 */
export function findSessionsByDomain(sessions: SessionLogEntry[], domain: SessionDomain): SessionLogEntry[] {
  return sessions.filter(s => s.domain === domain)
}

/**
 * Find all failed sessions
 */
export function findFailedSessions(sessions: SessionLogEntry[]): SessionLogEntry[] {
  return sessions.filter(s => s.status === 'failed' || s.buildResult === 'error' || s.typecheckResult === 'error')
}

/**
 * Find sessions with warnings
 */
export function findSessionsWithWarnings(sessions: SessionLogEntry[]): SessionLogEntry[] {
  return sessions.filter(s =>
    s.status === 'completed-with-warnings' ||
    s.buildResult === 'warning' ||
    s.typecheckResult === 'warning' ||
    s.qaResult === 'pass-with-notes'
  )
}

/**
 * Find recent sessions (by count)
 */
export function findRecentSessions(sessions: SessionLogEntry[], count: number = 10): SessionLogEntry[] {
  return sessions
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, count)
}

/**
 * Find sessions in a date range
 */
export function findSessionsByDateRange(
  sessions: SessionLogEntry[],
  startDate: Date,
  endDate: Date
): SessionLogEntry[] {
  const start = startDate.getTime()
  const end = endDate.getTime()

  return sessions.filter(s => {
    const sessionTime = new Date(s.completedAt).getTime()
    return sessionTime >= start && sessionTime <= end
  })
}

/**
 * Find sessions by partial task name
 */
export function findSessionsByTask(sessions: SessionLogEntry[], taskQuery: string): SessionLogEntry[] {
  const query = taskQuery.toLowerCase()
  return sessions.filter(s => s.task.toLowerCase().includes(query))
}

// ============================================================================
// SESSION LESSON HELPERS
// ============================================================================

/**
 * Aggregate all lessons across sessions
 */
export function aggregateLessons(sessions: SessionLogEntry[]): SessionLesson[] {
  const lessonMap = new Map<string, SessionLesson>()

  for (const session of sessions) {
    for (const lesson of session.lessonsLearned) {
      lessonMap.set(lesson.id, lesson)
    }
  }

  return Array.from(lessonMap.values())
}

/**
 * Count lessons by category
 */
export function countLessonsByCategory(sessions: SessionLogEntry[]): Record<LessonCategory, number> {
  const counts: Record<LessonCategory, number> = {
    'pattern': 0,
    'gotcha': 0,
    'best-practice': 0,
    'anti-pattern': 0,
    'architecture': 0,
    'governance': 0,
    'tools': 0,
    'workflow': 0,
    'other': 0,
  }

  const allLessons = aggregateLessons(sessions)

  for (const lesson of allLessons) {
    counts[lesson.category]++
  }

  return counts
}

/**
 * Find all anti-patterns across sessions
 */
export function findAntiPatterns(sessions: SessionLogEntry[]): SessionLesson[] {
  const allLessons = aggregateLessons(sessions)
  return allLessons.filter(l => l.isAntiPattern)
}

/**
 * Find high-confidence lessons
 */
export function findHighConfidenceLessons(sessions: SessionLogEntry[]): SessionLesson[] {
  const allLessons = aggregateLessons(sessions)
  return allLessons.filter(l => l.confidence === 'high')
}

// ============================================================================
// SESSION SUMMARY BUILDERS
// ============================================================================

/**
 * Build comprehensive summary of session logs
 */
export function summarizeSessionLog(registry: SessionLogRegistry): {
  totalSessions: number
  successRate: number
  avgFilesChanged: number
  topAgent: AgentModel | null
  topDomain: SessionDomain | null
  repassRate: number
  canaryPassRate: number
  totalUniqueLessons: number
  antiPatternCount: number
  lastSessionDate: string | null
  oldestSessionDate: string | null
} {
  const sessions = registry.sessions
  const total = sessions.length
  const successful = sessions.filter(s => s.status === 'completed').length
  const totalFilesChanged = sessions.reduce((sum, s) => sum + s.filesChanged.length, 0)
  const repassCount = countRepassNeeded(sessions)

  // Get top agent by frequency
  const agentCounts = countSessionsByAgent(sessions)
  const topAgent = (Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as AgentModel) || null

  // Get top domain by frequency
  const domainCounts = countSessionsByDomain(sessions)
  const topDomain = (Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as SessionDomain) || null

  // Get canary pass rate
  const canaryStatus = checkCanaryStatus(sessions)

  // Get all lessons and anti-patterns
  const allLessons = aggregateLessons(sessions)
  const antiPatterns = findAntiPatterns(sessions)

  // Get date range
  const sortedByDate = sessions.sort((a, b) => 
    new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  )

  return {
    totalSessions: total,
    successRate: total > 0 ? successful / total : 0,
    avgFilesChanged: total > 0 ? totalFilesChanged / total : 0,
    topAgent,
    topDomain,
    repassRate: total > 0 ? repassCount / total : 0,
    canaryPassRate: canaryStatus.totalChecked > 0 ? canaryStatus.totalPassed / canaryStatus.totalChecked : 1,
    totalUniqueLessons: allLessons.length,
    antiPatternCount: antiPatterns.length,
    lastSessionDate: sortedByDate[sortedByDate.length - 1]?.completedAt || null,
    oldestSessionDate: sortedByDate[0]?.startedAt || null,
  }
}

/**
 * Summarize recent sessions (last N)
 */
export function summarizeRecentSessions(sessions: SessionLogEntry[], count: number = 5): {
  recentCount: number
  recentSuccess: number
  recentFailed: number
  recentRepassNeeded: number
  averageFilesChanged: number
  topLessonCategories: Array<[LessonCategory, number]>
} {
  const recent = findRecentSessions(sessions, count)
  const successful = recent.filter(s => s.status === 'completed').length
  const failed = recent.filter(s => s.status === 'failed').length
  const repassNeeded = countRepassNeeded(recent)
  const totalFiles = recent.reduce((sum, s) => sum + s.filesChanged.length, 0)

  // Top lesson categories in recent sessions
  const lessonCounts = countLessonsByCategory(recent)
  const topCategories = Object.entries(lessonCounts)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count > 0)
    .slice(0, 3)

  return {
    recentCount: recent.length,
    recentSuccess: successful,
    recentFailed: failed,
    recentRepassNeeded: repassNeeded,
    averageFilesChanged: recent.length > 0 ? totalFiles / recent.length : 0,
    topLessonCategories: topCategories as Array<[LessonCategory, number]>,
  }
}

/**
 * Build execution timeline summary
 */
export function buildExecutionTimeline(sessions: SessionLogEntry[]): {
  sessionId: string
  agent: AgentModel
  status: SessionStatus
  completedAt: string
  duration: number // milliseconds
  buildResult: BuildResult
  repassNeeded: boolean
}[] {
  return sessions
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
    .map(s => ({
      sessionId: s.sessionId,
      agent: s.agent,
      status: s.status,
      completedAt: s.completedAt,
      duration: new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime(),
      buildResult: s.buildResult,
      repassNeeded: s.repassNeeded,
    }))
}

/**
 * Find sessions with context updates
 */
export function findSessionsWithContextUpdates(sessions: SessionLogEntry[]): SessionLogEntry[] {
  return sessions.filter(s => s.contextUpdated)
}

/**
 * Aggregate all context changes across sessions
 */
export function aggregateContextChanges(sessions: SessionLogEntry[]): Record<string, number> {
  const changes: Record<string, number> = {}

  for (const session of sessions) {
    if (session.contextUpdated && session.contextChanges) {
      for (const change of session.contextChanges) {
        changes[change] = (changes[change] || 0) + 1
      }
    }
  }

  return changes
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

/**
 * App Brain Session Log Summary v1
 * 
 * This module provides:
 * - Pure helper functions for analyzing session logs
 * - No side effects, no UI integration
 * - Counting, filtering, and aggregation functions
 * - Timeline and trend analysis
 * - Lesson extraction and categorization
 * 
 * Usage:
 * - Import helper functions in other components or services
 * - Use summarizeSessionLog() to get overall snapshot
 * - Use findSessionsFor* functions to query specific subsets
 * - Reference SessionLogEntry for schema
 */
