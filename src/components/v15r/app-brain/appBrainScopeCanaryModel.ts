/**
 * appBrainScopeCanaryModel.ts
 * 
 * Pure helper functions for App Brain canary scope checking.
 * 
 * This model provides low-friction scope validation:
 * - clean: quiet operation
 * - dirty: warning flags  
 * - severe: requires owner review
 * 
 * No hooks. No blocking behavior. No UI integration.
 */

import {
  FileCanaryCheck,
  ProtectedFile,
  AllowedScope,
  CanaryScopePlan,
  CanaryStatus,
  ScopeDriftReport,
  CanaryFileRecommendation,
  ScopeOverlapWarning,
  WaveCanaryContext,
  CanarySummary,
  FileScopeType,
  CanarySeverity,
} from './appBrainCanaryTypes';

/**
 * Wave 03 Hard Canaries - Files that MUST NOT be modified
 */
const WAVE03_PROTECTED_FILES: ProtectedFile[] = [
  // Package management
  { path: 'package.json', reason: 'package_management', category: 'core_dependency' },
  { path: 'package-lock.json', reason: 'package_management', category: 'core_dependency' },
  
  // Auth & Config
  { path: '.claude/settings.local.json', reason: 'auth_config', category: 'local_settings' },
  { path: 'src/store/authStore.ts', reason: 'auth_config', category: 'auth_system' },
  
  // Build config
  { path: 'vite.config.ts', reason: 'build_config', category: 'build_system' },
  { path: 'netlify.toml', reason: 'build_config', category: 'deployment' },
  
  // Backup service
  { path: 'src/services/backupDataService.ts', reason: 'backup_service', category: 'core_service' },
  
  // Shared context files
  { path: 'solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md', reason: 'shared_context', category: 'shared_docs' },
  { path: 'solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md', reason: 'shared_context', category: 'shared_docs' },
  { path: 'solarupgrade_agent_context/SOLARUPGRADE_CODEX.md', reason: 'shared_context', category: 'shared_docs' },
  { path: 'solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md', reason: 'shared_context', category: 'shared_docs' },
];

/**
 * Wave 03 Core UI Files - App Brain architecture control only
 */
const WAVE03_CORE_UI_FILES: ProtectedFile[] = [
  { path: 'src/components/v15r/V15rAppBrainTab.tsx', reason: 'core_ui', category: 'app_brain_core' },
  { path: 'src/components/v15r/V15rLayout.tsx', reason: 'core_ui', category: 'app_brain_core' },
  { path: 'src/components/v15r/V15rAppBrainScene.tsx', reason: 'core_ui', category: 'app_brain_core' },
  { path: 'src/components/v15r/appBrainMap.ts', reason: 'core_ui', category: 'app_brain_core' },
  { path: 'src/components/v15r/appBrainFilters.ts', reason: 'core_ui', category: 'app_brain_core' },
  
  // Generated manifests
  { path: 'src/components/v15r/generatedAppBrainManifest.ts', reason: 'core_ui', category: 'generated' },
  { path: 'src/components/v15r/generatedAppBrainDirectory.ts', reason: 'core_ui', category: 'generated' },
  { path: 'src/components/v15r/generatedAppBrainWorkManifest.ts', reason: 'core_ui', category: 'generated' },
  
  // Generator scripts
  { path: 'scripts/generate-app-brain-manifest.mjs', reason: 'core_ui', category: 'build_scripts' },
  { path: 'scripts/generate-app-brain-directory.mjs', reason: 'core_ui', category: 'build_scripts' },
  { path: 'scripts/generate-app-brain-work-manifest.mjs', reason: 'core_ui', category: 'build_scripts' },
];

/**
 * Wave 03 Secondary UI & Component Files - Shared but stable
 */
const WAVE03_SECONDARY_UI_FILES: ProtectedFile[] = [
  { path: 'src/components/v15r/V15rHome.tsx', reason: 'core_ui', category: 'ui_component' },
  { path: 'src/components/v15r/ProjectCard.tsx', reason: 'core_ui', category: 'ui_component' },
  { path: 'src/components/v15r/V15rProjectInner.tsx', reason: 'core_ui', category: 'ui_component' },
  { path: 'src/components/v15r/V15rChangeOrdersTab.tsx', reason: 'core_ui', category: 'ui_component' },
  { path: 'src/components/v15r/V15rFieldLogPanel.tsx', reason: 'core_ui', category: 'ui_component' },
  { path: 'src/components/v15r/V15rEstimateTab.tsx', reason: 'core_ui', category: 'ui_component' },
];

/**
 * Wave 03-A4 HAIKU APPBRAIN Scope - Only canary files allowed
 */
const WAVE03_A4_ALLOWED_SCOPE: AllowedScope[] = [
  {
    pattern: 'src/components/v15r/app-brain/appBrainCanaryTypes.ts',
    description: 'Canary type definitions for scope checking',
    category: 'canary_model',
  },
  {
    pattern: 'src/components/v15r/app-brain/appBrainScopeCanaryModel.ts',
    description: 'Canary scope checking model and helpers',
    category: 'canary_model',
  },
  {
    pattern: 'solarupgrade_agent_context/app_brain_session_reports/HAIKU_APPBRAIN_WAVE03_A4_CANARY_SCOPE_CHECKER.md',
    description: 'Isolated session report - no shared context mutation',
    category: 'session_report',
  },
];

/**
 * Classify a file's scope type
 */
export function classifyFileScope(filePath: string): FileScopeType {
  // Check protected files
  if (WAVE03_PROTECTED_FILES.some(f => f.path === filePath)) {
    return 'protected';
  }
  
  // Check core UI files
  if (WAVE03_CORE_UI_FILES.some(f => f.path === filePath)) {
    return 'protected';
  }
  
  // Check secondary UI files
  if (WAVE03_SECONDARY_UI_FILES.some(f => f.path === filePath)) {
    return 'protected';
  }
  
  // Check allowed scope
  if (WAVE03_A4_ALLOWED_SCOPE.some(a => a.pattern === filePath)) {
    return 'allowed';
  }
  
  // Check package files
  if (['package.json', 'package-lock.json'].includes(filePath)) {
    return 'package';
  }
  
  // Check shared context files
  if (filePath.startsWith('solarupgrade_agent_context/') && 
      !filePath.includes('app_brain_session_reports/')) {
    return 'shared_context';
  }
  
  return 'unknown';
}

/**
 * Build a scope canary plan for a wave session
 */
export function buildScopeCanaryPlan(
  sessionId: string,
  agentName: string,
  branch: string,
): CanaryScopePlan {
  return {
    sessionId,
    agentName,
    branch,
    allowedFiles: WAVE03_A4_ALLOWED_SCOPE,
    protectedFiles: [
      ...WAVE03_PROTECTED_FILES,
      ...WAVE03_CORE_UI_FILES,
      ...WAVE03_SECONDARY_UI_FILES,
    ],
    sharedContextFiles: WAVE03_PROTECTED_FILES.filter(f => f.reason === 'shared_context'),
    packageFiles: WAVE03_PROTECTED_FILES.filter(f => f.reason === 'package_management'),
    summary: {
      allowedCount: WAVE03_A4_ALLOWED_SCOPE.length,
      protectedCount: WAVE03_PROTECTED_FILES.length +
        WAVE03_CORE_UI_FILES.length +
        WAVE03_SECONDARY_UI_FILES.length,
      packageGuardsActive: true,
      sharedContextGuardsActive: true,
      status: 'ready',
    },
  };
}

/**
 * Check if a file is protected
 */
export function checkProtectedFiles(filePath: string): FileCanaryCheck {
  const scopeType = classifyFileScope(filePath);
  
  let severity: CanarySeverity = 'clean';
  let reason: string | undefined;
  
  if (scopeType === 'protected') {
    severity = 'critical';
    reason = `File is protected and must not be modified in this scope`;
  } else if (scopeType === 'package') {
    severity = 'critical';
    reason = `Package file - package management changes blocked`;
  } else if (scopeType === 'shared_context') {
    severity = 'critical';
    reason = `Shared context file - cannot be modified in isolated wave`;
  }
  
  return {
    filePath,
    scopeType,
    isTouched: false,
    severity,
    reason,
  };
}

/**
 * Check for scope drift from allowed files
 */
export function checkScopeDrift(
  changedFiles: string[],
  allowedFiles: AllowedScope[],
): ScopeDriftReport {
  const allowedPatterns = allowedFiles.map(f => f.pattern);
  const driftedFiles: FileCanaryCheck[] = [];
  
  for (const file of changedFiles) {
    if (!allowedPatterns.includes(file)) {
      const check = checkProtectedFiles(file);
      if (check.severity !== 'clean') {
        driftedFiles.push({
          ...check,
          isTouched: true,
        });
      }
    }
  }
  
  const hasDrift = driftedFiles.length > 0;
  const severity: CanarySeverity = hasDrift ? 'critical' : 'clean';
  
  return {
    hasDrift,
    driftedFiles,
    driftReason: hasDrift
      ? `Found ${driftedFiles.length} files outside allowed scope`
      : 'All changes within allowed scope',
    severity,
  };
}

/**
 * Recommend files for canary model scope
 */
export function recommendCanaryFiles(): CanaryFileRecommendation[] {
  return [
    {
      action: 'create',
      file: 'src/components/v15r/app-brain/appBrainCanaryTypes.ts',
      reason: 'Canary type definitions - core model contract',
      estimatedScope: 'allowed',
    },
    {
      action: 'create',
      file: 'src/components/v15r/app-brain/appBrainScopeCanaryModel.ts',
      reason: 'Canary scope checking helpers and pure functions',
      estimatedScope: 'allowed',
    },
    {
      action: 'create',
      file: 'solarupgrade_agent_context/app_brain_session_reports/HAIKU_APPBRAIN_WAVE03_A4_CANARY_SCOPE_CHECKER.md',
      reason: 'Isolated session report - Wave 03 A4 checkpoint',
      estimatedScope: 'allowed',
    },
    {
      action: 'skip',
      file: '.claude/settings.local.json',
      reason: 'Protected local settings file',
      estimatedScope: 'protected',
    },
    {
      action: 'skip',
      file: 'package.json',
      reason: 'Protected package management',
      estimatedScope: 'protected',
    },
    {
      action: 'skip',
      file: 'src/components/v15r/V15rAppBrainTab.tsx',
      reason: 'Core UI integration - handled in merge wave',
      estimatedScope: 'protected',
    },
  ];
}

/**
 * Summarize canary status for quick review
 */
export function summarizeCanaryStatus(
  branch: string,
  changedFiles: string[],
  plan: CanaryScopePlan,
): CanaryStatus {
  const drift = checkScopeDrift(changedFiles, plan.allowedFiles);
  const violations: FileCanaryCheck[] = [];
  const warnings: FileCanaryCheck[] = [];
  const cleanFiles: FileCanaryCheck[] = [];
  
  for (const file of changedFiles) {
    const check = checkProtectedFiles(file);
    if (check.severity === 'critical') {
      violations.push({ ...check, isTouched: true });
    } else if (check.severity === 'warning') {
      warnings.push({ ...check, isTouched: true });
    } else {
      cleanFiles.push({ ...check, isTouched: true });
    }
  }
  
  const overallSeverity: CanarySeverity =
    violations.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'clean';
  
  const recommendation =
    overallSeverity === 'critical'
      ? 'OWNER REVIEW REQUIRED: Protected files were modified'
      : overallSeverity === 'warning'
        ? 'Review warnings before committing'
        : 'Canary check passed - ready for staging';
  
  return {
    timestamp: new Date().toISOString(),
    branch,
    totalFilesChecked: changedFiles.length,
    filesAllowed: cleanFiles.length,
    filesProtected: plan.protectedFiles.length,
    filesTouched: changedFiles.length,
    violations,
    warnings,
    cleanFiles,
    overallSeverity,
    packageFilesIntact: !violations.some(v => v.scopeType === 'package'),
    sharedContextIntact: !violations.some(v => v.scopeType === 'shared_context'),
    recommendation,
  };
}

/**
 * Check for scope overlaps between agents (coordination helper)
 */
export function checkScopeOverlap(
  currentAgent: string,
  currentFiles: string[],
  assignedScopes: Record<string, string[]>,
): ScopeOverlapWarning[] {
  const warnings: ScopeOverlapWarning[] = [];
  
  for (const [agent, files] of Object.entries(assignedScopes)) {
    if (agent === currentAgent) continue;
    
    const overlap = currentFiles.filter(f => files.includes(f));
    
    for (const file of overlap) {
      warnings.push({
        file,
        assignedAgent: agent,
        currentAgent,
        severity: 'critical',
        recommendation: `Coordinate with ${agent} before modifying ${file}`,
      });
    }
  }
  
  return warnings;
}

/**
 * Validate wave context against current state
 */
export function validateWaveContext(
  context: WaveCanaryContext,
  changedFiles: string[],
): { isValid: boolean; violations: string[] } {
  const violations: string[] = [];
  
  for (const file of changedFiles) {
    if (context.mustNotTouch.includes(file)) {
      violations.push(`File ${file} is in mustNotTouch list`);
    }
  }
  
  const isValid = violations.length === 0;
  
  return { isValid, violations };
}
