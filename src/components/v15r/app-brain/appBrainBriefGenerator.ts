/**
 * App Brain Agent Brief Generator
 *
 * Pure functional module for generating compact agent briefs.
 *
 * Exports:
 * - buildAgentBrief: Construct full brief from task context
 * - formatAgentBriefMarkdown: Convert brief to markdown
 * - inferDoNotTouchFiles: Infer protected/canary files from domain/agent
 * - inferCanarySuggestions: Generate canary checks based on context
 * - summarizeActiveOverlaps: Analyze domain/file overlaps with active sessions
 *
 * Philosophy: Token-light, deterministic, no side effects
 * No file I/O, no API calls, no live claims
 */

import type {
  AgentSessionBrief,
  BriefGenerationOptions,
  BriefMarkdownOutput,
  InferredProtectionSet,
  InferredCanarySuggestions,
  ActiveOverlapSummary,
  BriefFileReference,
  QAChecklistItem,
  RuleSkillPlaceholder,
  CarnarySuggestion,
  DomainOverlap,
} from './appBrainBriefTypes';
import {
  createEmptyAgentSessionBrief,
  createDefaultQAChecklist,
} from './appBrainBriefTypes';
import type {
  AgentModel,
  SessionDomain,
  RiskLevel,
  LiveWorkSession,
} from './appBrainWorkTypes';

/**
 * Build a complete agent session brief from task and governance context
 *
 * Pure function: no side effects, deterministic output
 */
export function buildAgentBrief(
  briefId: string,
  agent: AgentModel,
  model: string,
  branchName: string,
  taskSummary: string,
  taskDescription: string,
  domain: SessionDomain,
  targetFiles: string[],
  options?: Partial<BriefGenerationOptions>
): AgentSessionBrief {
  const brief = createEmptyAgentSessionBrief(briefId, agent, model, branchName);

  brief.taskSummary = taskSummary;
  brief.taskDescription = taskDescription;
  brief.domain = domain;
  brief.targetFiles = targetFiles;

  // Infer protected files and canary suggestions
  const protectionSet = inferDoNotTouchFiles(domain, agent);
  brief.protectedFiles = protectionSet.protectedFiles;
  brief.canaryFiles = protectionSet.canaryFiles;

  // Infer canary suggestions
  const canaryInference = inferCanarySuggestions(domain, targetFiles);
  brief.canarySuggestions = canaryInference.suggestions;

  // Initialize file classifications based on target files
  brief.touchedFiles = targetFiles.map((file) => ({
    path: file,
    classification: 'touched',
  }));

  // Add default QA checklist
  brief.qaChecklist = createDefaultQAChecklist();

  // Default workflow context
  brief.suggestedCommitMessage = `feat(${domain}): ${taskSummary}`;
  brief.nextAction = 'Execute task and validate typecheck/build';
  brief.expectedOutcome = `Task completion in ${domain} with no protected file mutations`;

  // Isolation boundary inference
  if (domain === 'app-brain-core') {
    brief.isolationBoundary = 'src/components/v15r/app-brain/';
    brief.allowedFilePatterns = ['src/components/v15r/app-brain/**/*.ts'];
  }

  // Risk assessment
  brief.estimatedRiskLevel = assessTaskRisk(domain, targetFiles);

  return brief;
}

/**
 * Format an agent session brief as markdown
 *
 * Deterministic markdown output suitable for documentation and reviews
 */
export function formatAgentBriefMarkdown(brief: AgentSessionBrief): BriefMarkdownOutput {
  const sections: string[] = [];
  let tokenCount = 0;

  // Header
  const header = `# Agent Session Brief
  
**Brief ID**: ${brief.briefId}  
**Agent**: ${brief.agent} (${brief.model})  
**Branch**: \`${brief.branchName}\`  
**Generated**: ${brief.generatedAt}  
`;
  sections.push(header);
  tokenCount += estimateTokens(header);

  // Task
  const taskSection = `## Task

**Summary**: ${brief.taskSummary}

**Description**:
${brief.taskDescription}

**Domain**: ${brief.domain}  
**Target Files**: ${brief.targetFiles.length} files
`;
  sections.push(taskSection);
  tokenCount += estimateTokens(taskSection);

  // Governance
  const govSection = `## Governance

**Isolation Boundary**: ${brief.isolationBoundary || 'Not specified'}

### Protected Files (Do Not Touch)
${brief.protectedFiles.length > 0 ? brief.protectedFiles.map((f) => `- \`${f}\``).join('\n') : 'None'}

### Canary Files (Monitor)
${brief.canaryFiles.length > 0 ? brief.canaryFiles.map((f) => `- \`${f}\``).join('\n') : 'None'}

### Allowed File Patterns
${brief.allowedFilePatterns.length > 0 ? brief.allowedFilePatterns.map((p) => `- \`${p}\``).join('\n') : 'No restrictions'}
`;
  sections.push(govSection);
  tokenCount += estimateTokens(govSection);

  // Files
  const fileSection = `## Files Context

**Touched Files**: ${brief.touchedFiles.length}
${brief.touchedFiles.slice(0, 5).map((f) => `- \`${f.path}\` (${f.classification})`).join('\n')}
${brief.touchedFiles.length > 5 ? `- ... and ${brief.touchedFiles.length - 5} more` : ''}

**Created Files**: ${brief.createdFiles.length}
${brief.createdFiles.map((f) => `- \`${f.path}\``).join('\n')}

**Modified Files**: ${brief.modifiedFiles.length}
${brief.modifiedFiles.map((f) => `- \`${f.path}\``).join('\n')}
`;
  sections.push(fileSection);
  tokenCount += estimateTokens(fileSection);

  // Risk & Overlaps
  const riskSection = `## Risk Assessment

**Estimated Risk Level**: ${brief.estimatedRiskLevel}

**Active Overlaps**: ${brief.activeOverlaps.length}
${brief.activeOverlaps.map((o) => `- ${o.domain} (${o.overlapType}, severity: ${o.severity})`).join('\n') || 'None'}

**Conflicting Branches**: ${brief.conflictingBranches.length}
${brief.conflictingBranches.map((b) => `- \`${b}\``).join('\n') || 'None'}
`;
  sections.push(riskSection);
  tokenCount += estimateTokens(riskSection);

  // Rules & Skills
  const rulesSection = `## Rules & Skills (Placeholders)

**Applicable Rules**: ${brief.applicableRules.length}
${brief.applicableRules.slice(0, 3).map((r) => `- ${r.name} (${r.category})`).join('\n') || 'None'}

**Applicable Skills**: ${brief.applicableSkills.length}
${brief.applicableSkills.slice(0, 3).map((s) => `- ${s.name}`).join('\n') || 'None'}
`;
  sections.push(rulesSection);
  tokenCount += estimateTokens(rulesSection);

  // Canaries
  const canarySection = `## Canary Suggestions

${brief.canarySuggestions.slice(0, 5).map((c) => `- **${c.name}**: Check \`${c.fileOrConfig}\` (${c.checkFrequency})`).join('\n') || 'None'}
`;
  sections.push(canarySection);
  tokenCount += estimateTokens(canarySection);

  // QA Checklist
  const qaSection = `## QA Checklist

${brief.qaChecklist.map((item) => `- [ ] ${item.label}${item.required ? ' *(required)*' : ''}`).join('\n')}
`;
  sections.push(qaSection);
  tokenCount += estimateTokens(qaSection);

  // Workflow
  const workflowSection = `## Workflow

**TypeCheck Required**: ${brief.typecheckRequired ? 'Yes' : 'No'}  
**Build Required**: ${brief.buildRequired ? 'Yes' : 'No'}  

**Expected Outcome**:
${brief.expectedOutcome}

**Suggested Commit Message**:
\`\`\`
${brief.suggestedCommitMessage}
\`\`\`

**Next Action**:
${brief.nextAction}

${brief.blockingIssues ? `**Blocking Issues**:\n${brief.blockingIssues.map((i) => `- ${i}`).join('\n')}` : ''}
`;
  sections.push(workflowSection);
  tokenCount += estimateTokens(workflowSection);

  // Context Updates
  if (brief.contextUpdateRequired.length > 0) {
    const contextSection = `## Context Updates Required

${brief.contextUpdateRequired.map((c) => `- ${c}`).join('\n')}
`;
    sections.push(contextSection);
    tokenCount += estimateTokens(contextSection);
  }

  return {
    content: sections.join('\n'),
    estimatedTokens: tokenCount,
    sections: [
      'Header',
      'Task',
      'Governance',
      'Files',
      'Risk',
      'Rules & Skills',
      'Canaries',
      'QA',
      'Workflow',
      ...(brief.contextUpdateRequired.length > 0 ? ['Context Updates'] : []),
    ],
  };
}

/**
 * Infer protected and canary files based on domain and agent
 *
 * Maps domain + agent combination to expected protection sets
 */
export function inferDoNotTouchFiles(
  domain: SessionDomain,
  agent: AgentModel
): InferredProtectionSet {
  const protectedFiles: string[] = [
    // Global protected files (always)
    'src/store/authStore.ts',
    'netlify.toml',
    'src/services/backupDataService.ts',
    'vite.config.ts',
    'src/components/v15r/charts/SVGCharts.tsx',
    'package.json',
    'package-lock.json',
    '.claude/settings.local.json',
  ];

  const canaryFiles: string[] = [
    'src/index.tsx',
    'src/App.tsx',
  ];

  const rationale: Record<string, string> = {
    'src/store/authStore.ts': 'Auth state protection',
    'netlify.toml': 'Deployment config protection',
    'src/services/backupDataService.ts': 'Data safety protection',
    'vite.config.ts': 'Build config protection',
    'src/components/v15r/charts/SVGCharts.tsx': 'Frozen chart surface',
    'package.json': 'Dependency lock',
    'package-lock.json': 'Dependency lock',
    '.claude/settings.local.json': 'AI settings protection',
    'src/index.tsx': 'App entry point canary',
    'src/App.tsx': 'App root canary',
  };

  // Domain-specific protections
  if (domain === 'app-brain-core') {
    protectedFiles.push(
      'src/components/v15r/V15rAppBrainTab.tsx',
      'src/components/v15r/V15rLayout.tsx',
      'src/components/v15r/V15rAppBrainScene.tsx',
      'src/components/v15r/appBrainMap.ts',
      'src/components/v15r/appBrainFilters.ts',
      'src/components/v15r/generatedAppBrainManifest.ts',
      'src/components/v15r/generatedAppBrainDirectory.ts',
      'src/components/v15r/generatedAppBrainWorkManifest.ts',
      'scripts/generate-app-brain-manifest.mjs',
      'scripts/generate-app-brain-directory.mjs',
      'scripts/generate-app-brain-work-manifest.mjs'
    );
    rationale['src/components/v15r/V15rAppBrainTab.tsx'] = 'Shared UI integration hub';
    rationale['src/components/v15r/appBrainMap.ts'] = 'Core manifest reference';
    rationale['src/components/v15r/generatedAppBrainManifest.ts'] = 'Generated manifest';
  }

  if (domain === 'visual-suite') {
    protectedFiles.push('src/components/v15r/V15rHome.tsx', 'src/components/v15r/ProjectCard.tsx', 'src/components/v15r/V15rProjectInner.tsx', 'src/components/v15r/V15rChangeOrdersTab.tsx', 'src/components/v15r/V15rFieldLogPanel.tsx');
    rationale['src/components/v15r/V15rHome.tsx'] = 'Visual Suite home protected';
  }

  // Agent-specific adjustments
  if (agent === 'Gemini') {
    // Gemini cannot write code, only read
    protectedFiles.push('src/**/*.ts', 'src/**/*.tsx');
  }

  return {
    protectedFiles,
    canaryFiles,
    rationale,
  };
}

/**
 * Infer canary suggestions based on domain and target files
 */
export function inferCanarySuggestions(
  domain: SessionDomain,
  targetFiles: string[]
): InferredCanarySuggestions {
  const suggestions: CarnarySuggestion[] = [];

  // TypeScript/build canaries (always)
  suggestions.push({
    id: 'tsc-check',
    name: 'TypeScript Compilation',
    fileOrConfig: 'tsconfig.json',
    expectedBehavior: 'npx tsc --noEmit must pass',
    checkFrequency: 'build',
    rationale: 'Ensures no type errors are introduced',
  });

  suggestions.push({
    id: 'npm-build',
    name: 'NPM Build Success',
    fileOrConfig: 'package.json',
    expectedBehavior: 'npm run build completes with zero errors',
    checkFrequency: 'build',
    rationale: 'Ensures build system is not broken',
  });

  // Domain-specific canaries
  if (domain === 'app-brain-core') {
    suggestions.push({
      id: 'manifest-integrity',
      name: 'App Brain Manifest Integrity',
      fileOrConfig: 'src/components/v15r/generatedAppBrainManifest.ts',
      expectedBehavior: 'Manifest remains valid and unmodified',
      checkFrequency: 'manual',
      rationale: 'Manifest generation is controlled; changes must be reviewed',
    });

    suggestions.push({
      id: 'protected-files-check',
      name: 'Protected Files Not Touched',
      fileOrConfig: 'git status',
      expectedBehavior: 'V15rAppBrainTab.tsx, V15rLayout.tsx, V15rAppBrainScene.tsx not modified',
      checkFrequency: 'build',
      rationale: 'UI integration happens separately',
    });
  }

  if (domain === 'visual-suite') {
    suggestions.push({
      id: 'render-smoke-test',
      name: 'Visual Suite Render Smoke Test',
      fileOrConfig: 'src/components/v15r/V15rHome.tsx',
      expectedBehavior: 'App loads without console errors',
      checkFrequency: 'runtime',
      rationale: 'Visual Suite is customer-facing',
    });
  }

  // Type inference from target files
  const hasTypesFile = targetFiles.some((f) => f.endsWith('.ts') && f.includes('types'));
  if (hasTypesFile) {
    suggestions.push({
      id: 'type-exports',
      name: 'Type Exports Valid',
      fileOrConfig: 'src/**/*types.ts',
      expectedBehavior: 'All exported types are used or intentional',
      checkFrequency: 'build',
      rationale: 'Unused types waste bundle size',
    });
  }

  const confidenceLevel = suggestions.length >= 3 ? 90 : suggestions.length >= 2 ? 70 : 50;

  return {
    suggestions,
    confidenceLevel,
    rationale: `Inferred ${suggestions.length} canaries based on domain="${domain}" and ${targetFiles.length} target files`,
  };
}

/**
 * Summarize active overlaps with other sessions
 *
 * In a real system, this would query the active sessions manifest.
 * For now, it returns a template structure.
 */
export function summarizeActiveOverlaps(
  currentDomain: SessionDomain,
  currentAgent: AgentModel,
  currentBranch: string,
  activeSessions?: LiveWorkSession[]
): ActiveOverlapSummary {
  const overlaps: DomainOverlap[] = [];

  // Placeholder analysis: if sessions are provided, check for overlaps
  if (activeSessions && activeSessions.length > 0) {
    for (const session of activeSessions) {
      if (session.domain === currentDomain && session.agent !== currentAgent) {
        overlaps.push({
          domain: currentDomain,
          otherAgent: session.agent,
          otherBranch: session.branchName,
          overlapType: 'domain',
          severity: 'medium',
          resolvedHow: 'File-level isolation enforced',
        });
      }
    }
  }

  const overlapsByDomain: Record<string, number> = {};
  const overlapsBySeverity: Record<RiskLevel, number> = {
    none: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const overlap of overlaps) {
    overlapsByDomain[overlap.domain] = (overlapsByDomain[overlap.domain] || 0) + 1;
    overlapsBySeverity[overlap.severity]++;
  }

  const conflictingAgents = Array.from(
    new Set(overlaps.map((o) => o.otherAgent))
  );

  let resolutionRecommendation = 'No overlaps detected; proceed with execution.';
  if (overlaps.length > 0) {
    resolutionRecommendation =
      `${overlaps.length} overlap(s) detected. Ensure file-level isolation boundaries are enforced. Coordinate with ${conflictingAgents.join(', ')}.`;
  }

  return {
    totalActiveOverlaps: overlaps.length,
    overlapsByDomain,
    overlapsBySeverity,
    conflictingAgents,
    resolutionRecommendation,
  };
}

/**
 * Assess task risk level based on domain and touched files
 *
 * Pure logic, deterministic
 */
function assessTaskRisk(
  domain: SessionDomain,
  targetFiles: string[]
): RiskLevel {
  // App Brain core is lower risk (isolated)
  if (domain === 'app-brain-core') {
    return 'low';
  }

  // Visual Suite is higher risk (customer-facing)
  if (domain === 'visual-suite') {
    return 'medium';
  }

  // Auth/Security is critical
  if (domain === 'auth-security') {
    return 'critical';
  }

  // Check if touching core services
  const touchingCore = targetFiles.some((f) =>
    f.includes('src/services/') && !f.includes('app-brain')
  );
  if (touchingCore) {
    return 'medium';
  }

  return 'low';
}

/**
 * Estimate token count for a string (rough approximation)
 *
 * Uses 4-character average token length
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
