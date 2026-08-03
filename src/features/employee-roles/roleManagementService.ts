/**
 * roleManagementService.ts — ROLE-2 data service for employee role management.
 *
 * Security rules (enforced here AND by DB RLS):
 *  - org_id is always derived from the authenticated owner profile, never
 *    accepted raw from a component prop.
 *  - RLS on emp_roles, emp_role_assignments, emp_role_permissions, and
 *    emp_permission_overrides is the real enforcement authority.
 *  - No service_role key is used in any browser path.
 *  - Mutations confirm the target employee belongs to the caller's org before
 *    acting (belt-and-suspenders over RLS).
 */

import { supabase } from '@/lib/supabase'
import { getOwnerOrgId } from '@/services/crewPortalService'

// ── Result type (mirrors crewPortalService pattern) ──────────────────────────
export interface ServiceResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

// ── Domain types for ROLE-1 tables ───────────────────────────────────────────

export interface EmpRole {
  id: string
  org_id: string
  name: string
  description: string | null
  created_by: string
  created_at: string
  updated_at: string
  /** Injected client-side: number of employees holding this role. */
  assigneeCount?: number
}

export interface EmpRoleAssignment {
  id: string
  org_id: string
  employee_profile_id: string
  role_id: string
  assigned_by: string
  assigned_at: string
  /** Injected client-side: role name for display. */
  roleName?: string
}

export interface EmpPermissionOverride {
  id: string
  org_id: string
  employee_profile_id: string
  permission_key: string
  is_deny: boolean
  granted_by: string
  created_at: string
  updated_at: string
}

// emp_roles and related tables (migration 113) are not yet in the generated
// db/types.ts. Cast the from accessor to any so chained insert/update/upsert
// calls are not rejected as `never` — same pattern as adminTimecardService.ts.
const from = supabase.from as any

// ── Internal helpers ─────────────────────────────────────────────────────────

async function requireOrgId(): Promise<ServiceResult<string>> {
  return getOwnerOrgId()
}

/** Title-case a stored (lowercased) role name for display. */
export function titleCaseRoleName(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Normalize a role name: trim + lowercase. Rejects blank names. */
function normalizeName(raw: string): ServiceResult<string> {
  const n = raw.trim().toLowerCase()
  if (!n) return { success: false, error: 'Role name cannot be blank.' }
  if (n.length > 80) return { success: false, error: 'Role name must be 80 characters or fewer.' }
  return { success: true, data: n }
}

// ── A. Read operations ────────────────────────────────────────────────────────

/** Load all roles for the authenticated owner's organization. */
export async function loadOrgRoles(): Promise<ServiceResult<EmpRole[]>> {
  try {
    const orgRes = await requireOrgId()
    if (!orgRes.success || !orgRes.data) return { success: false, error: orgRes.error }

    const { data, error } = await from('emp_roles')
      .select('id, org_id, name, description, created_by, created_at, updated_at')
      .eq('org_id', orgRes.data)
      .order('name', { ascending: true })

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EmpRole[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Load permission keys granted to a specific role. */
export async function loadRolePermissions(roleId: string): Promise<ServiceResult<string[]>> {
  try {
    const { data, error } = await from('emp_role_permissions')
      .select('permission_key')
      .eq('role_id', roleId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []).map((r: any) => r.permission_key as string) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Load all role assignments for an employee profile. */
export async function loadEmployeeRoles(
  epId: string,
): Promise<ServiceResult<EmpRoleAssignment[]>> {
  try {
    const { data, error } = await from('emp_role_assignments')
      .select('id, org_id, employee_profile_id, role_id, assigned_by, assigned_at')
      .eq('employee_profile_id', epId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EmpRoleAssignment[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Load all individual permission overrides for an employee profile. */
export async function loadEmployeeOverrides(
  epId: string,
): Promise<ServiceResult<EmpPermissionOverride[]>> {
  try {
    const { data, error } = await from('emp_permission_overrides')
      .select('id, org_id, employee_profile_id, permission_key, is_deny, granted_by, created_at, updated_at')
      .eq('employee_profile_id', epId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EmpPermissionOverride[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Count how many employees currently hold a given role. */
export async function countRoleAssignments(roleId: string): Promise<ServiceResult<number>> {
  try {
    const { count, error } = await from('emp_role_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', roleId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: count ?? 0 }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Verify that an employee_profile belongs to the caller's org. */
export async function verifyEmployeeOrgMembership(epId: string): Promise<ServiceResult<boolean>> {
  try {
    const orgRes = await requireOrgId()
    if (!orgRes.success || !orgRes.data) return { success: false, error: orgRes.error }

    const { data, error } = await supabase
      .from('employee_profiles')
      .select('id')
      .eq('id', epId)
      .eq('org_id', orgRes.data)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data !== null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ── B. Role mutations ─────────────────────────────────────────────────────────

/** Create a new role for the authenticated owner's org. */
export async function createRole(
  name: string,
  description: string,
): Promise<ServiceResult<EmpRole>> {
  try {
    const orgRes = await requireOrgId()
    if (!orgRes.success || !orgRes.data) return { success: false, error: orgRes.error }

    const nameRes = normalizeName(name)
    if (!nameRes.success || !nameRes.data) return { success: false, error: nameRes.error }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await from('emp_roles')
      .insert({
        org_id:      orgRes.data,
        name:        nameRes.data,
        description: description.trim() || null,
        created_by:  user.id,
      })
      .select('id, org_id, name, description, created_by, created_at, updated_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: `A role named "${nameRes.data}" already exists in this organization.` }
      }
      return { success: false, error: error.message }
    }
    return { success: true, data: data as EmpRole }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Rename an existing role. */
export async function renameRole(roleId: string, newName: string): Promise<ServiceResult> {
  try {
    const nameRes = normalizeName(newName)
    if (!nameRes.success || !nameRes.data) return { success: false, error: nameRes.error }

    const { error } = await from('emp_roles')
      .update({ name: nameRes.data })
      .eq('id', roleId)

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: `A role named "${nameRes.data}" already exists.` }
      }
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Replace all permission keys for a role in one safe operation.
 * Deletes existing permissions, then inserts the new set.
 * RLS ensures this can only touch the caller's own org's roles.
 */
export async function setRolePermissions(
  orgId: string,
  roleId: string,
  permissionKeys: string[],
): Promise<ServiceResult> {
  try {
    // Delete existing
    const { error: delErr } = await from('emp_role_permissions')
      .delete()
      .eq('role_id', roleId)

    if (delErr) return { success: false, error: delErr.message }

    // Insert new set (skip empty)
    const unique = Array.from(new Set(permissionKeys)).filter(Boolean)
    if (unique.length > 0) {
      const rows = unique.map(key => ({ org_id: orgId, role_id: roleId, permission_key: key }))
      const { error: insErr } = await from('emp_role_permissions').insert(rows)

      if (insErr) return { success: false, error: insErr.message }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Delete a role. Fails if the role currently has employees assigned.
 * Callers should call countRoleAssignments first and show a confirmation.
 */
export async function deleteRole(roleId: string): Promise<ServiceResult> {
  try {
    // Belt-and-suspenders: refuse if assigned (even though cascade would delete)
    const countRes = await countRoleAssignments(roleId)
    if (!countRes.success) return { success: false, error: countRes.error }
    if ((countRes.data ?? 0) > 0) {
      return {
        success: false,
        error: `This role is assigned to ${countRes.data} employee(s). Remove all assignments before deleting.`,
      }
    }

    const { error } = await from('emp_roles')
      .delete()
      .eq('id', roleId)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ── C. Assignment mutations ───────────────────────────────────────────────────

/** Assign a role to an employee. Idempotent — ignores duplicate. */
export async function assignRole(
  orgId: string,
  epId: string,
  roleId: string,
): Promise<ServiceResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    // Verify employee belongs to the same org (belt-and-suspenders)
    const checkRes = await verifyEmployeeOrgMembership(epId)
    if (!checkRes.success) return { success: false, error: checkRes.error }
    if (!checkRes.data) {
      return { success: false, error: 'Employee does not belong to your organization.' }
    }

    const { error } = await from('emp_role_assignments').insert({
      org_id: orgId,
      employee_profile_id: epId,
      role_id: roleId,
      assigned_by: user.id,
    })

    if (error) {
      if (error.code === '23505') return { success: true } // already assigned — idempotent
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Remove a single role from an employee. Other roles are unaffected. */
export async function removeRole(epId: string, roleId: string): Promise<ServiceResult> {
  try {
    const { error } = await from('emp_role_assignments')
      .delete()
      .eq('employee_profile_id', epId)
      .eq('role_id', roleId)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ── D. Override mutations ─────────────────────────────────────────────────────

/**
 * Set a permission override (Allow or Deny) for an employee.
 * Uses UPSERT on (employee_profile_id, permission_key) unique constraint.
 */
export async function setOverride(
  orgId: string,
  epId: string,
  permKey: string,
  isDeny: boolean,
): Promise<ServiceResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { error } = await from('emp_permission_overrides').upsert(
      {
        org_id:              orgId,
        employee_profile_id: epId,
        permission_key:      permKey,
        is_deny:             isDeny,
        granted_by:          user.id,
      },
      { onConflict: 'employee_profile_id,permission_key' },
    )

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Remove an override, returning the permission to inherited/default state. */
export async function deleteOverride(epId: string, permKey: string): Promise<ServiceResult> {
  try {
    const { error } = await from('emp_permission_overrides')
      .delete()
      .eq('employee_profile_id', epId)
      .eq('permission_key', permKey)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ── E. Effective access calculation (browser-side preview) ───────────────────

export type EffectiveState = 'denied_override' | 'allowed_override' | 'allowed_role' | 'denied_default'

export interface EffectivePermission {
  key: string
  state: EffectiveState
  source: string
}

/**
 * Compute the effective access preview for an employee from owner-visible data.
 *
 * Precedence (mirrors DB resolver, for display only — DB is the enforcement authority):
 *   1. Explicit deny override → denied
 *   2. Explicit allow override → allowed
 *   3. Any role grant → allowed (reports which role)
 *   4. Default → denied
 */
export function computeEffectiveAccess(
  permissionKeys: string[],
  overrides: EmpPermissionOverride[],
  assignments: EmpRoleAssignment[],
  rolePermMap: Map<string, string[]>,
  roleNameMap: Map<string, string>,
): EffectivePermission[] {
  return permissionKeys.map(key => {
    const override = overrides.find(o => o.permission_key === key)

    if (override?.is_deny) {
      return { key, state: 'denied_override', source: 'Denied by individual override' }
    }
    if (override && !override.is_deny) {
      return { key, state: 'allowed_override', source: 'Allowed by individual override' }
    }

    for (const assignment of assignments) {
      const perms = rolePermMap.get(assignment.role_id) ?? []
      if (perms.includes(key)) {
        const name = roleNameMap.get(assignment.role_id) ?? assignment.role_id
        return { key, state: 'allowed_role', source: `Granted by ${titleCaseRoleName(name)}` }
      }
    }

    return { key, state: 'denied_default', source: 'Not granted' }
  })
}
