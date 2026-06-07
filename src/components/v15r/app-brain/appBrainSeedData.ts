/**
 * App Brain seed data adapters.
 * Mirrors solarupgrade_agent_context/APP_BRAIN_*.json until live file ingestion lands.
 */

import type { AppBrainActiveSessions } from './appBrainWorkTypes'
import type { FrictionLevel } from './appBrainRulesTypes'
import type { AppBrainSkillsRegistry } from './appBrainSkillsTypes'
import type { BacklogRegistry } from './appBrainBacklogTypes'

import activeSessionsJson from '../../../../solarupgrade_agent_context/APP_BRAIN_ACTIVE_SESSIONS.json'
import globalRulesJson from '../../../../solarupgrade_agent_context/APP_BRAIN_GLOBAL_RULES.json'
import agentRulesJson from '../../../../solarupgrade_agent_context/APP_BRAIN_AGENT_RULES.json'
import skillsJson from '../../../../solarupgrade_agent_context/APP_BRAIN_SKILLS.json'
import taskRegistryJson from '../../../../solarupgrade_agent_context/APP_BRAIN_TASK_REGISTRY.json'

export const APP_BRAIN_ACTIVE_SESSIONS = activeSessionsJson as AppBrainActiveSessions

export interface AppBrainGlobalRulesSeed {
  version: string
  name: string
  description: string
  lastUpdated: string
  source: string
  philosophy: string
  globalRules: Array<{
    id: string
    name: string
    description: string
    scope: string[]
    friction: FrictionLevel
    action: string
    rationale: string
    validation?: string
  }>
}

export interface AppBrainAgentRuleEntry {
  id: string
  description: string
  friction: FrictionLevel
  action?: string
  scope?: string[]
  blockedScope?: string[]
}

export interface AppBrainAgentRulesSeed {
  version: string
  name: string
  description: string
  lastUpdated: string
  source: string
  philosophy: string
  agents: Record<string, {
    id: string
    name: string
    role: string
    rules: AppBrainAgentRuleEntry[]
  }>
}

export const APP_BRAIN_GLOBAL_RULES = globalRulesJson as AppBrainGlobalRulesSeed
export const APP_BRAIN_AGENT_RULES = agentRulesJson as AppBrainAgentRulesSeed
export const APP_BRAIN_SKILLS_REGISTRY = skillsJson as AppBrainSkillsRegistry
export const APP_BRAIN_TASK_REGISTRY = taskRegistryJson as BacklogRegistry

export const APP_BRAIN_SEED_SOURCE_NOTE =
  'Static Wave 01 seed data — not live git/session tracking yet. Live ingestion comes in a later wave.'
