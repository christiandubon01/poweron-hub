/**
 * SCOUT Analyzer — sends gathered data to Claude Sonnet for pattern
 * detection and proposal generation.
 *
 * Returns a typed array of raw proposals (pre-MiroFish verification).
 */

import { SCOUT_SYSTEM_PROMPT } from './systemPrompt'
import type { ScoutDataSnapshot } from './dataGatherer'

// ── Types ───────────────────────────────────────────────────────────────────

export const PROPOSAL_CATEGORIES = [
  'operations', 'financial', 'scheduling', 'compliance',
  'relationship', 'pricing', 'staffing',
] as const

export type ProposalCategory = typeof PROPOSAL_CATEGORIES[number]

export interface RawProposal {
  title:        string
  description:  string
  category:     ProposalCategory
  impact_score: number   // 1-10
  risk_score:   number   // 1-10
  source_data:  Record<string, unknown>
  reasoning:    string
}

// ── Validation ──────────────────────────────────────────────────────────────

function isValidCategory(v: unknown): v is ProposalCategory {
  return typeof v === 'string' && (PROPOSAL_CATEGORIES as readonly string[]).includes(v)
}

function validateProposal(raw: unknown): RawProposal | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  if (typeof obj.title !== 'string' || !obj.title.trim()) return null
  if (typeof obj.description !== 'string' || !obj.description.trim()) return null
  if (!isValidCategory(obj.category)) return null
  if (typeof obj.impact_score !== 'number' || obj.impact_score < 1 || obj.impact_score > 10) return null
  if (typeof obj.risk_score !== 'number' || obj.risk_score < 1 || obj.risk_score > 10) return null
  if (typeof obj.reasoning !== 'string') return null

  return {
    title:        obj.title.trim(),
    description:  obj.description.trim(),
    category:     obj.category,
    impact_score: Math.round(obj.impact_score),
    risk_score:   Math.round(obj.risk_score),
    source_data:  (obj.source_data && typeof obj.source_data === 'object')
                    ? obj.source_data as Record<string, unknown>
                    : {},
    reasoning:    obj.reasoning,
  }
}

// ── Analyzer ────────────────────────────────────────────────────────────────

/**
 * Analyze a SCOUT data snapshot and generate proposals via Claude Sonnet.
 *
 * @param snapshot - The gathered data snapshot from dataGatherer
 * @returns Array of validated RawProposals (3-8 typically)
 */
export async function analyzeData(snapshot: ScoutDataSnapshot): Promise<RawProposal[]> {

  // Build a concise data summary for the prompt
  // (full snapshot can be large — summarize key metrics to stay in context)
  const dataSummary = buildDataSummary(snapshot)

  const response = await fetch('/.netlify/functions/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system:     SCOUT_SYSTEM_PROMPT,
      messages:   [{
        role:    'user',
        content: `Analyze the following data snapshot and generate proposals.\n\n${dataSummary}`,
      }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`SCOUT analyzer API call failed: ${response.status} ${errText}`)
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
  }

  const rawText = data.content[0]?.text ?? ''

  // Parse JSON array from response
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Try to extract JSON array from markdown wrapping
    const arrayMatch = rawText.match(/\[[\s\S]*\]/)
    if (!arrayMatch) {
      console.error('[Scout:analyzer] Non-JSON response:', rawText.slice(0, 300))
      return []
    }
    parsed = JSON.parse(arrayMatch[0])
  }

  if (!Array.isArray(parsed)) {
    console.error('[Scout:analyzer] Response is not an array')
    return []
  }

  // Validate each proposal
  const validated: RawProposal[] = []
  for (const item of parsed) {
    const proposal = validateProposal(item)
    if (proposal) {
      validated.push(proposal)
    } else {
      console.warn('[Scout:analyzer] Invalid proposal skipped:', item)
    }
  }

  return validated
}


// ── Data summary builder ────────────────────────────────────────────────────

function buildDataSummary(snapshot: ScoutDataSnapshot): string {
  const sections: string[] = []

  // Active projects
  if (snapshot.activeProjects.length > 0) {
    sections.push(
      `## Active Projects (${snapshot.activeProjects.length})\n` +
      JSON.stringify(snapshot.activeProjects.map(p => ({
        name: p.name, status: p.status, type: p.type, phase: p.phase,
        priority: p.priority, estimated_value: p.estimated_value,
        contract_value: p.contract_value, updated_at: p.updated_at,
      })), null, 2)
    )
  }

  // Field logs summary (aggregate by project)
  if (snapshot.fieldLogs.length > 0) {
    const byProject = new Map<string, { hours: number; material: number; entries: number }>()
    for (const fl of snapshot.fieldLogs) {
      const curr = byProject.get(fl.project_id) ?? { hours: 0, material: 0, entries: 0 }
      curr.hours    += fl.hours || 0
      curr.material += fl.material_cost || 0
      curr.entries  += 1
      byProject.set(fl.project_id, curr)
    }
    sections.push(
      `## Field Logs — Last 30 Days (${snapshot.fieldLogs.length} entries across ${byProject.size} projects)\n` +
      JSON.stringify(
        Array.from(byProject.entries()).map(([pid, agg]) => ({
          project_id: pid, total_hours: agg.hours,
          total_material_cost: agg.material, entry_count: agg.entries,
        })),
        null, 2
      )
    )
  }

  // Outdated pricing
  if (snapshot.outdatedPricing.length > 0) {
    sections.push(
      `## Outdated Price Book Items (${snapshot.outdatedPricing.length} items >60 days stale)\n` +
      JSON.stringify(snapshot.outdatedPricing.slice(0, 20), null, 2)
    )
  }

  // Overdue coordination items
  if (snapshot.overdueItems.length > 0) {
    sections.push(
      `## Overdue Coordination Items (${snapshot.overdueItems.length})\n` +
      JSON.stringify(snapshot.overdueItems, null, 2)
    )
  }

  // Cost variances
  if (snapshot.costVariances.length > 0) {
    const significant = snapshot.costVariances.filter(v => v.variance_pct !== null && Math.abs(v.variance_pct) > 10)
    if (significant.length > 0) {
      sections.push(
        `## Cost Variances >10% (${significant.length} projects)\n` +
        JSON.stringify(significant, null, 2)
      )
    }
  }

  // Dormant GC relationships
  if (snapshot.dormantGCs.length > 0) {
    sections.push(
      `## Dormant GC Relationships — 90+ Days (${snapshot.dormantGCs.length})\n` +
      JSON.stringify(snapshot.dormantGCs, null, 2)
    )
  }

  // Weekly tracker
  if (snapshot.weeklyTracker.length > 0) {
    sections.push(
      `## Weekly Tracker — Last ${snapshot.weeklyTracker.length} Weeks\n` +
      JSON.stringify(snapshot.weeklyTracker, null, 2)
    )
  }

  // Open invoices
  if (snapshot.openInvoices.length > 0) {
    const overdue = snapshot.openInvoices.filter(i => i.days_overdue > 0)
    const totalBalance = snapshot.openInvoices.reduce((s, i) => s + (i.balance_due || 0), 0)
    sections.push(
      `## Open Invoices (${snapshot.openInvoices.length} total, ${overdue.length} overdue, $${totalBalance.toLocaleString()} outstanding)\n` +
      JSON.stringify(snapshot.openInvoices.slice(0, 15), null, 2)
    )
  }

  if (sections.length === 0) {
    return '## No Data Available\nNo data was gathered from any tables. This may indicate the org has no records yet or a connectivity issue.'
  }

  return `# SCOUT Data Snapshot — ${snapshot.gatheredAt}\nOrg: ${snapshot.orgId}\n\n${sections.join('\n\n')}`
}
