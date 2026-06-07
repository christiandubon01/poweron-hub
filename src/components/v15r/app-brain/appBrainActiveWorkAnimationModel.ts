/**
 * App Brain Active Work Animation Model
 * ======================================
 *
 * Pure helper functions for deriving animation states from agent/session data.
 * 
 * This module contains no side effects, no Three.js code, and no UI integration.
 * All functions are pure: same input → same output, every time.
 *
 * SCOPE:
 * - Derive animation states from session data
 * - Calculate domain pulse metrics
 * - Detect overlap warnings
 * - Build animation snapshots
 * - Generate animation hints based on state
 *
 * NOT SCOPE:
 * - Rendering or Three.js updates
 * - Real-time event listening
 * - Live session mutation
 * - UI component behavior
 *
 * Last Updated: 2026-06-07
 */

import {
  AnimationState,
  AnimationHint,
  VisualWarningType,
  ReadinessState,
  AgentType,
  AgentSessionVisualState,
  DomainPulseState,
  OverlapWarning,
  ActiveWorkAnimationSnapshot,
  AnimationSnapshotBuilder,
} from './appBrainActiveWorkAnimationTypes';

// ============================================================================
// HELPER: Animation State Derivation
// ============================================================================

/**
 * Derive animation state from session status and metrics
 * 
 * Pure function: given session state, determine animation state
 * 
 * @param status - Session status ('in-progress', 'completed', 'blocked', 'repass')
 * @param isBlocked - Whether session is currently blocked
 * @param hasBeenCompleted - Whether work has finished
 * @param repassCount - Number of repasses this work has needed
 * @returns Animation state for visualization
 */
export function deriveAgentAnimationState(
  status: 'in-progress' | 'completed' | 'blocked' | 'repass',
  isBlocked: boolean,
  hasBeenCompleted: boolean,
  repassCount: number = 0
): AnimationState {
  // Repass needed takes priority
  if (status === 'repass' || repassCount > 0) {
    return 'repass-needed';
  }

  // Blocked state
  if (isBlocked || status === 'blocked') {
    return 'blocked';
  }

  // Completed
  if (hasBeenCompleted || status === 'completed') {
    return 'complete';
  }

  // In progress
  if (status === 'in-progress') {
    return 'running';
  }

  // Default to idle
  return 'idle';
}

/**
 * Derive visual warning type from session conditions
 * 
 * @param buildPass - Whether build succeeded
 * @param typecheckPass - Whether typecheck passed
 * @param isBlocked - Whether session is blocked
 * @param protectedFilesTouched - Count of protected files modified
 * @param overlapDetected - Whether work overlaps with another agent
 * @param durationMinutes - Session duration in minutes
 * @returns Warning type or 'none'
 */
export function deriveVisualWarning(
  buildPass: boolean,
  typecheckPass: boolean,
  isBlocked: boolean,
  protectedFilesTouched: number = 0,
  overlapDetected: boolean = false,
  durationMinutes: number = 0
): VisualWarningType {
  // Critical failures first
  if (isBlocked) {
    return 'blocked-session';
  }

  if (!typecheckPass) {
    return 'typecheck-failed';
  }

  if (!buildPass) {
    return 'build-failed';
  }

  if (protectedFilesTouched > 0) {
    return 'protected-file-touched';
  }

  if (overlapDetected) {
    return 'overlap-detected';
  }

  // Duration heuristic (warn if > 60 minutes)
  if (durationMinutes > 60) {
    return 'long-duration';
  }

  return 'none';
}

/**
 * Derive readiness state for QA or next stage
 * 
 * @param animationState - Current animation state
 * @param buildPass - Whether build succeeded
 * @param typecheckPass - Whether typecheck passed
 * @param pendingReview - Whether code is awaiting review
 * @returns Readiness state
 */
export function deriveReadinessState(
  animationState: AnimationState,
  buildPass: boolean,
  typecheckPass: boolean,
  pendingReview: boolean = false
): ReadinessState {
  // Can't be ready if running or blocked
  if (animationState === 'running' || animationState === 'blocked') {
    return 'not-ready';
  }

  // Repass needed means not ready for next stage
  if (animationState === 'repass-needed') {
    return 'not-ready';
  }

  // Complete without issues = ready
  if (animationState === 'complete') {
    if (!buildPass || !typecheckPass) {
      return 'not-ready';
    }
    if (pendingReview) {
      return 'in-review';
    }
    return 'ready';
  }

  // Ready-for-QA state = in review
  if (animationState === 'ready-for-qa') {
    return 'in-review';
  }

  // Planned state = not ready yet
  if (animationState === 'planned') {
    return 'not-ready';
  }

  return 'not-ready';
}

// ============================================================================
// HELPER: Animation Hints
// ============================================================================

/**
 * Build animation hint based on animation state and warnings
 * 
 * @param state - Current animation state
 * @param warning - Current warning type if any
 * @param agentType - Which agent is working
 * @param intensity - Optional override intensity (0-1)
 * @returns Animation hint for visualization
 */
export function buildAnimationHintForState(
  state: AnimationState,
  warning: VisualWarningType = 'none',
  agentType: AgentType = 'Manual/Owner',
  intensity?: number
): AnimationHint {
  // Color by agent
  const agentColorMap: Record<AgentType, string> = {
    'Claude': 'claude-blue',
    'Codex': 'codex-purple',
    'Cursor': 'cursor-teal',
    'Haiku': 'haiku-green',
    'Manual/Owner': 'owner-gold',
  };

  // Base hint by state
  let baseHint: AnimationHint = {
    intensity: 0.5,
    speedMultiplier: 1.0,
  };

  switch (state) {
    case 'idle':
      baseHint = {
        placementZone: 'outer-ring',
        visualStyle: 'translucent',
        intensity: 0.2,
        speedMultiplier: 0.5,
      };
      break;

    case 'planned':
      baseHint = {
        placementZone: 'inner-ring',
        visualStyle: 'solid',
        intensity: 0.4,
        speedMultiplier: 0.8,
      };
      break;

    case 'running':
      baseHint = {
        placementZone: 'center',
        visualStyle: 'pulsing',
        intensity: 0.9,
        speedMultiplier: 1.5,
      };
      break;

    case 'blocked':
      baseHint = {
        placementZone: 'warning-zone',
        visualStyle: 'warning',
        intensity: 0.95,
        speedMultiplier: 2.0,
        colorHint: 'warning-red',
      };
      break;

    case 'ready-for-qa':
      baseHint = {
        placementZone: 'qa-zone',
        visualStyle: 'pulsing',
        intensity: 0.7,
        speedMultiplier: 1.0,
        colorHint: 'qa-yellow',
      };
      break;

    case 'complete':
      baseHint = {
        placementZone: 'outer-ring',
        visualStyle: 'completed',
        intensity: 0.3,
        speedMultiplier: 0.3,
      };
      break;

    case 'repass-needed':
      baseHint = {
        placementZone: 'warning-zone',
        visualStyle: 'warning',
        intensity: 0.85,
        speedMultiplier: 1.5,
        colorHint: 'warning-orange',
      };
      break;
  }

  // Override color by agent if not warning state
  if (warning === 'none') {
    baseHint.colorHint = agentColorMap[agentType];
  }

  // Apply intensity override if provided
  if (intensity !== undefined) {
    baseHint.intensity = Math.max(0, Math.min(1, intensity));
  }

  // Add warning-specific visual notes
  if (warning !== 'none') {
    baseHint.notes = `Warning: ${warning}`;
  }

  return baseHint;
}

// ============================================================================
// HELPER: Domain Pulse State
// ============================================================================

/**
 * Derive domain pulse state from active sessions in that domain
 * 
 * Pure function: aggregates session data into domain health metric
 * 
 * @param domainId - Domain identifier
 * @param domainLabel - Optional human-readable label
 * @param activeSessions - Count of active sessions
 * @param blockedSessions - Count of blocked sessions
 * @param stateDistribution - Sessions by state
 * @param activeAgents - Agents currently working in domain
 * @param lastActivityAt - Last activity timestamp
 * @returns Domain pulse state
 */
export function deriveDomainPulseState(
  domainId: string,
  domainLabel: string = domainId,
  activeSessions: number = 0,
  blockedSessions: number = 0,
  stateDistribution: Partial<Record<AnimationState, number>> = {},
  activeAgents: AgentType[] = [],
  lastActivityAt?: string
): DomainPulseState {
  // Determine health based on blocked sessions and active count
  let health: 'healthy' | 'warning' | 'critical' = 'healthy';

  if (blockedSessions > 2) {
    health = 'critical';
  } else if (blockedSessions > 0) {
    health = 'warning';
  } else if (activeSessions > 5) {
    health = 'warning';
  }

  // Build animation hint based on health
  const animationHint = buildAnimationHintForDomain(domainId, health, activeSessions);

  return {
    domainId,
    domainLabel,
    activeSessions,
    blockedSessions,
    health,
    stateDistribution,
    activeAgents,
    lastActivityAt,
    animationHint,
  };
}

/**
 * Build animation hint for domain visualization
 * 
 * @param domainId - Domain identifier
 * @param health - Domain health status
 * @param activeSessions - Count of active sessions
 * @returns Animation hint
 */
function buildAnimationHintForDomain(
  domainId: string,
  health: 'healthy' | 'warning' | 'critical',
  activeSessions: number
): AnimationHint {
  const hint: AnimationHint = {};

  switch (health) {
    case 'healthy':
      hint.visualStyle = 'solid';
      hint.intensity = activeSessions > 0 ? 0.6 : 0.3;
      hint.speedMultiplier = activeSessions > 0 ? 1.0 : 0.5;
      hint.colorHint = 'domain-green';
      break;

    case 'warning':
      hint.visualStyle = 'pulsing';
      hint.intensity = 0.7;
      hint.speedMultiplier = 1.2;
      hint.colorHint = 'domain-yellow';
      break;

    case 'critical':
      hint.visualStyle = 'warning';
      hint.intensity = 0.9;
      hint.speedMultiplier = 1.8;
      hint.colorHint = 'domain-red';
      break;
  }

  hint.notes = `Domain ${domainId} - ${activeSessions} active sessions`;

  return hint;
}

// ============================================================================
// HELPER: Overlap Warning Detection
// ============================================================================

/**
 * Derive overlap warning when agents affect similar areas
 * 
 * @param warningId - Unique warning identifier
 * @param agentA - First agent
 * @param agentB - Second agent
 * @param overlapType - Type of overlap (file, domain, etc.)
 * @param affectedItems - Specific files or areas
 * @param detected - Whether overlap is actively detected
 * @returns Overlap warning object
 */
export function deriveOverlapWarningAnimation(
  warningId: string,
  agentA: AgentType,
  agentB: AgentType,
  overlapType: 'file' | 'domain' | 'protected-file' | 'isolation-boundary',
  affectedItems: string[] = [],
  detected: boolean = true
): OverlapWarning {
  // Severity depends on overlap type
  let severity: 'low' | 'medium' | 'high' = 'medium';

  if (overlapType === 'protected-file' || overlapType === 'isolation-boundary') {
    severity = 'high';
  } else if (overlapType === 'domain') {
    severity = 'low';
  }

  // Animation hint for warning visualization
  const animationHint: AnimationHint = {
    placementZone: 'warning-zone',
    visualStyle: 'warning',
    colorHint: severity === 'high' ? 'warning-red' : 'warning-yellow',
    intensity: severity === 'high' ? 0.95 : 0.7,
    speedMultiplier: 1.5,
    notes: `Overlap between ${agentA} and ${agentB}: ${overlapType}`,
  };

  return {
    warningId,
    agentA,
    agentB,
    overlapType,
    affectedItems,
    severity,
    detectedAt: new Date().toISOString(),
    resolved: !detected,
    animationHint,
  };
}

// ============================================================================
// HELPER: Build Complete Snapshot
// ============================================================================

/**
 * Build a complete active work animation snapshot
 * 
 * Pure function: assembles all animation state into one structure
 * 
 * @param agentSessions - Agent visual states keyed by agent type
 * @param domainPulses - Domain pulse states keyed by domain ID
 * @param overlapWarnings - Active overlap warnings
 * @returns Complete animation snapshot
 */
export function buildActiveWorkAnimationSnapshot(
  agentSessions: Record<AgentType, AgentSessionVisualState>,
  domainPulses: Record<string, DomainPulseState>,
  overlapWarnings: OverlapWarning[] = []
): ActiveWorkAnimationSnapshot {
  // Calculate summary statistics
  const totalActiveSessions = Object.values(agentSessions).reduce(
    (sum) => sum + 1,
    0
  );

  const stateDistribution: Partial<Record<AnimationState, number>> = {};
  Object.values(agentSessions).forEach((session) => {
    stateDistribution[session.animationState] =
      (stateDistribution[session.animationState] || 0) + 1;
  });

  const blockedCount = Object.values(agentSessions).filter(
    (s) => s.animationState === 'blocked'
  ).length;

  const warningCount = overlapWarnings.filter((w) => !w.resolved).length +
    Object.values(agentSessions).filter((s) => s.warning && s.warning !== 'none')
      .length;

  // Find most active domain
  const mostActiveDomain = Object.entries(domainPulses).reduce(
    (max, [domain, pulse]) =>
      pulse.activeSessions > (domainPulses[max]?.activeSessions || 0)
        ? domain
        : max,
    ''
  ) || undefined;

  // Determine overall system health
  let systemHealth: 'healthy' | 'warning' | 'critical' = 'healthy';

  if (blockedCount > 1 || warningCount > 3) {
    systemHealth = 'critical';
  } else if (blockedCount > 0 || warningCount > 0) {
    systemHealth = 'warning';
  }

  return {
    version: '1.0.0',
    snapshotAt: new Date().toISOString(),
    agentSessions,
    domainPulses,
    overlapWarnings,
    summary: {
      totalActiveSessions,
      stateDistribution,
      blockedCount,
      warningCount,
      mostActiveDomain,
      systemHealth,
      recommendedAction:
        blockedCount > 0 ? 'Investigate blocked sessions' : undefined,
    },
  };
}

// ============================================================================
// HELPER: Create Agent Session State
// ============================================================================

/**
 * Create an agent session visual state from basic parameters
 * 
 * @param agent - Agent type
 * @param animationState - Current animation state
 * @param sessionId - Optional session identifier
 * @param domain - Optional domain being worked on
 * @param options - Additional optional fields
 * @returns Agent session visual state
 */
export function createAgentSessionVisualState(
  agent: AgentType,
  animationState: AnimationState,
  sessionId?: string,
  domain?: string,
  options?: Partial<AgentSessionVisualState>
): AgentSessionVisualState {
  const warning = deriveVisualWarning(
    options?.buildPass ?? true,
    options?.typecheckPass ?? true,
    animationState === 'blocked'
  );

  const readiness = deriveReadinessState(
    animationState,
    options?.buildPass ?? true,
    options?.typecheckPass ?? true
  );

  const animationHint = buildAnimationHintForState(
    animationState,
    warning,
    agent
  );

  return {
    agent,
    animationState,
    warning: warning !== 'none' ? warning : undefined,
    readiness,
    sessionId,
    domain,
    animationHint,
    ...options,
  };
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

/**
 * EXPORT SUMMARY
 * ==============
 *
 * Pure helper functions provided:
 *
 * 1. deriveAgentAnimationState()
 *    - Maps session status to animation state
 *    - Handles priority: repass > blocked > complete > running > idle
 *
 * 2. deriveVisualWarning()
 *    - Determines warning type from build/typecheck/blocking conditions
 *    - Returns 'none' if all conditions pass
 *
 * 3. deriveReadinessState()
 *    - Indicates if work is ready for QA or next stage
 *    - Returns: not-ready, ready, in-review, approval-pending
 *
 * 4. buildAnimationHintForState()
 *    - Creates visualization hints based on state
 *    - Includes placement, style, color, intensity, speed
 *
 * 5. deriveDomainPulseState()
 *    - Aggregates session activity into domain health
 *    - Determines if domain is healthy, warning, or critical
 *
 * 6. deriveOverlapWarningAnimation()
 *    - Creates warnings when agents affect similar areas
 *    - Assigns severity based on overlap type
 *
 * 7. buildActiveWorkAnimationSnapshot()
 *    - Assembles full state into one structure
 *    - Calculates summary statistics
 *    - Determines overall system health
 *
 * 8. createAgentSessionVisualState()
 *    - Helper to create agent visual state objects
 *    - Auto-derives warning and readiness
 *
 * All functions:
 * - Are pure (no side effects)
 * - Accept plain data inputs
 * - Return plain data structures
 * - Can be tested independently
 * - Are suitable for serialization (JSON)
 *
 * Usage:
 * - Import and call in future animation model calculations
 * - Use snapshot output to drive 3D visualization
 * - Reference from V15rAppBrainScene.tsx when ready
 */
