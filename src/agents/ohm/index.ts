// @ts-nocheck
/**
 * OHM Orchestrator — Routes and processes electrical code compliance requests.
 *
 * Request types:
 * - code_question: Answer electrical code questions using NEC knowledge
 * - compliance_check: Verify project code compliance
 * - calculate: Perform electrical calculations (wire_size, conduit_fill, load_demand)
 * - generate_report: Create formatted compliance report
 *
 * Integrates with NEXUS router for agent delegation.
 */

import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'
import { OHM_SYSTEM_PROMPT } from './systemPrompt'
import * as codeSearch from './codeSearch'
import * as complianceChecker from './complianceChecker'
import * as calculators from './calculators'
import { storeEmbedding } from '@/services/embeddingService'
import { analyzeAfterWrite } from '@/services/patternService'

// ── Phase F: fire-and-forget embedding + pattern learning helper ─────────────
function fireAndForgetMemory(orgId: string, entityType: string, entityId: string, content: string, metadata?: Record<string, unknown>) {
  storeEmbedding(entityType as any, entityId, content, metadata, orgId).catch(() => { /* non-critical */ })
  analyzeAfterWrite(entityType, { ...metadata, id: entityId }, orgId).catch(() => { /* non-critical */ })
}

// ── Types ────────────────────────────────────────────────────────────────────

export type OhmAction =
  | 'code_question'
  | 'compliance_check'
  | 'calculate'
  | 'generate_report'

export interface OhmRequest {
  action: OhmAction
  orgId: string
  userId: string
  payload?: Record<string, unknown>
  userMessage?: string
}

export interface OhmResponse {
  success: boolean
  action: OhmAction
  data?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

// ── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * Process an OHM request.
 * Routes to appropriate handler based on action.
 * Exported for NEXUS router integration.
 */
export async function processOhmRequest(request: OhmRequest): Promise<OhmResponse> {
  try {
    switch (request.action) {
      case 'code_question':
        return await handleCodeQuestion(request)

      case 'compliance_check':
        return await handleComplianceCheck(request)

      case 'calculate':
        return await handleCalculate(request)

      case 'generate_report':
        return await handleGenerateReport(request)

      default:
        return {
          success: false,
          action: request.action,
          error: `Unknown action: ${request.action}`,
        }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[OHM] ${request.action} failed:`, err)
    return {
      success: false,
      action: request.action,
      error: errorMessage,
    }
  }
}

// ── Code Question Handler ────────────────────────────────────────────────────

/**
 * Answer electrical code questions using NEC knowledge.
 * Searches code database and uses Claude to provide detailed guidance.
 */
async function handleCodeQuestion(req: OhmRequest): Promise<OhmResponse> {
  if (!req.userMessage) {
    return {
      success: false,
      action: 'code_question',
      error: 'No question provided',
    }
  }

  try {
    // Get jurisdiction from payload
    const jurisdiction = (req.payload?.jurisdiction as string) || 'California'

    // Search NEC articles
    const searchResults = await codeSearch.searchNECArticles(
      req.userMessage,
      jurisdiction
    )

    // Format code search context
    const articlesContext = searchResults.articles
      .map(a => codeSearch.formatNECArticle(a))
      .join('\n\n')

    const rulesContext = searchResults.rules
      .map(r => codeSearch.formatJurisdictionRule(r))
      .join('\n\n')

    const contextMessage = `
Available NEC Articles:
${articlesContext || 'No articles found'}

Jurisdiction Rules (${jurisdiction}):
${rulesContext || 'No jurisdiction-specific rules found'}

User Question: "${req.userMessage}"
`

    // Use Claude to answer with code context
    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: OHM_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contextMessage }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const data = await response.json()
    const answer = (data.content?.[0]?.text ?? '') as string

    // Log audit
    await logAudit({
      action: 'code_question',
      entity_type: 'ohm_request',
      entity_id: `${req.orgId}-code-question`,
      description: `Code question answered: "${req.userMessage.substring(0, 100)}"`,
      metadata: { question: req.userMessage, jurisdiction },
    })

    return {
      success: true,
      action: 'code_question',
      data: {
        answer,
        references: searchResults.articles.map(a => ({
          article: a.article_number,
          title: a.title,
          section: a.section,
        })),
        jurisdiction,
      },
      metadata: { articlesUsed: searchResults.articles.length },
    }
  } catch (err) {
    throw err
  }
}

// ── Compliance Check Handler ─────────────────────────────────────────────────

/**
 * Check project code compliance.
 * Verifies NEC 2023 requirements and jurisdiction rules.
 */
async function handleComplianceCheck(req: OhmRequest): Promise<OhmResponse> {
  const projectId = req.payload?.projectId as string | undefined
  const jurisdiction = (req.payload?.jurisdiction as string) || 'California'

  if (!projectId) {
    return {
      success: false,
      action: 'compliance_check',
      error: 'projectId required',
    }
  }

  try {
    const result = await complianceChecker.checkProjectCompliance(
      projectId,
      jurisdiction
    )

    // Log audit
    await logAudit({
      action: 'compliance_check',
      entity_type: 'projects',
      entity_id: projectId,
      description: `Compliance check: ${result.compliant ? 'COMPLIANT' : 'NON-COMPLIANT'} (${result.severityCount.error} errors, ${result.severityCount.warning} warnings)`,
      metadata: {
        compliant: result.compliant,
        severity_count: result.severityCount,
        jurisdiction,
      },
    })

    // Phase F: store compliance flag embedding + trigger pattern learning (fire-and-forget)
    if (!result.compliant && result.flags?.length > 0) {
      const topFlag = result.flags[0]
      const content = `Compliance flag: project ${projectId} in ${jurisdiction}. ${topFlag?.code || ''}: ${topFlag?.description || ''}. ${result.severityCount?.error || 0} errors, ${result.severityCount?.warning || 0} warnings.`
      fireAndForgetMemory(req.orgId, 'compliance_flag', `${projectId}_compliance`, content, {
        project_id: projectId,
        jurisdiction,
        compliant: result.compliant,
        error_count: result.severityCount?.error,
        warning_count: result.severityCount?.warning,
        nec_code: topFlag?.code,
        code: topFlag?.code,
      })
    }

    return {
      success: true,
      action: 'compliance_check',
      data: result,
    }
  } catch (err) {
    throw err
  }
}

// ── Calculate Handler ────────────────────────────────────────────────────────

/**
 * Perform electrical calculations.
 * Routes to wire_size, conduit_fill, or load_demand calculator.
 */
async function handleCalculate(req: OhmRequest): Promise<OhmResponse> {
  const calcType = req.payload?.type as string | undefined

  if (!calcType) {
    return {
      success: false,
      action: 'calculate',
      error: 'Calculation type required (wire_size, conduit_fill, load_demand)',
    }
  }

  try {
    let result: unknown

    switch (calcType) {
      case 'wire_size':
        result = handleWireSizeCalc(req.payload)
        break
      case 'conduit_fill':
        result = handleConduitFillCalc(req.payload)
        break
      case 'load_demand':
        result = handleLoadDemandCalc(req.payload)
        break
      default:
        return {
          success: false,
          action: 'calculate',
          error: `Unknown calculation type: ${calcType}`,
        }
    }

    // Log audit
    await logAudit({
      action: 'calculate',
      entity_type: 'ohm_calculation',
      entity_id: `${req.orgId}-${calcType}`,
      description: `${calcType} calculation performed`,
      metadata: { calc_type: calcType, payload: req.payload },
    })

    return {
      success: true,
      action: 'calculate',
      data: result,
      metadata: { calculationType: calcType },
    }
  } catch (err) {
    throw err
  }
}

/**
 * Wire size calculator handler.
 */
function handleWireSizeCalc(payload: Record<string, unknown>): unknown {
  const amperage = payload.amperage as number
  const voltage = payload.voltage as number
  const distance = payload.distance as number
  const conductorType = payload.conductorType as 'copper' | 'aluminum'
  const installationMethod = payload.installationMethod as
    | 'conduit'
    | 'free_air'
    | 'buried'
    | 'cable_tray'
  const ambientTemp = payload.ambientTemp as number | undefined

  if (!amperage || !voltage || !distance || !conductorType || !installationMethod) {
    throw new Error(
      'Required: amperage, voltage, distance, conductorType, installationMethod'
    )
  }

  return calculators.calculateWireSize(
    amperage,
    voltage,
    distance,
    conductorType,
    installationMethod,
    ambientTemp
  )
}

/**
 * Conduit fill calculator handler.
 */
function handleConduitFillCalc(payload: Record<string, unknown>): unknown {
  const conductors = payload.conductors as Array<{ gauge: string; type: string }> | undefined
  const conduitType = payload.conduitType as string
  const conduitSize = payload.conduitSize as string

  if (!conductors || !Array.isArray(conductors) || !conduitType || !conduitSize) {
    throw new Error('Required: conductors (array), conduitType, conduitSize')
  }

  return calculators.calculateConduitFill(
    conductors as any,
    conduitType,
    conduitSize
  )
}

/**
 * Load demand calculator handler.
 */
function handleLoadDemandCalc(payload: Record<string, unknown>): unknown {
  const circuits = payload.circuits as Array<{
    type: string
    watts: number
    continuous: boolean
  }> | undefined
  const serviceSize = payload.serviceSize as number
  const voltage = payload.voltage as number | undefined

  if (!circuits || !Array.isArray(circuits) || !serviceSize) {
    throw new Error('Required: circuits (array), serviceSize')
  }

  return calculators.calculateLoadDemand(
    circuits as any,
    serviceSize,
    voltage
  )
}

// ── Generate Report Handler ──────────────────────────────────────────────────

/**
 * Generate formatted compliance report.
 * Uses Claude to structure and present findings professionally.
 */
async function handleGenerateReport(req: OhmRequest): Promise<OhmResponse> {
  const projectId = req.payload?.projectId as string | undefined
  const jurisdiction = (req.payload?.jurisdiction as string) || 'California'

  if (!projectId) {
    return {
      success: false,
      action: 'generate_report',
      error: 'projectId required',
    }
  }

  try {
    const report = await complianceChecker.generateComplianceReport(
      projectId,
      jurisdiction
    )

    // Log audit
    await logAudit({
      action: 'generate_report',
      entity_type: 'projects',
      entity_id: projectId,
      description: `Compliance report generated for ${jurisdiction}`,
      metadata: { jurisdiction, reportLength: report.length },
    })

    return {
      success: true,
      action: 'generate_report',
      data: {
        report,
        projectId,
        jurisdiction,
        generatedAt: new Date().toISOString(),
      },
    }
  } catch (err) {
    throw err
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { codeSearch, complianceChecker, calculators }
