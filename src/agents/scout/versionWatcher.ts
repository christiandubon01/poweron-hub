// @ts-nocheck
/**
 * Version Watcher — detects new migration opportunities when agents are added.
 *
 * Queries the agent_proposals table to see what agents exist,
 * compares against legacy feature list, and surfaces migration
 * opportunities that are newly migratable.
 *
 * Call after each build session or new agent addition.
 */

import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

export interface MigrationOpportunity {
  old_feature:     string
  new_agent:       string
  description:     string
  auto_migratable: boolean
  effort:          'Low' | 'Medium' | 'High'
}

// ── Legacy Features ──────────────────────────────────────────────────────────
// This is a hardcoded list of known features from the old v15r app
// that could benefit from migration to new agents.

const LEGACY_FEATURES = [
  {
    name:              'Customer Portal',
    oldLocation:       'v15r:/panels/CustomerPortal.html',
    compatibleAgent:   'VAULT',
    description:       'Legacy customer-facing proposal/estimate portal',
    effort:            'Medium' as const,
    requiresAgents:    ['VAULT'],
  },
  {
    name:              'Invoice Tracker',
    oldLocation:       'v15r:/panels/InvoiceTracker.aspx',
    compatibleAgent:   'LEDGER',
    description:       'AR aging report, overdue tracking, collection workflow',
    effort:            'Medium' as const,
    requiresAgents:    ['LEDGER'],
  },
  {
    name:              'Project Dashboard',
    oldLocation:       'v15r:/panels/ProjectDashboard.html',
    compatibleAgent:   'PULSE',
    description:       'Real-time project KPIs, budget vs. actual, task status',
    effort:            'High' as const,
    requiresAgents:    ['PULSE', 'BLUEPRINT'],
  },
  {
    name:              'Crew Scheduling',
    oldLocation:       'v15r:/panels/CrewScheduler.aspx',
    compatibleAgent:   'CHRONO',
    description:       'Resource allocation, crew calendar, job assignment',
    effort:            'High' as const,
    requiresAgents:    ['CHRONO'],
  },
  {
    name:              'Marketing Campaigns',
    oldLocation:       'v15r:/panels/MarketingTools.html',
    compatibleAgent:   'SPARK',
    description:       'Email templates, campaign tracking, lead generation',
    effort:            'Medium' as const,
    requiresAgents:    ['SPARK'],
  },
  {
    name:              'Compliance Checklist',
    oldLocation:       'v15r:/panels/ComplianceModule.aspx',
    compatibleAgent:   'OHM',
    description:       'Safety protocols, permit tracking, regulatory reminders',
    effort:            'Medium' as const,
    requiresAgents:    ['OHM'],
  },
  {
    name:              'Estimate Builder',
    oldLocation:       'v15r:/panels/EstimateBuilder.aspx',
    compatibleAgent:   'VAULT',
    description:       'Interactive estimate creation with material/labor breakdown',
    effort:            'High' as const,
    requiresAgents:    ['VAULT'],
  },
  {
    name:              'Field Log Mobile',
    oldLocation:       'v15r:/mobile/FieldLog.html',
    compatibleAgent:   'PULSE',
    description:       'Crew time entry, photo uploads, GPS logging from field',
    effort:            'High' as const,
    requiresAgents:    ['PULSE', 'CHRONO'],
  },
  {
    name:              'Price Book Manager',
    oldLocation:       'v15r:/panels/PriceBook.aspx',
    compatibleAgent:   'VAULT',
    description:       'Material/labor rate maintenance, cost updates, version control',
    effort:            'Low' as const,
    requiresAgents:    ['VAULT'],
  },
  {
    name:              'Customer CRM',
    oldLocation:       'v15r:/panels/CustomerCRM.aspx',
    compatibleAgent:   'SPARK',
    description:       'Contact management, communication history, relationship notes',
    effort:            'Medium' as const,
    requiresAgents:    ['SPARK'],
  },
  {
    name:              'Job Costing',
    oldLocation:       'v15r:/panels/JobCosting.aspx',
    compatibleAgent:   'LEDGER',
    description:       'Cost tracking, variance analysis, profitability by project',
    effort:            'High' as const,
    requiresAgents:    ['LEDGER'],
  },
]

// ── Main Function ────────────────────────────────────────────────────────────

/**
 * Check for new migration opportunities based on available agents.
 *
 * Queries agent_proposals table to find what agents have proposals,
 * then checks which legacy features can now be migrated.
 *
 * @param orgId - Organization ID (used for audit, agents are org-independent)
 * @returns Array of newly migratable features
 */
export async function checkNewMigrationOpportunities(
  orgId: string
): Promise<MigrationOpportunity[]> {
  try {
    // Query agent registry to see what agents exist
    // (Agents create proposals; if they have proposals, they're active)
    const { data: existingAgents, error: queryError } = await supabase
      .from('agent_proposals')
      .select('proposing_agent')
      .eq('org_id', orgId)
      .limit(1000)

    if (queryError) {
      console.warn('[VersionWatcher] Agent query error:', queryError)
      return []
    }

    // Extract unique agent names
    const activeAgents = new Set<string>()
    if (existingAgents) {
      for (const row of existingAgents) {
        const agent = (row as Record<string, unknown>)?.proposing_agent
        if (typeof agent === 'string') {
          activeAgents.add(agent.toUpperCase())
        }
      }
    }

    // Check for hardcoded agents from the orchestrator
    const knownAgents = [
      'NEXUS', 'PULSE', 'BLUEPRINT', 'VAULT', 'LEDGER',
      'SPARK', 'CHRONO', 'OHM', 'SCOUT', 'IDEATOR', 'COORDINATOR',
    ]
    for (const agent of knownAgents) {
      activeAgents.add(agent)
    }

    console.log('[VersionWatcher] Active agents:', Array.from(activeAgents))

    // Find newly migratable features
    const opportunities: MigrationOpportunity[] = []

    for (const feature of LEGACY_FEATURES) {
      // Check if all required agents are now available
      const allAgentsAvailable = feature.requiresAgents.every(
        agent => activeAgents.has(agent.toUpperCase())
      )

      if (allAgentsAvailable) {
        // Check if we've already proposed this
        const { data: existing } = await supabase
          .from('agent_proposals')
          .select('id')
          .eq('org_id', orgId)
          .eq('proposing_agent', 'scout')
          .like('title', `%${feature.name}%`)
          .limit(1)

        // Only add if not already proposed
        if (!existing || existing.length === 0) {
          opportunities.push({
            old_feature:     feature.name,
            new_agent:       feature.compatibleAgent,
            description:     feature.description,
            auto_migratable: feature.effort === 'Low',
            effort:          feature.effort,
          })
        }
      }
    }

    console.log(`[VersionWatcher] Found ${opportunities.length} new migration opportunities`)

    return opportunities
  } catch (err) {
    console.error('[VersionWatcher] Error checking opportunities:', err)
    return []
  }
}

// ── Helper: Get all legacy features ──────────────────────────────────────────

/**
 * Retrieve the full list of legacy features.
 * Useful for UI that displays what can be migrated.
 */
export function getLegacyFeatures() {
  return LEGACY_FEATURES.map(f => ({
    name:            f.name,
    description:     f.description,
    compatibleAgent: f.compatibleAgent,
    effort:          f.effort,
    oldLocation:     f.oldLocation,
  }))
}

// ── Exports ──────────────────────────────────────────────────────────────────
export type { MigrationOpportunity }
