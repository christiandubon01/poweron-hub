/**
 * App Brain Watch Mode Contract
 * 
 * Defines type-safe interfaces for watch mode monitoring.
 * Watch mode observes but never modifies source files.
 * 
 * This is a specification contract. Implementation happens in future waves.
 * See: solarupgrade_agent_context/APP_BRAIN_WATCH_MODE_DESIGN.md
 */

/**
 * Unique sources that trigger watch events
 */
export type WatchSource =
  | 'app-brain-manifest'
  | 'work-manifest'
  | 'directory-manifest'
  | 'context-freshness'
  | 'git-status'
  | 'isolation-boundary'
  | 'config-watch'
  | 'user-command';

/**
 * Watch / refresh execution mode for the CLI utility
 */
export type WatchRefreshMode = 'once' | 'watch';

/**
 * Result of a single generator invocation during refresh
 */
export interface GeneratorResult {
  /** Which watch source this generator maps to */
  source: WatchSource;

  /** Command executed */
  command: string;

  /** Whether the generator completed successfully */
  success: boolean;

  /** Duration in milliseconds */
  durationMs: number;

  /** Output file path (if applicable) */
  outputFile?: string;

  /** Whether the generator output file was written */
  written?: boolean;

  /** True when output matched prior content aside from timestamp fields */
  skippedNoMeaningfulChange?: boolean;

  /** Error message when success is false */
  error?: string;
}

/**
 * Safety note attached to runtime snapshots
 */
export interface WatchSafetyNote {
  note: string;
}

/**
 * Generated runtime snapshot written by scripts/app-brain-watch.mjs
 */
export interface AppBrainRuntimeSnapshot {
  /** ISO timestamp when snapshot was generated */
  generatedAt: string;

  /** Schema version for the snapshot structure */
  schemaVersion: string;

  /** Whether this snapshot came from one-shot or watch loop */
  mode: WatchRefreshMode;

  /** Watch utility is available as an opt-in CLI command */
  isWatchModeAvailable: boolean;

  /** True only when a watch loop was actively running during generation */
  isWatchModeRunning: boolean;

  /** Watch loop polls source mtimes and skips refresh when inputs are unchanged */
  hmrSafeWatch?: boolean;

  /** Whether meaningful watch inputs changed before this refresh */
  sourceChanged?: boolean;

  /** Suggested npm command for this snapshot mode */
  refreshCommand: string;

  /** Current git branch (if available) */
  branch: string | null;

  /** Whether working tree is clean (if git available) */
  gitClean: boolean | null;

  /** Raw changed file count from git porcelain */
  changedFileCount: number;

  /** Safe changed file paths (no contents, filtered) */
  changedFiles: readonly string[];

  /** Per-generator results from the refresh cycle */
  generatorResults: readonly GeneratorResult[];

  /** Sources successfully refreshed in this cycle */
  sourcesRefreshed: readonly WatchSource[];

  /** Output files written during this refresh */
  filesWritten?: readonly string[];

  /** Output files skipped because only timestamp fields changed */
  filesSkipped?: readonly string[];

  /** Count of files skipped for no meaningful content change */
  skippedNoMeaningfulChanges?: number;

  /** Non-fatal warnings from refresh or git capture */
  warnings: readonly string[];

  /** Safety notes for operators */
  safetyNotes: readonly string[];

  /** Snapshot excludes secrets by design */
  noSecrets: true;

  /** Snapshot excludes operational financial values by design */
  noFinancialValues: true;
}

/** Current runtime snapshot schema version */
export const RUNTIME_SNAPSHOT_SCHEMA_VERSION = 'app-brain-runtime-snapshot-v1';

/**
 * Event severity levels
 */
export type WatchEventSeverity = 'info' | 'warning' | 'error';

/**
 * Watch event types
 */
export type WatchEventType =
  | 'refresh'      // manifest refresh needed
  | 'status'       // status snapshot
  | 'snapshot'     // git/file state snapshot
  | 'error';       // error event

/**
 * Freshness indicators
 */
export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';

/**
 * Core watch event structure
 * 
 * Each watch event represents a detected change or status update.
 * Events are logged but never auto-staged or auto-committed.
 */
export interface WatchEvent {
  /** Unique event identifier */
  id: string;

  /** Event timestamp (epoch milliseconds) */
  timestamp: number;

  /** What triggered this event */
  source: WatchSource;

  /** Type of event */
  type: WatchEventType;

  /** Event-specific payload */
  payload: Record<string, unknown>;

  /** Severity level */
  severity: WatchEventSeverity;

  /** Optional message for logging */
  message?: string;
}

/**
 * Git status snapshot (read-only)
 * 
 * Captures current git state without staging or committing.
 * Does NOT modify any git state.
 */
export interface SnapshotStatus {
  /** Current branch name */
  branch: string;

  /** Current HEAD commit hash */
  currentCommit: string;

  /** Whether working tree is dirty */
  isDirty: boolean;

  /** Number of staged changes */
  stagedCount: number;

  /** Number of modified but unstaged files */
  modifiedCount: number;

  /** Number of untracked files */
  untrackedCount: number;

  /** Snapshot timestamp */
  timestamp: number;

  /** Optional list of modified files (if tracking enabled) */
  modifiedFiles?: string[];

  /** Optional list of untracked files (if tracking enabled) */
  untrackedFiles?: string[];
}

/**
 * Refresh result for a single watch source
 * 
 * Indicates whether a manifest or context needs refreshing
 * and how stale the current state is.
 */
export interface RefreshResult {
  /** Which source this result is for */
  source: WatchSource;

  /** Whether refresh is needed */
  needsRefresh: boolean;

  /** Last time this source was refreshed (epoch ms) */
  lastRefreshTime: number;

  /** How fresh is the current state */
  staleness: FreshnessStatus;

  /** Human-readable status message */
  message: string;

  /** Affected file paths (if applicable) */
  affectedPaths?: string[];

  /** Reason for staleness (if stale) */
  reason?: string;
}

/**
 * Error state for watch mode
 * 
 * Represents an error that occurred during watch operation.
 * Errors are logged and reported but do not stop the watch process
 * unless marked as unrecoverable.
 */
export interface WatchErrorState {
  /** The event that caused this error */
  eventId: string;

  /** Which watch source failed */
  source: WatchSource;

  /** Error message */
  error: string;

  /** Additional context about the error */
  context?: Record<string, unknown>;

  /** Whether watch mode can recover from this error */
  recoverable: boolean;

  /** Timestamp of the error */
  timestamp: number;

  /** Suggested recovery action */
  recoveryHint?: string;
}

/**
 * Configuration for watch mode behavior
 * 
 * Controls polling intervals, what gets monitored, and safety constraints.
 * All safety constraints are enforced (no staging, no committing, no secrets).
 */
export interface WatchModeConfig {
  /** Enable or disable watch mode */
  enabled: boolean;

  /** How often to poll for changes (milliseconds) */
  pollIntervalMs: number;

  /** Whether to track untracked files in snapshots */
  includeUntracked: boolean;

  /** Whether to snapshot git status */
  includeGitStatus: boolean;

  /** Whether to signal refresh on directory structure changes */
  refreshOnDirectoryChange: boolean;

  /** Whether to signal refresh when manifest exceeds max age */
  refreshOnManifestAge: boolean;

  /** Maximum age before forcing snapshot refresh (milliseconds) */
  maxSnapshotAge: number;

  /** Glob patterns to exclude from watch (e.g., node_modules, .git) */
  excludePatterns: string[];

  /** If true, watch mode never stages or commits (always enforced for safety) */
  safeMode: boolean;

  /** Whether to log full file lists in events */
  verbose: boolean;

  /** Max events to keep in memory before rotating log */
  maxEventsInMemory: number;
}

/**
 * Watch mode state (ephemeral)
 * 
 * Represents current watch mode state.
 * This state is not persistent and resets on shutdown.
 * Never uses this to claim persistent ownership.
 */
export interface WatchModeState {
  /** Is watch mode currently active */
  isRunning: boolean;

  /** Process ID if running (if applicable) */
  processId?: number;

  /** Current watch status message */
  status: string;

  /** Last event emitted by watch mode */
  lastEvent?: WatchEvent;

  /** Watch mode uptime (milliseconds) */
  uptime: number;

  /** Total events emitted in this session */
  totalEvents: number;

  /** Total errors encountered */
  totalErrors: number;

  /** Timestamp watch mode started */
  startTime?: number;
}

/**
 * Watch mode manifest refresh request
 * 
 * When watch mode detects that a manifest is stale,
 * it signals a refresh need but does NOT execute the refresh.
 * The user must run the refresh script explicitly.
 */
export interface ManifestRefreshRequest {
  /** Which manifest needs refresh */
  manifestType: 'work' | 'directory' | 'appbrain';

  /** Reason for the refresh request */
  reason: string;

  /** Paths that changed (if applicable) */
  changedPaths?: string[];

  /** Suggested command to run for refresh */
  suggestedCommand: string;

  /** Timestamp of the request */
  timestamp: number;

  /** Whether this is auto-requested or user-initiated */
  isAutomatic: boolean;
}

/**
 * Consolidated watch mode event batch
 * 
 * Contains all events and errors from a watch cycle.
 * Used for logging and UI integration.
 */
export interface WatchEventBatch {
  /** Batch ID */
  batchId: string;

  /** When this batch was created */
  timestamp: number;

  /** All events in this batch */
  events: WatchEvent[];

  /** All errors in this batch */
  errors: WatchErrorState[];

  /** Current git snapshot (if tracking git) */
  snapshot?: SnapshotStatus;

  /** Refresh results for each source */
  refreshResults: RefreshResult[];

  /** Overall batch status */
  status: 'success' | 'partial' | 'error';

  /** Summary message */
  summary: string;
}

/**
 * Watch source health indicator
 * 
 * Tracks whether a specific watch source is healthy
 * and capable of reliable monitoring.
 */
export interface WatchSourceHealth {
  /** The watch source */
  source: WatchSource;

  /** Is this source healthy */
  healthy: boolean;

  /** Last time this source was checked */
  lastCheckTime: number;

  /** Last error (if any) */
  lastError?: string;

  /** How many consecutive failures */
  failureCount: number;

  /** Recommended action if unhealthy */
  recommendedAction?: string;
}

/**
 * Watch mode command contract
 * 
 * Future implementation will support:
 * ```bash
 * npm run app-brain:watch
 * ```
 * 
 * This interface describes the contract for that command.
 */
export interface WatchModeCommandContract {
  /** Command name */
  command: 'app-brain:watch';

  /** Command description */
  description: string;

  /** Configuration to use */
  config: WatchModeConfig;

  /** Supported flags (future) */
  flags?: {
    enable?: boolean;
    disable?: boolean;
    dryRun?: boolean;
    verbose?: boolean;
    config?: string;
  };

  /** Expected output behavior */
  expectedBehavior: {
    pollsManifests: boolean;
    logsToFile: boolean;
    respectsSafeMode: boolean;
    allowsGracefulShutdown: boolean;
    neverStages: boolean;
    neverCommits: boolean;
    neverModifiesFiles: boolean;
  };

  /** Expected exit codes */
  exitCodes: {
    success: 0;
    gracefulShutdown: 0;
    unrecoverableError: 1;
    configError: 2;
  };
}

/**
 * Type guard to check if a value is a valid WatchSource
 */
export function isValidWatchSource(value: unknown): value is WatchSource {
  const validSources: WatchSource[] = [
    'app-brain-manifest',
    'work-manifest',
    'directory-manifest',
    'context-freshness',
    'git-status',
    'isolation-boundary',
    'config-watch',
    'user-command',
  ];
  return typeof value === 'string' && (validSources as string[]).includes(value);
}

/**
 * Default watch mode configuration
 * 
 * Safe defaults for watch mode operation.
 * All constraints are enforced.
 */
export const DEFAULT_WATCH_MODE_CONFIG: WatchModeConfig = {
  enabled: false,
  pollIntervalMs: 5000,
  includeUntracked: false,
  includeGitStatus: true,
  refreshOnDirectoryChange: true,
  refreshOnManifestAge: true,
  maxSnapshotAge: 30000,
  excludePatterns: [
    'node_modules/**',
    'dist/**',
    '.git/**',
    '.vite/**',
    '.env*',
    '*.local.json',
    'src/components/v15r/generatedAppBrain*.ts',
  ],
  safeMode: true,
  verbose: false,
  maxEventsInMemory: 1000,
};
