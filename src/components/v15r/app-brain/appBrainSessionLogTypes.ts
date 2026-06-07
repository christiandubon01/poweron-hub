/**
 * App Brain Session Log - Type Definitions
 * 
 * Defines the schema for tracking AI agent session execution, outcomes, and lessons learned.
 * This is the foundation for session history that powers build workflow auditing and agent learning.
 */

/**
 * AI agent/model identifier
 */
export type AgentModel = 
  | 'claude-haiku'
  | 'claude-sonnet'
  | 'claude-opus'
  | 'gemini'
  | 'cursor'
  | 'other'

/**
 * Build/execution domain
 */
export type SessionDomain =
  | 'app-brain'
  | 'visual-suite'
  | 'neural-world'
  | 'orb-lab'
  | 'core-shell'
  | 'integrations'
  | 'governance'
  | 'infrastructure'
  | 'other'

/**
 * Overall session execution status
 */
export type SessionStatus =
  | 'started'
  | 'in-progress'
  | 'completed'
  | 'completed-with-warnings'
  | 'failed'
  | 'aborted'

/**
 * Build/typecheck result outcome
 */
export type BuildResult =
  | 'success'
  | 'warning'
  | 'error'
  | 'skipped'
  | 'unknown'

/**
 * TypeScript compilation result outcome
 */
export type TypecheckResult =
  | 'success'
  | 'error'
  | 'warning'
  | 'skipped'
  | 'unknown'

/**
 * QA gate outcome (integration/regression checks)
 */
export type QAResult =
  | 'pass'
  | 'pass-with-notes'
  | 'fail'
  | 'skipped'
  | 'unknown'

/**
 * Lesson/observation category
 */
export type LessonCategory =
  | 'pattern'
  | 'gotcha'
  | 'best-practice'
  | 'anti-pattern'
  | 'architecture'
  | 'governance'
  | 'tools'
  | 'workflow'
  | 'other'

/**
 * Lesson/observation record
 */
export interface SessionLesson {
  /**
   * Unique lesson ID (can be reused across sessions)
   */
  id: string

  /**
   * Category for lesson organization
   */
  category: LessonCategory

  /**
   * Short summary of the lesson
   */
  title: string

  /**
   * Detailed explanation
   */
  description: string

  /**
   * Is this a negative pattern to avoid?
   */
  isAntiPattern?: boolean

  /**
   * Related file or module (if applicable)
   */
  relatedFile?: string

  /**
   * Confidence that this lesson is reliable
   */
  confidence: 'low' | 'medium' | 'high'
}

/**
 * Individual build/execution session record
 */
export interface SessionLogEntry {
  /**
   * Unique session identifier (e.g., "appbrain-w03-a3-session-log-schema")
   */
  sessionId: string

  /**
   * AI model/agent that executed this session
   */
  agent: AgentModel

  /**
   * User-provided task name or ticket reference
   */
  task: string

  /**
   * Brief summary of what was attempted
   */
  summary?: string

  /**
   * Domain this session worked on
   */
  domain: SessionDomain

  /**
   * Overall execution status
   */
  status: SessionStatus

  /**
   * Array of files modified or created in this session
   */
  filesChanged: string[]

  /**
   * Git commit hash for this session's work (if completed)
   */
  commitHash?: string

  /**
   * Branch name this session worked on
   */
  branch?: string

  /**
   * Result of npm run build (or equivalent)
   */
  buildResult: BuildResult

  /**
   * Details about build result (error messages, warnings, etc.)
   */
  buildDetails?: string

  /**
   * Result of TypeScript type checking
   */
  typecheckResult: TypecheckResult

  /**
   * Details about typecheck result
   */
  typecheckDetails?: string

  /**
   * QA/integration test result
   */
  qaResult: QAResult

  /**
   * Details about QA result
   */
  qaDetails?: string

  /**
   * Was a rework/repass needed after this session?
   */
  repassNeeded: boolean

  /**
   * If rework needed, what was the reason?
   */
  repassReason?: string

  /**
   * Session-specific lessons learned
   */
  lessonsLearned: SessionLesson[]

  /**
   * Canary files that were checked to remain untouched
   */
  canariesChecked?: string[]

  /**
   * Did all canaries pass (remain untouched)?
   */
  canariesPassed?: boolean

  /**
   * Any notes about canary violations
   */
  canaryNotes?: string

  /**
   * ISO 8601 timestamp when session started
   */
  startedAt: string

  /**
   * ISO 8601 timestamp when session completed
   */
  completedAt: string

  /**
   * Was the shared context updated during this session?
   */
  contextUpdated: boolean

  /**
   * If context updated, what was changed?
   */
  contextChanges?: string[]

  /**
   * Any miscellaneous notes about the session
   */
  notes?: string
}

/**
 * Session log registry/catalog
 */
export interface SessionLogRegistry {
  /**
   * Metadata about the registry
   */
  metadata: {
    /**
     * Version of the schema
     */
    version: string

    /**
     * Last update timestamp
     */
    lastUpdated: string

    /**
     * Total number of sessions recorded
     */
    totalSessions: number

    /**
     * Total number of successful sessions
     */
    successfulSessions: number

    /**
     * Total number of failed sessions
     */
    failedSessions: number
  }

  /**
   * Array of session log entries
   */
  sessions: SessionLogEntry[]

  /**
   * Summary statistics
   */
  summary: {
    /**
     * Count by agent model
     */
    byAgent: Record<AgentModel, number>

    /**
     * Count by domain
     */
    byDomain: Record<SessionDomain, number>

    /**
     * Count by status
     */
    byStatus: Record<SessionStatus, number>

    /**
     * Count by build result
     */
    byBuildResult: Record<BuildResult, number>

    /**
     * Count by typecheck result
     */
    byTypecheckResult: Record<TypecheckResult, number>

    /**
     * Total sessions needing repass
     */
    repassNeeded: number

    /**
     * Total lessons learned across all sessions
     */
    totalLessonsLearned: number
  }
}

/**
 * Helper type for creating a new session log entry
 */
export interface CreateSessionLogInput {
  sessionId: string
  agent: AgentModel
  task: string
  domain: SessionDomain
  status?: SessionStatus
  filesChanged?: string[]
  commitHash?: string
  branch?: string
  buildResult?: BuildResult
  buildDetails?: string
  typecheckResult?: TypecheckResult
  typecheckDetails?: string
  qaResult?: QAResult
  qaDetails?: string
  repassNeeded?: boolean
  repassReason?: string
  lessonsLearned?: SessionLesson[]
  canariesChecked?: string[]
  canariesPassed?: boolean
  canaryNotes?: string
  startedAt?: string
  completedAt?: string
  contextUpdated?: boolean
  contextChanges?: string[]
  notes?: string
  summary?: string
}
