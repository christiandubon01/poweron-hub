/**
 * rolePermissions.ts
 * V3-28 — Role Configuration System
 *
 * Defines all application roles and their associated permissions.
 * Used by roleService.ts and the Role Manager UI in CrewPortal.
 */

// ─── Role Type ────────────────────────────────────────────────────────────────

export type AppRole =
  | 'owner'
  | 'manager'
  | 'foreman'
  | 'sales'
  | 'crew'
  | 'receptionist';

export const ALL_ROLES: AppRole[] = [
  'owner',
  'manager',
  'foreman',
  'sales',
  'crew',
  'receptionist',
];

// ─── Panel IDs (mirrors FEATURE_VIEWS in App.tsx) ─────────────────────────────

export const PANEL_IDS = {
  BLUEPRINT_AI:        'blueprint-ai',
  AGENT_MODE_SELECTOR: 'agent-mode-selector',
  N8N_AUTOMATION:      'n8n-automation',
  GUARDIAN:            'guardian',
  SPARK_LIVE_CALL:     'spark-live-call',
  LEAD_ROLLING_TREND:  'lead-rolling-trend',
  MATERIAL_INTEL:      'material-intelligence',
  VAULT_ESTIMATE:      'vault-estimate',
  DEBT_KILLER:         'debt-killer',
  VOICE_JOURNALING:    'voice-journaling-v2',
  CREW_PORTAL:         'crew-portal',
  DEMO_MODE:           'demo-mode',
  SETTINGS:            'settings',
} as const;

const ALL_PANELS: string[] = Object.values(PANEL_IDS);

// ─── Permission Interface ─────────────────────────────────────────────────────

export type DataScope =
  | 'all'               // owner / manager: unrestricted
  | 'assigned-projects' // crew: only projects they are assigned to
  | 'assigned-leads'    // sales: only leads they own
  | 'own-logs';         // foreman: own field logs only

export interface RolePermissions {
  /** Which panel IDs are visible in the sidebar for this role */
  visiblePanels: string[];
  /** Panel ID to navigate to when a restricted panel is requested */
  defaultPanel: string;
  /** May edit financial figures (invoices, estimates, debt killer) */
  canEditFinancials: boolean;
  /** Data filter applied to list views */
  dataScope: DataScope;
  /** Resources/domains this role can read */
  canRead: string[];
  /** Resources/domains this role can write / modify */
  canWrite: string[];
}

// ─── Permission Matrix ────────────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<AppRole, RolePermissions> = {

  /**
   * OWNER
   * Full access to all panels, all read/write operations.
   * Can manage roles, view billing, and configure the org.
   */
  owner: {
    visiblePanels: ALL_PANELS,
    defaultPanel: PANEL_IDS.BLUEPRINT_AI,   // Home
    canEditFinancials: true,
    dataScope: 'all',
    canRead: ['*'],
    canWrite: ['*'],
  },

  /**
   * MANAGER
   * Operational oversight. Can see all work panels but not demo or
   * low-level agent configuration. Can write to most business objects.
   */
  manager: {
    visiblePanels: [
      PANEL_IDS.BLUEPRINT_AI,
      PANEL_IDS.N8N_AUTOMATION,
      PANEL_IDS.GUARDIAN,
      PANEL_IDS.SPARK_LIVE_CALL,
      PANEL_IDS.LEAD_ROLLING_TREND,
      PANEL_IDS.MATERIAL_INTEL,
      PANEL_IDS.VAULT_ESTIMATE,
      PANEL_IDS.DEBT_KILLER,
      PANEL_IDS.VOICE_JOURNALING,
      PANEL_IDS.CREW_PORTAL,
      PANEL_IDS.SETTINGS,
    ],
    defaultPanel: PANEL_IDS.GUARDIAN,        // Projects
    canEditFinancials: true,
    dataScope: 'all',
    canRead: [
      'projects',
      'leads',
      'invoices',
      'expenses',
      'debts',
      'crew',
      'journal_entries',
      'guardian_rules',
      'guardian_violations',
      'blueprints',
      'estimates',
      'materials',
      'workflows',
    ],
    canWrite: [
      'projects',
      'leads',
      'invoices',
      'expenses',
      'crew',
      'journal_entries',
      'guardian_rules',
      'blueprints',
      'estimates',
    ],
  },

  /**
   * FOREMAN
   * Field team lead. Focuses on crew management, tasks, and field logs.
   * No access to financial data, lead pipeline, or app configuration.
   */
  foreman: {
    visiblePanels: [
      PANEL_IDS.GUARDIAN,
      PANEL_IDS.VOICE_JOURNALING,
      PANEL_IDS.CREW_PORTAL,
      PANEL_IDS.SPARK_LIVE_CALL,
    ],
    defaultPanel: PANEL_IDS.VOICE_JOURNALING, // Field Log
    canEditFinancials: false,
    dataScope: 'own-logs',
    canRead: [
      'projects',
      'crew',
      'crew_tasks',
      'journal_entries',
      'guardian_rules',
      'guardian_violations',
    ],
    canWrite: [
      'crew_tasks',
      'journal_entries',
    ],
  },

  /**
   * SALES
   * Lead management, estimates, and call intelligence.
   * No access to internal crew data or financial records.
   */
  sales: {
    visiblePanels: [
      PANEL_IDS.LEAD_ROLLING_TREND,
      PANEL_IDS.SPARK_LIVE_CALL,
      PANEL_IDS.VAULT_ESTIMATE,
      PANEL_IDS.BLUEPRINT_AI,
      PANEL_IDS.MATERIAL_INTEL,
    ],
    defaultPanel: PANEL_IDS.LEAD_ROLLING_TREND, // Leads
    canEditFinancials: false,
    dataScope: 'assigned-leads',
    canRead: [
      'leads',
      'estimates',
      'materials',
      'blueprints',
      'call_sessions',
    ],
    canWrite: [
      'leads',
      'estimates',
      'call_sessions',
    ],
  },

  /**
   * CREW
   * Individual field worker. Sees only their own tasks and logs.
   * Minimal write access — own journal and task status only.
   */
  crew: {
    visiblePanels: [
      PANEL_IDS.CREW_PORTAL,
      PANEL_IDS.VOICE_JOURNALING,
    ],
    defaultPanel: PANEL_IDS.CREW_PORTAL, // Field Log (crew-facing)
    canEditFinancials: false,
    dataScope: 'assigned-projects',
    canRead: [
      'own_tasks',
      'own_projects',
      'own_journal_entries',
    ],
    canWrite: [
      'own_journal_entries',
      'own_task_status',
    ],
  },

  /**
   * RECEPTIONIST
   * Front-desk / admin support. Handles lead intake and crew scheduling.
   * Read-only on most data; can write new leads and schedule entries.
   */
  receptionist: {
    visiblePanels: [
      PANEL_IDS.LEAD_ROLLING_TREND,
      PANEL_IDS.SPARK_LIVE_CALL,
      PANEL_IDS.CREW_PORTAL,
    ],
    defaultPanel: PANEL_IDS.SPARK_LIVE_CALL, // Intake
    canEditFinancials: false,
    dataScope: 'all',
    canRead: [
      'leads',
      'crew',
      'projects',
      'call_sessions',
    ],
    canWrite: [
      'leads',
      'call_sessions',
    ],
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the full permissions object for the given role.
 */
export function getPermissionsForRole(role: AppRole): RolePermissions {
  return ROLE_PERMISSIONS[role];
}

/**
 * Returns true if the role can see the given panel.
 */
export function canSeePanel(role: AppRole, panelId: string): boolean {
  const perms = getPermissionsForRole(role);
  return perms.visiblePanels.includes(panelId);
}

/**
 * Returns true if the role can read the given resource.
 * Wildcard '*' grants access to all resources.
 */
export function canRead(role: AppRole, resource: string): boolean {
  const perms = getPermissionsForRole(role);
  return perms.canRead.includes('*') || perms.canRead.includes(resource);
}

/**
 * Returns true if the role can write the given resource.
 * Wildcard '*' grants write access to all resources.
 */
export function canWrite(role: AppRole, resource: string): boolean {
  const perms = getPermissionsForRole(role);
  return perms.canWrite.includes('*') || perms.canWrite.includes(resource);
}

/**
 * Human-readable display labels for each role.
 */
export const ROLE_LABELS: Record<AppRole, string> = {
  owner:        'Owner',
  manager:      'Manager',
  foreman:      'Foreman',
  sales:        'Sales',
  crew:         'Crew',
  receptionist: 'Receptionist',
};

/**
 * Returns the safe landing panel for a role.
 */
export function getDefaultPanel(role: AppRole): string {
  return ROLE_PERMISSIONS[role].defaultPanel;
}

/**
 * Roles that are allowed to use the "View As" switcher.
 */
export const VIEW_AS_ELIGIBLE_ROLES: AppRole[] = ['owner'];

/**
 * Tailwind color tokens for each role badge.
 */
export const ROLE_COLORS: Record<AppRole, { text: string; bg: string; border: string }> = {
  owner:        { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700/40' },
  manager:      { text: 'text-purple-400', bg: 'bg-purple-900/30', border: 'border-purple-700/40' },
  foreman:      { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700/40' },
  sales:        { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700/40' },
  crew:         { text: 'text-cyan-400',   bg: 'bg-cyan-900/30',   border: 'border-cyan-700/40' },
  receptionist: { text: 'text-pink-400',   bg: 'bg-pink-900/30',   border: 'border-pink-700/40' },
};
