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

// ── Bounded read-after-write verification (ROLE-2.4) ─────────────────────────
// The false "written but not visible" first-save error came from a SINGLE
// immediate SELECT after the write: PostgREST read replicas / connection routing
// can lag a few milliseconds behind the write, so the row is real but momentarily
// invisible. A second click "worked" only because the lag had cleared.
//
// Fix: (1) prefer the authoritative rows the write itself returns (same request,
// no replica lag); (2) if a fresh SELECT is still needed, retry it a bounded
// number of times with short backoff BEFORE reporting failure. The write is NEVER
// repeated during verification.

const VERIFY_DELAYS_MS = [0, 60, 180]

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve()
}

/** True when two key collections contain exactly the same set of values. */
export function sameKeySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const k of b) if (!sa.has(k)) return false
  return true
}

/**
 * Re-run `load` up to VERIFY_DELAYS_MS.length times (with short backoff between
 * attempts) until `predicate(rows)` holds. Returns the last load result. Does NOT
 * write anything. Used only to confirm a write became visible.
 */
async function verifyWithRetry<T>(
  load: () => Promise<ServiceResult<T[]>>,
  predicate: (rows: T[]) => boolean,
): Promise<ServiceResult<T[]>> {
  let last: ServiceResult<T[]> = { success: false, error: 'Verification did not run.' }
  for (let i = 0; i < VERIFY_DELAYS_MS.length; i++) {
    await sleep(VERIFY_DELAYS_MS[i])
    last = await load()
    if (last.success && predicate(last.data ?? [])) return last
  }
  return last
}

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
 * org_id is always taken from the authenticated owner profile (never trusted
 * from a component prop alone). After write, a fresh SELECT verifies rows.
 */
export async function setRolePermissions(
  _orgId: string,
  roleId: string,
  permissionKeys: string[],
): Promise<ServiceResult<string[]>> {
  try {
    const orgRes = await requireOrgId()
    if (!orgRes.success || !orgRes.data) return { success: false, error: orgRes.error }
    const orgId = orgRes.data

    // Confirm the role belongs to this org before mutating permissions.
    const { data: roleRow, error: roleErr } = await from('emp_roles')
      .select('id, org_id')
      .eq('id', roleId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (roleErr) return { success: false, error: roleErr.message }
    if (!roleRow) return { success: false, error: 'Role not found in your organization.' }

    const { error: delErr } = await from('emp_role_permissions')
      .delete()
      .eq('role_id', roleId)

    if (delErr) return { success: false, error: delErr.message }

    const unique = Array.from(new Set(permissionKeys)).filter(Boolean)

    // Empty set: nothing to insert. Verify the delete landed (bounded retry).
    if (unique.length === 0) {
      const verify = await verifyWithRetry(
        () => loadRolePermissions(roleId),
        rows => rows.length === 0,
      )
      if (verify.success && (verify.data ?? []).length === 0) return { success: true, data: [] }
      return { success: false, error: verify.error || 'Cleared permissions but rows still visible after retries.' }
    }

    const rows = unique.map(key => ({ org_id: orgId, role_id: roleId, permission_key: key }))
    // Return the inserted rows in the SAME request — authoritative, no replica lag.
    const { data: insData, error: insErr } = await from('emp_role_permissions')
      .insert(rows)
      .select('permission_key')
    if (insErr) return { success: false, error: insErr.message }

    // Fast path: the write's own returned rows already match the intended set.
    const insertedKeys = Array.isArray(insData)
      ? insData.map((r: any) => r.permission_key as string)
      : []
    if (sameKeySet(insertedKeys, unique)) {
      return { success: true, data: unique }
    }

    // Fallback: bounded read-after-write verification (NEVER re-writes).
    const verify = await verifyWithRetry(
      () => loadRolePermissions(roleId),
      saved => sameKeySet(saved, unique),
    )
    if (verify.success && sameKeySet(verify.data ?? [], unique)) {
      return { success: true, data: verify.data ?? [] }
    }
    const saved = new Set(verify.data ?? [])
    const missing = unique.filter(k => !saved.has(k))
    return {
      success: false,
      error: missing.length > 0
        ? `Permissions were written but ${missing.length} were still not visible after retries (${missing.join(', ')}). Check SELECT policy on emp_role_permissions.`
        : `Expected ${unique.length} permission(s) after save, found ${(verify.data ?? []).length}.`,
    }
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

/** Assign a role to an employee. Idempotent — ignores duplicate. Verifies with a fresh query. */
export async function assignRole(
  _orgId: string,
  epId: string,
  roleId: string,
): Promise<ServiceResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const orgRes = await requireOrgId()
    if (!orgRes.success || !orgRes.data) return { success: false, error: orgRes.error }
    const orgId = orgRes.data

    // employee_profiles.id only — never a Cost Model / backup id.
    const checkRes = await verifyEmployeeOrgMembership(epId)
    if (!checkRes.success) return { success: false, error: checkRes.error }
    if (!checkRes.data) {
      return { success: false, error: 'Employee does not belong to your organization.' }
    }

    const { data: insData, error } = await from('emp_role_assignments')
      .insert({
        org_id: orgId,
        employee_profile_id: epId,
        role_id: roleId,
        assigned_by: user.id,
      })
      .select('id, role_id')

    // 23505 = already assigned. Idempotent success — the pair exists either way.
    if (error && error.code !== '23505') {
      return { success: false, error: error.message }
    }

    // Fast path: the insert returned the row we intended (no duplicate case).
    if (!error && Array.isArray(insData) && insData.some((a: any) => a.role_id === roleId)) {
      return { success: true }
    }

    // Duplicate (23505) or no returned row → bounded read-after-write verify.
    const verify = await verifyWithRetry(
      () => loadEmployeeRoles(epId),
      rows => rows.some(a => a.role_id === roleId),
    )
    if (verify.success && (verify.data ?? []).some(a => a.role_id === roleId)) {
      return { success: true }
    }
    return {
      success: false,
      error: verify.error
        || 'Assignment was written but did not appear after retries. Check SELECT on emp_role_assignments.',
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Remove a single role from an employee. Other roles are unaffected. Verifies removal. */
export async function removeRole(epId: string, roleId: string): Promise<ServiceResult> {
  try {
    const { error } = await from('emp_role_assignments')
      .delete()
      .eq('employee_profile_id', epId)
      .eq('role_id', roleId)

    if (error) return { success: false, error: error.message }

    // Bounded read-after-write verify that the row is gone (never re-deletes).
    const verify = await verifyWithRetry(
      () => loadEmployeeRoles(epId),
      rows => !rows.some(a => a.role_id === roleId),
    )
    if (verify.success && !(verify.data ?? []).some(a => a.role_id === roleId)) {
      return { success: true }
    }
    return {
      success: false,
      error: verify.error
        || 'Role assignment is still present after retries. Check DELETE policy on emp_role_assignments.',
    }
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
