/**
 * App Brain Live Work Control Tower - Work Schema & Session Types
 * 
 * This module defines the data structures for the App Brain Live Work session
 * management system. It provides the schema for tracking active agent sessions,
 * their assigned domains, file touchpoints, risk assessments, and operational
 * health metrics.
 * 
 * Display-only module: No integration wired yet.
 * Future integration: V15rAppBrainTab.tsx (separate session)
 */

/**
 * Agent model enumeration
 */
export type AgentModel = 'Claude' | 'Codex' | 'Cursor' | 'Haiku' | 'Manual/Owner' | 'CrewAI' | 'Gemini';

/**
 * Session domain enumeration
 * Defines bounded work areas within the app
 */
export type SessionDomain = 
  | 'app-brain-core'
  | 'visual-suite'
  | 'neural-world'
  | 'orb-lab'
  | 'queue-system'
  | 'field-operations'
  | 'estimating'
  | 'project-tracking'
  | 'service-calls'
  | 'collections'
  | 'price-book'
  | 'material-takeoff'
  | 'dashboards'
  | 'ai-workflows'
  | 'settings-config'
  | 'auth-security';

/**
 * Session status enumeration
 */
export type SessionStatus = 
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'pending'
  | 'blocked'
  | 'idle';

/**
 * Risk level enumeration
 */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * TypeCheck result status
 */
export type TypeCheckResult = 'pass' | 'fail' | 'pending' | 'blocked' | 'warning';

/**
 * Context health indicator
 */
export type ContextHealth = 'healthy' | 'degraded' | 'critical' | 'unknown';

/**
 * Overlap warning for parallel session coordination
 */
export interface OverlapWarning {
  conflictingAgent: AgentModel;
  conflictingBranch: string;
  overlapType: 'file' | 'domain' | 'boundary' | 'config';
  severity: RiskLevel;
  description: string;
  resolvedAt?: string;
}

/**
 * Claimed file reference
 */
export interface ClaimedFile {
  path: string;
  status: 'created' | 'modified' | 'reviewed' | 'pending';
  riskLevel: RiskLevel;
  touchedAt: string;
}

/**
 * Live Work Session Schema
 * Represents a single agent's active work session
 */
export interface LiveWorkSession {
  // Identity
  sessionId: string;
  agent: AgentModel;
  model: string; // e.g., 'claude-3-5-haiku', 'gpt-4o', 'cursor-pro'
  
  // Task context
  currentTask: string;
  domain: SessionDomain;
  status: SessionStatus;
  
  // Governance
  claimedFiles: ClaimedFile[];
  touchedFiles: string[];
  isolationBoundary?: string;
  protectedFiles: string[];
  canaryFiles: string[];
  
  // Risk assessment
  riskLevel: RiskLevel;
  overlapWarnings: OverlapWarning[];
  
  // Operational metrics
  typecheckResult: TypeCheckResult;
  typecheckLastRun?: string;
  commitHash?: string;
  branchName: string;
  
  // Context tracking
  contextUpdated: boolean;
  contextHealth: ContextHealth;
  resetRecommendation: boolean;
  
  // Timeline
  startedAt: string;
  lastActivityAt: string;
  lastUpdatedAt: string;
  estimatedCompletionAt?: string;
  completedAt?: string;
  
  // Workflow
  nextAction: string;
  blockingIssue?: string;
  notes?: string;
  
  // Integrity check
  checksumValid: boolean;
}

/**
 * App Brain Control Center - Multi-session tracking
 * Master record for all active Live Work sessions across all agents
 */
export interface AppBrainActiveSessions {
  version: string;
  lastUpdatedAt: string;
  generatedAt: string;
  
  // Session summary
  totalActiveSessions: number;
  sessionsByStatus: Record<SessionStatus, number>;
  sessionsByDomain: Record<SessionDomain, number>;
  
  // Risk summary
  totalRiskLevel: RiskLevel;
  criticalSessions: number;
  sessionsByRiskLevel: Record<RiskLevel, number>;
  
  // Health summary
  overallHealthy: boolean;
  degradedSessionCount: number;
  typeCheckPassRate: number;
  
  // Active sessions
  sessions: Record<string, LiveWorkSession>;
  
  // Governance tracking
  protectedFilesModified: string[];
  canaryFileStatus: Record<string, boolean>;
  
  // Workflow coordination
  overlappingBranches: string[];
  mergeQueue: string[];
  completedSessions: string[];
  
  // Metadata
  isMainMergeInProgress: boolean;
  requiredApprovals: string[];
  masterBranchClean: boolean;
}

/**
 * Session creation helper
 */
export function createLiveWorkSession(
  sessionId: string,
  agent: AgentModel,
  model: string,
  currentTask: string,
  domain: SessionDomain,
  branchName: string
): LiveWorkSession {
  const now = new Date().toISOString();
  return {
    sessionId,
    agent,
    model,
    currentTask,
    domain,
    status: 'pending',
    claimedFiles: [],
    touchedFiles: [],
    protectedFiles: [],
    canaryFiles: [],
    riskLevel: 'none',
    overlapWarnings: [],
    typecheckResult: 'pending',
    branchName,
    contextUpdated: false,
    contextHealth: 'unknown',
    resetRecommendation: false,
    startedAt: now,
    lastActivityAt: now,
    lastUpdatedAt: now,
    nextAction: 'Awaiting execution',
    checksumValid: true,
  };
}

/**
 * Create empty App Brain Active Sessions structure
 */
export function createEmptyAppBrainActiveSessions(): AppBrainActiveSessions {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    lastUpdatedAt: now,
    generatedAt: now,
    totalActiveSessions: 0,
    sessionsByStatus: {
      'active': 0,
      'paused': 0,
      'completed': 0,
      'failed': 0,
      'pending': 0,
      'blocked': 0,
      'idle': 0,
    },
    sessionsByDomain: {
      'app-brain-core': 0,
      'visual-suite': 0,
      'neural-world': 0,
      'orb-lab': 0,
      'queue-system': 0,
      'field-operations': 0,
      'estimating': 0,
      'project-tracking': 0,
      'service-calls': 0,
      'collections': 0,
      'price-book': 0,
      'material-takeoff': 0,
      'dashboards': 0,
      'ai-workflows': 0,
      'settings-config': 0,
      'auth-security': 0,
    },
    totalRiskLevel: 'none',
    criticalSessions: 0,
    sessionsByRiskLevel: {
      'none': 0,
      'low': 0,
      'medium': 0,
      'high': 0,
      'critical': 0,
    },
    overallHealthy: true,
    degradedSessionCount: 0,
    typeCheckPassRate: 100,
    sessions: {},
    protectedFilesModified: [],
    canaryFileStatus: {},
    overlappingBranches: [],
    mergeQueue: [],
    completedSessions: [],
    isMainMergeInProgress: false,
    requiredApprovals: [],
    masterBranchClean: true,
  };
}
