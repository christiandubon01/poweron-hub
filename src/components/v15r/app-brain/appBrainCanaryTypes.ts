/**
 * appBrainCanaryTypes.ts
 * 
 * Canary scope checking model for App Brain Wave 03 parallel agent work.
 * 
 * Defines types and interfaces for:
 * - Scope boundary checking
 * - Protected file detection
 * - Package file guards
 * - Shared context guards
 * - Canary status reporting
 */

/**
 * File classification for scope canary model
 */
export type FileScopeType = 'allowed' | 'protected' | 'shared_context' | 'package' | 'unknown';

/**
 * Severity level for canary checks
 */
export type CanarySeverity = 'clean' | 'warning' | 'critical';

/**
 * Single file scope check result
 */
export interface FileCanaryCheck {
  filePath: string;
  scopeType: FileScopeType;
  isTouched: boolean;
  severity: CanarySeverity;
  reason?: string;
}

/**
 * Protected file definition
 */
export interface ProtectedFile {
  path: string;
  reason: 'package_management' | 'auth_config' | 'build_config' | 'shared_context' | 'core_ui' | 'backup_service';
  category: string;
}

/**
 * Allowed file scope definition
 */
export interface AllowedScope {
  pattern: string; // glob or exact path
  description: string;
  category: string;
}

/**
 * Canary scope plan summary
 */
export interface CanaryScopePlan {
  sessionId: string;
  agentName: string;
  branch: string;
  allowedFiles: AllowedScope[];
  protectedFiles: ProtectedFile[];
  sharedContextFiles: ProtectedFile[];
  packageFiles: ProtectedFile[];
  summary: CanarySummary;
}

/**
 * Comprehensive canary status report
 */
export interface CanaryStatus {
  timestamp: string;
  branch: string;
  totalFilesChecked: number;
  filesAllowed: number;
  filesProtected: number;
  filesTouched: number;
  violations: FileCanaryCheck[];
  warnings: FileCanaryCheck[];
  cleanFiles: FileCanaryCheck[];
  overallSeverity: CanarySeverity;
  packageFilesIntact: boolean;
  sharedContextIntact: boolean;
  recommendation: string;
}

/**
 * Brief canary summary for quick review
 */
export interface CanarySummary {
  allowedCount: number;
  protectedCount: number;
  packageGuardsActive: boolean;
  sharedContextGuardsActive: boolean;
  status: 'ready' | 'drift_detected' | 'violation_critical';
}

/**
 * Drift detection result
 */
export interface ScopeDriftReport {
  hasDrift: boolean;
  driftedFiles: FileCanaryCheck[];
  driftReason: string;
  severity: CanarySeverity;
}

/**
 * File recommendations for canary model
 */
export interface CanaryFileRecommendation {
  action: 'create' | 'modify' | 'verify' | 'skip';
  file: string;
  reason: string;
  estimatedScope: 'allowed' | 'protected';
}

/**
 * Scope overlap warning for multi-agent coordination
 */
export interface ScopeOverlapWarning {
  file: string;
  assignedAgent: string;
  currentAgent: string;
  severity: CanarySeverity;
  recommendation: string;
}

/**
 * Wave-specific canary metadata
 */
export interface WaveCanaryContext {
  waveId: string;
  waveType: 'parallel' | 'sequential' | 'merge';
  agentRole: 'build_worker' | 'integration_worker' | 'merge_coordinator';
  isolationLevel: 'full' | 'scoped' | 'collaborative';
  expectedTouches: string[]; // Files this agent is expected to touch
  mustNotTouch: string[]; // Files absolutely protected
  allowedPatterns: string[]; // File patterns allowed to modify
}
