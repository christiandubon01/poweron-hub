/**
 * roleService.ts
 * V3-28 — Role Configuration System (CREW-PORTAL-LIVE-1 + LIVE-2)
 *
 * Member list + role writes use employee_profiles (same source as Team → Timesheets).
 * Portal access role: employee | foreman (`role` column).
 * Trade role: tech_1 | tech_2 | lead | foreman | null (`employee_role` column, migration 084).
 * Invite path: sendEmployeeInvite (see employeeInviteService).
 */

import type { AppRole } from '../config/rolePermissions'
import { supabase } from '@/lib/supabase'

const from = supabase.from as any

export type EmployeePortalRole = 'employee' | 'foreman'

/** Trade / field role — independent of portal access level. */
export type EmployeeTradeRole = 'tech_1' | 'tech_2' | 'lead' | 'foreman'

export const TRADE_ROLE_OPTIONS: Array<EmployeeTradeRole | null> = [
  'tech_1',
  'tech_2',
  'lead',
  'foreman',
  null,
]

export const TRADE_ROLE_LABELS: Record<EmployeeTradeRole, string> = {
  tech_1: 'Tech 1',
  tech_2: 'Tech 2',
  lead: 'Lead',
  foreman: 'Foreman',
}

/** Badge colors for trade roles (Crew Portal + timecards). */
export const TRADE_ROLE_BADGE_CLASS: Record<EmployeeTradeRole, string> = {
  tech_1: 'text-blue-400 bg-blue-900/30 border-blue-700/40',
  tech_2: 'text-cyan-400 bg-cyan-900/30 border-cyan-700/40',
  lead: 'text-amber-400 bg-amber-900/30 border-amber-700/40',
  foreman: 'text-orange-400 bg-orange-900/30 border-orange-700/40',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserRoleRecord {
  id: string
  user_id: string
  org_id: string
  role: AppRole | EmployeePortalRole
  assigned_at: string
  assigned_by: string | null
}

export interface OrgMember {
  /** employee_profiles.id */
  id: string
  /** auth.users id when invite accepted; null while pending */
  user_id: string | null
  name: string
  email: string
  role: EmployeePortalRole
  employeeRole: EmployeeTradeRole | null
  portalAccess: Record<string, unknown> | null
  active: boolean
  assigned_at: string
  avatarInitials?: string
  isPendingInvite?: boolean
}

export interface AssignRolePayload {
  /** employee_profiles.id */
  profileId: string
  orgId: string
  role: EmployeePortalRole
  assignedBy: string
}

export interface AssignTradeRolePayload {
  profileId: string
  orgId: string
  /** null = Unassigned */
  employeeRole: EmployeeTradeRole | null
  assignedBy: string
}

export interface InviteLink {
  url: string
  role: AppRole
  orgId: string
  expiresAt: string
  token: string
}

export interface RoleServiceResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

function toPortalRole(raw: string | null | undefined): EmployeePortalRole {
  return raw === 'foreman' ? 'foreman' : 'employee'
}

export function toTradeRole(raw: string | null | undefined): EmployeeTradeRole | null {
  if (raw === 'tech_1' || raw === 'tech_2' || raw === 'lead' || raw === 'foreman') return raw
  return null
}

function initials(name: string): string {
  return (name || 'U')
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Fetch the role for a single employee profile within an org.
 */
export async function getUserRole(
  userId: string,
  orgId: string,
): Promise<RoleServiceResult<UserRoleRecord>> {
  try {
    const { data, error } = await from('employee_profiles')
      .select('id, user_id, org_id, role, invited_at, created_at, accepted_at')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: 'User not found in org' }

    return {
      success: true,
      data: {
        id: data.id,
        user_id: data.user_id || userId,
        org_id: data.org_id,
        role: toPortalRole(data.role),
        assigned_at: data.accepted_at || data.invited_at || data.created_at,
        assigned_by: null,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    return { success: false, error: message }
  }
}

/**
 * Update employee_profiles.role (portal access: employee | foreman).
 * Owner/admin only (RLS).
 */
export async function assignRole(
  payload: AssignRolePayload,
): Promise<RoleServiceResult<UserRoleRecord>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    if (payload.role !== 'employee' && payload.role !== 'foreman') {
      return { success: false, error: 'Invalid role' }
    }

    const { data, error } = await from('employee_profiles')
      .update({ role: payload.role })
      .eq('id', payload.profileId)
      .eq('org_id', payload.orgId)
      .select('id, user_id, org_id, role, invited_at, created_at, accepted_at')
      .single()

    if (error) return { success: false, error: error.message }

    return {
      success: true,
      data: {
        id: data.id,
        user_id: data.user_id || payload.profileId,
        org_id: data.org_id,
        role: toPortalRole(data.role),
        assigned_at: data.accepted_at || data.invited_at || data.created_at,
        assigned_by: payload.assignedBy || user.id,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.warn('[roleService] assignRole error:', err)
    return { success: false, error: message }
  }
}

/**
 * Update employee_profiles.employee_role (trade role). null = Unassigned.
 * Does not change portal access `role`.
 */
export async function assignTradeRole(
  payload: AssignTradeRolePayload,
): Promise<RoleServiceResult<{ id: string; employeeRole: EmployeeTradeRole | null }>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const next =
      payload.employeeRole === null
        ? null
        : toTradeRole(payload.employeeRole)

    if (payload.employeeRole !== null && next === null) {
      return { success: false, error: 'Invalid trade role' }
    }

    const { data, error } = await from('employee_profiles')
      .update({ employee_role: next })
      .eq('id', payload.profileId)
      .eq('org_id', payload.orgId)
      .select('id, employee_role')
      .single()

    if (error) return { success: false, error: error.message }

    return {
      success: true,
      data: {
        id: data.id,
        employeeRole: toTradeRole(data.employee_role),
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.warn('[roleService] assignTradeRole error:', err)
    return { success: false, error: message }
  }
}

/**
 * All employee_profiles for the org (same roster source as Team → Timesheets).
 */
export async function getOrgMembers(
  orgId: string,
): Promise<RoleServiceResult<OrgMember[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await from('employee_profiles')
      .select('id, user_id, org_id, display_name, email, role, employee_role, portal_access, active, invited_at, created_at, accepted_at')
      .eq('org_id', orgId)
      .order('display_name', { ascending: true })

    if (error) {
      console.warn('[roleService] getOrgMembers failed:', error.message)
      return { success: false, error: error.message }
    }

    const members: OrgMember[] = ((data || []) as Array<{
      id: string
      user_id: string | null
      display_name: string
      email: string | null
      role: string
      employee_role: string | null
      portal_access: Record<string, unknown> | null
      active: boolean
      invited_at: string | null
      created_at: string
      accepted_at: string | null
    }>).map((p) => ({
      id: p.id,
      user_id: p.user_id,
      name: p.display_name || 'Unknown',
      email: p.email || '',
      role: toPortalRole(p.role),
      employeeRole: toTradeRole(p.employee_role),
      portalAccess: p.portal_access ?? null,
      active: p.active !== false,
      assigned_at: p.accepted_at || p.invited_at || p.created_at,
      avatarInitials: initials(p.display_name || 'U'),
      isPendingInvite: !p.user_id,
    }))

    return { success: true, data: members }
  } catch (err: unknown) {
    console.warn('[roleService] getOrgMembers error:', err)
    const message = err instanceof Error ? err.message : 'Network error'
    return { success: false, error: message }
  }
}

/**
 * @deprecated Use sendEmployeeInvite from employeeInviteService.
 */
export async function generateInviteLink(
  orgId: string,
  role: AppRole,
  invitedBy: string,
): Promise<RoleServiceResult<InviteLink>> {
  void orgId
  void role
  void invitedBy
  return {
    success: false,
    error: 'Use sendEmployeeInvite / EmployeeInviteModal — generateInviteLink is retired',
  }
}

/** @deprecated Mock reset — no-op after live wiring. */
export function resetMockMembers(): void {
  // no-op
}
