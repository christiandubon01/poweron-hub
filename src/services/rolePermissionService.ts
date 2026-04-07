/**
 * src/services/rolePermissionService.ts
 * B32 — Multi-User Org Architecture Foundation
 *
 * Implements the 4-role permission matrix for PowerOn Hub multi-user orgs.
 * Functions mirror what will be wired to `org_members` Supabase table on integration.
 *
 * Roles:
 *   employee           — field log + assigned projects only
 *   project_manager    — projects, field log, templates, blueprint AI, OHM; no financials
 *   operations_director — everything except owner financials and leads
 *   owner              — full access + full audit trail
 *
 * Lead Flow Stages:
 *   spark_captured → sales (employee/office) → contact_logged → office → status_updated
 *   → project_manager (on conversion) → owner sees full pipeline
 */

// ─── Role Type ────────────────────────────────────────────────────────────────

export type B32Role =
  | 'employee'
  | 'project_manager'
  | 'operations_director'
  | 'owner';

export const B32_ALL_ROLES: B32Role[] = [
  'employee',
  'project_manager',
  'operations_director',
  'owner',
];

// ─── Feature Keys (mapped to sidebar views and data access) ──────────────────

export type B32Feature =
  // Sidebar nav views
  | 'home'
  | 'projects'
  | 'leads'
  | 'templates'
  | 'pricing-intelligence'
  | 'estimate'
  | 'material-takeoff'
  | 'progress'
  | 'framework'
  | 'rfi-tracker'
  | 'coordination'
  | 'graph-dashboard'
  | 'field-log'
  | 'money'
  | 'price-book'
  | 'settings'
  | 'blueprint-ai'
  | 'vault-estimate'
  | 'demo-mode'
  | 'team'
  | 'crew-portal'
  | 'guardian'
  | 'compliance'        // OHM
  | 'voice-hub'
  | 'activity'
  | 'agent-mode-selector'
  | 'material-intelligence'
  | 'guardian-view'
  | 'n8n-automation'
  | 'spark-live-call'
  | 'income-calc'
  | 'debt-killer'
  // Data-level features
  | 'financials'
  | 'audit_trail'
  | 'lead_pipeline'
  | 'assigned_projects_only'
  | 'phase_update'
  | 'rfi_update'
  | 'org_settings';

// ─── Permission Matrix ────────────────────────────────────────────────────────

/**
 * B32 permission matrix.
 * Each role gets a Set of allowed features for O(1) lookup via canAccess().
 */
const B32_PERMISSION_MATRIX: Record<B32Role, Set<B32Feature>> = {

  /**
   * EMPLOYEE
   * Field-level worker. Sees only their own field log and assigned projects.
   * No financial data, no leads, no admin panels.
   */
  employee: new Set<B32Feature>([
    'field-log',
    'projects',              // filtered to assigned only — enforced at data layer
    'assigned_projects_only',
    'crew-portal',
    'home',
  ]),

  /**
   * PROJECT MANAGER
   * Sees all projects, can update phases and RFIs. No financial raw data.
   * Has access to Templates, Blueprint AI, OHM (compliance), Field Log.
   */
  project_manager: new Set<B32Feature>([
    'home',
    'projects',
    'field-log',
    'templates',
    'blueprint-ai',
    'compliance',            // OHM
    'rfi-tracker',
    'coordination',
    'progress',
    'framework',
    'material-takeoff',
    'estimate',
    'price-book',
    'crew-portal',
    'guardian',
    'team',
    'voice-hub',
    'activity',
    'material-intelligence',
    'phase_update',
    'rfi_update',
  ]),

  /**
   * OPERATIONS DIRECTOR
   * Sees everything EXCEPT owner financials and leads.
   * Can access all operational panels, settings, intelligence.
   */
  operations_director: new Set<B32Feature>([
    'home',
    'projects',
    'templates',
    'pricing-intelligence',
    'estimate',
    'material-takeoff',
    'progress',
    'framework',
    'rfi-tracker',
    'coordination',
    'graph-dashboard',
    'field-log',
    'price-book',
    'settings',
    'blueprint-ai',
    'vault-estimate',
    'team',
    'crew-portal',
    'guardian',
    'guardian-view',
    'compliance',
    'voice-hub',
    'activity',
    'agent-mode-selector',
    'material-intelligence',
    'n8n-automation',
    'spark-live-call',
    'phase_update',
    'rfi_update',
    'org_settings',
  ]),

  /**
   * OWNER
   * Full access to all panels, all data, full audit trail.
   */
  owner: new Set<B32Feature>([
    'home',
    'projects',
    'leads',
    'templates',
    'pricing-intelligence',
    'estimate',
    'material-takeoff',
    'progress',
    'framework',
    'rfi-tracker',
    'coordination',
    'graph-dashboard',
    'field-log',
    'money',
    'price-book',
    'settings',
    'blueprint-ai',
    'vault-estimate',
    'demo-mode',
    'team',
    'crew-portal',
    'guardian',
    'guardian-view',
    'compliance',
    'voice-hub',
    'activity',
    'agent-mode-selector',
    'material-intelligence',
    'n8n-automation',
    'spark-live-call',
    'income-calc',
    'debt-killer',
    'financials',
    'audit_trail',
    'lead_pipeline',
    'phase_update',
    'rfi_update',
    'org_settings',
  ]),
};

// ─── Org Member Stub (maps to `org_members` Supabase table) ──────────────────

export interface OrgMemberB32 {
  user_id: string;
  name: string;
  email: string;
  role: B32Role;
  org_id: string;
  assigned_at: string;
}

/**
 * Mock org_members data.
 * Replace with Supabase query in V2 integration:
 *   supabase.from('org_members').select('*').eq('user_id', userId).maybeSingle()
 */
const _mockOrgMembers: OrgMemberB32[] = [
  {
    user_id: 'user-001',
    name: 'Chris Swatish',
    email: 'swatish.3103@gmail.com',
    role: 'owner',
    org_id: 'org-poweron-001',
    assigned_at: '2026-01-01T00:00:00.000Z',
  },
  {
    user_id: 'user-010',
    name: 'Field Worker A',
    email: 'field@poweronsolutions.com',
    role: 'employee',
    org_id: 'org-poweron-001',
    assigned_at: '2026-02-01T08:00:00.000Z',
  },
  {
    user_id: 'user-011',
    name: 'PM Lead',
    email: 'pm@poweronsolutions.com',
    role: 'project_manager',
    org_id: 'org-poweron-001',
    assigned_at: '2026-02-15T08:00:00.000Z',
  },
  {
    user_id: 'user-012',
    name: 'Director Ops',
    email: 'director@poweronsolutions.com',
    role: 'operations_director',
    org_id: 'org-poweron-001',
    assigned_at: '2026-03-01T08:00:00.000Z',
  },
];

// ─── getUserRole ──────────────────────────────────────────────────────────────

/**
 * Returns the B32 role for a given user, looked up from the org_members table.
 *
 * Stub: checks email-match in mock data, falls back to 'owner' for unrecognized users
 * (preserving single-user behavior during prototype phase).
 *
 * Supabase integration target:
 *   const { data } = await supabase
 *     .from('org_members')
 *     .select('role')
 *     .eq('user_id', userId)
 *     .maybeSingle()
 *   return data?.role ?? 'employee'
 *
 * @param userId  - auth.users.id from Supabase auth session
 * @param email   - optional email for email-based fallback lookup
 */
export function getUserRole(userId: string, email?: string): B32Role {
  // Primary: look up by userId
  const byId = _mockOrgMembers.find((m) => m.user_id === userId);
  if (byId) return byId.role;

  // Secondary: look up by email (useful before userId is stored in mock)
  if (email) {
    const byEmail = _mockOrgMembers.find((m) => m.email === email);
    if (byEmail) return byEmail.role;
  }

  // Default: owner (single-user fallback — preserves existing app behavior)
  return 'owner';
}

// ─── canAccess ────────────────────────────────────────────────────────────────

/**
 * Returns true if the given role is permitted to access the given feature.
 *
 * Usage in V15rLayout.tsx:
 *   canAccess(userRole, 'leads')        // false for employee/PM/director
 *   canAccess(userRole, 'financials')   // only true for owner
 *   canAccess(userRole, 'field-log')    // true for all roles
 *
 * @param role     - the user's B32Role
 * @param feature  - a B32Feature key (panel view id or data-level feature)
 */
export function canAccess(role: B32Role, feature: B32Feature): boolean {
  const perms = B32_PERMISSION_MATRIX[role];
  if (!perms) return false;
  return perms.has(feature);
}

// ─── Lead Flow ────────────────────────────────────────────────────────────────

export type LeadFlowStage =
  | 'spark_captured'
  | 'contact_logged'
  | 'status_updated'
  | 'converting_to_project'
  | 'active_project';

export interface LeadFlowStatus {
  stage: LeadFlowStage;
  responsibleRole: B32Role;
  label: string;
  description: string;
}

/**
 * Lead flow stage definitions.
 * Maps each stage to the role responsible for action at that stage.
 */
const LEAD_FLOW_STAGES: Record<LeadFlowStage, Omit<LeadFlowStatus, 'stage'>> = {
  spark_captured: {
    responsibleRole: 'employee',        // sales-role employee captures via SPARK
    label: 'Lead Captured',
    description: 'SPARK captured inbound lead — assigned to sales for contact',
  },
  contact_logged: {
    responsibleRole: 'employee',        // sales logs initial contact
    label: 'Contact Logged',
    description: 'Sales logged first contact — awaiting office status update',
  },
  status_updated: {
    responsibleRole: 'operations_director', // office/director updates status
    label: 'Status Updated',
    description: 'Office updated lead status — evaluating for project conversion',
  },
  converting_to_project: {
    responsibleRole: 'project_manager', // PM assigned when converting
    label: 'Converting to Project',
    description: 'PM assigned — lead converting to active project',
  },
  active_project: {
    responsibleRole: 'owner',           // owner sees full pipeline
    label: 'Active Project',
    description: 'Project active — owner has full pipeline visibility',
  },
};

/**
 * Mock lead stage store (keyed by leadId).
 * In V2 integration, replace with Supabase query:
 *   supabase.from('leads').select('flow_stage').eq('id', leadId).maybeSingle()
 */
const _mockLeadStages: Record<string, LeadFlowStage> = {};

/**
 * Returns the current lead flow stage and responsible role for a given lead.
 *
 * @param leadId - the lead's ID
 */
export function getLeadFlowStage(leadId: string): LeadFlowStatus {
  const stage: LeadFlowStage = _mockLeadStages[leadId] ?? 'spark_captured';
  return {
    stage,
    ...LEAD_FLOW_STAGES[stage],
  };
}

/**
 * Advances a lead to the next flow stage.
 * Called when a role-gated action completes (e.g., PM converts lead to project).
 *
 * In V2 integration, update the `leads` table `flow_stage` column.
 */
export function advanceLeadStage(leadId: string, toStage: LeadFlowStage): void {
  _mockLeadStages[leadId] = toStage;
}

// ─── Audit Decisions ──────────────────────────────────────────────────────────

export interface AuditDecisionEntry {
  id: string;
  timestamp: string;
  user_id: string;
  role: B32Role;
  action: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface LogAuditDecisionParams {
  user_id: string;
  role: B32Role;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}

/** In-memory audit_decisions store (stub — replace with Supabase insert in V2). */
const _auditDecisionsStore: AuditDecisionEntry[] = [];

function _generateAuditId(): string {
  return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Logs a role-tagged action to the `audit_decisions` table.
 * Every action by any role is captured here with the `role` field.
 *
 * Supabase integration target:
 *   await supabase.from('audit_decisions').insert({
 *     user_id, role, action, entity_type, entity_id, description, metadata,
 *     timestamp: new Date().toISOString(),
 *   })
 *
 * @param params - action details including role
 */
export function logAuditDecision(params: LogAuditDecisionParams): AuditDecisionEntry {
  const entry: AuditDecisionEntry = {
    id: _generateAuditId(),
    timestamp: new Date().toISOString(),
    user_id: params.user_id,
    role: params.role,
    action: params.action,
    entity_type: params.entity_type,
    entity_id: params.entity_id ?? null,
    description: params.description,
    metadata: params.metadata,
  };

  _auditDecisionsStore.unshift(entry);

  // Fire-and-forget console log for prototype visibility
  console.log(
    `[audit_decisions] ${entry.timestamp} | ${entry.role} | ${entry.action} | ${entry.entity_type}`,
    entry.entity_id ? `#${entry.entity_id}` : '',
  );

  return entry;
}

/**
 * Returns all audit_decisions entries (for owner audit trail view).
 * Optionally filter by role or user_id.
 */
export function getAuditDecisions(filters?: {
  role?: B32Role;
  user_id?: string;
  limit?: number;
}): AuditDecisionEntry[] {
  let entries = [..._auditDecisionsStore];

  if (filters?.role) {
    entries = entries.filter((e) => e.role === filters.role);
  }
  if (filters?.user_id) {
    entries = entries.filter((e) => e.user_id === filters.user_id);
  }

  const limit = filters?.limit ?? 100;
  return entries.slice(0, limit);
}

// ─── Role Display Helpers ─────────────────────────────────────────────────────

export const B32_ROLE_LABELS: Record<B32Role, string> = {
  employee:            'Employee',
  project_manager:     'Project Manager',
  operations_director: 'Operations Director',
  owner:               'Owner',
};

export const B32_ROLE_COLORS: Record<B32Role, { text: string; bg: string; border: string }> = {
  employee:            { text: 'text-cyan-400',   bg: 'bg-cyan-900/30',   border: 'border-cyan-700/40'   },
  project_manager:     { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700/40'   },
  operations_director: { text: 'text-purple-400', bg: 'bg-purple-900/30', border: 'border-purple-700/40' },
  owner:               { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700/40'  },
};
