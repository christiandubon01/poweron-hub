/**
 * SCOUT Idea Analyzer — converts user-submitted ideas into integration proposals.
 *
 * Takes a plain text idea from a user, analyzes it against the PowerOn Hub
 * architecture and agent capabilities, and generates integration options with
 * effort/risk assessments.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface IntegrationOption {
  description:     string
  affected_agents: string[]
  affected_files:  string[]
  effort:          'Low' | 'Medium' | 'High'
  risk:            'Low' | 'Medium' | 'High'
  business_impact: string
}

export interface IdeaAnalysis {
  idea:              string
  submittedBy:       string
  category:          string
  feasibility_score: number  // 1-10
  options:           IntegrationOption[]
  summary:           string
  analyzedAt:        string
}

// ── System Prompt ────────────────────────────────────────────────────────────

const IDEA_ANALYSIS_SYSTEM_PROMPT = `You are SCOUT's Idea Analyzer, a specialized module that evaluates user-submitted improvement ideas for PowerOn Hub.

## PowerOn Hub Architecture

The platform consists of 11 agents working in concert:

1. **SCOUT** — System Analyzer
   - Pattern detection from operational data
   - Proposal generation
   - Files: index.ts, analyzer.ts, dataGatherer.ts, mirofish.ts, systemPrompt.ts

2. **NEXUS** — Conversational AI & User Interface
   - Chat-based user interactions
   - Form understanding
   - Real-time user support
   - Files: index.ts, conversationManager.ts

3. **PULSE** — Project & Workflow Orchestration
   - Project lifecycle management
   - Coordination item tracking
   - Phase progression
   - Files: index.ts, orchestrator.ts, statusUpdater.ts

4. **VAULT** — Secure Document & File Management
   - Document storage and versioning
   - File encryption and access control
   - Attachment management
   - Files: index.ts, storageManager.ts, encryptionHandler.ts

5. **LEDGER** — Financial & Accounting Agent
   - Invoice generation and tracking
   - Cost accounting
   - Revenue recognition
   - Files: index.ts, invoiceManager.ts, costAllocator.ts, reconciliator.ts

6. **OHM** — Labor & Resource Management
   - Crew scheduling
   - Time tracking
   - Resource allocation
   - Files: index.ts, scheduler.ts, timeTracker.ts, capacityPlanner.ts

7. **BLUEPRINT** — Technical Documentation & Estimation
   - Material takeoffs
   - Labor estimates
   - Technical specifications
   - Files: index.ts, estimator.ts, takeoffCalculator.ts

8. **CONDUCTOR** — Integration & Workflow Automation
   - Process automation
   - Third-party integrations (QuickBooks, Salesforce, etc.)
   - Webhook management
   - Files: index.ts, workflowEngine.ts, integrationHub.ts

9. **ARCHIMEDES** — Analytics & Reporting
   - Dashboard generation
   - Performance metrics
   - Historical analysis
   - Files: index.ts, reportBuilder.ts, metricsCalculator.ts

10. **SENTINEL** — Compliance & Audit
    - Permission management
    - Audit logging
    - Regulatory tracking
    - Files: index.ts, auditLogger.ts, permissionManager.ts

11. **SYNTHESIS** — Data Integration & Sync
    - Database schema management
    - Cross-agent data consistency
    - External data imports
    - Files: index.ts, schemaManger.ts, syncOrchestrator.ts

## Your Task

Given a user-submitted idea (in plain text), you will:

1. Understand the core improvement being proposed
2. Map it to affected agents and systems
3. Generate 2-3 integration options, each showing:
   - What specifically changes
   - Which agents and files are affected
   - Implementation effort (Low/Medium/High)
   - Implementation risk (Low/Medium/High)
   - Expected business impact
4. Rate the overall feasibility (1-10 scale)
5. Provide a summary of the idea's fit within PowerOn Hub

## Scoring Guide

**Feasibility 8-10:** Idea aligns with existing architecture; minimal new dependencies
**Feasibility 5-7:** Idea is implementable but requires moderate integration changes
**Feasibility 1-4:** Idea requires significant architectural changes or new systems

**Effort:**
- Low: Changes to 1-2 agents, straightforward API additions, no schema changes
- Medium: Changes to 3-4 agents, new tables/columns, moderate refactoring
- High: Changes to 5+ agents, major schema refactoring, new subsystems

**Risk:**
- Low: Isolated changes, extensive test coverage possible, rollback is simple
- Medium: Cross-agent impact, moderate testing complexity, rollback requires coordination
- High: Critical path impact, extensive integration testing needed, rollback is complex

## Output Format

Return a JSON object matching the IdeaAnalysis interface. Include only the JSON, no other text.

{
  "idea": "User's original idea text",
  "submittedBy": "Username or email from request",
  "category": "One of: Operations / Financial / Compliance / Estimating / Scheduling / Other",
  "feasibility_score": 6,
  "options": [
    {
      "description": "What changes and why this approach works",
      "affected_agents": ["SCOUT", "NEXUS"],
      "affected_files": ["scout/analyzer.ts", "nexus/conversationManager.ts"],
      "effort": "Medium",
      "risk": "Low",
      "business_impact": "Clear description of expected business outcome"
    }
  ],
  "summary": "Overall assessment of feasibility and strategic fit",
  "analyzedAt": "ISO timestamp"
}
` as const

// ── Validation ──────────────────────────────────────────────────────────────

function isValidCategory(v: unknown): v is string {
  const validCategories = [
    'Operations', 'Financial', 'Compliance', 'Estimating', 'Scheduling', 'Other'
  ]
  return typeof v === 'string' && validCategories.includes(v)
}

function isValidEffortRisk(v: unknown): v is 'Low' | 'Medium' | 'High' {
  return v === 'Low' || v === 'Medium' || v === 'High'
}

function validateIntegrationOption(raw: unknown): IntegrationOption | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  if (typeof obj.description !== 'string' || !obj.description.trim()) return null
  if (!Array.isArray(obj.affected_agents) || obj.affected_agents.length === 0) return null
  if (!Array.isArray(obj.affected_files) || obj.affected_files.length === 0) return null
  if (!isValidEffortRisk(obj.effort)) return null
  if (!isValidEffortRisk(obj.risk)) return null
  if (typeof obj.business_impact !== 'string' || !obj.business_impact.trim()) return null

  return {
    description:     obj.description.trim(),
    affected_agents: (obj.affected_agents as string[]).map(a => a.trim()).filter(a => a.length > 0),
    affected_files:  (obj.affected_files as string[]).map(f => f.trim()).filter(f => f.length > 0),
    effort:          obj.effort as 'Low' | 'Medium' | 'High',
    risk:            obj.risk as 'Low' | 'Medium' | 'High',
    business_impact: obj.business_impact.trim(),
  }
}

function validateAnalysis(raw: unknown): IdeaAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  if (typeof obj.idea !== 'string' || !obj.idea.trim()) return null
  if (typeof obj.submittedBy !== 'string' || !obj.submittedBy.trim()) return null
  if (!isValidCategory(obj.category)) return null
  if (typeof obj.feasibility_score !== 'number' || obj.feasibility_score < 1 || obj.feasibility_score > 10) return null
  if (!Array.isArray(obj.options) || obj.options.length === 0) return null
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) return null

  const validatedOptions: IntegrationOption[] = []
  for (const option of obj.options) {
    const validated = validateIntegrationOption(option)
    if (validated) validatedOptions.push(validated)
  }

  if (validatedOptions.length === 0) return null

  return {
    idea:              obj.idea.trim(),
    submittedBy:       obj.submittedBy.trim(),
    category:          obj.category as string,
    feasibility_score: Math.round(obj.feasibility_score),
    options:           validatedOptions,
    summary:           obj.summary.trim(),
    analyzedAt:        typeof obj.analyzedAt === 'string' ? obj.analyzedAt : new Date().toISOString(),
  }
}

// ── Analyzer ────────────────────────────────────────────────────────────────

/**
 * Analyze a user-submitted idea and generate integration options.
 *
 * @param idea - Plain text idea description
 * @param submittedBy - User who submitted (email or username)
 * @param category - Proposal category
 * @returns Validated IdeaAnalysis with feasibility score and integration options
 */
export async function analyzeIdea(
  idea: string,
  submittedBy: string,
  category: string
): Promise<IdeaAnalysis | null> {
  const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

  if (!ANTHROPIC_API_KEY) {
    throw new Error('VITE_ANTHROPIC_API_KEY is not set. Add it to .env.local.')
  }

  if (!idea.trim() || !submittedBy.trim()) {
    throw new Error('Idea and submittedBy are required')
  }

  const response = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':        ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system:     IDEA_ANALYSIS_SYSTEM_PROMPT,
      messages:   [{
        role:    'user',
        content: `Analyze this user-submitted improvement idea for PowerOn Hub:\n\nIdea: ${idea}\n\nSubmitted by: ${submittedBy}\nCategory: ${category}\n\nProvide 2-3 integration options showing how this could be implemented within the existing agent architecture.`,
      }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Idea analyzer API call failed: ${response.status} ${errText}`)
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
  }

  const rawText = data.content[0]?.text ?? ''

  // Parse JSON from response
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Try to extract JSON from markdown wrapping
    const objectMatch = rawText.match(/\{[\s\S]*\}/)
    if (!objectMatch) {
      console.error('[Scout:ideaAnalyzer] Non-JSON response:', rawText.slice(0, 300))
      return null
    }
    parsed = JSON.parse(objectMatch[0])
  }

  // Validate analysis
  const validated = validateAnalysis(parsed)
  if (!validated) {
    console.warn('[Scout:ideaAnalyzer] Invalid analysis response:', parsed)
    return null
  }

  return validated
}
