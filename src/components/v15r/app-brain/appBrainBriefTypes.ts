/**
 * App Brain Agent Brief Types
 *
 * Type definitions for compact agent session briefs that consolidate
 * task context, governance, file boundaries, risk assessment, and
 * actionable next steps.
 *
 * Purpose: Token-light, deterministic brief generation for multi-agent
 * parallel execution coordination and post-session validation.
 *
 * Display-only module: No integration wired yet.
 * Future integration: AppBrainSessionPanel.tsx (separate session)
 */

import type { AgentModel, SessionDomain, RiskLevel } from './appBrainWorkTypes';

/**
 * QA checklist item for session validation
 */
export interface QAChecklistItem {
  id: string;
  label: string;
  required: boolean;
  completed: boolean;
  notes?: string;
}

/**
 * File classification in brief context
 */
export interface BriefFileReference {
  path: string;
  classification: 'touched' | 'reviewed' | 'protected' | 'canary';
  reason?: string;
}

/**
 * Rule or skill placeholder (no live imports)
 */
export interface RuleSkillPlaceholder {
  id: string;
  name: string;
  category: 'rule' | 'skill' | 'pattern';
  scope: string[];
  description: string;
}

/**
 * Canary suggestion for integrity monitoring
 */
export interface CarnarySuggestion {
  id: string;
  name: string;
  fileOrConfig: string;
  expectedBehavior: string;
  checkFrequency: 'build' | 'typecheck' | 'runtime' | 'manual';
  rationale: string;
}

/**
 * Domain overlap with active parallel sessions
 */
export interface DomainOverlap {
  domain: SessionDomain;
  otherAgent: AgentModel;
  otherBranch: string;
  overlapType: 'file' | 'domain' | 'boundary' | 'config';
  severity: RiskLevel;
  resolvedHow?: string;
}

/**
 * Compact Agent Session Brief
 *
 * Single-document context for a work session, suitable for:
 * - Pre-execution review
 * - Isolation validation
 * - Post-execution QA
 * - Cross-agent coordination
 * - Merge readiness assessment
 */
export interface AgentSessionBrief {
  // Identity
  briefId: string;
  agent: AgentModel;
  model: string;
  branchName: string;
  generatedAt: string;

  // Task
  taskSummary: string;
  taskDescription: string;
  domain: SessionDomain;
  targetFiles: string[];

  // Governance & Boundaries
  isolationBoundary?: string;
  protectedFiles: string[];
  canaryFiles: string[];
  allowedFilePatterns: string[];

  // Files Context
  touchedFiles: BriefFileReference[];
  createdFiles: BriefFileReference[];
  modifiedFiles: BriefFileReference[];
  reviewedFiles: BriefFileReference[];

  // Risk & Overlaps
  estimatedRiskLevel: RiskLevel;
  activeOverlaps: DomainOverlap[];
  conflictingBranches: string[];

  // Rules & Skills (Placeholders)
  applicableRules: RuleSkillPlaceholder[];
  applicableSkills: RuleSkillPlaceholder[];

  // Canaries & Monitoring
  canarySuggestions: CarnarySuggestion[];
  integrationPoints: string[];

  // Validation & QA
  qaChecklist: QAChecklistItem[];
  typecheckRequired: boolean;
  buildRequired: boolean;
  expectedOutcome: string;

  // Commit & Context
  suggestedCommitMessage: string;
  contextUpdateRequired: string[];
  nextAction: string;
  blockingIssues?: string[];

  // Metadata
  version: string;
  source: string;
}

/**
 * Brief generation options
 */
export interface BriefGenerationOptions {
  includeRules?: boolean;
  includeSkills?: boolean;
  includeCanaries?: boolean;
  checkForOverlaps?: boolean;
  formatOutput?: 'json' | 'markdown' | 'text';
  tokenLimit?: number;
}

/**
 * Brief markdown output
 */
export interface BriefMarkdownOutput {
  content: string;
  estimatedTokens: number;
  sections: string[];
}

/**
 * Inferred do-not-touch file set
 */
export interface InferredProtectionSet {
  protectedFiles: string[];
  canaryFiles: string[];
  rationale: Record<string, string>;
}

/**
 * Inferred canary suggestions based on domain and files
 */
export interface InferredCanarySuggestions {
  suggestions: CarnarySuggestion[];
  confidenceLevel: number; // 0-100
  rationale: string;
}

/**
 * Summarized active overlap analysis
 */
export interface ActiveOverlapSummary {
  totalActiveOverlaps: number;
  overlapsByDomain: Record<string, number>;
  overlapsBySeverity: Record<RiskLevel, number>;
  conflictingAgents: AgentModel[];
  resolutionRecommendation: string;
}

/**
 * Create empty agent session brief
 */
export function createEmptyAgentSessionBrief(
  briefId: string,
  agent: AgentModel,
  model: string,
  branchName: string
): AgentSessionBrief {
  const now = new Date().toISOString();
  return {
    briefId,
    agent,
    model,
    branchName,
    generatedAt: now,
    taskSummary: '',
    taskDescription: '',
    domain: 'app-brain-core',
    targetFiles: [],
    protectedFiles: [],
    canaryFiles: [],
    allowedFilePatterns: [],
    touchedFiles: [],
    createdFiles: [],
    modifiedFiles: [],
    reviewedFiles: [],
    estimatedRiskLevel: 'none',
    activeOverlaps: [],
    conflictingBranches: [],
    applicableRules: [],
    applicableSkills: [],
    canarySuggestions: [],
    integrationPoints: [],
    qaChecklist: [],
    typecheckRequired: true,
    buildRequired: true,
    expectedOutcome: '',
    suggestedCommitMessage: '',
    contextUpdateRequired: [],
    nextAction: '',
    version: '1.0.0',
    source: 'appBrainBriefGenerator',
  };
}

/**
 * Create default QA checklist for any brief
 */
export function createDefaultQAChecklist(): QAChecklistItem[] {
  return [
    {
      id: 'typecheck',
      label: 'TypeScript typecheck passes (npx tsc --noEmit)',
      required: true,
      completed: false,
    },
    {
      id: 'build',
      label: 'Build completes successfully (npm run build)',
      required: true,
      completed: false,
    },
    {
      id: 'protected',
      label: 'Protected files untouched',
      required: true,
      completed: false,
    },
    {
      id: 'canary',
      label: 'Canary files verified post-execution',
      required: true,
      completed: false,
    },
    {
      id: 'isolation',
      label: 'File changes stay within isolation boundary',
      required: true,
      completed: false,
    },
    {
      id: 'commit',
      label: 'Commit staged with proper message',
      required: true,
      completed: false,
    },
    {
      id: 'overlap',
      label: 'Active overlaps reviewed and resolved',
      required: false,
      completed: false,
    },
    {
      id: 'context',
      label: 'Context files updated as needed',
      required: false,
      completed: false,
    },
  ];
}
