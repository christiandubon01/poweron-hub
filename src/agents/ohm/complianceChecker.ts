// @ts-nocheck
/**
 * Compliance Checker Module — Project compliance verification, violation detection, and reporting.
 *
 * Features:
 * - Project-wide compliance assessment
 * - Code-specific requirements by project type
 * - Violation detection from field logs and project data
 * - Formatted compliance reports with recommendations
 */

import { supabase } from '@/lib/supabase'
import { OHM_SYSTEM_PROMPT } from './systemPrompt'
import { getJurisdictionRules } from './codeSearch'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceIssue {
  code: string
  severity: 'info' | 'warning' | 'error'
  title: string
  description: string
  necArticles: string[]
  recommendation: string
}

export interface ComplianceCheckResult {
  projectId: string
  compliant: boolean
  severityCount: { info: number; warning: number; error: number }
  issues: ComplianceIssue[]
  recommendations: string[]
  jurisdiction: string
  checkedAt: string
}

export interface ProjectTypeRequirements {
  projectType: string
  coreArticles: string[]
  calculationRequired: boolean
  permitRequired: boolean
  inspectionPoints: string[]
  commonViolations: string[]
}

// ── Violation Keywords ───────────────────────────────────────────────────────

const VIOLATION_KEYWORDS: Record<string, { severity: 'warning' | 'error'; title: string }> = {
  'no grounding': { severity: 'error', title: 'Missing Grounding' },
  'improper ground': { severity: 'error', title: 'Improper Grounding' },
  'missing bond': { severity: 'error', title: 'Missing Bonding' },
  'undersized wire': { severity: 'error', title: 'Undersized Wire' },
  'overloaded circuit': { severity: 'error', title: 'Overloaded Circuit' },
  'missing disconnect': { severity: 'warning', title: 'Missing Disconnect Means' },
  'improper conduit': { severity: 'warning', title: 'Improper Conduit Installation' },
  'conduit fill': { severity: 'warning', title: 'Excessive Conduit Fill' },
  'missing gfci': { severity: 'warning', title: 'Missing GFCI Protection' },
  'missing afci': { severity: 'warning', title: 'Missing AFCI Protection' },
  'improper label': { severity: 'info', title: 'Missing or Improper Labeling' },
  'clearance': { severity: 'warning', title: 'Inadequate Equipment Clearance' },
  'panel full': { severity: 'warning', title: 'Panel Lacks Space for Future Growth' },
  'open knock-out': { severity: 'warning', title: 'Open Knockouts Not Sealed' },
  'improper bonding': { severity: 'error', title: 'Improper Bonding Connection' },
}

// ── Project Type Code Requirements ───────────────────────────────────────────

/**
 * Get code requirements matrix for a project type and NEC version.
 *
 * @param projectType Type of project (e.g., "service upgrade", "new construction", "solar", "ev_charging")
 * @param necVersion NEC version (e.g., "2023")
 * @returns Promise with code requirements
 */
export async function getProjectTypeCodeRequirements(
  projectType: string,
  necVersion: string = '2023'
): Promise<ProjectTypeRequirements> {
  const typeMap: Record<string, ProjectTypeRequirements> = {
    service_upgrade: {
      projectType: 'Service Upgrade',
      coreArticles: ['110', '200', '230', '250', '408'],
      calculationRequired: true,
      permitRequired: true,
      inspectionPoints: [
        'Service entrance grounding',
        'Main disconnect clearance',
        'Panel bonding and labeling',
        'Load calculations verification',
        'Meter base installation',
      ],
      commonViolations: [
        'Undersized grounding electrode',
        'Missing main disconnect',
        'Improper panel labeling',
        'Inadequate panel space',
      ],
    },
    new_construction: {
      projectType: 'New Construction',
      coreArticles: ['110', '200', '210', '220', '250', '408'],
      calculationRequired: true,
      permitRequired: true,
      inspectionPoints: [
        'Service sizing calculations',
        'Branch circuit layout',
        'Grounding and bonding',
        'GFCI/AFCI requirements',
        'Code compliance of all systems',
      ],
      commonViolations: [
        'Improper branch circuit sizing',
        'Missing GFCI/AFCI protection',
        'Inadequate grounding',
        'Missing conduit support',
      ],
    },
    solar_pv: {
      projectType: 'Solar PV Installation',
      coreArticles: ['110', '200', '250', '408', '690'],
      calculationRequired: true,
      permitRequired: true,
      inspectionPoints: [
        'DC array and AC disconnect location',
        'Overcurrent protection sizing',
        'Grounding per 690.47',
        'Battery storage protection',
        'System bonding and equipment grounding',
        'California Title 24 compliance',
      ],
      commonViolations: [
        'Improper DC disconnect placement',
        'Inadequate overcurrent protection',
        'Missing equipment grounding conductor',
        'Battery bonding issues',
      ],
    },
    ev_charging: {
      projectType: 'EV Charging Installation',
      coreArticles: ['110', '200', '210', '220', '250', '625'],
      calculationRequired: true,
      permitRequired: true,
      inspectionPoints: [
        'Dedicated circuit sizing (NEC 625.23)',
        'Disconnect means location',
        'Overcurrent protection (NEC 625.21)',
        'Grounding and bonding',
        'Fault protection (NEC 625.16)',
        'Equipment listing and certification',
      ],
      commonViolations: [
        'Undersized feeder/branch circuit',
        'Missing dedicated disconnect',
        'Improper ground-fault protection',
        'Missing overcurrent protection',
      ],
    },
    sub_panel: {
      projectType: 'Sub-Panel Installation',
      coreArticles: ['200', '225', '250', '408'],
      calculationRequired: true,
      permitRequired: true,
      inspectionPoints: [
        'Feeder sizing (NEC 215.2)',
        'Grounded conductor bonding',
        'Equipment grounding',
        'Disconnect location',
        'Panel labeling and clearance',
      ],
      commonViolations: [
        'Undersized feeder',
        'Incorrect bonding configuration',
        'Missing grounding conductor',
        'Inadequate panel clearance',
      ],
    },
    remodel: {
      projectType: 'Remodel/Renovation',
      coreArticles: ['110', '200', '210', '250', '406'],
      calculationRequired: false,
      permitRequired: true,
      inspectionPoints: [
        'Outlet spacing and GFCI requirements',
        'Circuit protection adequacy',
        'Bonding continuity',
        'Code compliance of affected circuits',
        'Arc-fault protection where applicable',
      ],
      commonViolations: [
        'Missing GFCI/AFCI protection',
        'Inadequate outlet spacing',
        'Improper grounding',
        'Oversized wire protection',
      ],
    },
  }

  return (
    typeMap[projectType.toLowerCase()] || {
      projectType: projectType,
      coreArticles: ['110', '200', '250'],
      calculationRequired: false,
      permitRequired: true,
      inspectionPoints: ['General code compliance', 'Safe installation'],
      commonViolations: ['Code violations'],
    }
  )
}

// ── Code Violation Detection ─────────────────────────────────────────────────

/**
 * Detect potential code violations from text description.
 * Scans for common violation keywords and patterns.
 *
 * @param description Text to scan for violations
 * @param projectType Type of project for context
 * @returns Promise with detected violations
 */
export async function detectCodeViolations(
  description: string,
  projectType: string
): Promise<ComplianceIssue[]> {
  const lowerDesc = description.toLowerCase()
  const violations: ComplianceIssue[] = []

  // Check for violation keywords
  Object.entries(VIOLATION_KEYWORDS).forEach(([keyword, { severity, title }]) => {
    if (lowerDesc.includes(keyword)) {
      violations.push({
        code: keyword.replace(/\s+/g, '_').toUpperCase(),
        severity,
        title,
        description: `Detected potential "${keyword}" issue in project description`,
        necArticles: getArticlesForViolation(keyword),
        recommendation: getRecommendationForViolation(keyword),
      })
    }
  })

  return violations
}

/**
 * Map violation keywords to relevant NEC articles.
 *
 * @param violation Violation keyword
 * @returns Array of relevant NEC article numbers
 */
function getArticlesForViolation(violation: string): string[] {
  const violationArticles: Record<string, string[]> = {
    'no grounding': ['250', '110'],
    'improper ground': ['250', '110'],
    'missing bond': ['250', '408'],
    'undersized wire': ['310', '215', '220'],
    'overloaded circuit': ['210', '220', '215'],
    'missing disconnect': ['110', '225'],
    'improper conduit': ['353', '356', '358'],
    'conduit fill': ['353', '4'],
    'missing gfci': ['210', '406'],
    'missing afci': ['210', '406'],
    'improper label': ['110.21'],
    'clearance': ['110.26', '408.51'],
    'panel full': ['408.3'],
    'open knock-out': ['110.12'],
    'improper bonding': ['250'],
  }

  return violationArticles[violation] || ['110']
}

/**
 * Get recommendation for addressing a violation.
 *
 * @param violation Violation keyword
 * @returns Recommendation string
 */
function getRecommendationForViolation(violation: string): string {
  const recommendations: Record<string, string> = {
    'no grounding': 'Verify all equipment and enclosures are properly grounded per NEC 250.4. Conduct grounding resistance test.',
    'improper ground': 'Correct grounding connections per NEC 250.53 and 250.66. Verify grounding electrode resistance.',
    'missing bond': 'Install bonding jumpers per NEC 250.96 and 250.102 for all metal enclosures.',
    'undersized wire': 'Upsize conductor per NEC 310.15 tables. Consider voltage drop and ampacity derating.',
    'overloaded circuit': 'Redistribute load or increase service capacity. Verify per NEC 220 demand calculations.',
    'missing disconnect': 'Install disconnect means per NEC 110.36 and 225.31 within sight of equipment.',
    'improper conduit': 'Reinstall conduit using proper support and securing per NEC 353.30.',
    'conduit fill': 'Check fill percentage per NEC 4 tables. Size up conduit or reduce conductor count.',
    'missing gfci': 'Install GFCI protection for wet locations per NEC 210.8.',
    'missing afci': 'Install AFCI protection for branch circuits per NEC 210.12.',
    'improper label': 'Label all circuits and equipment per NEC 110.21(B) and 408.4.',
    'clearance': 'Ensure equipment clearance per NEC 110.26 and 408.51.',
    'panel full': 'Install space for future growth. Consider relocating panel or installing subpanel.',
    'open knock-out': 'Seal all open knockouts with appropriate closure devices per NEC 110.12(A).',
    'improper bonding': 'Install equipment bonding conductors per NEC 250.102 and 250.110.',
  }

  return recommendations[violation] || 'Address this violation per applicable NEC articles.'
}

// ── Project Compliance Checking ──────────────────────────────────────────────

/**
 * Check overall compliance of a project.
 *
 * @param projectId Project ID
 * @param jurisdiction Jurisdiction for rule lookup
 * @returns Promise with compliance check result
 */
export async function checkProjectCompliance(
  projectId: string,
  jurisdiction: string
): Promise<ComplianceCheckResult> {
  try {
    // Fetch project details
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      throw new Error(`Project not found: ${projectError?.message}`)
    }

    const issues: ComplianceIssue[] = []

    // Get code requirements for project type
    const requirements = await getProjectTypeCodeRequirements(project.type, project.nec_version)

    // Check jurisdiction rules
    const jurisdictionRules = await getJurisdictionRules(jurisdiction)

    // Add jurisdiction rule compliance checks
    jurisdictionRules.forEach(rule => {
      if (rule.severity === 'error' && !project.description?.includes('compliant')) {
        issues.push({
          code: rule.id,
          severity: rule.severity,
          title: `Jurisdiction Requirement: ${rule.rule_category}`,
          description: rule.rule_text,
          necArticles: [rule.nec_article],
          recommendation: `Ensure compliance with local AHJ requirement: ${rule.rule_category}`,
        })
      }
    })

    // Fetch field logs to check for violations
    const { data: fieldLogs, error: logsError } = await supabase
      .from('field_logs')
      .select('*')
      .eq('project_id', projectId)

    // ERROR 4 fix: log the exact Supabase error so we can diagnose 400s
    if (logsError) {
      console.error('[ComplianceChecker] field_logs query failed (400 or schema mismatch):',
        logsError.message, '| code:', logsError.code, '| details:', logsError.details,
        '\nNote: If 400, check that field_logs table has a "project_id" column in Supabase.'
      )
    }

    if (!logsError && fieldLogs) {
      for (const log of fieldLogs) {
        const detectedViolations = await detectCodeViolations(log.notes || '', project.type)
        issues.push(...detectedViolations)
      }
    }

    // Check project description for violations
    if (project.description) {
      const descriptionViolations = await detectCodeViolations(project.description, project.type)
      issues.push(...descriptionViolations)
    }

    // Count severity levels
    const severityCount = {
      info: issues.filter(i => i.severity === 'info').length,
      warning: issues.filter(i => i.severity === 'warning').length,
      error: issues.filter(i => i.severity === 'error').length,
    }

    // Generate recommendations
    const recommendations = generateRecommendations(
      project,
      requirements,
      issues,
      severityCount
    )

    // Determine overall compliance
    const compliant = severityCount.error === 0

    return {
      projectId,
      compliant,
      severityCount,
      issues,
      recommendations,
      jurisdiction,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error('[OHM] checkProjectCompliance error:', err)
    throw err
  }
}

// ── Compliance Report Generation ─────────────────────────────────────────────

/**
 * Generate formatted compliance report using Claude.
 *
 * @param projectId Project ID
 * @param jurisdiction Jurisdiction for context
 * @returns Promise with formatted report
 */
export async function generateComplianceReport(
  projectId: string,
  jurisdiction: string
): Promise<string> {
  try {
    // Get compliance check results
    const checkResult = await checkProjectCompliance(projectId, jurisdiction)

    // Fetch project details
    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (!project) {
      throw new Error('Project not found')
    }

    // Format issues for Claude
    const issuesText = checkResult.issues
      .map(
        issue =>
          `- [${issue.severity.toUpperCase()}] ${issue.title}: ${issue.description}
        NEC Articles: ${issue.necArticles.join(', ')}
        Recommendation: ${issue.recommendation}`
      )
      .join('\n')

    const prompt = `Generate a professional electrical code compliance report:

Project: ${project.type}
Jurisdiction: ${jurisdiction}
NEC Version: ${project.nec_version}
Compliance Status: ${checkResult.compliant ? 'COMPLIANT' : 'NON-COMPLIANT'}

Issues Found (${checkResult.severityCount.error} errors, ${checkResult.severityCount.warning} warnings, ${checkResult.severityCount.info} info):
${issuesText || 'No issues detected'}

Recommendations:
${checkResult.recommendations.map(r => `- ${r}`).join('\n')}

Format as:
1. Executive Summary (1 paragraph)
2. Compliance Status (pass/fail with severity counts)
3. Issues & Required Actions (by severity)
4. Recommendations
5. Next Steps

Be specific, professional, and actionable.`

    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': (import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : '') as string,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: OHM_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const data = await response.json()
    const report = (data.content?.[0]?.text ?? '') as string

    return report
  } catch (err) {
    console.error('[OHM] generateComplianceReport error:', err)
    throw err
  }
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Generate compliance recommendations based on check results.
 */
function generateRecommendations(
  project: any,
  requirements: ProjectTypeRequirements,
  issues: ComplianceIssue[],
  severityCount: { info: number; warning: number; error: number }
): string[] {
  const recommendations: string[] = []

  // Critical issues first
  if (severityCount.error > 0) {
    recommendations.push(
      `URGENT: Address ${severityCount.error} critical code violation(s) before proceeding with project.`
    )
  }

  // Calculation requirements
  if (requirements.calculationRequired) {
    recommendations.push(`Verify load calculations per NEC 220 for this ${requirements.projectType}.`)
  }

  // Inspection points
  if (requirements.inspectionPoints.length > 0) {
    recommendations.push(`Schedule final inspection covering: ${requirements.inspectionPoints.slice(0, 3).join(', ')}.`)
  }

  // Permit requirement
  if (requirements.permitRequired) {
    recommendations.push(`Verify this ${requirements.projectType} requires AHJ permit in ${project.ahj_jurisdiction || 'local jurisdiction'}.`)
  }

  // Jurisdiction-specific
  if (project.ahj_jurisdiction?.includes('California')) {
    recommendations.push('Apply California Title 24 amendments if solar, battery, or EV charging is included.')
  }

  // General best practice
  if (issues.length === 0) {
    recommendations.push('Project appears compliant with NEC 2023. Proceed to submission.')
  } else if (severityCount.warning > 0) {
    recommendations.push(`Review and resolve ${severityCount.warning} warning(s) for smooth AHJ review.`)
  }

  return recommendations
}
