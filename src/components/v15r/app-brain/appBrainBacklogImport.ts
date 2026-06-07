/**
 * App Brain Backlog Import & Classification Helpers
 * 
 * Provides deterministic helper functions for importing and classifying backlog items.
 * This module enables automated task normalization, domain inference, risk assessment,
 * priority calculation, and backlog grouping.
 * 
 * No UI integration. No live claims. No financial values.
 * Pure functional helpers for backlog processing.
 * 
 * Design: Functions are stateless and deterministic.
 * Extensibility: Can be chained for multi-stage classification pipelines.
 */

import type {
  BacklogTask,
  TaskDomain,
  TaskPriority,
  TaskStatus,
  RiskLevel,
  DomainBucket,
} from './appBrainBacklogTypes'

/**
 * Normalize a task title for consistent presentation and matching.
 * 
 * Rules:
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Remove leading/trailing punctuation
 * - Preserve case
 * 
 * @param title Raw task title
 * @returns Normalized title
 */
export function normalizeTaskTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
}

/**
 * Infer domain from task title and description using keyword matching.
 * 
 * Matching strategy:
 * - Case-insensitive keyword search
 * - Domain-specific term mapping
 * - Fallback to 'admin-app-brain' if no match
 * 
 * Supported domains:
 * - core-shell: app shell, layout, routing, initialization
 * - home: dashboard, home, overview, quick access
 * - projects: projects, project list, creation
 * - project-inner: project detail, tabs, inner navigation
 * - estimate: estimating, pricing, proposal, calculation
 * - material-takeoff: material, takeoff, MTO, parts list
 * - field-logs: field, service call, time tracking, logging
 * - graph-dashboard: chart, graph, dashboard, analytics, reporting
 * - money: financial, payment, income, accounting, money
 * - settings: settings, preferences, configuration, profile
 * - blueprint-pdf: blueprint, PDF, document, annotation, drawing
 * - price-book: price book, labor rate, pricing, cost
 * - leads-sales: lead, sales, pipeline, opportunity, customer
 * - ai-nexus: AI, NEXUS, CrewAI, automation, intelligent
 * - admin-app-brain: admin, control tower, backlog, registry, system
 * - sync-persistence: sync, persistence, storage, backup, data
 * - integrations: integration, API, webhook, external, third-party
 * 
 * @param title Task title (normalized recommended)
 * @param description Optional detailed description
 * @returns Inferred task domain
 */
export function inferBacklogDomain(title: string, description?: string): TaskDomain {
  const searchText = [title, description].filter(Boolean).join(' ').toLowerCase()

  // Domain keyword mappings (ordered by specificity)
  const domainKeywords: Record<TaskDomain, string[]> = {
    'core-shell': ['shell', 'layout', 'routing', 'init', 'initialization', 'app-shell', 'root', 'core'],
    'home': ['home', 'dashboard', 'overview', 'quick access', 'home dashboard', 'landing'],
    'projects': ['project', 'project list', 'project creation', 'project management', 'projects tab'],
    'project-inner': ['project detail', 'project inner', 'project tabs', 'inner project', 'sub-workflow'],
    'estimate': ['estimate', 'estimating', 'pricing', 'proposal', 'calculation', 'quote', 'bid'],
    'material-takeoff': ['material', 'takeoff', 'mto', 'parts list', 'parts', 'bill of material'],
    'field-logs': ['field', 'service call', 'time tracking', 'logging', 'field log', 'work log'],
    'graph-dashboard': ['chart', 'graph', 'dashboard', 'analytics', 'reporting', 'visualization', 'svg'],
    'money': ['financial', 'payment', 'income', 'accounting', 'money', 'revenue', 'expenses'],
    'settings': ['settings', 'preferences', 'configuration', 'profile', 'config', 'user settings'],
    'blueprint-pdf': ['blueprint', 'pdf', 'document', 'annotation', 'drawing', 'image', 'attachment'],
    'price-book': ['price book', 'labor rate', 'pricing', 'cost', 'rate'],
    'leads-sales': ['lead', 'sales', 'pipeline', 'opportunity', 'customer', 'prospect'],
    'ai-nexus': ['ai', 'nexus', 'crewai', 'automation', 'intelligent', 'ml', 'machine learning'],
    'admin-app-brain': ['admin', 'control tower', 'backlog', 'registry', 'system', 'brain'],
    'sync-persistence': ['sync', 'persistence', 'storage', 'backup', 'data sync', 'cache'],
    'integrations': ['integration', 'api', 'webhook', 'external', 'third-party', 'connect'],
  }

  // Score each domain based on keyword matches
  let bestDomain: TaskDomain = 'admin-app-brain'
  let bestScore = 0

  for (const [domain, keywords] of Object.entries(domainKeywords) as [TaskDomain, string[]][]) {
    const score = keywords.filter(kw => searchText.includes(kw)).length
    if (score > bestScore) {
      bestScore = score
      bestDomain = domain
    }
  }

  return bestDomain
}

/**
 * Infer risk level from task characteristics.
 * 
 * Risk factors:
 * - Critical/high priority → higher risk baseline
 * - Keywords suggesting complexity: "refactor", "migration", "redesign", "large", "complex"
 * - Keywords suggesting stability concerns: "breaking change", "public API", "shared", "critical"
 * - Keywords suggesting safety: "test", "validation", "isolated", "simple", "small"
 * 
 * @param title Task title
 * @param priority Task priority
 * @param description Optional detailed description
 * @returns Inferred risk level
 */
export function inferBacklogRisk(
  title: string,
  priority: TaskPriority,
  description?: string,
): RiskLevel {
  const searchText = [title, description].filter(Boolean).join(' ').toLowerCase()

  // Start with base risk from priority
  let riskScore = 0
  if (priority === 'critical') riskScore += 3
  else if (priority === 'high') riskScore += 2
  else if (priority === 'medium') riskScore += 1

  // Check for complexity indicators
  const complexityKeywords = ['refactor', 'migration', 'redesign', 'large', 'complex', 'rewrite', 'restructure']
  riskScore += complexityKeywords.filter(kw => searchText.includes(kw)).length * 2

  // Check for stability concerns
  const stabilityKeywords = ['breaking change', 'public api', 'shared', 'critical', 'core', 'foundation']
  riskScore += stabilityKeywords.filter(kw => searchText.includes(kw)).length * 2

  // Check for safety indicators (reduce risk)
  const safetyKeywords = ['test', 'validation', 'isolated', 'simple', 'small', 'docs', 'documentation']
  riskScore -= safetyKeywords.filter(kw => searchText.includes(kw)).length

  // Clamp and return
  if (riskScore >= 7) return 'critical'
  if (riskScore >= 5) return 'high'
  if (riskScore >= 2) return 'medium'
  if (riskScore >= 0) return 'low'
  return 'none'
}

/**
 * Infer priority from task title and description using keyword matching.
 * 
 * Priority factors:
 * - Keywords "critical", "blocking", "urgent" → critical
 * - Keywords "high", "important", "priority" → high
 * - Keywords "medium", "soon", "next" → medium
 * - Keywords "low", "nice-to-have", "future" → low
 * - Default to backlog if no priority keyword
 * 
 * @param title Task title
 * @param description Optional detailed description
 * @returns Inferred priority
 */
export function inferBacklogPriority(title: string, description?: string): TaskPriority {
  const searchText = [title, description].filter(Boolean).join(' ').toLowerCase()

  if (searchText.match(/critical|blocking|urgent|asap|immediately|emergency/)) return 'critical'
  if (searchText.match(/high|important|priority|must|essential/)) return 'high'
  if (searchText.match(/medium|soon|next|upcoming/)) return 'medium'
  if (searchText.match(/low|nice.to.have|future|consider|maybe/)) return 'low'
  
  return 'backlog'
}

/**
 * Create a backlog task draft with inferred fields.
 * 
 * Auto-populated fields:
 * - domain: inferred from title/description
 * - risk: inferred from title/priority
 * - priority: inferred from title/description (unless provided)
 * - status: defaults to 'backlog'
 * - timestamps: current ISO 8601
 * - source: defaults to 'import-session'
 * 
 * @param taskId Unique task identifier
 * @param title Task title
 * @param feature Feature/module name
 * @param description Optional detailed description
 * @param options Optional overrides for auto-inferred fields
 * @returns Complete backlog task ready for registry
 */
export function createBacklogTaskDraft(
  taskId: string,
  title: string,
  feature: string,
  description?: string,
  options?: {
    domain?: TaskDomain
    priority?: TaskPriority
    risk?: RiskLevel
    status?: TaskStatus
    assignedAgent?: string
    relatedFiles?: string[]
    dependencies?: string[]
    qaChecklist?: string[]
    notes?: string
    source?: string
  },
): BacklogTask {
  const normalizedTitle = normalizeTaskTitle(title)
  const inferredDomain = options?.domain || inferBacklogDomain(normalizedTitle, description)
  const inferredPriority = options?.priority || inferBacklogPriority(normalizedTitle, description)
  const inferredRisk = options?.risk || inferBacklogRisk(normalizedTitle, inferredPriority, description)

  const now = new Date().toISOString()

  return {
    taskId,
    domain: inferredDomain,
    feature,
    title: normalizedTitle,
    description,
    status: options?.status || 'backlog',
    priority: inferredPriority,
    risk: inferredRisk,
    assignedAgent: options?.assignedAgent,
    relatedFiles: options?.relatedFiles || [],
    dependencies: options?.dependencies,
    qaChecklist: options?.qaChecklist,
    notes: options?.notes,
    source: options?.source || 'import-session',
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Group backlog tasks by domain and return as domain buckets.
 * 
 * Also calculates per-domain statistics:
 * - total: count of all tasks
 * - completed: count of 'completed' status
 * - inProgress: count of 'in-progress' status
 * - blocked: count of 'blocked' status
 * - critical: count of 'critical' priority
 * 
 * @param tasks Array of backlog tasks
 * @param domainMetadata Optional metadata override for domain descriptions
 * @returns Record of domain -> DomainBucket
 */
export function groupBacklogByDomain(
  tasks: BacklogTask[],
  domainMetadata?: Record<TaskDomain, { displayName?: string; description?: string }>,
): Record<TaskDomain, DomainBucket> {
  // Default domain metadata
  const defaultMetadata: Record<TaskDomain, { displayName: string; description: string }> = {
    'core-shell': {
      displayName: 'Core Shell',
      description: 'Root application shell, layout, routing, and initialization infrastructure',
    },
    'home': {
      displayName: 'Home',
      description: 'Home dashboard, quick access, and overview panels',
    },
    'projects': {
      displayName: 'Projects',
      description: 'Project list, creation, management, and project-level workflows',
    },
    'project-inner': {
      displayName: 'Project Inner',
      description: 'Project detail view, tabs, sub-workflows, and inner project navigation',
    },
    'estimate': {
      displayName: 'Estimate',
      description: 'Estimating workflows, pricing calculations, and proposal generation',
    },
    'material-takeoff': {
      displayName: 'Material Takeoff (MTO)',
      description: 'Material list generation, pricing, and takeoff calculations',
    },
    'field-logs': {
      displayName: 'Field Logs',
      description: 'Service call logging, time tracking, and field operation workflows',
    },
    'graph-dashboard': {
      displayName: 'Graph Dashboard',
      description: 'Data visualization, charts, reporting, and analytics dashboard',
    },
    'money': {
      displayName: 'Money',
      description: 'Financial tracking, income calculations, payments, and accounting workflows',
    },
    'settings': {
      displayName: 'Settings',
      description: 'User preferences, configuration, app settings, and profile management',
    },
    'blueprint-pdf': {
      displayName: 'Blueprint/PDF',
      description: 'Blueprint viewing, PDF management, annotation, and document handling',
    },
    'price-book': {
      displayName: 'Price Book',
      description: 'Labor rates, material pricing, pricing history, and cost management',
    },
    'leads-sales': {
      displayName: 'Leads / Sales',
      description: 'Lead tracking, sales pipeline, customer management, and opportunity workflows',
    },
    'ai-nexus': {
      displayName: 'AI / NEXUS',
      description: 'AI integration, NEXUS system, CrewAI, and intelligent workflow automation',
    },
    'admin-app-brain': {
      displayName: 'Admin / App Brain',
      description: 'App Brain control tower, admin panels, backlog registry, and system administration',
    },
    'sync-persistence': {
      displayName: 'Sync / Persistence',
      description: 'Data synchronization, persistence layer, storage, and data backup workflows',
    },
    'integrations': {
      displayName: 'Integrations',
      description: 'Third-party integrations, APIs, webhooks, and external service connections',
    },
  }

  const metadata = { ...defaultMetadata, ...domainMetadata }

  // Initialize buckets for all domains
  const buckets: Record<TaskDomain, DomainBucket> = {} as Record<TaskDomain, DomainBucket>
  const allDomains: TaskDomain[] = [
    'core-shell',
    'home',
    'projects',
    'project-inner',
    'estimate',
    'material-takeoff',
    'field-logs',
    'graph-dashboard',
    'money',
    'settings',
    'blueprint-pdf',
    'price-book',
    'leads-sales',
    'ai-nexus',
    'admin-app-brain',
    'sync-persistence',
    'integrations',
  ]

  for (const domain of allDomains) {
    buckets[domain] = {
      domain,
      displayName: metadata[domain]?.displayName || domain,
      description: metadata[domain]?.description || '',
      tasks: [],
      stats: {
        total: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        critical: 0,
      },
    }
  }

  // Populate buckets and calculate stats
  for (const task of tasks) {
    buckets[task.domain].tasks.push(task)
    buckets[task.domain].stats.total++

    if (task.status === 'completed') buckets[task.domain].stats.completed++
    if (task.status === 'in-progress') buckets[task.domain].stats.inProgress++
    if (task.status === 'blocked') buckets[task.domain].stats.blocked++
    if (task.priority === 'critical') buckets[task.domain].stats.critical++
  }

  // Sort tasks within each bucket by priority and creation date
  const priorityOrder: Record<TaskPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    backlog: 4,
  }

  for (const domain of allDomains) {
    buckets[domain].tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }

  return buckets
}

/**
 * Batch create backlog tasks from raw data.
 * 
 * Convenience function for importing multiple tasks with minimal data.
 * Each task gets auto-inferred domain, priority, and risk.
 * 
 * @param rawTasks Array of raw task data
 * @param source Override source for all tasks
 * @returns Array of complete backlog tasks
 */
export function batchCreateBacklogTasks(
  rawTasks: Array<{
    taskId: string
    title: string
    feature: string
    description?: string
    priority?: TaskPriority
    relatedFiles?: string[]
  }>,
  source?: string,
): BacklogTask[] {
  return rawTasks.map(raw =>
    createBacklogTaskDraft(raw.taskId, raw.title, raw.feature, raw.description, {
      priority: raw.priority,
      relatedFiles: raw.relatedFiles,
      source,
    }),
  )
}

/**
 * Validate backlog task structure and return errors.
 * 
 * Validation checks:
 * - taskId is non-empty string
 * - domain is valid
 * - title is non-empty
 * - feature is non-empty
 * - status is valid
 * - priority is valid
 * - risk is valid
 * - createdAt and updatedAt are valid ISO dates
 * - timestamps are in logical order
 * 
 * @param task Backlog task to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateBacklogTask(task: BacklogTask): string[] {
  const errors: string[] = []
  const validDomains = [
    'core-shell', 'home', 'projects', 'project-inner', 'estimate', 'material-takeoff',
    'field-logs', 'graph-dashboard', 'money', 'settings', 'blueprint-pdf', 'price-book',
    'leads-sales', 'ai-nexus', 'admin-app-brain', 'sync-persistence', 'integrations',
  ]
  const validStatuses = ['backlog', 'planned', 'in-progress', 'blocked', 'review', 'completed', 'archived']
  const validPriorities = ['critical', 'high', 'medium', 'low', 'backlog']
  const validRisks = ['critical', 'high', 'medium', 'low', 'none']

  if (!task.taskId || typeof task.taskId !== 'string') errors.push('taskId must be non-empty string')
  if (!validDomains.includes(task.domain)) errors.push(`domain must be one of: ${validDomains.join(', ')}`)
  if (!task.title || typeof task.title !== 'string') errors.push('title must be non-empty string')
  if (!task.feature || typeof task.feature !== 'string') errors.push('feature must be non-empty string')
  if (!validStatuses.includes(task.status)) errors.push(`status must be one of: ${validStatuses.join(', ')}`)
  if (!validPriorities.includes(task.priority)) errors.push(`priority must be one of: ${validPriorities.join(', ')}`)
  if (!validRisks.includes(task.risk)) errors.push(`risk must be one of: ${validRisks.join(', ')}`)

  // Validate timestamps
  try {
    new Date(task.createdAt).toISOString()
  } catch {
    errors.push('createdAt must be valid ISO 8601 date')
  }

  try {
    new Date(task.updatedAt).toISOString()
  } catch {
    errors.push('updatedAt must be valid ISO 8601 date')
  }

  const createdTime = new Date(task.createdAt).getTime()
  const updatedTime = new Date(task.updatedAt).getTime()
  if (updatedTime < createdTime) {
    errors.push('updatedAt cannot be before createdAt')
  }

  return errors
}
