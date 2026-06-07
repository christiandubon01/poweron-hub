/**
 * App Brain QA Gate Registry - Type Definitions
 * 
 * Defines the schema for quality assurance gates and validation checkpoints.
 * This is the foundation for the QA Gate Registry that powers the App Brain control tower.
 * 
 * SCOPE: Development quality gates, spec compliance, canary validation, and build/typecheck results.
 * NOT operational or electrical business metrics.
 */

/**
 * QA gate result status
 */
export type GateStatus = 'PASS' | 'FAIL' | 'PARTIAL';

/**
 * Canary health status
 */
export type CanaryStatus = 'clean' | 'modified' | 'missing' | 'unknown';

/**
 * Context file update status
 */
export type ContextUpdateStatus = 'updated' | 'unchanged' | 'invalid';

/**
 * Individual spec item for compliance tracking
 */
export interface SpecItem {
  /**
   * Unique spec item identifier (e.g., "spec-metrics-001")
   */
  specId: string;

  /**
   * Requirement category (e.g., "type-definitions", "seed-data", "no-ui-integration")
   */
  category: string;

  /**
   * Human-readable requirement text
   */
  requirement: string;

  /**
   * Whether this spec item was fulfilled
   */
  fulfilled: boolean;

  /**
   * Implementation notes or why requirement was not met
   */
  notes?: string;
}

/**
 * QA gate result for a specific validation checkpoint
 */
export interface QAGateResult {
  /**
   * Unique gate identifier (e.g., "qa-gate-metrics-qa-001")
   */
  gateId: string;

  /**
   * Gate name (e.g., "Type Definitions Created")
   */
  gateName: string;

  /**
   * Gate category (e.g., "spec-compliance", "build-validation", "canary-check")
   */
  category: string;

  /**
   * Overall gate status
   */
  status: GateStatus;

  /**
   * Spec items checked in this gate
   */
  specItems: SpecItem[];

  /**
   * Files changed during session
   */
  filesChanged: string[];

  /**
   * Number of files that were changed
   */
  fileChangeCount: number;

  /**
   * Canary file status checks
   */
  canaries: Array<{
    /**
     * Canary file path
     */
    filePath: string;

    /**
     * Current status of the canary
     */
    status: CanaryStatus;

    /**
     * Hash of file content (for change detection)
     */
    contentHash?: string;

    /**
     * Timestamp of last check
     */
    checkedAt: string;
  }>;

  /**
   * Whether all canaries are clean
   */
  allCanariesClean: boolean;

  /**
   * TypeScript compilation result
   */
  tscResult: {
    /**
     * Whether tsc passed without errors
     */
    passed: boolean;

    /**
     * Error count
     */
    errorCount: number;

    /**
     * Warning count
     */
    warningCount: number;

    /**
     * Command executed
     */
    command: string;

    /**
     * Execution timestamp
     */
    executedAt: string;
  };

  /**
   * Build validation result (npm run build)
   */
  buildResult: {
    /**
     * Whether build passed
     */
    passed: boolean;

    /**
     * Build exit code
     */
    exitCode: number;

    /**
     * Command executed
     */
    command: string;

    /**
     * Execution timestamp
     */
    executedAt: string;

    /**
     * Whether result is blocked by shell harness
     */
    blockedByHarness?: boolean;

    /**
     * Documented blocker if applicable
     */
    blockerDescription?: string;
  };

  /**
   * Typecheck validation result (npm run typecheck)
   */
  typecheckResult: {
    /**
     * Whether typecheck passed
     */
    passed: boolean;

    /**
     * Exit code
     */
    exitCode: number;

    /**
     * Command executed
     */
    command: string;

    /**
     * Execution timestamp
     */
    executedAt: string;

    /**
     * Whether result is blocked by shell harness
     */
    blockedByHarness?: boolean;

    /**
     * Documented blocker if applicable
     */
    blockerDescription?: string;
  };

  /**
   * Shared context file status (should not be modified in parallel agents)
   */
  contextStatus: {
    /**
     * Status of context update
     */
    status: ContextUpdateStatus;

    /**
     * List of files that should not be modified
     */
    protectedFiles: string[];

    /**
     * Any files from protected list that were changed (should be empty)
     */
    protectedFilesChanged: string[];

    /**
     * New context/report files created
     */
    newReportFiles: string[];

    /**
     * Timestamp of status check
     */
    checkedAt: string;
  };

  /**
   * Whether manual QA review is needed
   */
  manualQANeeded: boolean;

  /**
   * Reason for manual QA if needed
   */
  manualQAReason?: string;

  /**
   * Associated git commit hash
   */
  commitHash?: string;

  /**
   * Branch name
   */
  branch?: string;

  /**
   * Gate execution timestamp
   */
  executedAt: string;

  /**
   * Duration of gate execution in seconds
   */
  durationSeconds?: number;

  /**
   * Summary notes
   */
  summary: string;
}

/**
 * Full QA Gate Registry structure
 */
export interface QAGateRegistry {
  /**
   * Metadata about the registry
   */
  metadata: {
    /**
     * Version of the schema
     */
    version: string;

    /**
     * Registry creation timestamp
     */
    createdAt: string;

    /**
     * Last update timestamp
     */
    lastUpdated: string;

    /**
     * Total gates executed
     */
    totalGates: number;

    /**
     * Gates that passed
     */
    passedGates: number;

    /**
     * Gates that failed
     */
    failedGates: number;

    /**
     * Gates with partial results
     */
    partialGates: number;
  };

  /**
   * All gate results, keyed by gate ID
   */
  gates: Record<string, QAGateResult>;

  /**
   * Summary statistics across all gates
   */
  summary: {
    /**
     * Overall pass rate (0-1)
     */
    passRate: number;

    /**
     * Total canaries monitored
     */
    totalCanaries: number;

    /**
     * Canaries currently clean
     */
    cleanCanaries: number;

    /**
     * Total spec items tracked
     */
    totalSpecItems: number;

    /**
     * Spec items fulfilled
     */
    fulfilledSpecItems: number;

    /**
     * Average gate execution time in seconds
     */
    avgExecutionTime: number;

    /**
     * Most recent passed gate timestamp
     */
    mostRecentPass?: string;

    /**
     * Most recent failed gate timestamp
     */
    mostRecentFail?: string;
  };
}

/**
 * Helper type for creating a new QA gate result
 */
export interface CreateQAGateResultInput {
  gateId: string;
  gateName: string;
  category: string;
  status?: GateStatus;
  specItems?: SpecItem[];
  filesChanged?: string[];
  canaries?: Array<{
    filePath: string;
    status: CanaryStatus;
    contentHash?: string;
  }>;
  tscResult?: {
    passed: boolean;
    errorCount?: number;
    warningCount?: number;
    command?: string;
  };
  buildResult?: {
    passed: boolean;
    exitCode?: number;
    command?: string;
    blockedByHarness?: boolean;
    blockerDescription?: string;
  };
  typecheckResult?: {
    passed: boolean;
    exitCode?: number;
    command?: string;
    blockedByHarness?: boolean;
    blockerDescription?: string;
  };
  contextStatus?: {
    status: ContextUpdateStatus;
    protectedFiles?: string[];
    protectedFilesChanged?: string[];
    newReportFiles?: string[];
  };
  manualQANeeded?: boolean;
  manualQAReason?: string;
  commitHash?: string;
  branch?: string;
  summary: string;
}
