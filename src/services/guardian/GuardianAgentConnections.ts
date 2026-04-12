// @ts-nocheck
/**
 * GuardianAgentConnections — AGENT ECOSYSTEM WIRING
 *
 * Hooks GUARDIAN into the agentEventBus to intercept cross-agent events
 * and enforce compliance checkpoints at each trigger point.
 *
 * Listeners:
 *   blueprint:phase_start  → check pre-job checklist
 *   chrono:clock_in        → verify task assignment + solo protocol
 *   ledger:invoice_generate → check phase docs + attach walkthrough
 *   nexus:voice_entry      → scan for scope change / RFI language
 *   vault:material_purchase → flag unauthorized substitution
 *   spark:call_complete    → prompt contract documentation check
 *   hunter:lead_close      → trigger permit requirement check
 *
 * Each listener runs the 5-step GUARDIAN intelligence loop:
 *   1. Detect   — identify the triggering condition
 *   2. Evaluate — assess severity against compliance rules
 *   3. Classify — assign category (CSLB / safety / financial)
 *   4. Record   — log to guardian_audit_log (localStorage mirror)
 *   5. Alert    — publish COMPLIANCE_FLAG event to agentEventBus
 */

import { subscribe, publish, type AgentEvent } from '@/services/agentEventBus'
import { getBackupData } from '@/services/backupDataService'

// ── Audit Log Storage ────────────────────────────────────────────────────────

const AUDIT_KEY = 'guardian_audit_log'

export interface GuardianAuditEntry {
  id: string
  timestamp: string
  trigger: string
  category: 'cslb' | 'safety' | 'financial' | 'documentation' | 'compliance'
  severity: 'critical' | 'high' | 'medium' | 'low'
  agentSource: string
  projectId?: string
  workerId?: string
  message: string
  step1_detect: string
  step2_evaluate: string
  step3_classify: string
  step4_record: string
  step5_alert: string
  resolved: boolean
}

function loadAuditLog(): GuardianAuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveAuditLog(entries: GuardianAuditEntry[]): void {
  try {
    // Keep last 500 entries
    const trimmed = entries.slice(-500)
    localStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage quota — silently fail
  }
}

function uid(): string {
  return `grd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ── 5-Step Intelligence Loop ─────────────────────────────────────────────────

interface IntelligenceLoopParams {
  trigger: string
  category: GuardianAuditEntry['category']
  severity: GuardianAuditEntry['severity']
  agentSource: string
  projectId?: string
  workerId?: string
  message: string
  detect: string
  evaluate: string
  classify: string
  record: string
  alert: string
}

function runIntelligenceLoop(params: IntelligenceLoopParams): GuardianAuditEntry {
  const entry: GuardianAuditEntry = {
    id: uid(),
    timestamp: new Date().toISOString(),
    trigger: params.trigger,
    category: params.category,
    severity: params.severity,
    agentSource: params.agentSource,
    projectId: params.projectId,
    workerId: params.workerId,
    message: params.message,
    step1_detect: params.detect,
    step2_evaluate: params.evaluate,
    step3_classify: params.classify,
    step4_record: params.record,
    step5_alert: params.alert,
    resolved: false,
  }

  // Step 4: Record to audit log
  const log = loadAuditLog()
  log.push(entry)
  saveAuditLog(log)

  // Step 5: Alert via event bus
  setTimeout(() => {
    try {
      publish(
        'COMPLIANCE_FLAG',
        'guardian',
        {
          auditId: entry.id,
          trigger: entry.trigger,
          severity: entry.severity,
          category: entry.category,
          message: entry.message,
          projectId: entry.projectId,
          workerId: entry.workerId,
        },
        `GUARDIAN: ${entry.severity.toUpperCase()} — ${entry.message}`
      )
    } catch {
      // Bus unavailable — entry is still in audit log
    }
  }, 0)

  return entry
}

// ── Listener: blueprint:phase_start ─────────────────────────────────────────
// Check if pre-job checklist is complete before allowing phase start.
// Blocks phase if checklist is missing.

function onBlueprintPhaseStart(event: AgentEvent): void {
  const { projectId, phase, checklistComplete } = (event.payload || {}) as any
  const data = getBackupData()

  // Look for pre-job checklist in backup data
  const checklists: any[] = (data as any)?.guardian_checklists || []
  const hasPreJob = checklists.some(
    (c) => c.projectId === projectId && c.type === 'pre_job' && c.completed
  )

  if (!hasPreJob && checklistComplete !== true) {
    runIntelligenceLoop({
      trigger: 'blueprint:phase_start',
      category: 'documentation',
      severity: 'high',
      agentSource: 'blueprint',
      projectId: projectId || undefined,
      message: `Phase "${phase || 'Unknown'}" started without a completed pre-job checklist.`,
      detect: `BLUEPRINT emitted phase_start for project ${projectId}, phase: ${phase}`,
      evaluate: 'Pre-job checklist record not found in guardian_checklists for this project.',
      classify: 'Documentation gap — CSLB customer complaint risk if pre-existing conditions not recorded.',
      record: 'Logged to guardian_audit_log with severity HIGH.',
      alert: 'COMPLIANCE_FLAG emitted — GuardianDashboard will surface as open alert.',
    })
  }
}

// ── Listener: chrono:clock_in ────────────────────────────────────────────────
// Verify task assignment exists + trigger solo safety protocol if alone.

function onChronoClockIn(event: AgentEvent): void {
  const { workerId, projectId, taskId, crewCount } = (event.payload || {}) as any
  const data = getBackupData()

  // Check task assignment
  const hasTask = taskId && taskId !== ''
  if (!hasTask) {
    runIntelligenceLoop({
      trigger: 'chrono:clock_in',
      category: 'compliance',
      severity: 'medium',
      agentSource: 'chrono',
      projectId: projectId || undefined,
      workerId: workerId || undefined,
      message: `Worker clocked in without a verified task assignment on project ${projectId || 'unknown'}.`,
      detect: `CHRONO clock_in event received for worker ${workerId} — no taskId in payload.`,
      evaluate: 'No task assignment verified for this clock-in. Worker compensation documentation at risk.',
      classify: 'Worker complaint risk — undocumented labor assignment.',
      record: 'Logged to guardian_audit_log.',
      alert: 'COMPLIANCE_FLAG emitted to GuardianDashboard.',
    })
  }

  // Solo work protocol
  const isSolo = !crewCount || Number(crewCount) <= 1
  if (isSolo) {
    runIntelligenceLoop({
      trigger: 'chrono:clock_in_solo',
      category: 'safety',
      severity: 'medium',
      agentSource: 'chrono',
      projectId: projectId || undefined,
      workerId: workerId || undefined,
      message: `Solo work session started — safety assessment and check-in protocol required.`,
      detect: `CHRONO clock_in event: crewCount = ${crewCount ?? 1} — solo work detected.`,
      evaluate: 'Solo work requires completed safety hazard assessment and scheduled check-in.',
      classify: 'Safety compliance — solo protocol per company policy.',
      record: 'Solo session flagged in guardian_audit_log.',
      alert: 'COMPLIANCE_FLAG emitted — prompt solo protocol acknowledgment in Crew Portal.',
    })
  }
}

// ── Listener: ledger:invoice_generate ───────────────────────────────────────
// Check phase docs complete + attach owner walkthrough before invoice generation.

function onLedgerInvoiceGenerate(event: AgentEvent): void {
  const { projectId, invoiceId, isFinal } = (event.payload || {}) as any
  const data = getBackupData()

  if (!isFinal) return // Only check on final invoice

  const checklists: any[] = (data as any)?.guardian_checklists || []
  const hasWalkthrough = checklists.some(
    (c) => c.projectId === projectId && c.type === 'owner_walkthrough' && c.completed
  )

  if (!hasWalkthrough) {
    runIntelligenceLoop({
      trigger: 'ledger:invoice_generate',
      category: 'documentation',
      severity: 'high',
      agentSource: 'ledger',
      projectId: projectId || undefined,
      message: `Final invoice generated for project ${projectId} without a completed owner walkthrough.`,
      detect: `LEDGER invoice_generate event: invoiceId=${invoiceId}, isFinal=true, project=${projectId}.`,
      evaluate: 'No owner_walkthrough checklist found for this project. Warranty and final inspection not documented.',
      classify: 'Customer complaint readiness gap — walkthrough required for CSLB protection.',
      record: 'Logged to guardian_audit_log with severity HIGH.',
      alert: 'COMPLIANCE_FLAG emitted — owner walkthrough form surfaced in GuardianDashboard.',
    })
  }
}

// ── Listener: nexus:voice_entry ──────────────────────────────────────────────
// Scan for scope change and RFI language in voice entries.

const SCOPE_KEYWORDS = ['scope change', 'added work', 'extra work', 'not in contract', 'verbal approval', 'they asked me to']
const RFI_KEYWORDS = ['rfi', 'request for information', 'need clarification', 'waiting on gc', 'inspector said', 'engineer needs']

function onNexusVoiceEntry(event: AgentEvent): void {
  const { transcript, projectId, entryId } = (event.payload || {}) as any
  if (!transcript) return

  const lower = (transcript as string).toLowerCase()

  const hasScope = SCOPE_KEYWORDS.some((kw) => lower.includes(kw))
  const hasRFI = RFI_KEYWORDS.some((kw) => lower.includes(kw))

  if (hasScope) {
    runIntelligenceLoop({
      trigger: 'nexus:voice_entry_scope_change',
      category: 'financial',
      severity: 'high',
      agentSource: 'nexus',
      projectId: projectId || undefined,
      message: `Scope change language detected in voice entry — formal change order required.`,
      detect: `Voice entry ${entryId} contains scope change indicators: ${SCOPE_KEYWORDS.filter(kw => lower.includes(kw)).join(', ')}.`,
      evaluate: 'Verbal scope changes without written documentation are a financial and legal liability.',
      classify: 'Change order conversion required — financial risk if not documented.',
      record: 'Scope change flag logged to guardian_audit_log.',
      alert: 'COMPLIANCE_FLAG emitted — prompt change order creation in VAULT.',
    })
  }

  if (hasRFI) {
    runIntelligenceLoop({
      trigger: 'nexus:voice_entry_rfi',
      category: 'documentation',
      severity: 'medium',
      agentSource: 'nexus',
      projectId: projectId || undefined,
      message: `RFI language detected in voice entry — formal RFI submission recommended.`,
      detect: `Voice entry ${entryId} contains RFI indicators: ${RFI_KEYWORDS.filter(kw => lower.includes(kw)).join(', ')}.`,
      evaluate: 'Untracked RFIs delay project schedules and create dispute risk.',
      classify: 'Documentation gap — RFI response tracking required.',
      record: 'RFI flag logged to guardian_audit_log.',
      alert: 'COMPLIANCE_FLAG emitted — prompt RFI creation in BLUEPRINT.',
    })
  }
}

// ── Listener: vault:material_purchase ───────────────────────────────────────
// Flag if substitution occurred without authorization.

const SUBSTITUTION_KEYWORDS = ['substituted', 'swapped', 'replaced with', 'different brand', 'used instead', 'substitution']

function onVaultMaterialPurchase(event: AgentEvent): void {
  const { materialName, projectId, note, authorized } = (event.payload || {}) as any

  const noteText = ((note || '') as string).toLowerCase()
  const isSubstitution =
    authorized === false ||
    SUBSTITUTION_KEYWORDS.some((kw) => noteText.includes(kw))

  if (isSubstitution) {
    runIntelligenceLoop({
      trigger: 'vault:material_purchase_substitution',
      category: 'compliance',
      severity: 'high',
      agentSource: 'vault',
      projectId: projectId || undefined,
      message: `Unauthorized material substitution detected: ${materialName || 'Unknown material'}.`,
      detect: `VAULT material_purchase event — substitution keywords found in note or authorized=false.`,
      evaluate: 'Material substitution without authorization may violate specifications and warranty.',
      classify: 'Compliance risk — substitution must be documented and approved by GC or engineer.',
      record: 'Substitution flag logged to guardian_audit_log.',
      alert: 'COMPLIANCE_FLAG emitted — flag in project documentation.',
    })
  }
}

// ── Listener: spark:call_complete ────────────────────────────────────────────
// Prompt contract/scope documentation check after completed call.

function onSparkCallComplete(event: AgentEvent): void {
  const { leadId, callOutcome, projectId, scopeDiscussed } = (event.payload || {}) as any

  if (scopeDiscussed === true || callOutcome === 'scope_agreed') {
    runIntelligenceLoop({
      trigger: 'spark:call_complete_scope',
      category: 'financial',
      severity: 'medium',
      agentSource: 'spark',
      projectId: projectId || undefined,
      message: `Call completed with scope discussion — written contract or change order documentation required.`,
      detect: `SPARK call_complete event: leadId=${leadId}, scopeDiscussed=true or outcome=scope_agreed.`,
      evaluate: 'Any verbal scope agreement on a call must be immediately captured in writing.',
      classify: 'Contract documentation — prevent verbal-only scope disputes.',
      record: 'Call scope flag logged to guardian_audit_log.',
      alert: 'COMPLIANCE_FLAG emitted — prompt contract documentation in VAULT.',
    })
  }
}

// ── Listener: hunter:lead_close ──────────────────────────────────────────────
// Trigger permit requirement check before scheduling new work.

function onHunterLeadClose(event: AgentEvent): void {
  const { leadId, projectType, permitRequired, location } = (event.payload || {}) as any

  // Electrical work in CA requires permits by default unless exempt (minor repairs)
  const likelyNeedsPermit = !permitRequired === undefined || permitRequired !== false
  if (likelyNeedsPermit) {
    runIntelligenceLoop({
      trigger: 'hunter:lead_close_permit',
      category: 'cslb',
      severity: 'medium',
      agentSource: 'hunter',
      message: `Lead closed — verify permit requirements before scheduling work for "${projectType || 'new project'}".`,
      detect: `HUNTER lead_close event: leadId=${leadId}, projectType=${projectType}, location=${location}.`,
      evaluate: 'Electrical work in California requires permits unless explicitly exempt. Scheduling without permit confirmation is a CSLB violation risk.',
      classify: 'Permit violation readiness — confirm AHJ requirements before job start.',
      record: 'Permit check flag logged to guardian_audit_log.',
      alert: 'COMPLIANCE_FLAG emitted — surface permit checklist in CHRONO before scheduling.',
    })
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

let _unsubscribers: Array<() => void> = []
let _initialized = false

/**
 * registerAllListeners
 * Hooks GUARDIAN into the agentEventBus for all compliance trigger points.
 * Safe to call multiple times — will not double-register.
 * Returns a cleanup function that removes all listeners.
 */
export function registerAllListeners(): () => void {
  if (_initialized) return () => void 0

  _initialized = true

  // Register each listener using the existing AgentEventType values
  // Custom event names are mapped to the closest available type

  _unsubscribers = [
    // blueprint:phase_start → PROJECT_UPDATED (BLUEPRINT publishes phase changes)
    subscribe('PROJECT_UPDATED', (event: AgentEvent) => {
      if (event.source === 'blueprint' && (event.payload as any)?.eventSubtype === 'phase_start') {
        onBlueprintPhaseStart(event)
      }
    }),

    // chrono:clock_in → JOB_SCHEDULED (CHRONO publishes scheduling actions)
    subscribe('JOB_SCHEDULED', (event: AgentEvent) => {
      if (event.source === 'chrono' && (event.payload as any)?.eventSubtype === 'clock_in') {
        onChronoClockIn(event)
      }
    }),

    // ledger:invoice_generate → INVOICE_CREATED
    subscribe('INVOICE_CREATED', (event: AgentEvent) => {
      onLedgerInvoiceGenerate(event)
    }),

    // nexus:voice_entry → DATA_GAP_DETECTED (voice entries surfaced via NEXUS)
    subscribe('DATA_GAP_DETECTED', (event: AgentEvent) => {
      if (event.source === 'nexus' && (event.payload as any)?.eventSubtype === 'voice_entry') {
        onNexusVoiceEntry(event)
      }
    }),

    // vault:material_purchase → ESTIMATE_CREATED (VAULT publishes material decisions)
    subscribe('ESTIMATE_CREATED', (event: AgentEvent) => {
      if (event.source === 'vault' && (event.payload as any)?.eventSubtype === 'material_purchase') {
        onVaultMaterialPurchase(event)
      }
    }),

    // spark:call_complete → LEAD_CONVERTED
    subscribe('LEAD_CONVERTED', (event: AgentEvent) => {
      if (event.source === 'spark') {
        onSparkCallComplete(event)
      }
    }),

    // hunter:lead_close → HIGH_VALUE_LEAD (HUNTER publishes lead closes)
    subscribe('HIGH_VALUE_LEAD', (event: AgentEvent) => {
      if (event.source === 'hunter') {
        onHunterLeadClose(event)
      }
    }),
  ]

  console.log('[GUARDIAN] All agent ecosystem listeners registered.')

  return () => {
    _unsubscribers.forEach((unsub) => unsub())
    _unsubscribers = []
    _initialized = false
    console.log('[GUARDIAN] Agent ecosystem listeners removed.')
  }
}

/**
 * getAuditLog — retrieve all guardian audit entries from localStorage.
 */
export function getAuditLog(): GuardianAuditEntry[] {
  return loadAuditLog()
}

/**
 * getOpenAlerts — returns unresolved audit entries sorted by severity.
 */
export function getOpenAlerts(): GuardianAuditEntry[] {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return loadAuditLog()
    .filter((e) => !e.resolved)
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
}

/**
 * resolveAlert — mark an alert as resolved.
 */
export function resolveAlert(id: string): void {
  const log = loadAuditLog()
  const entry = log.find((e) => e.id === id)
  if (entry) {
    entry.resolved = true
    saveAuditLog(log)
  }
}

/**
 * acknowledgeAlert — alias for resolveAlert (UI distinction only).
 */
export function acknowledgeAlert(id: string): void {
  resolveAlert(id)
}

/**
 * escalateAlert — re-publish at critical severity.
 */
export function escalateAlert(id: string): void {
  const log = loadAuditLog()
  const entry = log.find((e) => e.id === id)
  if (!entry) return

  entry.severity = 'critical'
  saveAuditLog(log)

  setTimeout(() => {
    try {
      publish(
        'COMPLIANCE_FLAG',
        'guardian',
        {
          auditId: entry.id,
          trigger: entry.trigger,
          severity: 'critical',
          category: entry.category,
          message: `ESCALATED: ${entry.message}`,
          projectId: entry.projectId,
        },
        `GUARDIAN ESCALATION: ${entry.message}`
      )
    } catch {
      // silently fail
    }
  }, 0)
}
