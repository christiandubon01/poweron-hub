/**
 * CT-CORE-1: Architect planning helpers.
 *
 * The Architect is a REAL provider turn executed with the read-only-reviewer
 * safety profile (plan mode — it cannot write anything). Its structured plan
 * output is parsed and validated here; an invalid plan fails the create_plan
 * request safely with NO Run created (§17).
 *
 * Prompts are synthesized HOST-SIDE from validated structured fields — the
 * provider never supplies executable instructions back into the system, and no
 * prompt text is ever published to the control plane.
 */

import { randomUUID } from 'node:crypto';

import {
  computePlanHash,
  validatePlan,
  PLAN_PROVIDER_IDS,
  ROLE_TO_PERMISSION_PROFILE,
  type ControlPlan,
  type CreatePlanPayload,
  type CreatePlanRequestResult,
  type PhaseExecutionIntent,
  type PlanRole,
  type PlanTask,
  type PlanValidationCode,
} from './types.ts';
import { parseCreatePlanScopePackFields } from './scopePack.ts';
import type { ExecutionResult, PermissionProfile, ProviderId } from '../providers/types.ts';

export const ARCHITECT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60_000;

export type PlanParseFailureCode =
  | 'ARCHITECT_TURN_FAILED'
  | 'PLAN_OUTPUT_MISSING'
  | 'PLAN_JSON_UNPARSEABLE'
  | 'PLAN_VALIDATION_FAILED';

export interface PlanParseFailure {
  code: PlanParseFailureCode;
  message: string;
  validationErrors?: PlanValidationCode[];
}

export interface PlanParseSuccess {
  ok: true;
  result: CreatePlanRequestResult;
}

export interface PlanParseFailureResult {
  ok: false;
  failure: PlanParseFailure;
}

/* -------------------------------------------------------------------------- */
/* Architect prompt + plan parse                                               */
/* -------------------------------------------------------------------------- */

/**
 * The roles the Architect may generate executable tasks for. The architect
 * role is the planning turn itself — it must NEVER become an executable task.
 */
export const EXECUTABLE_PLAN_ROLES = ['implementer', 'verifier'] as const satisfies readonly PlanRole[];
export type ExecutablePlanRole = (typeof EXECUTABLE_PLAN_ROLES)[number];

/**
 * The ONLY valid role → permissionProfile pairs for Architect-generated
 * executable tasks. Derived from the canonical ROLE_TO_PERMISSION_PROFILE so
 * the prompt and the validator can never drift apart: whatever the prompt
 * tells the model is exactly what validatePlan enforces.
 */
export const EXECUTABLE_ROLE_PROFILE_PAIRS: ReadonlyArray<{ role: ExecutablePlanRole; profile: PermissionProfile }> =
  EXECUTABLE_PLAN_ROLES.map((role) => ({ role, profile: ROLE_TO_PERMISSION_PROFILE[role] }));

export function buildArchitectPrompt(payload: CreatePlanPayload): string {
  const lines: string[] = [];
  lines.push('You are the Team Architect for this repository.');
  lines.push('The owner wants work done. Read the repository to understand it, then produce an execution plan.');
  lines.push('');
  lines.push(`OWNER SCOPE:\n${payload.scope}`);
  if (payload.constraints.length > 0) {
    lines.push('');
    lines.push(`OWNER CONSTRAINTS:\n${payload.constraints.map((constraint) => `- ${constraint}`).join('\n')}`);
  }
  lines.push('');
  lines.push('Plan rules:');
  lines.push('- Output ONLY a single JSON object and nothing else. No prose before or after it. Use a ```json fenced block.');
  lines.push('- The plan describes a sequence of tasks executed by other agents in this repo.');
  lines.push('- Each task has a role, and the role FIXES the permissionProfile. The ONLY valid pairs are:');
  for (const { role, profile } of EXECUTABLE_ROLE_PROFILE_PAIRS) {
    lines.push(`  - role "${role}" → permissionProfile "${profile}" (exactly this string; any other value is rejected)`);
  }
  lines.push('- "implementer" writes code in an isolated copy of this repo. "verifier" is a read-only check of the implementer work. Do NOT generate tasks with any other role — the Architect role itself is this planning turn, not an executable task.');
  lines.push('- Include at least one implementer task and at least one verifier task. The verifier must depend on the implementer task(s) it checks.');
  lines.push('- authorizedWritePaths must list the exact repo-relative file paths each implementer is allowed to create or modify. Keep the change small and precise. Do not authorize broad directories.');
  lines.push('- Verifier tasks must set authorizedWritePaths to [] (they are read-only).');
  lines.push('- plannedAreas lists repo-relative areas (files or directories) the task is expected to touch. Writes outside those areas are drift and require owner approval.');
  lines.push('- provider must be one of: ' + PLAN_PROVIDER_IDS.join(', ') + '. requestedModel may be null (no preference).');
  lines.push('- validationRequirements lists the concrete checks the verifier must perform.');
  lines.push('');
  lines.push('JSON shape (all fields required unless noted):');
  lines.push('```json');
  lines.push(JSON.stringify({
    objective: 'one-paragraph interpretation of the owner scope as you understand it',
    constraints: ['echo of the owner constraints that apply, if any'],
    riskSummary: 'one short paragraph of risks/assumptions (optional, may be null)',
    tasks: [
      {
        clientTaskKey: 'implement-the-change',
        title: 'short task title',
        goal: 'precise description of what this task must accomplish',
        role: 'implementer',
        dependencies: [],
        permissionProfile: ROLE_TO_PERMISSION_PROFILE.implementer,
        authorizedWritePaths: ['exact/repo-relative/file.ts'],
        plannedAreas: ['repo-relative/area'],
        validationRequirements: ['check the verifier should perform'],
        provider: 'claude',
        requestedModel: null,
      },
      {
        clientTaskKey: 'verify-the-change',
        title: 'short task title',
        goal: 'precise description of what this task verifies',
        role: 'verifier',
        dependencies: ['implement-the-change'],
        permissionProfile: ROLE_TO_PERMISSION_PROFILE.verifier,
        authorizedWritePaths: [],
        plannedAreas: ['repo-relative/area'],
        validationRequirements: ['check the verifier should perform'],
        provider: 'claude',
        requestedModel: null,
      },
    ],
  }, null, 2));
  lines.push('```');
  return lines.join('\n');
}

/**
 * Parse the Architect's provider turn into a validated ControlPlan.
 * Fail closed: any parse/validation failure produces NO plan.
 */
export function parseArchitectPlan(options: {
  scope: string;
  constraints: string[];
  provider: ProviderId;
  result: ExecutionResult;
  executionIntent?: PhaseExecutionIntent;
}): PlanParseSuccess | PlanParseFailureResult {
  if (!options.result.provider.success) {
    return {
      ok: false,
      failure: {
        code: 'ARCHITECT_TURN_FAILED',
        message: options.result.provider.errorMessage ?? `Architect provider turn failed (${options.result.provider.errorCode ?? 'unknown'}).`,
      },
    };
  }

  const finalText = options.result.output.finalText ?? '';
  const planObject = extractPlanJsonObject(finalText);
  if (!planObject) {
    return {
      ok: false,
      failure: {
        code: 'PLAN_OUTPUT_MISSING',
        message: 'The Architect turn completed but produced no output text to parse.',
      },
    };
  }

  const planId = `plan-${randomUUID()}`;
  const validation = validatePlan({
    planId,
    objective: planObject.objective,
    constraints: planObject.constraints,
    riskSummary: planObject.riskSummary,
    tasks: planObject.tasks,
  }, { executionIntent: options.executionIntent });

  if (!validation.ok || !validation.plan) {
    return {
      ok: false,
      failure: {
        code: 'PLAN_VALIDATION_FAILED',
        message: `The Architect plan failed validation: ${validation.errors.join(', ')}.`,
        validationErrors: validation.errors,
      },
    };
  }

  return {
    ok: true,
    result: {
      plan: validation.plan,
      planHash: computePlanHash(validation.plan),
      architect: {
        provider: options.provider,
        requestedModel: options.result.model.requestedModel,
        reportedModel: options.result.model.reportedModel,
        reportedModelSource: options.result.model.reportedModelSource,
      },
    },
  };
}

/**
 * Extract the plan JSON object from the Architect's output. Accepts a fenced
 * ```json block, a bare JSON object, or a JSON object embedded in surrounding
 * text. Returns the parsed object or null.
 */
export function extractPlanJsonObject(finalText: string): Record<string, unknown> | null {
  const candidates: string[] = [];

  const fenced = finalText.match(/```(?:json)?\s*\r?\n([\s\S]*?)\r?\n\s*```/u);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  const firstBrace = finalText.indexOf('{');
  const lastBrace = finalText.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(finalText.slice(firstBrace, lastBrace + 1));
  }

  candidates.push(finalText.trim());

  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Task prompt synthesis (host-side, from validated plan fields)               */
/* -------------------------------------------------------------------------- */

export function buildImplementerPrompt(task: PlanTask, plan: ControlPlan): string {
  const lines: string[] = [];
  lines.push(`You are the Implementer for task "${task.title}".`);
  lines.push('');
  lines.push(`GOAL:\n${task.goal}`);
  if (plan.constraints.length > 0) {
    lines.push('');
    lines.push(`CONSTRAINTS:\n${plan.constraints.map((constraint) => `- ${constraint}`).join('\n')}`);
  }
  if (task.validationRequirements.length > 0) {
    lines.push('');
    lines.push(`ACCEPTANCE CHECKS THE VERIFIER WILL RUN:\n${task.validationRequirements.map((check) => `- ${check}`).join('\n')}`);
  }
  lines.push('');
  lines.push(`You may create or modify ONLY these repo-relative paths:\n${task.authorizedWritePaths.map((path) => `- ${path}`).join('\n')}`);
  lines.push('Do not touch any other file. Do not commit. Do not push. Do not run git commands that rewrite history.');
  return lines.join('\n');
}

export function buildVerifierPrompt(task: PlanTask, plan: ControlPlan): string {
  const lines: string[] = [];
  lines.push(`You are the Verifier for task "${task.title}".`);
  lines.push('You are read-only. This working directory is the isolated implementer candidate. Verify that tree. Do not modify anything.');
  lines.push('');
  lines.push(`VERIFICATION GOAL:\n${task.goal}`);
  if (task.validationRequirements.length > 0) {
    lines.push('');
    lines.push(`REQUIRED CHECKS:\n${task.validationRequirements.map((check) => `- ${check}`).join('\n')}`);
  }
  if (plan.constraints.length > 0) {
    lines.push('');
    lines.push(`OWNER CONSTRAINTS THAT MUST HOLD:\n${plan.constraints.map((constraint) => `- ${constraint}`).join('\n')}`);
  }
  lines.push('');
  if (plan.scopePack) {
    lines.push('');
    lines.push(`SCOPE PACK: ${plan.scopePack.packId} v${plan.scopePack.version} phase ${plan.scopePack.phaseId} (${plan.scopePack.reconciliationState ?? 'unverified'}).`);
    lines.push('A Run cannot PASS if an applicable locked Scope Pack rule or do-not-touch boundary was violated, even when tests pass.');
  }
  lines.push('');
  lines.push('Check the actual files in this working directory, not the implementer description.');
  lines.push('End with these lines only. Put at most 8 EVIDENCE lines and at most 8 FAILED_CHECK lines before SUMMARY.');
  lines.push('EVIDENCE: <repo-relative path>');
  lines.push('FAILED_CHECK: <short check id>');
  lines.push('SUMMARY: <one sentence, 240 characters or fewer>');
  lines.push('VERDICT: PASS');
  lines.push('or');
  lines.push('VERDICT: FAIL');
  lines.push('Do not include hidden reasoning.');
  return lines.join('\n');
}

export function buildReviewerPrompt(task: PlanTask, plan: ControlPlan): string {
  const lines: string[] = [];
  lines.push(`You are a read-only reviewer for task "${task.title}".`);
  lines.push('');
  lines.push(`GOAL:\n${task.goal}`);
  lines.push('You are read-only: report findings only. Do not modify anything.');
  return lines.join('\n');
}

export function buildTaskPrompt(task: PlanTask, plan: ControlPlan): string {
  switch (task.role) {
    case 'implementer':
      return buildImplementerPrompt(task, plan);
    case 'verifier':
      return buildVerifierPrompt(task, plan);
    case 'architect':
    default:
      return buildReviewerPrompt(task, plan);
  }
}

/* -------------------------------------------------------------------------- */
/* Verifier verdict parsing                                                    */
/* -------------------------------------------------------------------------- */

export type VerifierVerdict = 'pass' | 'fail' | 'unknown';

export const VERIFIER_SUMMARY_MAX_CHARS = 240;
export const VERIFIER_EVIDENCE_REF_MAX = 8;
export const VERIFIER_EVIDENCE_REF_MAX_CHARS = 120;
export const VERIFIER_FAILED_CHECK_MAX = 8;
export const VERIFIER_FAILED_CHECK_MAX_CHARS = 80;

export interface ParsedVerifierResult {
  verdict: VerifierVerdict;
  summary: string | null;
  evidenceRefs: string[];
  failedChecks: string[];
}

export const CONTROL_TOWER_UI_SMOKE_PATH = 'agent-host/smoke/control-tower-ui-e2e.txt';
export const CONTROL_TOWER_UI_SMOKE_LINE = 'CONTROL_TOWER_UI_E2E_OK final';

/**
 * Parse the verifier's explicit verdict from its final text. Fail closed:
 * missing or ambiguous verdict reports 'unknown', never an unearned PASS.
 */
export function parseVerifierVerdict(finalText: string | undefined): VerifierVerdict {
  return parseVerifierResult(finalText).verdict;
}

/**
 * Bounded user-facing verifier evidence. Only labeled lines are kept.
 * Free prose, including hidden reasoning, is discarded.
 */
export function parseVerifierResult(finalText: string | undefined): ParsedVerifierResult {
  const empty: ParsedVerifierResult = { verdict: 'unknown', summary: null, evidenceRefs: [], failedChecks: [] };
  if (!finalText) {
    return empty;
  }
  const matches = [...finalText.matchAll(/\bVERDICT\s*:\s*(PASS|FAIL)\b/giu)];
  const verdicts = new Set(matches.map((match) => match[1]!.toLowerCase()));
  if (matches.length === 0 || verdicts.size !== 1) {
    return empty;
  }
  const verdict: VerifierVerdict = verdicts.has('pass') ? 'pass' : 'fail';
  const summaries = labeledLines(finalText, 'SUMMARY');
  return {
    verdict,
    summary: summaries.length === 1 ? boundText(summaries[0]!, VERIFIER_SUMMARY_MAX_CHARS) : null,
    evidenceRefs: labeledLines(finalText, 'EVIDENCE').slice(0, VERIFIER_EVIDENCE_REF_MAX).map((line) => boundText(line, VERIFIER_EVIDENCE_REF_MAX_CHARS)),
    failedChecks: labeledLines(finalText, 'FAILED_CHECK').slice(0, VERIFIER_FAILED_CHECK_MAX).map((line) => boundText(line, VERIFIER_FAILED_CHECK_MAX_CHARS)),
  };
}

/** Durable summary for a parsed verdict. Omits any unlabeled prose. */
export function verifierResultSummary(result: ParsedVerifierResult): string | null {
  if (result.verdict === 'unknown') {
    return null;
  }
  return result.summary ?? `VERDICT: ${result.verdict.toUpperCase()}`;
}

/**
 * Exact text-file acceptance for the control-tower smoke marker.
 * One trailing newline (LF or CRLF) is the only accepted terminator.
 */
export function evaluateControlTowerUiSmokeAcceptance(input: {
  fileBytes: Buffer | null;
  changedPaths: readonly string[];
}): { passed: boolean; failedChecks: string[] } {
  const failedChecks: string[] = [];
  if (!input.fileBytes) {
    failedChecks.push('file-missing');
  } else if (!smokeFileMatchesAcceptance(input.fileBytes)) {
    failedChecks.push('content-mismatch');
  }
  const changedPaths = input.changedPaths.map((entry) => entry.replaceAll('\\', '/'));
  if (changedPaths.length !== 1 || changedPaths[0] !== CONTROL_TOWER_UI_SMOKE_PATH) {
    failedChecks.push('unauthorized-change');
  }
  return { passed: failedChecks.length === 0, failedChecks };
}

function smokeFileMatchesAcceptance(bytes: Buffer): boolean {
  const text = bytes.toString('utf8');
  const newline = text.endsWith('\r\n') ? '\r\n' : text.endsWith('\n') ? '\n' : null;
  if (!newline) {
    return false;
  }
  const body = text.slice(0, -newline.length);
  return body === CONTROL_TOWER_UI_SMOKE_LINE && !body.includes('\n') && !body.includes('\r');
}

function labeledLines(text: string, label: string): string[] {
  const pattern = new RegExp(`^${label}\\s*:\\s*(.*)$`, 'gimu');
  return [...text.matchAll(pattern)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((line) => line.length > 0);
}

function boundText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

/* -------------------------------------------------------------------------- */
/* create_plan payload validation (§8 — browser-supplied fields only)           */
/* -------------------------------------------------------------------------- */

export type CreatePlanPayloadFailureCode =
  | 'PAYLOAD_NOT_OBJECT'
  | 'SCOPE_MISSING'
  | 'SCOPE_TOO_LONG'
  | 'CONSTRAINTS_INVALID'
  | 'ROUTING_INVALID'
  | 'SCOPE_PACK_ID_INVALID'
  | 'SCOPE_PACK_VERSION_INVALID'
  | 'SCOPE_PACK_PHASE_INVALID';

export function parseCreatePlanPayload(raw: unknown): { ok: true; payload: CreatePlanPayload } | { ok: false; code: CreatePlanPayloadFailureCode; message: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'PAYLOAD_NOT_OBJECT', message: 'create_plan payload must be a JSON object.' };
  }
  const record = raw as Record<string, unknown>;

  const scope = typeof record.scope === 'string' ? record.scope.trim() : '';
  if (!scope) {
    return { ok: false, code: 'SCOPE_MISSING', message: 'create_plan payload requires a non-empty scope.' };
  }
  if (scope.length > 8_000) {
    return { ok: false, code: 'SCOPE_TOO_LONG', message: 'create_plan scope exceeds the 8000-character limit.' };
  }

  let constraints: string[] = [];
  if (record.constraints !== undefined && record.constraints !== null) {
    if (!Array.isArray(record.constraints)) {
      return { ok: false, code: 'CONSTRAINTS_INVALID', message: 'create_plan constraints must be a JSON array of strings.' };
    }
    if (record.constraints.length > 16) {
      return { ok: false, code: 'CONSTRAINTS_INVALID', message: 'create_plan allows at most 16 constraints.' };
    }
    for (const constraint of record.constraints) {
      if (typeof constraint !== 'string' || constraint.length === 0 || constraint.length > 1_000) {
        return { ok: false, code: 'CONSTRAINTS_INVALID', message: 'create_plan constraints must be strings of 1-1000 characters.' };
      }
    }
    constraints = record.constraints as string[];
  }

  let requestedRouting: CreatePlanPayload['requestedRouting'] = null;
  if (record.requestedRouting !== undefined && record.requestedRouting !== null) {
    if (typeof record.requestedRouting !== 'object' || Array.isArray(record.requestedRouting)) {
      return { ok: false, code: 'ROUTING_INVALID', message: 'create_plan requestedRouting must be a JSON object.' };
    }
    const routing = record.requestedRouting as Record<string, unknown>;
    if (routing.provider !== undefined && routing.provider !== null) {
      if (typeof routing.provider !== 'string' || !(PLAN_PROVIDER_IDS as readonly string[]).includes(routing.provider)) {
        return { ok: false, code: 'ROUTING_INVALID', message: `requestedRouting.provider must be one of: ${PLAN_PROVIDER_IDS.join(', ')}.` };
      }
    }
    if (routing.requestedModel !== undefined && routing.requestedModel !== null) {
      if (typeof routing.requestedModel !== 'string' || routing.requestedModel.length === 0 || routing.requestedModel.length > 200) {
        return { ok: false, code: 'ROUTING_INVALID', message: 'requestedRouting.requestedModel must be a string of 1-200 characters.' };
      }
    }
    requestedRouting = {
      provider: typeof routing.provider === 'string' ? (routing.provider as ProviderId) : undefined,
      requestedModel: typeof routing.requestedModel === 'string' ? routing.requestedModel : undefined,
    };
  }

  const scopePack = parseCreatePlanScopePackFields(record);
  if (!scopePack.ok) {
    return { ok: false, code: scopePack.code as CreatePlanPayloadFailureCode, message: scopePack.message };
  }

  return {
    ok: true,
    payload: {
      scope,
      constraints,
      requestedRouting,
      ...(scopePack.fields
        ? {
            scopePackId: scopePack.fields.scopePackId,
            scopePackVersion: scopePack.fields.scopePackVersion,
            scopePackPhaseId: scopePack.fields.scopePackPhaseId,
            staleAcknowledged: scopePack.fields.staleAcknowledged,
            ownerReviewedConflict: scopePack.fields.ownerReviewedConflict,
          }
        : {}),
    },
  };
}