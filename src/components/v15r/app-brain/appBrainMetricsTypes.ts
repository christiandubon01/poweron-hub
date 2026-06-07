/**
 * App Brain Metrics Registry - Type Definitions
 * 
 * Defines the schema for AI development efficiency metrics tracking.
 * This is the foundation for the Metrics Registry that powers the App Brain control tower.
 * 
 * SCOPE: AI development efficiency only (sessions, blocked sessions, repass counts, build/typecheck pass rates).
 * NOT operational or electrical business financial metrics.
 */

/**
 * Model domain classification for metrics tracking
 */
export type ModelDomain =
  | 'core-shell'
  | 'home'
  | 'projects'
  | 'project-inner'
  | 'estimate'
  | 'material-takeoff'
  | 'field-logs'
  | 'graph-dashboard'
  | 'money'
  | 'settings'
  | 'blueprint-pdf'
  | 'price-book'
  | 'leads-sales'
  | 'ai-nexus'
  | 'admin-app-brain'
  | 'sync-persistence'
  | 'integrations'
  | 'other';

/**
 * Development session status
 */
export type SessionStatus = 'in-progress' | 'completed' | 'blocked' | 'repass';

/**
 * AI model type used in session
 */
export type AIModel = 'claude-3-5-sonnet' | 'claude-3-5-haiku' | 'other';

/**
 * Session outcome classification
 */
export type SessionOutcome = 'success' | 'partial' | 'blocked' | 'repass-required';

/**
 * Individual development session record
 */
export interface DevSession {
  /**
   * Unique session identifier (e.g., "sess-20240607-001")
   */
  sessionId: string;

  /**
   * Primary domain this session focused on
   */
  domain: ModelDomain;

  /**
   * Feature/module name (e.g., "Metrics QA Foundations")
   */
  feature: string;

  /**
   * AI model used in this session
   */
  model: AIModel;

  /**
   * Session status
   */
  status: SessionStatus;

  /**
   * Session outcome classification
   */
  outcome: SessionOutcome;

  /**
   * Number of times this task required repassing
   */
  repassCount: number;

  /**
   * Files touched/modified in this session
   */
  filesChanged: string[];

  /**
   * Number of files modified
   */
  fileCount: number;

  /**
   * Session start timestamp (ISO 8601)
   */
  startTime: string;

  /**
   * Session end timestamp (ISO 8601)
   */
  endTime: string;

  /**
   * Estimated duration in minutes (placeholder for calculation)
   */
  durationMinutes?: number;

  /**
   * Whether typecheck passed
   */
  typecheckPass: boolean;

  /**
   * Whether build passed
   */
  buildPass: boolean;

  /**
   * Number of TypeScript errors encountered
   */
  tsErrorCount: number;

  /**
   * Context reset count during this session
   */
  contextResetCount: number;

  /**
   * Implementation notes, blockers, design decisions
   */
  notes?: string;

  /**
   * Associated git commit hash if completed
   */
  commitHash?: string;

  /**
   * Unique hash/tag for tracking related repasses
   */
  taskGroup?: string;
}

/**
 * Metrics aggregation for a specific period and domain
 */
export interface DomainMetrics {
  /**
   * Domain identifier
   */
  domain: ModelDomain;

  /**
   * Display name for the domain
   */
  displayName: string;

  /**
   * Total sessions executed in this domain
   */
  totalSessions: number;

  /**
   * Sessions that completed successfully
   */
  successfulSessions: number;

  /**
   * Sessions that were blocked
   */
  blockedSessions: number;

  /**
   * Sessions that required repassing
   */
  repassSessions: number;

  /**
   * Total repass count (cumulative across all sessions)
   */
  totalRepassCount: number;

  /**
   * Average session duration in minutes (placeholder)
   */
  avgDurationMinutes?: number;

  /**
   * Typecheck pass rate (0-1)
   */
  typecheckPassRate: number;

  /**
   * Build pass rate (0-1)
   */
  buildPassRate: number;

  /**
   * Total files touched in this domain
   */
  totalFilesTouched: number;

  /**
   * Most frequently modified files (top 5)
   */
  mostTouchedFiles: Array<{
    filePath: string;
    modificationCount: number;
  }>;

  /**
   * Primary model used in this domain
   */
  modelUsage: Record<AIModel, number>;

  /**
   * Average context resets per session
   */
  avgContextResetsPerSession: number;

  /**
   * Period this metrics covers (e.g., "week-2024-w23")
   */
  period: string;

  /**
   * Timestamp when metrics were calculated
   */
  calculatedAt: string;
}

/**
 * Summary metrics across all domains
 */
export interface MetricsSummary {
  /**
   * Metadata about the metrics registry
   */
  metadata: {
    /**
     * Version of the schema
     */
    version: string;

    /**
     * Last update timestamp
     */
    lastUpdated: string;

    /**
     * Metrics calculation period
     */
    period: string;

    /**
     * Total unique sessions tracked
     */
    totalSessions: number;

    /**
     * Total completed sessions
     */
    completedSessions: number;

    /**
     * Total blocked sessions
     */
    blockedSessions: number;
  };

  /**
   * All domain metrics, keyed by domain ID
   */
  domains: Record<ModelDomain, DomainMetrics>;

  /**
   * Aggregated summary statistics
   */
  summary: {
    /**
     * Overall typecheck pass rate (0-1)
     */
    overallTypecheckRate: number;

    /**
     * Overall build pass rate (0-1)
     */
    overallBuildRate: number;

    /**
     * Total files touched across all domains
     */
    totalFilesTouched: number;

    /**
     * Average session duration in minutes (placeholder)
     */
    avgDurationMinutes?: number;

    /**
     * Distribution by model
     */
    modelDistribution: Record<AIModel, number>;

    /**
     * Sessions by status
     */
    byStatus: Record<SessionStatus, number>;

    /**
     * Sessions by outcome
     */
    byOutcome: Record<SessionOutcome, number>;

    /**
     * Average repass count per blocked session
     */
    avgRepassesPerBlockedSession: number;

    /**
     * Average context resets per session
     */
    avgContextResetsPerSession: number;
  };

  /**
   * All individual sessions (for detailed analysis)
   */
  sessions: DevSession[];
}

/**
 * Helper type for creating a new session record
 */
export interface CreateDevSessionInput {
  sessionId: string;
  domain: ModelDomain;
  feature: string;
  model: AIModel;
  status?: SessionStatus;
  outcome?: SessionOutcome;
  repassCount?: number;
  filesChanged?: string[];
  startTime: string;
  endTime: string;
  typecheckPass?: boolean;
  buildPass?: boolean;
  tsErrorCount?: number;
  contextResetCount?: number;
  notes?: string;
  commitHash?: string;
  taskGroup?: string;
}
