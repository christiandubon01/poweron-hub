/**
 * src/services/guardian/GuardianPermissionTiers.ts
 * GRD4 — GUARDIAN 3-Tier Permission System
 *
 * Defines the three authority tiers for PowerOn Solutions field operations.
 * Provides checkPermission() and getWorkerTier() for boundary enforcement.
 *
 * TIER 1 — FIELD CREW
 * TIER 2 — FOREMAN
 * TIER 3 — OWNER (Christian)
 *
 * Supabase table: crew_members
 */

import { supabase } from '@/lib/supabase';

// ─── Tier Definition ──────────────────────────────────────────────────────────

export type WorkerTier = 1 | 2 | 3;

export interface TierDefinition {
  tier: WorkerTier;
  label: string;
  description: string;
  can: string[];
  cannot: string[];
}

export const TIER_DEFINITIONS: Record<WorkerTier, TierDefinition> = {
  1: {
    tier: 1,
    label: 'Field Crew',
    description: 'On-site execution. Follows defined scope. All authority questions go up the chain.',
    can: [
      'execute_defined_scope',
      'document_work',
      'flag_questions_via_guardian',
      'clock_in',
      'clock_out',
      'submit_field_log',
      'report_material_usage',
    ],
    cannot: [
      'approve_material_substitution',
      'approve_scope_change',
      'respond_to_rfi',
      'approve_schedule_change',
      'communicate_scope_to_gc',
      'communicate_scope_to_customer',
      'approve_change_order',
      'respond_to_gc_directly',
      'approve_mto_over_500',
      'approve_contract_change',
      'issue_warranty_response',
      'issue_dispute_response',
    ],
  },
  2: {
    tier: 2,
    label: 'Foreman',
    description: 'Site leadership. Coordinates within scope. Escalates anything contract-affecting in writing.',
    can: [
      'execute_defined_scope',
      'document_work',
      'flag_questions_via_guardian',
      'clock_in',
      'clock_out',
      'submit_field_log',
      'report_material_usage',
      'coordinate_with_trades_on_site',
      'escalate_rfi_in_writing',
      'verify_quality_checkpoints',
      'minor_material_substitution_within_spec',
      'log_substitution_with_reason',
    ],
    cannot: [
      'approve_scope_change',
      'approve_change_order',
      'approve_anything_affecting_contract_value',
      'approve_anything_affecting_timeline',
      'respond_to_gc_directly_on_scope',
      'communicate_scope_to_gc',
      'communicate_scope_to_customer',
      'approve_mto_over_500',
      'approve_contract_change',
      'issue_warranty_response',
      'issue_dispute_response',
    ],
  },
  3: {
    tier: 3,
    label: 'Owner',
    description: 'Christian — full authority over all scope, contract, financial, and communication decisions.',
    can: [
      'execute_defined_scope',
      'document_work',
      'flag_questions_via_guardian',
      'clock_in',
      'clock_out',
      'submit_field_log',
      'report_material_usage',
      'coordinate_with_trades_on_site',
      'escalate_rfi_in_writing',
      'verify_quality_checkpoints',
      'minor_material_substitution_within_spec',
      'log_substitution_with_reason',
      'approve_scope_change',
      'respond_to_rfi',
      'approve_schedule_change',
      'communicate_scope_to_gc',
      'communicate_scope_to_customer',
      'approve_change_order',
      'respond_to_gc_directly_on_scope',
      'approve_mto_over_500',
      'approve_contract_change',
      'issue_warranty_response',
      'issue_dispute_response',
      'apply_for_permit',
      'approve_material_substitution',
    ],
    cannot: [],
  },
};

// ─── Action → Minimum Tier Required ──────────────────────────────────────────

/**
 * Maps each action type to the minimum WorkerTier required.
 * Actions not listed here default to TIER 1 (everyone can perform).
 */
export const ACTION_TIER_REQUIREMENTS: Record<string, WorkerTier> = {
  // Tier 1 actions (anyone)
  execute_defined_scope:           1,
  document_work:                   1,
  flag_questions_via_guardian:     1,
  clock_in:                        1,
  clock_out:                       1,
  submit_field_log:                1,
  report_material_usage:           1,

  // Tier 2 actions (Foreman+)
  coordinate_with_trades_on_site:  2,
  escalate_rfi_in_writing:         2,
  verify_quality_checkpoints:      2,
  minor_material_substitution_within_spec: 2,
  log_substitution_with_reason:    2,

  // Tier 3 actions (Owner only)
  approve_scope_change:            3,
  respond_to_rfi:                  3,
  approve_schedule_change:         3,
  communicate_scope_to_gc:         3,
  communicate_scope_to_customer:   3,
  approve_change_order:            3,
  respond_to_gc_directly_on_scope: 3,
  approve_mto_over_500:            3,
  approve_contract_change:         3,
  issue_warranty_response:         3,
  issue_dispute_response:          3,
  apply_for_permit:                3,
  approve_material_substitution:   3,
};

// ─── Permission Check Result ──────────────────────────────────────────────────

export interface PermissionCheckResult {
  allowed: boolean;
  tier_required: WorkerTier;
  worker_tier: WorkerTier;
  action: string;
  worker_id: string;
  reason: string;
}

// ─── Crew Member Row (crew_members table) ─────────────────────────────────────

interface CrewMemberRow {
  id: string;
  name: string;
  role: string;
  tier?: number;
  active?: boolean;
}

// ─── getWorkerTier ────────────────────────────────────────────────────────────

/**
 * Reads the worker's tier from the crew_members Supabase table.
 *
 * Maps known role strings to tiers:
 *   'owner'   → 3
 *   'foreman' → 2
 *   'crew' | 'field_crew' | * → 1
 *
 * If the row has an explicit `tier` column, that takes precedence.
 * Falls back to TIER 1 if the worker is not found.
 */
export async function getWorkerTier(workerId: string): Promise<WorkerTier> {
  try {
    const { data, error } = await supabase
      .from('crew_members')
      .select('id, name, role, tier, active')
      .eq('id', workerId)
      .single();

    if (error || !data) {
      console.warn(`[GuardianPermissionTiers] Worker ${workerId} not found — defaulting to Tier 1`);
      return 1;
    }

    const row = data as CrewMemberRow;

    // Explicit tier column takes precedence
    if (typeof row.tier === 'number' && row.tier >= 1 && row.tier <= 3) {
      return row.tier as WorkerTier;
    }

    // Derive tier from role string
    const role = (row.role ?? '').toLowerCase();
    if (role === 'owner') return 3;
    if (role === 'foreman' || role === 'lead') return 2;
    return 1;
  } catch (err) {
    console.error('[GuardianPermissionTiers] getWorkerTier error:', err);
    return 1;
  }
}

// ─── checkPermission ──────────────────────────────────────────────────────────

/**
 * Checks whether a worker is authorized to perform a given action.
 *
 * @param workerId   - crew_members.id
 * @param actionType - key from ACTION_TIER_REQUIREMENTS
 * @returns PermissionCheckResult
 */
export async function checkPermission(
  workerId: string,
  actionType: string,
): Promise<PermissionCheckResult> {
  const workerTier = await getWorkerTier(workerId);
  const tierRequired: WorkerTier = ACTION_TIER_REQUIREMENTS[actionType] ?? 1;
  const allowed = workerTier >= tierRequired;

  const tierLabels: Record<WorkerTier, string> = {
    1: 'Field Crew',
    2: 'Foreman',
    3: 'Owner',
  };

  const reason = allowed
    ? `Worker (Tier ${workerTier} — ${tierLabels[workerTier]}) is authorized for "${actionType}".`
    : `Worker (Tier ${workerTier} — ${tierLabels[workerTier]}) is NOT authorized for "${actionType}". ` +
      `This action requires Tier ${tierRequired} (${tierLabels[tierRequired]}) or above.`;

  return {
    allowed,
    tier_required: tierRequired,
    worker_tier:   workerTier,
    action:        actionType,
    worker_id:     workerId,
    reason,
  };
}

// ─── getTierDefinition ────────────────────────────────────────────────────────

/**
 * Returns the full TierDefinition for a given tier number.
 */
export function getTierDefinition(tier: WorkerTier): TierDefinition {
  return TIER_DEFINITIONS[tier];
}

/**
 * Returns the TierDefinition derived from a crew role string.
 */
export function getTierDefinitionForRole(role: string): TierDefinition {
  const r = role.toLowerCase();
  if (r === 'owner') return TIER_DEFINITIONS[3];
  if (r === 'foreman' || r === 'lead') return TIER_DEFINITIONS[2];
  return TIER_DEFINITIONS[1];
}

// ─── isActionRestrictedForTier ────────────────────────────────────────────────

/**
 * Synchronous check — does this action require a higher tier than the given tier?
 * Used for UI gating when worker tier is already known.
 */
export function isActionRestrictedForTier(tier: WorkerTier, actionType: string): boolean {
  const required: WorkerTier = ACTION_TIER_REQUIREMENTS[actionType] ?? 1;
  return tier < required;
}
