/**
 * Code Analyzer — analyzes raw code snippets against PowerOn Hub architecture.
 *
 * Sends code to Claude Sonnet with detailed context about:
 * - Current React+TypeScript architecture
 * - All 11 agents and their domains
 * - Migration context (old v15r app → new PowerOn Hub)
 *
 * Returns structured migration report with features, status, risks, and recommended approach.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface MigrationFeature {
  feature_name:           string
  description:            string
  migration_status:       'done' | 'pending' | 'needs_rework'
  risk:                   'Low' | 'Medium' | 'High'
  effort:                 'Low' | 'Medium' | 'High'
  recommended_approach:   string
  affected_files:         string[]
  priority_order:         number
}

export interface CodeAnalysisReport {
  code_snippet:           string  // first 200 chars for reference
  context:                string
  language_detected:      string
  total_features:         number
  features:               MigrationFeature[]
  architecture_conflicts: string[]
  recommended_migration_order: string[]
  summary:                string
  analyzedAt:             string
}

// ── System Prompt ────────────────────────────────────────────────────────────

const CODE_ANALYSIS_SYSTEM_PROMPT = `You are SCOUT's Code Intelligence Layer, specializing in analyzing legacy code and mapping it to PowerOn Hub's modern architecture.

## PowerOn Hub Architecture

**Tech Stack:**
- Framework: React 18 + TypeScript
- UI: Tailwind CSS with custom design tokens (bg-bg, bg-bg-1, text-text-1, text-scout, etc.)
- State: Supabase + pgvector for relational + vector search
- Memory: Redis + pgvector audit trails
- API: Anthropic Claude Sonnet 4 (claude-sonnet-4-20250514)
- Auth: Passcode + Biometric
- Agents: 11 specialized agent domains coordinated by NEXUS

**The 11 Agents:**
1. NEXUS (Manager, delegation, orchestration)
2. PULSE (Dashboard, KPIs, real-time monitoring)
3. BLUEPRINT (Project management, workflows)
4. VAULT (Estimating intelligence, proposal generation)
5. LEDGER (Accounting, AR/AP automation)
6. SPARK (Marketing, content generation)
7. CHRONO (Scheduling, resource allocation)
8. OHM (Compliance, safety, regulations)
9. SCOUT (Pattern analysis, migration intelligence)
10. IDEATOR (User ideas, feature requests)
11. COORDINATOR (Cross-agent task delegation)

**Migration Context:**
- Source: Legacy v15r PowerOn app (HTML/JS/VB.NET backend)
- Target: PowerOn Hub v3.0 (React+TypeScript, API-first)
- Goal: Modernize panels/features incrementally while maintaining data integrity

**Architectural Patterns:**
- Components are phase-gated (Phase 01, 02, 03, etc.)
- Each agent owns a domain and proposes improvements via agent_proposals table
- Code never modifies files directly; all changes go through proposal→confirmation workflow
- All suggestions are immutable audit-logged
- React patterns use custom hooks (useAuth, custom Supabase queries)

## Analysis Guidelines

When analyzing code:
1. **Identify panels/features** from old app (e.g., "Customer Portal", "Invoice Tracker")
2. **Map to new agents** (which agent domain owns this feature?)
3. **Assess migration status**:
   - 'done': Already in new app with modern architecture
   - 'pending': Identified, not yet started
   - 'needs_rework': Partially migrated but has conflicts
4. **Risk assessment**: Legacy code patterns, data model mismatches, breaking changes
5. **Effort estimation**: Low (1-2 days), Medium (3-5 days), High (1+ weeks)
6. **Conflict detection**: List any architectural mismatches with current design
7. **Recommended approach**: Step-by-step migration path, testing strategy, data mapping

## Response Format

You MUST return a valid JSON object matching this exact structure:
{
  "code_snippet": "<first 200 chars of input code>",
  "context": "<user-provided context>",
  "language_detected": "html|javascript|typescript|vbnet|sql|other",
  "total_features": <number>,
  "features": [
    {
      "feature_name": "<feature name>",
      "description": "<1-2 sentences>",
      "migration_status": "done|pending|needs_rework",
      "risk": "Low|Medium|High",
      "effort": "Low|Medium|High",
      "recommended_approach": "<step-by-step approach>",
      "affected_files": ["<relative paths in new app>"],
      "priority_order": <1-9>
    }
  ],
  "architecture_conflicts": ["<conflict 1>", "<conflict 2>"],
  "recommended_migration_order": ["<feature 1>", "<feature 2>"],
  "summary": "<2-3 sentence summary of migration plan>",
  "analyzedAt": "<ISO timestamp>"
}

Return ONLY valid JSON, no markdown or explanation.`;

// ── Analyzer ─────────────────────────────────────────────────────────────────

/**
 * Analyze raw code against PowerOn Hub architecture.
 *
 * @param codeInput - Raw HTML/JS/TS code snippet
 * @param context - User-provided context ("What is this code for?")
 * @returns Structured migration report
 */
export async function analyzeCode(
  codeInput: string,
  context: string
): Promise<CodeAnalysisReport> {
  const ANTHROPIC_API_KEY = (import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : '') as string

  if (!ANTHROPIC_API_KEY) {
    throw new Error('VITE_ANTHROPIC_API_KEY is not set. Add it to .env.local.')
  }

  const response = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':                          ANTHROPIC_API_KEY,
      'anthropic-version':                  '2023-06-01',
      'content-type':                       'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system:     CODE_ANALYSIS_SYSTEM_PROMPT,
      messages:   [{
        role:    'user',
        content: `Analyze this code for migration to PowerOn Hub.\n\nContext: ${context}\n\nCode:\n\`\`\`\n${codeInput}\n\`\`\``,
      }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Code analyzer API call failed: ${response.status} ${errText}`)
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
  }

  const rawText = data.content[0]?.text ?? ''

  // Parse JSON response
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Try to extract JSON object from markdown wrapping
    const objMatch = rawText.match(/\{[\s\S]*\}/)
    if (!objMatch) {
      console.error('[Scout:codeAnalyzer] Non-JSON response:', rawText.slice(0, 300))
      throw new Error('Claude did not return valid JSON response')
    }
    parsed = JSON.parse(objMatch[0])
  }

  // Validate report structure
  const report = validateReport(parsed, codeInput)
  return report
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateReport(raw: unknown, codeInput: string): CodeAnalysisReport {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid report structure')
  }

  const obj = raw as Record<string, unknown>

  // Validate features array
  if (!Array.isArray(obj.features)) {
    obj.features = []
  }

  const features: MigrationFeature[] = []
  for (const feat of obj.features as unknown[]) {
    const f = validateFeature(feat)
    if (f) features.push(f)
  }

  // Validate architecture conflicts
  const conflicts: string[] = []
  if (Array.isArray(obj.architecture_conflicts)) {
    for (const c of obj.architecture_conflicts) {
      if (typeof c === 'string') conflicts.push(c)
    }
  }

  // Validate migration order
  const migrationOrder: string[] = []
  if (Array.isArray(obj.recommended_migration_order)) {
    for (const m of obj.recommended_migration_order) {
      if (typeof m === 'string') migrationOrder.push(m)
    }
  }

  return {
    code_snippet:           (codeInput.slice(0, 200) || ''),
    context:                (typeof obj.context === 'string' ? obj.context : ''),
    language_detected:      (typeof obj.language_detected === 'string' ? obj.language_detected : 'unknown'),
    total_features:         features.length,
    features:               features,
    architecture_conflicts: conflicts,
    recommended_migration_order: migrationOrder,
    summary:                (typeof obj.summary === 'string' ? obj.summary : 'Analysis complete.'),
    analyzedAt:             new Date().toISOString(),
  }
}

function validateFeature(raw: unknown): MigrationFeature | null {
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>

  const validStatuses = ['done', 'pending', 'needs_rework']
  const validRisks = ['Low', 'Medium', 'High']
  const validEfforts = ['Low', 'Medium', 'High']

  if (typeof obj.feature_name !== 'string' || !obj.feature_name.trim()) return null
  if (typeof obj.description !== 'string' || !obj.description.trim()) return null
  if (typeof obj.migration_status !== 'string' || !validStatuses.includes(obj.migration_status)) return null
  if (typeof obj.risk !== 'string' || !validRisks.includes(obj.risk)) return null
  if (typeof obj.effort !== 'string' || !validEfforts.includes(obj.effort)) return null
  if (typeof obj.recommended_approach !== 'string' || !obj.recommended_approach.trim()) return null
  if (typeof obj.priority_order !== 'number' || obj.priority_order < 1 || obj.priority_order > 9) return null

  let affected_files: string[] = []
  if (Array.isArray(obj.affected_files)) {
    affected_files = (obj.affected_files as unknown[])
      .filter(f => typeof f === 'string')
      .slice(0, 10)  // Max 10 files per feature
  }

  return {
    feature_name:          obj.feature_name.trim(),
    description:           obj.description.trim(),
    migration_status:      obj.migration_status as 'done' | 'pending' | 'needs_rework',
    risk:                  obj.risk as 'Low' | 'Medium' | 'High',
    effort:                obj.effort as 'Low' | 'Medium' | 'High',
    recommended_approach:  obj.recommended_approach.trim(),
    affected_files:        affected_files,
    priority_order:        Math.round(obj.priority_order as number),
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────
export { CODE_ANALYSIS_SYSTEM_PROMPT }
