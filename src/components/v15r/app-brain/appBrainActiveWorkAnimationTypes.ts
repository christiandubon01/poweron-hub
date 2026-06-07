/**
 * App Brain Active Work Animation Types
 * =====================================
 *
 * Type definitions for tracking active work animation state in the App Brain.
 * 
 * This module defines how agent/session state can inform animation hints
 * for future 3D scene visualization. It includes pure data structures only—
 * no animation code, no Three.js calls, no UI integration.
 *
 * SCOPE:
 * - Animation states for work/session tracking
 * - Agent visual categorization (Claude, Codex, Cursor, Haiku, Manual/Owner)
 * - Work status indicators (idle, planned, running, blocked, ready-for-qa, complete, repass-needed)
 * - Visual animation hints for future 3D scene design
 * - Blocked/warning/overlap/readiness states
 *
 * NOT SCOPE:
 * - Three.js scene editing
 * - UI component rendering
 * - Live tracking or real-time mutation
 * - Business financial values
 *
 * Last Updated: 2026-06-07
 */

/**
 * Agent identifier aligned with App Brain governance model
 */
export type AgentType =
  | 'Claude'
  | 'Codex'
  | 'Cursor'
  | 'Haiku'
  | 'Manual/Owner';

/**
 * Active work animation state
 * Represents the lifecycle stage of a work item or session
 */
export type AnimationState =
  | 'idle'              // No active work
  | 'planned'           // Work scheduled/spec locked
  | 'running'           // Session actively executing
  | 'blocked'           // Session blocked on a dependency or error
  | 'ready-for-qa'      // Session completed, awaiting QA validation
  | 'complete'          // Work successfully finished
  | 'repass-needed';    // Work requires a repass/rework session

/**
 * Visual hint category for warning/alert conditions
 */
export type VisualWarningType =
  | 'none'              // No warning
  | 'blocked-session'   // Session is blocked
  | 'typecheck-failed'  // TypeScript validation failed
  | 'build-failed'      // Build validation failed
  | 'protected-file-touched'  // Protected file was unexpectedly modified
  | 'overlap-detected'  // Session overlaps with another agent's work
  | 'long-duration'     // Session exceeded expected duration
  | 'repass-threshold'; // Repass count exceeded threshold

/**
 * Readiness indicator for QA or next stage
 */
export type ReadinessState =
  | 'not-ready'         // Work not ready to advance
  | 'ready'             // Work ready to advance to next stage
  | 'in-review'         // Work is under review
  | 'approval-pending'; // Awaiting approval before advancing

/**
 * Animation hint for 3D visualization
 * (design guidance only, not executable animation code)
 */
export interface AnimationHint {
  /**
   * Suggested placement in 3D space
   * - 'center': Active execution area
   * - 'inner-ring': Planning/ready states
   * - 'outer-ring': Completed/archived
   * - 'warning-zone': Blocked/error states
   */
  placementZone?: 'center' | 'inner-ring' | 'outer-ring' | 'warning-zone' | 'qa-zone';

  /**
   * Suggested visual style for representation
   * - 'solid': Stable, complete state
   * - 'pulsing': Active work in progress
   * - 'warning': Problem state requiring attention
   * - 'translucent': Planned but not yet started
   * - 'completed': Finished state
   */
  visualStyle?: 'solid' | 'pulsing' | 'warning' | 'translucent' | 'completed';

  /**
   * Suggested color for visual representation
   * - Agent-based: claude-blue, codex-purple, cursor-teal, haiku-green, owner-gold
   * - Status-based: green (success), yellow (warning), red (error), blue (info)
   */
  colorHint?: string;

  /**
   * Animation intensity (0-1)
   * Higher = more prominent/urgent
   */
  intensity?: number;

  /**
   * Optional animation speed multiplier (0.5-2.0)
   * For pulsing or rotating indicators
   */
  speedMultiplier?: number;

  /**
   * Design notes for visualization engineer
   */
  notes?: string;
}

/**
 * Agent session visual state snapshot
 * Captures how an agent's current session should be represented visually
 */
export interface AgentSessionVisualState {
  /**
   * Agent identifier
   */
  agent: AgentType;

  /**
   * Current animation state of this agent's work
   */
  animationState: AnimationState;

  /**
   * Visual warning condition if applicable
   */
  warning?: VisualWarningType;

  /**
   * Readiness for QA or next stage
   */
  readiness?: ReadinessState;

  /**
   * Session identifier being executed
   */
  sessionId?: string;

  /**
   * Primary feature/domain being worked on
   */
  domain?: string;

  /**
   * Repass count (how many times this work has needed rework)
   */
  repassCount?: number;

  /**
   * Number of files being modified
   */
  fileCount?: number;

  /**
   * Whether typecheck is passing
   */
  typecheckPass?: boolean;

  /**
   * Whether build is passing
   */
  buildPass?: boolean;

  /**
   * Session start timestamp (ISO 8601)
   */
  startTime?: string;

  /**
   * Session duration in minutes (when active)
   */
  durationMinutes?: number;

  /**
   * Estimated time until completion
   */
  estimatedTimeRemaining?: number;

  /**
   * Animation hint for 3D visualization
   */
  animationHint?: AnimationHint;
}

/**
 * Domain pulse state for ecosystem visualization
 * Shows activity/health across a domain
 */
export interface DomainPulseState {
  /**
   * Domain identifier
   */
  domainId: string;

  /**
   * Display name
   */
  domainLabel?: string;

  /**
   * Number of active sessions in this domain
   */
  activeSessions: number;

  /**
   * Number of blocked sessions in this domain
   */
  blockedSessions: number;

  /**
   * Overall health: healthy, warning, critical
   */
  health: 'healthy' | 'warning' | 'critical';

  /**
   * Sessions by state in this domain
   */
  stateDistribution: Partial<Record<AnimationState, number>>;

  /**
   * Agents currently working in this domain
   */
  activeAgents: AgentType[];

  /**
   * Most recent activity timestamp
   */
  lastActivityAt?: string;

  /**
   * Animation hint for domain representation
   */
  animationHint?: AnimationHint;
}

/**
 * Overlap warning when multiple agents touch similar areas
 */
export interface OverlapWarning {
  /**
   * Unique warning identifier
   */
  warningId: string;

  /**
   * First agent involved
   */
  agentA: AgentType;

  /**
   * Second agent involved
   */
  agentB: AgentType;

  /**
   * Type of overlap: file, domain, protected area, etc.
   */
  overlapType: 'file' | 'domain' | 'protected-file' | 'isolation-boundary';

  /**
   * Specific files or areas involved
   */
  affectedItems: string[];

  /**
   * Severity: low (informational), medium (should coordinate), high (critical)
   */
  severity: 'low' | 'medium' | 'high';

  /**
   * When the overlap was detected
   */
  detectedAt: string;

  /**
   * Resolution status
   */
  resolved: boolean;

  /**
   * Animation hint for warning visualization
   */
  animationHint?: AnimationHint;
}

/**
 * Complete active work animation snapshot
 * Represents the full state of all active work for animation purposes
 */
export interface ActiveWorkAnimationSnapshot {
  /**
   * Schema version
   */
  version: string;

  /**
   * Snapshot timestamp
   */
  snapshotAt: string;

  /**
   * All agent sessions and their visual state
   */
  agentSessions: Record<AgentType, AgentSessionVisualState>;

  /**
   * Domain pulse states across the ecosystem
   */
  domainPulses: Record<string, DomainPulseState>;

  /**
   * Active overlap warnings
   */
  overlapWarnings: OverlapWarning[];

  /**
   * Summary statistics
   */
  summary: {
    /**
     * Total active sessions
     */
    totalActiveSessions: number;

    /**
     * Sessions by state
     */
    stateDistribution: Partial<Record<AnimationState, number>>;

    /**
     * Number of blocked sessions requiring attention
     */
    blockedCount: number;

    /**
     * Number of warnings active
     */
    warningCount: number;

    /**
     * Most active domain
     */
    mostActiveDomain?: string;

    /**
     * Overall system health
     */
    systemHealth: 'healthy' | 'warning' | 'critical';

    /**
     * Recommended action
     */
    recommendedAction?: string;
  };
}

/**
 * Helper type for building animation snapshots incrementally
 */
export interface AnimationSnapshotBuilder {
  version: string;
  snapshotAt: string;
  agentSessions: Partial<Record<AgentType, AgentSessionVisualState>>;
  domainPulses: Record<string, DomainPulseState>;
  overlapWarnings: OverlapWarning[];
}

/**
 * EXPORT SUMMARY
 * ==============
 *
 * This module provides type definitions for:
 *
 * 1. Animation states representing work lifecycle (idle → running → complete)
 * 2. Agent type categorization (Claude, Codex, Cursor, Haiku, Manual/Owner)
 * 3. Visual warning categories (blocked, build failed, overlap, etc.)
 * 4. Animation hints for 3D scene design (placement, style, color, intensity)
 * 5. Agent session visual snapshots (current state of an agent's work)
 * 6. Domain pulse states (health and activity across domains)
 * 7. Overlap warnings (when multiple agents affect same areas)
 * 8. Complete animation snapshots (full system state for visualization)
 *
 * These types are designed to be:
 * - Pure data structures (no code execution)
 * - Visualization-agnostic (hints for future 3D design, not tied to Three.js)
 * - Session/agent-focused (track development work, not business operations)
 * - Composable (can be built incrementally)
 * - Easy to serialize/persist (JSON-friendly)
 *
 * Usage:
 * - Import types in appBrainActiveWorkAnimationModel.ts
 * - Use in future 3D visualization layer to render agent/session activity
 * - Reference from V15rAppBrainScene.tsx when scene integration is scheduled
 */
