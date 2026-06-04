/**
 * App Brain Rules Type System
 * 
 * Type definitions for global, agent, domain, and file-type rules
 * that govern the PowerOn Hub AI operations platform.
 * 
 * Philosophy: Low friction by default (silent or warn)
 * Last Updated: 2026-06-04
 */

// ============================================================================
// FRICTION LEVELS
// ============================================================================

export type FrictionLevel = 'silent' | 'warn' | 'confirm' | 'block';

/**
 * Friction Level Ordering
 * silent < warn < confirm < block
 * 
 * When multiple rules apply, the highest friction wins.
 */
export const FRICTION_ORDER: Record<FrictionLevel, number> = {
  silent: 0,
  warn: 1,
  confirm: 2,
  block: 3,
};

// ============================================================================
// GLOBAL RULES
// ============================================================================

export interface GlobalRule {
  id: string;
  name: string;
  description: string;
  scope: string[];
  friction: FrictionLevel;
  action: RuleAction;
  rationale: string;
  validation?: string;
}

export interface GlobalRulesSet {
  version: string;
  name: string;
  description: string;
  lastUpdated: string;
  source: string;
  philosophy: string;
  globalRules: GlobalRule[];
  domainRules: DomainRule[];
  fileTypeRules: FileTypeRule[];
  sessionTypeRules: SessionTypeRule[];
}

// ============================================================================
// DOMAIN RULES
// ============================================================================

export interface DomainRule {
  id: string;
  domain: string;
  description: string;
  friction: FrictionLevel;
  allowedScope?: string[];
  blockedScope?: string[];
  rationale: string;
}

export type Domain =
  | 'app-brain'
  | 'business-operations'
  | 'electrical-skills'
  | 'shared-ui'
  | 'auth'
  | 'data-sync'
  | 'ai-integrations'
  | 'field-operations';

// ============================================================================
// FILE TYPE RULES
// ============================================================================

export interface FileTypeRule {
  id: string;
  fileType: string;
  description: string;
  friction: FrictionLevel;
  validation: string;
  rationale: string;
}

// ============================================================================
// SESSION TYPE RULES
// ============================================================================

export interface SessionTypeRule {
  id: string;
  sessionType: SessionType;
  description: string;
  friction: FrictionLevel;
  rules: string[];
  rationale: string;
}

export type SessionType =
  | 'parallel-wave'
  | 'sequential-merge'
  | 'bug-fix'
  | 'feature-dev'
  | 'emergency';

// ============================================================================
// AGENT RULES
// ============================================================================

export interface AgentRule {
  id: string;
  description: string;
  friction: FrictionLevel;
  action: RuleAction;
  scope?: string[];
  blockedScope?: string[];
}

export interface AgentRuleSet {
  id: string;
  name: string;
  role: string;
  rules: AgentRule[];
}

export type AgentName =
  | 'Claude'
  | 'Codex'
  | 'Cursor'
  | 'Haiku'
  | 'Manual';

export interface AgentCapabilities {
  canModifyProtected: boolean;
  canBypassTypecheck: boolean;
  canMergeToMain: boolean;
  requiresReport: boolean;
}

// ============================================================================
// RULE ACTIONS
// ============================================================================

export type RuleAction =
  | 'prevent_modification'
  | 'allow_modification'
  | 'require_validation'
  | 'require_explicit_staging'
  | 'prevent_npm_install'
  | 'prevent_main_modification'
  | 'log_and_continue'
  | 'require_report'
  | 'require_spec_review'
  | 'require_typecheck'
  | 'require_compatibility_check'
  | 'optional_report'
  | 'allow_local_iteration'
  | 'require_commit'
  | 'require_branch'
  | 'require_push'
  | 'require_pin'
  | 'allow_main_merge';

// ============================================================================
// RULE EVALUATION
// ============================================================================

export interface RuleEvaluationContext {
  agent: AgentName;
  sessionType: SessionType;
  filePath: string;
  action: 'read' | 'write' | 'delete' | 'commit' | 'push';
  timestamp: Date;
}

export interface RuleEvaluationResult {
  allowed: boolean;
  friction: FrictionLevel;
  matchedRules: string[];
  message: string;
  action?: RuleAction;
  requiresApproval?: boolean;
}

// ============================================================================
// CONFLICT RESOLUTION
// ============================================================================

export interface ConflictResolution {
  rule: string;
  example1?: ConflictExample;
  example2?: ConflictExample;
  agentConflict?: AgentConflictResolution;
}

export interface ConflictExample {
  rule1: { id: string; friction: FrictionLevel };
  rule2: { id: string; friction: FrictionLevel };
  result: string;
}

export interface AgentConflictResolution {
  rule: string;
  priority: AgentName[];
  rationale: string;
}

// ============================================================================
// CONFIGURATION & DEFAULTS
// ============================================================================

export interface RulesConfig {
  globalRules: GlobalRulesSet;
  agentRules: Record<AgentName, AgentRuleSet>;
  conflictResolution: ConflictResolution;
  defaults: RulesDefaults;
}

export interface RulesDefaults {
  defaultFriction: FrictionLevel;
  defaultAction: RuleAction;
  agentPriority: AgentName[];
  requireTypecheckOnCommit: boolean;
  requireReportForParallelWaves: boolean;
}

// ============================================================================
// SESSION METADATA
// ============================================================================

export interface SessionMetadata {
  sessionId: string;
  agent: AgentName;
  sessionType: SessionType;
  branch: string;
  startTime: Date;
  rules: RulesConfig;
}

export interface SessionReport {
  sessionId: string;
  agent: AgentName;
  sessionType: SessionType;
  branch: string;
  startTime: Date;
  endTime: Date;
  filesChanged: string[];
  commitHash?: string;
  typecheckResult: 'pass' | 'fail';
  typecheckErrors?: string[];
  canariesUntouched: boolean;
  packageFilesUntouched: boolean;
  sharedContextUntouched: boolean;
  rulesViolations: RuleViolation[];
  summary: string;
}

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  friction: FrictionLevel;
  description: string;
  filePath?: string;
  action?: string;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type RuleMatcher = (
  context: RuleEvaluationContext,
  rule: GlobalRule | AgentRule | DomainRule | FileTypeRule
) => boolean;

export type RuleEvaluator = (
  context: RuleEvaluationContext,
  rules: RulesConfig
) => RuleEvaluationResult;

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isGlobalRule(rule: any): rule is GlobalRule {
  return rule && 'globalRules' in rule;
}

export function isAgentRule(rule: any): rule is AgentRule {
  return rule && 'id' in rule && 'description' in rule && 'friction' in rule;
}

export function isDomainRule(rule: any): rule is DomainRule {
  return rule && 'domain' in rule && 'friction' in rule;
}

export function isFileTypeRule(rule: any): rule is FileTypeRule {
  return rule && 'fileType' in rule && 'validation' in rule;
}

export function isSessionTypeRule(rule: any): rule is SessionTypeRule {
  return rule && 'sessionType' in rule && 'rules' in rule;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const PROTECTED_FILES = [
  'package.json',
  'package-lock.json',
  '.claude/settings.local.json',
  'vite.config.ts',
  'netlify.toml',
  'src/store/authStore.ts',
  'src/services/backupDataService.ts',
];

export const SHARED_CONTEXT_FILES = [
  'solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md',
  'solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md',
  'solarupgrade_agent_context/SOLARUPGRADE_CODEX.md',
  'solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md',
];

export const CANARY_FILES = [
  '.claude/settings.local.json',
  'src/components/v15r/V15rAppBrainTab.tsx',
  'src/components/v15r/V15rAppBrainScene.tsx',
  'src/components/v15r/appBrainMap.ts',
  'src/components/v15r/appBrainFilters.ts',
  'src/components/v15r/generatedAppBrainManifest.ts',
  'scripts/generate-app-brain-manifest.mjs',
  'package.json',
  'package-lock.json',
];

export const SHARED_UI_PROTECTED = [
  'CommandHUD.tsx',
  'NeuralWorldView.tsx',
  'WorldLayers.tsx',
  'SettingsPanel.tsx',
  'index.ts',
];

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

/**
 * Complete type system for App Brain Rules v1
 * 
 * Usage:
 * - Import types for rule definitions
 * - Use type guards to validate rule objects
 * - Apply RuleEvaluator to check if actions are allowed
 * - Use constants for protected/shared files
 * 
 * Philosophy:
 * - Low friction default (silent or warn)
 * - Higher friction wins in conflicts
 * - Agent hierarchy: Manual > Claude > Codex > Cursor > Haiku
 */
