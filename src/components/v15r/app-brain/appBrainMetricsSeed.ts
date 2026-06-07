/**
 * App Brain Metrics Registry - Seed Data
 * 
 * Provides initial data structure and helper functions for the Metrics Registry.
 * Seeds empty metrics containers and utility functions for tracking AI development efficiency.
 */

import {
  DevSession,
  DomainMetrics,
  MetricsSummary,
  ModelDomain,
  AIModel,
  SessionStatus,
  SessionOutcome,
} from './appBrainMetricsTypes';

/**
 * Domain display names and descriptions
 */
export const DOMAIN_INFO: Record<ModelDomain, { displayName: string; description: string }> = {
  'core-shell': {
    displayName: 'Core Shell',
    description: 'Core app shell and layout components',
  },
  'home': {
    displayName: 'Home',
    description: 'Home page and dashboard features',
  },
  'projects': {
    displayName: 'Projects',
    description: 'Project list and management',
  },
  'project-inner': {
    displayName: 'Project Inner',
    description: 'Project detail and inner components',
  },
  'estimate': {
    displayName: 'Estimate',
    description: 'Estimate and quote generation',
  },
  'material-takeoff': {
    displayName: 'Material Takeoff',
    description: 'Material calculations and takeoff',
  },
  'field-logs': {
    displayName: 'Field Logs',
    description: 'Field logging and time tracking',
  },
  'graph-dashboard': {
    displayName: 'Graph Dashboard',
    description: 'Data visualization and charts',
  },
  'money': {
    displayName: 'Money',
    description: 'Financial tracking and reporting',
  },
  'settings': {
    displayName: 'Settings',
    description: 'User settings and preferences',
  },
  'blueprint-pdf': {
    displayName: 'Blueprint PDF',
    description: 'PDF blueprint handling and display',
  },
  'price-book': {
    displayName: 'Price Book',
    description: 'Price book management',
  },
  'leads-sales': {
    displayName: 'Leads & Sales',
    description: 'Lead tracking and sales pipeline',
  },
  'ai-nexus': {
    displayName: 'AI Nexus',
    description: 'AI integration and automation',
  },
  'admin-app-brain': {
    displayName: 'Admin App Brain',
    description: 'Admin control tower and monitoring',
  },
  'sync-persistence': {
    displayName: 'Sync & Persistence',
    description: 'Data synchronization and storage',
  },
  'integrations': {
    displayName: 'Integrations',
    description: 'Third-party integrations',
  },
  'other': {
    displayName: 'Other',
    description: 'Miscellaneous domains',
  },
};

/**
 * Create an empty DomainMetrics record for initialization
 */
export function createEmptyDomainMetrics(domain: ModelDomain): DomainMetrics {
  const info = DOMAIN_INFO[domain];
  return {
    domain,
    displayName: info.displayName,
    totalSessions: 0,
    successfulSessions: 0,
    blockedSessions: 0,
    repassSessions: 0,
    totalRepassCount: 0,
    avgDurationMinutes: undefined,
    typecheckPassRate: 1.0,
    buildPassRate: 1.0,
    totalFilesTouched: 0,
    mostTouchedFiles: [],
    modelUsage: {
      'claude-3-5-sonnet': 0,
      'claude-3-5-haiku': 0,
      'other': 0,
    },
    avgContextResetsPerSession: 0,
    period: `week-${getCurrentWeekString()}`,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Create an empty MetricsSummary for the current period
 */
export function createEmptyMetricsSummary(): MetricsSummary {
  const domains: Record<ModelDomain, DomainMetrics> = {} as any;
  const domainKeys = Object.keys(DOMAIN_INFO) as ModelDomain[];

  domainKeys.forEach((domain) => {
    domains[domain] = createEmptyDomainMetrics(domain);
  });

  return {
    metadata: {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      period: `week-${getCurrentWeekString()}`,
      totalSessions: 0,
      completedSessions: 0,
      blockedSessions: 0,
    },
    domains,
    summary: {
      overallTypecheckRate: 1.0,
      overallBuildRate: 1.0,
      totalFilesTouched: 0,
      avgDurationMinutes: undefined,
      modelDistribution: {
        'claude-3-5-sonnet': 0,
        'claude-3-5-haiku': 0,
        'other': 0,
      },
      byStatus: {
        'in-progress': 0,
        'completed': 0,
        'blocked': 0,
        'repass': 0,
      },
      byOutcome: {
        'success': 0,
        'partial': 0,
        'blocked': 0,
        'repass-required': 0,
      },
      avgRepassesPerBlockedSession: 0,
      avgContextResetsPerSession: 0,
    },
    sessions: [],
  };
}

/**
 * Calculate current week identifier (ISO week format)
 */
export function getCurrentWeekString(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const weekNumber = Math.ceil((dayOfYear + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-w${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Calculate session duration in minutes from start and end times
 */
export function calculateSessionDuration(startTime: string, endTime: string): number {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  return Math.round((end - start) / (1000 * 60));
}

/**
 * Aggregate metrics from multiple sessions
 */
export function aggregateSessionsToMetrics(
  domain: ModelDomain,
  sessions: DevSession[]
): DomainMetrics {
  const info = DOMAIN_INFO[domain];
  const domainSessions = sessions.filter((s) => s.domain === domain);

  if (domainSessions.length === 0) {
    return createEmptyDomainMetrics(domain);
  }

  const successful = domainSessions.filter((s) => s.outcome === 'success').length;
  const blocked = domainSessions.filter((s) => s.status === 'blocked').length;
  const repass = domainSessions.filter((s) => s.status === 'repass').length;
  const totalRepassCount = domainSessions.reduce((sum, s) => sum + s.repassCount, 0);

  const typecheckPassing = domainSessions.filter((s) => s.typecheckPass).length;
  const buildPassing = domainSessions.filter((s) => s.buildPass).length;

  const allFilesChanged = domainSessions.flatMap((s) => s.filesChanged);
  const fileFrequency: Record<string, number> = {};
  allFilesChanged.forEach((file) => {
    fileFrequency[file] = (fileFrequency[file] || 0) + 1;
  });
  const mostTouchedFiles = Object.entries(fileFrequency)
    .map(([filePath, count]) => ({ filePath, modificationCount: count }))
    .sort((a, b) => b.modificationCount - a.modificationCount)
    .slice(0, 5);

  const modelUsage: Record<AIModel, number> = {
    'claude-3-5-sonnet': 0,
    'claude-3-5-haiku': 0,
    'other': 0,
  };
  domainSessions.forEach((s) => {
    modelUsage[s.model]++;
  });

  const totalContextResets = domainSessions.reduce((sum, s) => sum + s.contextResetCount, 0);
  const avgContextResetsPerSession = totalContextResets / domainSessions.length;

  const durations = domainSessions
    .filter((s) => s.durationMinutes !== undefined)
    .map((s) => s.durationMinutes as number);
  const avgDurationMinutes = durations.length > 0
    ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
    : undefined;

  return {
    domain,
    displayName: info.displayName,
    totalSessions: domainSessions.length,
    successfulSessions: successful,
    blockedSessions: blocked,
    repassSessions: repass,
    totalRepassCount,
    avgDurationMinutes,
    typecheckPassRate: domainSessions.length > 0 ? typecheckPassing / domainSessions.length : 1.0,
    buildPassRate: domainSessions.length > 0 ? buildPassing / domainSessions.length : 1.0,
    totalFilesTouched: new Set(allFilesChanged).size,
    mostTouchedFiles,
    modelUsage,
    avgContextResetsPerSession,
    period: `week-${getCurrentWeekString()}`,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Calculate overall metrics summary from all sessions
 */
export function calculateMetricsSummary(sessions: DevSession[]): MetricsSummary {
  const domains: Record<ModelDomain, DomainMetrics> = {} as any;
  const domainKeys = Object.keys(DOMAIN_INFO) as ModelDomain[];

  let totalTypecheckPass = 0;
  let totalBuildPass = 0;
  let totalSessions = sessions.length;

  domainKeys.forEach((domain) => {
    domains[domain] = aggregateSessionsToMetrics(domain, sessions);
  });

  sessions.forEach((s) => {
    if (s.typecheckPass) totalTypecheckPass++;
    if (s.buildPass) totalBuildPass++;
  });

  const allFilesChanged = sessions.flatMap((s) => s.filesChanged);
  const totalFilesTouched = new Set(allFilesChanged).size;

  const totalContextResets = sessions.reduce((sum, s) => sum + s.contextResetCount, 0);
  const avgContextResetsPerSession = totalSessions > 0 ? totalContextResets / totalSessions : 0;

  const modelDistribution: Record<AIModel, number> = {
    'claude-3-5-sonnet': 0,
    'claude-3-5-haiku': 0,
    'other': 0,
  };
  sessions.forEach((s) => {
    modelDistribution[s.model]++;
  });

  const statusCounts: Record<SessionStatus, number> = {
    'in-progress': 0,
    'completed': 0,
    'blocked': 0,
    'repass': 0,
  };
  sessions.forEach((s) => {
    statusCounts[s.status]++;
  });

  const outcomeCounts: Record<SessionOutcome, number> = {
    'success': 0,
    'partial': 0,
    'blocked': 0,
    'repass-required': 0,
  };
  sessions.forEach((s) => {
    outcomeCounts[s.outcome]++;
  });

  const blockedSessions = sessions.filter((s) => s.status === 'blocked');
  const avgRepassesPerBlockedSession = blockedSessions.length > 0
    ? blockedSessions.reduce((sum, s) => sum + s.repassCount, 0) / blockedSessions.length
    : 0;

  const completedSessions = sessions.filter((s) => s.status === 'completed').length;
  const blockedSessionCount = blockedSessions.length;

  return {
    metadata: {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      period: `week-${getCurrentWeekString()}`,
      totalSessions,
      completedSessions,
      blockedSessions: blockedSessionCount,
    },
    domains,
    summary: {
      overallTypecheckRate: totalSessions > 0 ? totalTypecheckPass / totalSessions : 1.0,
      overallBuildRate: totalSessions > 0 ? totalBuildPass / totalSessions : 1.0,
      totalFilesTouched,
      avgDurationMinutes: undefined,
      modelDistribution,
      byStatus: statusCounts,
      byOutcome: outcomeCounts,
      avgRepassesPerBlockedSession,
      avgContextResetsPerSession,
    },
    sessions,
  };
}

/**
 * Helper to create a new DevSession with defaults
 */
export function createDevSession(
  sessionId: string,
  domain: ModelDomain,
  feature: string,
  model: AIModel,
  startTime: string,
  endTime: string,
  overrides?: Partial<DevSession>
): DevSession {
  return {
    sessionId,
    domain,
    feature,
    model,
    status: 'in-progress',
    outcome: 'success',
    repassCount: 0,
    filesChanged: [],
    fileCount: 0,
    startTime,
    endTime,
    durationMinutes: calculateSessionDuration(startTime, endTime),
    typecheckPass: true,
    buildPass: true,
    tsErrorCount: 0,
    contextResetCount: 0,
    ...overrides,
  };
}

/**
 * Sample seed sessions for testing and reference
 */
export const SAMPLE_SESSIONS: DevSession[] = [
  {
    sessionId: 'sess-20240607-001',
    domain: 'admin-app-brain',
    feature: 'Metrics QA Foundations',
    model: 'claude-3-5-haiku',
    status: 'completed',
    outcome: 'success',
    repassCount: 0,
    filesChanged: [
      'src/components/v15r/app-brain/appBrainMetricsTypes.ts',
      'src/components/v15r/app-brain/appBrainQaGateTypes.ts',
      'src/components/v15r/app-brain/appBrainMetricsSeed.ts',
    ],
    fileCount: 3,
    startTime: '2024-06-07T06:00:00Z',
    endTime: '2024-06-07T06:45:00Z',
    durationMinutes: 45,
    typecheckPass: true,
    buildPass: true,
    tsErrorCount: 0,
    contextResetCount: 1,
    notes: 'Initial draft of metrics and QA gate foundations',
    commitHash: 'abc123def456',
    taskGroup: 'appbrain-w02-a5',
  },
];
