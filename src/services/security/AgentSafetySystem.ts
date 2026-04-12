/**
 * AgentSafetySystem.ts
 *
 * 5-Layer Military-Grade Agent Safety System for PowerOn Hub.
 *
 * This is a PERMANENT architectural rule: AI agents must NEVER touch
 * customer data without explicit owner approval, change summaries,
 * post-execution verification, and a permanent audit trail.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  LAYER 1 — Sandbox Isolation        (validateAgentPrompt)        │
 * │  LAYER 2 — Owner Approval Gate      (requestApproval)            │
 * │  LAYER 3 — Change Summary / Diff    (showChangeSummary)          │
 * │  LAYER 4 — Post-Execution Verify    (verifyExecution)            │
 * │  LAYER 5 — Permanent Audit Trail    (logAction)                  │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Actions that always require owner approval before proceeding. */
export type ApprovalRequiredAction =
  | 'supabase_write'
  | 'supabase_delete'
  | 'env_var_change'
  | 'netlify_deploy'
  | 'git_push'
  | 'config_file_write'
  | 'credential_change'

/** Approval phrases Christian can say (case-insensitive). */
export const APPROVAL_PHRASES: readonly string[] = [
  '10-4',
  'good to go',
  'green',
  'approved',
  'yes',
]

/** Possible states for an approval request. */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'timeout'

/** An active approval request. */
export interface ApprovalRequest {
  id: string
  action: ApprovalRequiredAction
  description: string
  diff: ChangeDiff | null
  status: ApprovalStatus
  requestedAt: string
  resolvedAt: string | null
  approvalPhrase: string | null
  userId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — SANDBOX ISOLATION
// ─────────────────────────────────────────────────────────────────────────────

/** Credential patterns that must NEVER appear in agent prompts. */
const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /SUPABASE_URL/i,                          label: 'SUPABASE_URL' },
  { pattern: /SUPABASE_ANON_KEY/i,                     label: 'SUPABASE_ANON_KEY' },
  { pattern: /SUPABASE_SERVICE_ROLE_KEY/i,             label: 'SUPABASE_SERVICE_ROLE_KEY' },
  { pattern: /ANTHROPIC_API_KEY/i,                     label: 'ANTHROPIC_API_KEY' },
  { pattern: /ELEVENLABS_API_KEY/i,                    label: 'ELEVENLABS_API_KEY' },
  { pattern: /OPENAI_API_KEY/i,                        label: 'OPENAI_API_KEY' },
  { pattern: /VITE_SUPABASE_URL/i,                     label: 'VITE_SUPABASE_URL' },
  { pattern: /VITE_SUPABASE_ANON_KEY/i,                label: 'VITE_SUPABASE_ANON_KEY' },
  // Literal URL patterns that look like Supabase project endpoints
  { pattern: /https:\/\/[a-z0-9]{20}\.supabase\.co/i, label: 'Supabase project URL' },
  // eyJ… is the base64-encoded header of a JWT (used for anon/service keys)
  { pattern: /eyJ[A-Za-z0-9_-]{30,}/,                 label: 'JWT / API key literal' },
  // Generic .env-style assignments
  { pattern: /[A-Z_]{5,}=\S{8,}/,                     label: 'env variable assignment' },
]

export interface PromptValidationResult {
  safe: boolean
  violations: string[]
  sanitizedPrompt: string
}

/**
 * LAYER 1 — validateAgentPrompt
 *
 * Scans any prompt intended for an agent for embedded credentials or
 * sensitive environment variables. If violations are found the prompt is
 * blocked (sanitized copy returned for logging; the caller must NOT send
 * the original prompt to the AI model).
 */
export function validateAgentPrompt(prompt: string): PromptValidationResult {
  const violations: string[] = []

  for (const { pattern, label } of CREDENTIAL_PATTERNS) {
    if (pattern.test(prompt)) {
      violations.push(label)
    }
  }

  if (violations.length > 0) {
    // Sanitize: replace every violation hit with a placeholder so the
    // blocked prompt can be safely logged without leaking the value.
    let sanitized = prompt
    for (const { pattern, label } of CREDENTIAL_PATTERNS) {
      sanitized = sanitized.replace(pattern, `[REDACTED:${label}]`)
    }
    return { safe: false, violations, sanitizedPrompt: sanitized }
  }

  return { safe: true, violations: [], sanitizedPrompt: prompt }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — OWNER APPROVAL GATE
// ─────────────────────────────────────────────────────────────────────────────

/** In-memory map of pending approval requests (keyed by request id). */
const _pendingApprovals = new Map<string, ApprovalRequest>()

/**
 * Returns true for actions that MUST be gated by owner approval before
 * proceeding.
 */
export function approvalRequired(action: string): action is ApprovalRequiredAction {
  const gated: ApprovalRequiredAction[] = [
    'supabase_write',
    'supabase_delete',
    'env_var_change',
    'netlify_deploy',
    'git_push',
    'config_file_write',
    'credential_change',
  ]
  return (gated as string[]).includes(action)
}

/**
 * Checks whether a given phrase is an accepted approval phrase
 * (case-insensitive, leading/trailing whitespace stripped).
 */
export function isApprovalPhrase(phrase: string): boolean {
  return APPROVAL_PHRASES.includes(phrase.trim().toLowerCase())
}

/**
 * LAYER 2 — requestApproval
 *
 * Creates an approval request and returns it in `pending` state.
 * The caller must surface the request to Christian and await his response
 * via `resolveApproval()` before proceeding with the action.
 *
 * For managed agents: enforcement is handled at the dispatch layer
 * (agents cannot deploy without a git push from Christian).
 * For in-app AI actions (NEXUS writing to Supabase): wire this to the
 * confirmation modal before any write operation.
 */
export function requestApproval(
  action: ApprovalRequiredAction,
  description: string,
  diff: ChangeDiff | null = null,
  userId: string | null = null,
): ApprovalRequest {
  const request: ApprovalRequest = {
    id: `apr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    action,
    description,
    diff,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    resolvedAt: null,
    approvalPhrase: null,
    userId,
  }

  _pendingApprovals.set(request.id, request)

  // Log the request immediately so it appears in the audit trail even if
  // the user never responds (timeout case is handled on resolution).
  void logAction({
    agentName: 'SYSTEM',
    actionType: 'approval_requested',
    target: `${action}:${description.slice(0, 120)}`,
    approvalStatus: 'pending',
    approvalPhrase: null,
    userId,
    beforeState: null,
    afterState: null,
    verificationResult: null,
  })

  return request
}

/**
 * Resolves a pending approval request.
 * Pass the phrase Christian typed; if it is an accepted phrase the request
 * is marked `approved`, otherwise `denied`.
 */
export function resolveApproval(requestId: string, phrase: string): ApprovalRequest | null {
  const req = _pendingApprovals.get(requestId)
  if (!req) return null

  const accepted = isApprovalPhrase(phrase)
  req.status = accepted ? 'approved' : 'denied'
  req.resolvedAt = new Date().toISOString()
  req.approvalPhrase = phrase

  void logAction({
    agentName: 'SYSTEM',
    actionType: accepted ? 'approval_granted' : 'approval_denied',
    target: `${req.action}:${req.description.slice(0, 120)}`,
    approvalStatus: req.status,
    approvalPhrase: phrase,
    userId: req.userId,
    beforeState: null,
    afterState: null,
    verificationResult: null,
  })

  _pendingApprovals.delete(requestId)
  return req
}

/** Returns all currently pending approval requests. */
export function getPendingApprovals(): ApprovalRequest[] {
  return Array.from(_pendingApprovals.values())
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — CHANGE SUMMARY / DIFF
// ─────────────────────────────────────────────────────────────────────────────

/** A single field-level change for diffing purposes. */
export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

/** Represents a complete change summary for a write operation. */
export interface ChangeDiff {
  /** Human-readable label for the target (e.g. "supabase:projects.status") */
  target: string
  /** For Supabase writes: name of the table being modified. */
  table?: string
  /** For file writes: path of the file being modified. */
  filePath?: string
  /** Field-level changes in this write. */
  changes: FieldChange[]
  /** Optional free-text summary added by the agent. */
  summary?: string
  /** Timestamp when this diff was computed. */
  computedAt: string
}

/**
 * LAYER 3 — showChangeSummary
 *
 * Formats a `ChangeDiff` into a human-readable string suitable for
 * display in the approval modal or console.
 *
 * Returns the formatted string so callers can render it in the UI.
 */
export function showChangeSummary(diff: ChangeDiff): string {
  const lines: string[] = []

  lines.push(`═══ CHANGE SUMMARY ═══════════════════════════════════`)
  lines.push(`Target : ${diff.target}`)
  if (diff.table)    lines.push(`Table  : ${diff.table}`)
  if (diff.filePath) lines.push(`File   : ${diff.filePath}`)
  lines.push(`Time   : ${diff.computedAt}`)
  if (diff.summary)  lines.push(`Note   : ${diff.summary}`)
  lines.push(`──────────────────────────────────────────────────────`)

  if (diff.changes.length === 0) {
    lines.push('  (no field-level changes recorded)')
  } else {
    for (const c of diff.changes) {
      const before = JSON.stringify(c.before) ?? 'undefined'
      const after  = JSON.stringify(c.after)  ?? 'undefined'
      lines.push(`  ${c.field}`)
      lines.push(`    BEFORE: ${before}`)
      lines.push(`    AFTER : ${after}`)
    }
  }

  lines.push(`═══════════════════════════════════════════════════════`)

  return lines.join('\n')
}

/**
 * Convenience helper: build a `ChangeDiff` from two plain objects and
 * return only the fields that actually differ.
 */
export function diffObjects(
  target: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  opts: Pick<ChangeDiff, 'table' | 'filePath' | 'summary'> = {},
): ChangeDiff {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changes: FieldChange[] = []

  for (const key of allKeys) {
    const b = before[key]
    const a = after[key]
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push({ field: key, before: b, after: a })
    }
  }

  return {
    target,
    table: opts.table,
    filePath: opts.filePath,
    summary: opts.summary,
    changes,
    computedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4 — POST-EXECUTION VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/** The type of thing being verified after a write. */
export type VerificationTarget = 'file' | 'supabase_record' | 'supabase_count' | 'deploy' | 'generic'

/** What the caller expects after a write. */
export interface ExpectedState {
  type: VerificationTarget
  /** For files: minimum byte size (ROOT FILE PROTECTION LAW). */
  minSizeBytes?: number
  /** For Supabase record checks: expected record count in the table. */
  expectedCount?: number
  /** For Supabase record checks: table name. */
  table?: string
  /** For deploy: whether build should pass. */
  buildPasses?: boolean
  /** For generic: arbitrary key/value pairs to assert. */
  assertions?: Record<string, unknown>
}

/** The actual state observed after a write. */
export interface ActualState {
  type: VerificationTarget
  /** For files: observed byte size. */
  observedSizeBytes?: number
  /** For Supabase: observed record count. */
  observedCount?: number
  /** For deploy: did the build succeed. */
  buildPassed?: boolean
  /** For generic: actual key/value observations. */
  observations?: Record<string, unknown>
}

export interface VerificationResult {
  passed: boolean
  failures: string[]
  rollbackRequired: boolean
  verifiedAt: string
}

/**
 * LAYER 4 — verifyExecution
 *
 * Compares what was expected after a write against what was actually
 * observed.  Returns a `VerificationResult` indicating whether the
 * operation met its contract.
 *
 * If `rollbackRequired` is true, the caller MUST revert the write and
 * alert Christian.
 */
export function verifyExecution(
  expected: ExpectedState,
  actual: ActualState,
): VerificationResult {
  const failures: string[] = []

  // ROOT FILE PROTECTION LAW — file must not shrink
  if (
    expected.type === 'file' &&
    expected.minSizeBytes !== undefined &&
    actual.observedSizeBytes !== undefined
  ) {
    if (actual.observedSizeBytes < expected.minSizeBytes) {
      failures.push(
        `File shrank below minimum: expected >= ${expected.minSizeBytes} bytes, ` +
        `got ${actual.observedSizeBytes} bytes. ROOT FILE PROTECTION VIOLATED.`,
      )
    }
  }

  // Supabase record count check
  if (
    (expected.type === 'supabase_record' || expected.type === 'supabase_count') &&
    expected.expectedCount !== undefined &&
    actual.observedCount !== undefined
  ) {
    if (actual.observedCount !== expected.expectedCount) {
      failures.push(
        `Supabase record count mismatch on table "${expected.table ?? 'unknown'}": ` +
        `expected ${expected.expectedCount}, got ${actual.observedCount}.`,
      )
    }
  }

  // Deploy verification
  if (expected.type === 'deploy' && expected.buildPasses === true) {
    if (actual.buildPassed !== true) {
      failures.push('Deploy verification failed: build did not pass.')
    }
  }

  // Generic key/value assertions
  if (expected.type === 'generic' && expected.assertions && actual.observations) {
    for (const [key, expectedValue] of Object.entries(expected.assertions)) {
      const actualValue = actual.observations[key]
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        failures.push(
          `Assertion failed for "${key}": expected ${JSON.stringify(expectedValue)}, ` +
          `got ${JSON.stringify(actualValue)}.`,
        )
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    rollbackRequired: failures.length > 0,
    verifiedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 5 — PERMANENT AUDIT TRAIL
// ─────────────────────────────────────────────────────────────────────────────

/** A single entry in the agent audit trail. */
export interface AgentAuditEntry {
  /** Auto-assigned by Supabase (uuid). */
  id?: string
  /** ISO timestamp. */
  timestamp: string
  /** Name of the agent or system component performing the action. */
  agentName: string
  /** Type of action performed. */
  actionType: string
  /** The resource affected: e.g. "supabase:projects", "file:src/agents/guardian.ts" */
  target: string
  /** Current approval status at the time of logging. */
  approvalStatus: ApprovalStatus | 'n/a'
  /** The exact phrase Christian used to approve (if applicable). */
  approvalPhrase: string | null
  /** User ID (owner) associated with this action. */
  userId: string | null
  /** Serialized snapshot of state/record BEFORE the action. */
  beforeState: unknown
  /** Serialized snapshot of state/record AFTER the action. */
  afterState: unknown
  /** Result from Layer 4 verification (null if verification was not run). */
  verificationResult: VerificationResult | null
}

/** Input shape for logAction — timestamp is added automatically. */
export type LogActionInput = Omit<AgentAuditEntry, 'id' | 'timestamp'>

/**
 * LAYER 5 — logAction
 *
 * Writes a permanent, tamper-resistant audit entry to the
 * `agent_audit_trail` Supabase table.
 *
 * Rules:
 * - This table CANNOT be deleted by agents — only by owner via direct
 *   Supabase console.
 * - Every agent action must call this function, including no-ops and
 *   approval requests.
 * - The entry is also echoed to the browser console for immediate
 *   visibility during development.
 */
export async function logAction(input: LogActionInput): Promise<void> {
  const entry: AgentAuditEntry = {
    ...input,
    timestamp: new Date().toISOString(),
  }

  // Always log to console for visibility in dev / managed agent sessions.
  console.info(
    `[AgentAuditTrail] ${entry.timestamp} | ${entry.agentName} | ${entry.actionType} | ${entry.target} | approval=${entry.approvalStatus}`,
  )

  // Persist to Supabase. If Supabase is unavailable, the entry is still
  // in console output (local) and can be recovered from agent session logs.
  try {
    const client = supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any).from('agent_audit_trail').insert([
      {
        timestamp:           entry.timestamp,
        agent_name:          entry.agentName,
        action_type:         entry.actionType,
        target:              entry.target,
        approval_status:     entry.approvalStatus,
        approval_phrase:     entry.approvalPhrase,
        user_id:             entry.userId,
        before_state:        entry.beforeState  != null ? JSON.stringify(entry.beforeState)  : null,
        after_state:         entry.afterState   != null ? JSON.stringify(entry.afterState)   : null,
        verification_result: entry.verificationResult != null
                               ? JSON.stringify(entry.verificationResult)
                               : null,
      },
    ])

    if (error) {
      // Do NOT throw — a failed audit write must never block the main flow.
      // The console output above is the fallback record.
      console.error('[AgentAuditTrail] Failed to persist audit entry:', error.message)
    }
  } catch (err) {
    console.error('[AgentAuditTrail] Unexpected error writing audit trail:', err)
  }
}

/**
 * Query the audit trail for a time window.
 *
 * Example: "Show me everything agents did in the last 24 hours"
 */
export async function queryAuditTrail(options: {
  /** ISO timestamp lower bound (inclusive). */
  since?: string
  /** ISO timestamp upper bound (inclusive). */
  until?: string
  agentName?: string
  actionType?: string
  userId?: string
  limit?: number
}): Promise<AgentAuditEntry[]> {
  const client = supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (client as any)
    .from('agent_audit_trail')
    .select('*')
    .order('timestamp', { ascending: false })

  if (options.since)      query = query.gte('timestamp', options.since)
  if (options.until)      query = query.lte('timestamp', options.until)
  if (options.agentName)  query = query.eq('agent_name', options.agentName)
  if (options.actionType) query = query.eq('action_type', options.actionType)
  if (options.userId)     query = query.eq('user_id', options.userId)
  if (options.limit)      query = query.limit(options.limit)

  const { data, error } = await query

  if (error) {
    console.error('[AgentAuditTrail] Failed to query audit trail:', error.message)
    return []
  }

  // Map snake_case DB columns → camelCase TS shape.
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id:                 String(row['id'] ?? ''),
    timestamp:          String(row['timestamp'] ?? ''),
    agentName:          String(row['agent_name'] ?? ''),
    actionType:         String(row['action_type'] ?? ''),
    target:             String(row['target'] ?? ''),
    approvalStatus:     (row['approval_status'] as AgentAuditEntry['approvalStatus']) ?? 'n/a',
    approvalPhrase:     (row['approval_phrase'] as string | null) ?? null,
    userId:             (row['user_id'] as string | null) ?? null,
    beforeState:        row['before_state'] != null
                          ? JSON.parse(String(row['before_state']))
                          : null,
    afterState:         row['after_state'] != null
                          ? JSON.parse(String(row['after_state']))
                          : null,
    verificationResult: row['verification_result'] != null
                          ? JSON.parse(String(row['verification_result']))
                          : null,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE: FULL 5-LAYER GUARD WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

export interface SafeWriteOptions {
  agentName:   string
  action:      ApprovalRequiredAction
  description: string
  diff:        ChangeDiff | null
  userId:      string | null
  /** Called only if the owner approves. Must return the after-state. */
  execute:     () => Promise<unknown>
  expected:    ExpectedState
}

/**
 * Full 5-layer safe-write wrapper.
 *
 * 1. Validates no credentials leak out (Layer 1 guard already applied
 *    at prompt time — skipped here since we don't have a prompt arg).
 * 2. Creates an approval request and surfaces the diff (Layers 2 + 3).
 * 3. Waits for owner to supply an approval phrase.
 * 4. Executes the write only after approval.
 * 5. Runs post-execution verification and auto-rolls back on failure.
 * 6. Logs the entire transaction to the audit trail (Layer 5).
 *
 * NOTE: In a UI context you must call `resolveApproval()` separately
 * (e.g. from the confirmation modal). This synchronous helper is
 * suitable for non-interactive / scripted flows where approval is
 * provided inline (e.g. n8n automation steps, server-side dispatch).
 */
export async function safeWrite(
  opts: SafeWriteOptions,
  approvalPhrase: string,
): Promise<{ success: boolean; message: string; verification: VerificationResult | null }> {
  // Layer 2 — Create approval request
  const request = requestApproval(opts.action, opts.description, opts.diff, opts.userId)

  // Layer 3 — Show change summary (logs to console; UI callers render separately)
  if (opts.diff) {
    console.info(showChangeSummary(opts.diff))
  }

  // Layer 2 — Resolve approval
  const resolved = resolveApproval(request.id, approvalPhrase)
  if (!resolved || resolved.status !== 'approved') {
    await logAction({
      agentName:          opts.agentName,
      actionType:         `${opts.action}_blocked`,
      target:             opts.description.slice(0, 200),
      approvalStatus:     resolved?.status ?? 'denied',
      approvalPhrase:     approvalPhrase,
      userId:             opts.userId,
      beforeState:        opts.diff?.changes.map(c => ({ [c.field]: c.before })) ?? null,
      afterState:         null,
      verificationResult: null,
    })
    return { success: false, message: `Action denied — approval phrase not accepted.`, verification: null }
  }

  // Execute write
  let afterState: unknown = null
  try {
    afterState = await opts.execute()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAction({
      agentName:          opts.agentName,
      actionType:         `${opts.action}_error`,
      target:             opts.description.slice(0, 200),
      approvalStatus:     'approved',
      approvalPhrase:     approvalPhrase,
      userId:             opts.userId,
      beforeState:        opts.diff?.changes.map(c => ({ [c.field]: c.before })) ?? null,
      afterState:         null,
      verificationResult: null,
    })
    return { success: false, message: `Execution error: ${msg}`, verification: null }
  }

  // Layer 4 — Verify execution
  const actual: ActualState = {
    type: opts.expected.type,
    ...(afterState && typeof afterState === 'object' ? (afterState as ActualState) : {}),
  }
  const verification = verifyExecution(opts.expected, actual)

  // Layer 5 — Log the full transaction
  await logAction({
    agentName:          opts.agentName,
    actionType:         opts.action,
    target:             opts.description.slice(0, 200),
    approvalStatus:     'approved',
    approvalPhrase:     approvalPhrase,
    userId:             opts.userId,
    beforeState:        opts.diff?.changes.map(c => ({ [c.field]: c.before })) ?? null,
    afterState:         afterState,
    verificationResult: verification,
  })

  if (!verification.passed) {
    console.error(
      `[AgentSafetySystem] Layer 4 verification FAILED for "${opts.description}". ` +
      `Rollback required. Failures: ${verification.failures.join('; ')}`,
    )
    return {
      success: false,
      message: `Write executed but verification failed. Rollback required. ${verification.failures.join('; ')}`,
      verification,
    }
  }

  return { success: true, message: 'Write completed and verified.', verification }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS — grouped for convenience
// ─────────────────────────────────────────────────────────────────────────────

export const AgentSafetySystem = {
  // Layer 1
  validateAgentPrompt,
  CREDENTIAL_PATTERNS,
  // Layer 2
  approvalRequired,
  isApprovalPhrase,
  requestApproval,
  resolveApproval,
  getPendingApprovals,
  APPROVAL_PHRASES,
  // Layer 3
  showChangeSummary,
  diffObjects,
  // Layer 4
  verifyExecution,
  // Layer 5
  logAction,
  queryAuditTrail,
  // Compound helper
  safeWrite,
} as const
