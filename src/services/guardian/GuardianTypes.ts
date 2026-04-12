/**
 * GuardianTypes.ts
 * TypeScript interfaces and enums for the GUARDIAN compliance and
 * protection agent — Power On Solutions LLC (C-10 #1151468).
 *
 * Mirrors supabase/migrations/055_guardian_tables.sql exactly.
 */

// ─── Enums ────────────────────────────────────────────────────

export enum AlertType {
  SCOPE_CHANGE         = 'scope_change',
  RFI_UNDOCUMENTED     = 'rfi_undocumented',
  SOLO_WORK            = 'solo_work',
  PRECONDITION_MISSING = 'precondition_missing',
  BOUNDARY_VIOLATION   = 'boundary_violation',
  CSLB_EXPOSURE        = 'cslb_exposure',
}

export enum Severity {
  CRITICAL = 'critical',
  WARNING  = 'warning',
  INFO     = 'info',
}

export enum AlertStatus {
  OPEN         = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED     = 'resolved',
}

export enum ChecklistType {
  PRE_JOB           = 'pre_job',
  DAILY_FIELD_LOG   = 'daily_field_log',
  OWNER_WALKTHROUGH = 'owner_walkthrough',
  SOLO_SAFETY       = 'solo_safety',
}

export enum ChecklistStatus {
  PENDING    = 'pending',
  COMPLETE   = 'complete',
  INCOMPLETE = 'incomplete',
}

export enum RFIStatus {
  SENT      = 'sent',
  AWAITING  = 'awaiting',
  RESPONDED = 'responded',
  OVERDUE   = 'overdue',
}

export enum ViolationType {
  SCOPE_AUTHORITY = 'scope_authority',
  MATERIAL_SUB    = 'material_sub',
  SCHEDULE_CHANGE = 'schedule_change',
  SAFETY          = 'safety',
}

export enum TierCrossed {
  TIER1_TO_TIER2 = 'tier1_to_tier2',
  TIER1_TO_TIER3 = 'tier1_to_tier3',
  TIER2_TO_TIER3 = 'tier2_to_tier3',
}

export enum RuleStatus {
  ACTIVE   = 'active',
  ARCHIVED = 'archived',
}

/**
 * Permission tier hierarchy for crew authority levels.
 * Tier 1 = field worker (execute only)
 * Tier 2 = lead / foreman (execute + limited decisions)
 * Tier 3 = owner (full authority)
 */
export enum PermissionTier {
  TIER_1 = 'tier_1',
  TIER_2 = 'tier_2',
  TIER_3 = 'tier_3',
}

// ─── Checklist Item ───────────────────────────────────────────

export interface ChecklistItem {
  label:        string;
  completed:    boolean;
  photo_url?:   string | null;
  notes?:       string | null;
  completed_at?: string | null;  // ISO timestamp
}

// ─── Core Interfaces ──────────────────────────────────────────

/**
 * A single flagged event with its full 5-step intelligence output.
 */
export interface GuardianAlert {
  id:                     string;
  user_id:                string;
  project_id?:            string | null;
  worker_id?:             string | null;

  // Classification
  alert_type:             AlertType;
  severity:               Severity;

  // 5-Step Intelligence Loop
  flag?:                  string | null;  // Step 1
  impact_analysis?:       string | null;  // Step 2
  corrective_action?:     string | null;  // Step 3
  employee_documentation?: string | null; // Step 4
  prevention_rule?:       string | null;  // Step 5

  // Lifecycle
  status:                 AlertStatus;
  acknowledged_by?:       string | null;
  resolved_at?:           string | null;
  created_at:             string;
}

/**
 * A project-level checklist (pre-job, daily log, walkthrough, solo-safety).
 */
export interface GuardianChecklist {
  id:              string;
  user_id:         string;
  project_id?:     string | null;
  checklist_type:  ChecklistType;
  items:           ChecklistItem[];
  status:          ChecklistStatus;
  created_at:      string;
  completed_at?:   string | null;
}

/**
 * An undocumented or open RFI that requires GUARDIAN tracking.
 */
export interface GuardianRFI {
  id:                         string;
  user_id:                    string;
  project_id?:                string | null;
  permit_number?:             string | null;
  nec_reference?:             string | null;
  conflict_description:       string;
  corrective_action_required?: string | null;
  responsible_party?:         string | null;
  response_deadline?:         string | null;
  response_received?:         string | null;
  response_date?:             string | null;
  status:                     RFIStatus;
  sent_at:                    string;
  auto_followup_sent:         boolean;
}

/**
 * A documented scope change with cost and timeline impact.
 */
export interface GuardianChangeOrder {
  id:                  string;
  user_id:             string;
  project_id?:         string | null;
  original_scope:      string;
  change_description:  string;
  change_reason?:      string | null;
  cost_impact?:        number | null;
  timeline_impact?:    string | null;
  requested_by?:       string | null;
  approved:            boolean;
  approved_at?:        string | null;
  signed_document_url?: string | null;
  created_at:          string;
}

/**
 * A permission-tier violation by a worker.
 */
export interface GuardianViolation {
  id:                      string;
  user_id:                 string;
  worker_id?:              string | null;
  project_id?:             string | null;
  violation_type:          ViolationType;
  tier_crossed?:           TierCrossed | null;
  description:             string;
  impact?:                 string | null;
  corrective_conversation?: string | null;
  rule_established?:       string | null;
  created_at:              string;
}

/**
 * A permanent prevention rule generated by Step 5 of the intelligence loop.
 */
export interface GuardianRule {
  id:               string;
  user_id:          string;
  rule_text:        string;
  source_alert_id?: string | null;
  category?:        string | null;
  status:           RuleStatus;
  created_at:       string;
}

// ─── Intelligence Loop I/O ────────────────────────────────────

/**
 * Raw event payload passed into the 5-step intelligence loop.
 */
export interface GuardianEvent {
  alert_type:   AlertType;
  project_id?:  string;
  worker_id?:   string;
  description:  string;
  timestamp?:   string;  // ISO — defaults to now() if omitted
  context?:     Record<string, unknown>;
}

/**
 * Structured JSON output Claude must return for each flagged event.
 */
export interface GuardianLoopOutput {
  flag:                   string;
  impact_analysis:        string;
  corrective_action:      string;
  employee_documentation: string;
  prevention_rule:        string;
  severity:               Severity;
}

/**
 * Full alert data ready to be persisted to guardian_alerts.
 */
export type GuardianAlertInsert = Omit<GuardianAlert, 'id' | 'created_at'>;
