/**
 * App Brain Governance Summary Module
 * 
 * Read-only preview foundation for governance overview.
 * Summarizes clean rules and fresh skills registries from existing seed structures.
 * 
 * CRITICAL DISTINCTIONS:
 * - Clean Rules: Active v4.0 law stack, governance prescriptive constraints
 * - Fresh Skills: Learned patterns from seed structures, observable and learnable
 * - Old Laws/Skills Archives: Reference-only, not active execution rules
 * 
 * Philosophy: Low-friction by default (silent, warn) with escalation to confirm/block
 * 
 * Last Updated: 2026-06-07
 */

import type {
  FrictionLevel,
  GlobalRule,
  AgentRuleSet,
  DomainRule,
  FileTypeRule,
  SessionTypeRule,
  RuleEvaluationResult,
  RuleEvaluationContext,
} from './appBrainRulesTypes'

import type {
  AppBrainSkill,
  AppBrainSkillsRegistry,
} from './appBrainSkillsTypes'

import {
  APP_BRAIN_GLOBAL_RULES,
  APP_BRAIN_AGENT_RULES,
  APP_BRAIN_SKILLS_REGISTRY,
  APP_BRAIN_SEED_SOURCE_NOTE,
} from './appBrainSeedData'

// ============================================================================
// GOVERNANCE SUMMARY TYPES
// ============================================================================

export interface GovernanceSummary {
  version: string
  timestamp: string
  sourceNote: string
  cleanRulesActive: boolean
  skillsRegistryActive: boolean
  archivesReferenceOnly: boolean
  stats: GovernanceStats
  frictionLevels: FrictionLevelSummary
}

export interface GovernanceStats {
  totalGlobalRules: number
  totalDomainRules: number
  totalFileTypeRules: number
  totalSessionRules: number
  totalAgentRules: number
  activeSkills: number
  inactiveSkills: number
  totalSkills: number
  blockFrictionRules: number
  warnFrictionRules: number
  confirmFrictionRules: number
  silentFrictionRules: number
}

export interface FrictionLevelSummary {
  silent: {
    count: number
    meaning: string
    examples: string[]
  }
  warn: {
    count: number
    meaning: string
    examples: string[]
  }
  confirm: {
    count: number
    meaning: string
    examples: string[]
  }
  block: {
    count: number
    meaning: string
    examples: string[]
  }
}

export interface CleanRulesSet {
  globalRules: GlobalRule[]
  domainRules: DomainRule[]
  fileTypeRules: FileTypeRule[]
  sessionTypeRules: SessionTypeRule[]
  agentRules: Record<string, AppBrainAgentRuleData>
}

export interface AppBrainAgentRuleData {
  agentName: string
  role: string
  ruleCount: number
  rules: Array<{
    id: string
    description: string
    friction: FrictionLevel
  }>
}

export interface SkillsRegistrySummary {
  version: string
  createdAt: string
  lastUpdatedAt: string
  totalSkills: number
  activeSkills: number
  inactiveSkills: number
  byDomain: Record<string, number>
  byConfidence: Record<string, number>
}

export interface ArchiveReference {
  archiveType: string
  description: string
  status: 'reference-only' | 'archived'
  location: string
  note: string
}

// ============================================================================
// HELPER FUNCTIONS: COUNT RULES AND SKILLS
// ============================================================================

/**
 * Count active rules by friction level
 */
export function countRulesByFriction(rules: GlobalRule[]): Record<FrictionLevel, number> {
  return {
    silent: rules.filter(r => r.friction === 'silent').length,
    warn: rules.filter(r => r.friction === 'warn').length,
    confirm: rules.filter(r => r.friction === 'confirm').length,
    block: rules.filter(r => r.friction === 'block').length,
  }
}

/**
 * Count domain rules by friction level
 */
export function countDomainRulesByFriction(rules: DomainRule[]): Record<FrictionLevel, number> {
  return {
    silent: rules.filter(r => r.friction === 'silent').length,
    warn: rules.filter(r => r.friction === 'warn').length,
    confirm: rules.filter(r => r.friction === 'confirm').length,
    block: rules.filter(r => r.friction === 'block').length,
  }
}

/**
 * Count file type rules by friction level
 */
export function countFileTypeRulesByFriction(rules: FileTypeRule[]): Record<FrictionLevel, number> {
  return {
    silent: rules.filter(r => r.friction === 'silent').length,
    warn: rules.filter(r => r.friction === 'warn').length,
    confirm: rules.filter(r => r.friction === 'confirm').length,
    block: rules.filter(r => r.friction === 'block').length,
  }
}

/**
 * Count session type rules by friction level
 */
export function countSessionTypeRulesByFriction(rules: SessionTypeRule[]): Record<FrictionLevel, number> {
  return {
    silent: rules.filter(r => r.friction === 'silent').length,
    warn: rules.filter(r => r.friction === 'warn').length,
    confirm: rules.filter(r => r.friction === 'confirm').length,
    block: rules.filter(r => r.friction === 'block').length,
  }
}

/**
 * Count total agent rules by friction level across all agents
 */
export function countAgentRulesByFriction(agentRules: Record<string, any>): Record<FrictionLevel, number> {
  let silent = 0
  let warn = 0
  let confirm = 0
  let block = 0

  for (const agentId in agentRules) {
    const agent = agentRules[agentId]
    if (agent.rules && Array.isArray(agent.rules)) {
      for (const rule of agent.rules) {
        if (rule.friction === 'silent') silent++
        else if (rule.friction === 'warn') warn++
        else if (rule.friction === 'confirm') confirm++
        else if (rule.friction === 'block') block++
      }
    }
  }

  return { silent, warn, confirm, block }
}

/**
 * Count active and inactive skills
 */
export function countSkillsActiveInactive(skills: AppBrainSkill[]): {
  active: number
  inactive: number
  total: number
} {
  const active = skills.filter(s => s.active && !s.inactive).length
  const inactive = skills.filter(s => s.inactive || !s.active).length
  return { active, inactive, total: skills.length }
}

/**
 * Count skills by domain
 */
export function countSkillsByDomain(skills: AppBrainSkill[]): Record<string, number> {
  const domains: Record<string, number> = {}
  for (const skill of skills) {
    domains[skill.domain] = (domains[skill.domain] || 0) + 1
  }
  return domains
}

/**
 * Count skills by confidence level buckets
 */
export function countSkillsByConfidence(
  skills: AppBrainSkill[]
): Record<string, number> {
  const buckets: Record<string, number> = {
    'high (0.8-1.0)': 0,
    'medium (0.5-0.8)': 0,
    'low (0.0-0.5)': 0,
  }

  for (const skill of skills) {
    if (skill.confidence >= 0.8) buckets['high (0.8-1.0)']++
    else if (skill.confidence >= 0.5) buckets['medium (0.5-0.8)']++
    else buckets['low (0.0-0.5)']++
  }

  return buckets
}

// ============================================================================
// BUILD GOVERNANCE SUMMARY
// ============================================================================

/**
 * Build complete governance summary from seed data
 */
export function buildGovernanceSummary(): GovernanceSummary {
  const globalRulesData = APP_BRAIN_GLOBAL_RULES as any
  const globalRules = globalRulesData.globalRules || []
  const domainRules = globalRulesData.domainRules || []
  const fileTypeRules = globalRulesData.fileTypeRules || []
  const sessionRules = globalRulesData.sessionTypeRules || []
  const agentRules = APP_BRAIN_AGENT_RULES.agents || {}
  const skills = APP_BRAIN_SKILLS_REGISTRY.skills || []

  const globalFriction = countRulesByFriction(globalRules as GlobalRule[])
  const domainFriction = countDomainRulesByFriction(domainRules as DomainRule[])
  const fileTypeFriction = countFileTypeRulesByFriction(fileTypeRules as FileTypeRule[])
  const sessionFriction = countSessionTypeRulesByFriction(sessionRules as SessionTypeRule[])
  const agentFriction = countAgentRulesByFriction(agentRules)

  const totalBlock = globalFriction.block + domainFriction.block + fileTypeFriction.block + sessionFriction.block + agentFriction.block
  const totalWarn = globalFriction.warn + domainFriction.warn + fileTypeFriction.warn + sessionFriction.warn + agentFriction.warn
  const totalConfirm = globalFriction.confirm + domainFriction.confirm + fileTypeFriction.confirm + sessionFriction.confirm + agentFriction.confirm
  const totalSilent = globalFriction.silent + domainFriction.silent + fileTypeFriction.silent + sessionFriction.silent + agentFriction.silent

  const skillStats = countSkillsActiveInactive(skills)

  const stats: GovernanceStats = {
    totalGlobalRules: globalRules.length,
    totalDomainRules: (domainRules as DomainRule[]).length,
    totalFileTypeRules: (fileTypeRules as FileTypeRule[]).length,
    totalSessionRules: (sessionRules as SessionTypeRule[]).length,
    totalAgentRules: Object.values(agentRules).reduce((sum, agent: any) => sum + (agent.rules?.length || 0), 0),
    activeSkills: skillStats.active,
    inactiveSkills: skillStats.inactive,
    totalSkills: skillStats.total,
    blockFrictionRules: totalBlock,
    warnFrictionRules: totalWarn,
    confirmFrictionRules: totalConfirm,
    silentFrictionRules: totalSilent,
  }

  const frictionLevels: FrictionLevelSummary = {
    silent: {
      count: totalSilent,
      meaning: 'Log and continue — non-blocking issues logged for reference',
      examples: ['Documentation updates', 'Low-priority warnings', 'Informational logging'],
    },
    warn: {
      count: totalWarn,
      meaning: 'Warning issued but action allowed — use with caution',
      examples: ['Non-critical file modifications', 'Stage discipline violations', 'Deprecated patterns'],
    },
    confirm: {
      count: totalConfirm,
      meaning: 'User confirmation required before proceeding',
      examples: ['Risky operations requiring explicit approval', 'Protected file access attempts'],
    },
    block: {
      count: totalBlock,
      meaning: 'Action prevented — hard enforcement',
      examples: ['Package.json modifications', 'Protected file writes', 'TypeScript compilation failures'],
    },
  }

  return {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    sourceNote: APP_BRAIN_SEED_SOURCE_NOTE,
    cleanRulesActive: true,
    skillsRegistryActive: true,
    archivesReferenceOnly: true,
    stats,
    frictionLevels,
  }
}

// ============================================================================
// BUILD CLEAN RULES SET
// ============================================================================

/**
 * Extract clean rules from seed data
 */
export function buildCleanRulesSet(): CleanRulesSet {
  const globalRulesData = APP_BRAIN_GLOBAL_RULES as any
  const globalRules = (globalRulesData.globalRules || []) as GlobalRule[]
  const domainRules = (globalRulesData.domainRules || []) as DomainRule[]
  const fileTypeRules = (globalRulesData.fileTypeRules || []) as FileTypeRule[]
  const sessionTypeRules = (globalRulesData.sessionTypeRules || []) as SessionTypeRule[]
  const agentRules = APP_BRAIN_AGENT_RULES.agents || {}

  const agentRulesData: Record<string, AppBrainAgentRuleData> = {}
  for (const agentId in agentRules) {
    const agent = agentRules[agentId] as any
    agentRulesData[agentId] = {
      agentName: agent.name || agentId,
      role: agent.role || 'unknown',
      ruleCount: agent.rules?.length || 0,
      rules: (agent.rules || []).map((rule: any) => ({
        id: rule.id || 'unknown',
        description: rule.description || '',
        friction: rule.friction || 'silent',
      })),
    }
  }

  return {
    globalRules,
    domainRules,
    fileTypeRules,
    sessionTypeRules,
    agentRules: agentRulesData,
  }
}

// ============================================================================
// BUILD SKILLS REGISTRY SUMMARY
// ============================================================================

/**
 * Summarize skills registry from seed data
 */
export function buildSkillsRegistrySummary(): SkillsRegistrySummary {
  const registry = APP_BRAIN_SKILLS_REGISTRY
  const skills = registry.skills || []

  const skillStats = countSkillsActiveInactive(skills)
  const byDomain = countSkillsByDomain(skills)
  const byConfidence = countSkillsByConfidence(skills)

  return {
    version: registry.version || '1.0.0',
    createdAt: registry.createdAt || new Date().toISOString(),
    lastUpdatedAt: registry.lastUpdatedAt || new Date().toISOString(),
    totalSkills: skillStats.total,
    activeSkills: skillStats.active,
    inactiveSkills: skillStats.inactive,
    byDomain,
    byConfidence,
  }
}

// ============================================================================
// ARCHIVE REFERENCES
// ============================================================================

/**
 * Define old archives as reference-only (not active execution)
 */
export function getArchiveReferences(): ArchiveReference[] {
  return [
    {
      archiveType: 'old-laws-pdf',
      description: 'Legacy PDF governance archives',
      status: 'reference-only',
      location: 'solarupgrade_agent_context/archives/',
      note: 'These are reference materials only. Active rules come from v4.0 law stack in APP_BRAIN_GLOBAL_RULES.json',
    },
    {
      archiveType: 'old-skills-pdf',
      description: 'Legacy PDF skill dumps',
      status: 'reference-only',
      location: 'solarupgrade_agent_context/archives/',
      note: 'These are reference materials only. Active skills are in APP_BRAIN_SKILLS.json and must be explicitly imported',
    },
    {
      archiveType: 'deprecated-canary',
      description: 'Canary PDFs from previous sessions',
      status: 'archived',
      location: 'solarupgrade_agent_context/archives/',
      note: 'These are historical records. Current canaries are defined in appBrainRulesTypes.ts CANARY_FILES',
    },
  ]
}

// ============================================================================
// GOVERNANCE FRICTION CONCEPTS
// ============================================================================

/**
 * Friction level definitions for read-only preview
 */
export const FRICTION_CONCEPTS = {
  silent: {
    label: 'Silent',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    description: 'Logged but not enforced',
    use: 'Non-blocking informational logging',
  },
  warn: {
    label: 'Warn',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    description: 'Warning issued, action allowed',
    use: 'Caution recommended but not required',
  },
  confirm: {
    label: 'Confirm',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    description: 'User confirmation required',
    use: 'Explicit approval needed to proceed',
  },
  block: {
    label: 'Block',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    description: 'Action prevented hard stop',
    use: 'Enforcement — operation not permitted',
  },
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

/**
 * App Brain Governance Summary v1
 * 
 * This module provides:
 * - Read-only governance overview from seed structures
 * - Helper functions to count active/inactive rules and skills
 * - Clear distinction: Clean Rules (v4.0 active) vs Archives (reference-only)
 * - Low-friction concepts: silent, warn, confirm, block
 * 
 * NOT included:
 * - Edit UI (read-only preview only)
 * - Old PDF imports (archives are reference materials)
 * 
 * Usage:
 * - Import helper functions to analyze governance in other components
 * - Use buildGovernanceSummary() to get overall snapshot
 * - Reference FRICTION_CONCEPTS for UI preview rendering
 */
