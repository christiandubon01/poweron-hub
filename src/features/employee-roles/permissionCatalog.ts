/**
 * permissionCatalog.ts — Central permission catalog for the ROLE-2+ system.
 *
 * Single source of truth for all permission keys. Components reference this
 * catalog rather than scattering raw strings. ROLE-3 and later phases consume
 * these same keys for Portal feature gates.
 *
 * Permission key format: <category>.<action>  (matches the DB CHECK constraint)
 */

export interface PermissionEntry {
  key: string
  label: string
  description: string
  category: PermissionCategory
  sensitive?: true
}

export type PermissionCategory =
  | 'Leads'
  | 'Service Calls'
  | 'Scheduling'
  | 'Estimates'
  | 'Finance'
  | 'Reviews'
  | 'Projects'
  | 'Work Packages'
  | 'Time'
  | 'Tasks'
  | 'Admin'

export const PERMISSION_CATALOG: PermissionEntry[] = [
  // ── Leads ────────────────────────────────────────────────────────────────────
  {
    key: 'leads.view',
    label: 'View Leads',
    description: 'See the leads list and individual lead details.',
    category: 'Leads',
  },
  {
    key: 'leads.assign',
    label: 'Assign Leads',
    description: 'Assign leads to team members or take ownership.',
    category: 'Leads',
  },
  {
    key: 'leads.update',
    label: 'Update Leads',
    description: 'Edit lead details, status, and follow-up notes.',
    category: 'Leads',
  },

  // ── Service Calls ─────────────────────────────────────────────────────────
  {
    key: 'service_calls.view',
    label: 'View Service Calls',
    description: 'See the service call list and individual call details.',
    category: 'Service Calls',
  },
  {
    key: 'service_calls.assign',
    label: 'Assign Service Calls',
    description: 'Assign service calls to technicians.',
    category: 'Service Calls',
  },
  {
    key: 'service_calls.update',
    label: 'Update Service Calls',
    description: 'Edit service call details, notes, and status.',
    category: 'Service Calls',
  },

  // ── Scheduling ────────────────────────────────────────────────────────────
  {
    key: 'scheduling.view',
    label: 'View Schedule',
    description: 'See the team schedule and individual assignments.',
    category: 'Scheduling',
  },
  {
    key: 'scheduling.manage',
    label: 'Manage Schedule',
    description: 'Create, edit, and delete schedule entries for the team.',
    category: 'Scheduling',
  },

  // ── Estimates ─────────────────────────────────────────────────────────────
  {
    key: 'estimates.view',
    label: 'View Estimates',
    description: 'See estimate documents and their statuses.',
    category: 'Estimates',
  },
  {
    key: 'estimates.create_draft',
    label: 'Create Draft Estimates',
    description: 'Start new estimates and save them as drafts.',
    category: 'Estimates',
  },
  {
    key: 'estimates.send',
    label: 'Send Estimates',
    description: 'Send finalized estimates to customers.',
    category: 'Estimates',
    sensitive: true,
  },
  {
    key: 'estimates.view_financials',
    label: 'View Estimate Financials',
    description: 'See cost breakdowns, margins, and profit data in estimates.',
    category: 'Estimates',
    sensitive: true,
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  {
    key: 'finance.view',
    label: 'View Financials',
    description: 'See invoices, payments, and financial summaries.',
    category: 'Finance',
    sensitive: true,
  },
  {
    key: 'finance.manage',
    label: 'Manage Financials',
    description: 'Create invoices, record payments, and manage billing.',
    category: 'Finance',
    sensitive: true,
  },

  // ── Reviews ───────────────────────────────────────────────────────────────
  {
    key: 'reviews.request',
    label: 'Request Reviews',
    description: 'Send review requests to customers after job completion.',
    category: 'Reviews',
  },

  // ── Projects ──────────────────────────────────────────────────────────────
  {
    key: 'projects.view_assigned',
    label: 'View Assigned Projects',
    description: 'See details of projects they are assigned to.',
    category: 'Projects',
  },

  // ── Work Packages ─────────────────────────────────────────────────────────
  {
    key: 'work_packages.view_assigned',
    label: 'View Assigned Work Packages',
    description: 'See work packages and tasks assigned to them.',
    category: 'Work Packages',
  },

  // ── Time ──────────────────────────────────────────────────────────────────
  {
    key: 'time.view_own',
    label: 'View Own Time',
    description: 'See their own time entries and history.',
    category: 'Time',
  },
  {
    key: 'time.manage_team',
    label: 'Manage Team Time',
    description: 'View and edit time entries for all team members.',
    category: 'Time',
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  {
    key: 'tasks.view_own',
    label: 'View Own Tasks',
    description: 'See tasks assigned to them.',
    category: 'Tasks',
  },
  {
    key: 'tasks.assign',
    label: 'Assign Tasks',
    description: 'Create and assign tasks to team members.',
    category: 'Tasks',
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  {
    key: 'admin.manage_roles',
    label: 'Manage Roles & Permissions',
    description: 'Create, edit, and delete employee roles and permission assignments.',
    category: 'Admin',
    sensitive: true,
  },
]

/** All distinct categories in catalog order. */
export const PERMISSION_CATEGORIES: PermissionCategory[] = Array.from(
  new Set(PERMISSION_CATALOG.map(p => p.category))
)

/** Look up a catalog entry by key. Returns undefined for unknown keys. */
export function getCatalogEntry(key: string): PermissionEntry | undefined {
  return PERMISSION_CATALOG.find(p => p.key === key)
}

/** Get all entries for a given category. */
export function getPermissionsByCategory(category: PermissionCategory): PermissionEntry[] {
  return PERMISSION_CATALOG.filter(p => p.category === category)
}
