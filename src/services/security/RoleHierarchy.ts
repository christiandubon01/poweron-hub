/**
 * RoleHierarchy.ts
 * 
 * Role-based access control (RBAC) service for PowerOn Hub.
 * Defines role hierarchy, panel visibility, and column-level access controls.
 */

// Role types with hierarchical ordering
export type UserRole = 'owner' | 'foreman' | 'employee' | 'guest';

// Role hierarchy: owner > foreman > employee > guest
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner: 4,
  foreman: 3,
  employee: 2,
  guest: 1,
};

// Resource types for access control
export type ResourceType = 
  | 'projects'
  | 'financial'
  | 'crew'
  | 'settings'
  | 'billing'
  | 'pricing'
  | 'field_logs'
  | 'tasks'
  | 'hours'
  | 'project_details';

// Panel IDs that can be gated by role
export type PanelId = 
  | 'home'
  | 'projects'
  | 'estimate'
  | 'field'
  | 'progress'
  | 'dashboard'
  | 'mto'
  | 'rfi'
  | 'coord'
  | 'pricebook'
  | 'money'
  | 'graphs'
  | 'incalc'
  | 'leads'
  | 'team'
  | 'templates'
  | 'intelligence'
  | 'settings';

// Table names for column-level filtering
export type TableName = 
  | 'projects'
  | 'serviceLogs'
  | 'employees'
  | 'weeklyData'
  | 'logs'
  | 'settings';

/**
 * Role Permissions Matrix
 * Defines which resources each role can access
 */
const ROLE_PERMISSIONS: Record<UserRole, ResourceType[]> = {
  owner: [
    'projects',
    'financial',
    'crew',
    'settings',
    'billing',
    'pricing',
    'field_logs',
    'tasks',
    'hours',
    'project_details',
  ],
  foreman: [
    'projects',
    'field_logs',
    'tasks',
    'hours',
    'project_details',
  ],
  employee: [
    'tasks',
    'hours',
  ],
  guest: [],
};

/**
 * Panel Access Control
 * Defines which panels each role can see
 */
const PANEL_ACCESS: Record<UserRole, PanelId[]> = {
  owner: [
    'home',
    'projects',
    'estimate',
    'field',
    'progress',
    'dashboard',
    'mto',
    'rfi',
    'coord',
    'pricebook',
    'money',
    'graphs',
    'incalc',
    'leads',
    'team',
    'templates',
    'intelligence',
    'settings',
  ],
  foreman: [
    'home',
    'projects',
    'field',
    'progress',
    'leads',
  ],
  employee: [
    'home',
    'field',
  ],
  guest: [
    'home',
  ],
};

/**
 * Column visibility per role per table
 * Defines which columns are visible in each table for each role
 */
const COLUMN_ACCESS: Record<TableName, Record<UserRole, string[]>> = {
  projects: {
    owner: ['id', 'name', 'type', 'status', 'contract', 'billed', 'paid', 'health', 'lastMove', 'phases', 'margin'],
    foreman: ['id', 'name', 'status', 'health', 'phases', 'tasks'],
    employee: ['id', 'name', 'status'],
    guest: ['id', 'name', 'status'],
  },
  serviceLogs: {
    owner: ['id', 'date', 'customer', 'address', 'jtype', 'hrs', 'miles', 'quoted', 'mat', 'collected', 'profit', 'payStatus', 'mileCost', 'opCost', 'notes'],
    foreman: ['id', 'date', 'customer', 'hrs', 'quoted', 'collected', 'payStatus'],
    employee: ['id', 'date', 'hrs', 'collected'],
    guest: [],
  },
  employees: {
    owner: ['id', 'name', 'role', 'costRate', 'billRate'],
    foreman: ['id', 'name', 'role'],
    employee: ['id', 'name'],
    guest: [],
  },
  weeklyData: {
    owner: ['wk', 'start', 'proj', 'svc', 'unbilled', 'pendingInv', 'accum'],
    foreman: ['wk', 'start', 'proj'],
    employee: [],
    guest: [],
  },
  logs: {
    owner: ['id', 'projectId', 'date', 'hrs', 'miles', 'mat', 'note', 'paymentsCollected'],
    foreman: ['id', 'projectId', 'date', 'hrs', 'miles', 'note'],
    employee: ['id', 'date', 'hrs'],
    guest: [],
  },
  settings: {
    owner: ['company', 'billRate', 'defaultOHRate', 'markup', 'tax', 'mileRate', 'dayTarget', 'overhead', 'phaseWeights'],
    foreman: [],
    employee: [],
    guest: [],
  },
};

/**
 * Check if a user role has access to a specific resource
 * 
 * @param role - The user's role
 * @param resource - The resource to check access for
 * @returns true if the role can access the resource
 */
export function checkRoleAccess(role: UserRole, resource: ResourceType): boolean {
  return ROLE_PERMISSIONS[role].includes(resource);
}

/**
 * Get all panel IDs visible to a user role
 * 
 * @param role - The user's role
 * @returns Array of panel IDs the role can access
 */
export function getVisiblePanels(role: UserRole): PanelId[] {
  return PANEL_ACCESS[role] || [];
}

/**
 * Get visible columns for a specific table and role
 * 
 * @param role - The user's role
 * @param table - The table name
 * @returns Array of visible column names
 */
export function getVisibleColumns(role: UserRole, table: TableName): string[] {
  return COLUMN_ACCESS[table]?.[role] || [];
}

/**
 * Check if a specific panel is accessible by a role
 * 
 * @param role - The user's role
 * @param panelId - The panel ID to check
 * @returns true if the role can access the panel
 */
export function canAccessPanel(role: UserRole, panelId: PanelId): boolean {
  return getVisiblePanels(role).includes(panelId);
}

/**
 * Check if a role can see a specific column in a table
 * 
 * @param role - The user's role
 * @param table - The table name
 * @param column - The column name
 * @returns true if the role can see the column
 */
export function canAccessColumn(role: UserRole, table: TableName, column: string): boolean {
  const visibleColumns = getVisibleColumns(role, table);
  return visibleColumns.includes(column);
}

/**
 * Compare two roles by hierarchy level
 * 
 * @param role1 - First role to compare
 * @param role2 - Second role to compare
 * @returns positive if role1 > role2, negative if role1 < role2, 0 if equal
 */
export function compareRoles(role1: UserRole, role2: UserRole): number {
  return ROLE_HIERARCHY[role1] - ROLE_HIERARCHY[role2];
}

/**
 * Check if role1 is greater than or equal to role2 in hierarchy
 * 
 * @param role1 - The role to check
 * @param role2 - The role to compare against
 * @returns true if role1 >= role2
 */
export function roleGte(role1: UserRole, role2: UserRole): boolean {
  return ROLE_HIERARCHY[role1] >= ROLE_HIERARCHY[role2];
}

/**
 * Check if role1 is greater than role2 in hierarchy
 * 
 * @param role1 - The role to check
 * @param role2 - The role to compare against
 * @returns true if role1 > role2
 */
export function roleGt(role1: UserRole, role2: UserRole): boolean {
  return ROLE_HIERARCHY[role1] > ROLE_HIERARCHY[role2];
}

/**
 * Get the role description
 * 
 * @param role - The role
 * @returns A human-readable description of the role
 */
export function getRoleDescription(role: UserRole): string {
  const descriptions: Record<UserRole, string> = {
    owner: 'Full access to everything — all panels, data, settings, billing',
    foreman: 'Crew tasks, assigned project details, field logs, hours. Cannot see: financials, other salaries, settings',
    employee: 'Task list, own hours, clock in/out. Cannot see: financial data, other employees, project costs',
    guest: 'Project name and health status only. Cannot see: financial, crew, internal data',
  };
  return descriptions[role];
}

/**
 * Export all security functions
 */
export default {
  checkRoleAccess,
  getVisiblePanels,
  getVisibleColumns,
  canAccessPanel,
  canAccessColumn,
  compareRoles,
  roleGte,
  roleGt,
  getRoleDescription,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  PANEL_ACCESS,
  COLUMN_ACCESS,
};
