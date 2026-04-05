/**
 * roleService.ts
 * V3-28 — Role Configuration System
 *
 * Service stubs for the `user_roles` Supabase table.
 * Replace stub bodies with real @supabase/supabase-js calls on V2 integration.
 *
 * Supabase table: user_roles
 * Schema:
 *   id          uuid         primary key, default gen_random_uuid()
 *   user_id     uuid         not null, references auth.users(id)
 *   org_id      uuid         not null
 *   role        text         not null  -- AppRole enum value
 *   assigned_at timestamptz  not null, default now()
 *   assigned_by uuid         references auth.users(id)
 */

import type { AppRole } from '../config/rolePermissions';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserRoleRecord {
  id: string;
  user_id: string;
  org_id: string;
  role: AppRole;
  assigned_at: string;  // ISO 8601 timestamp
  assigned_by: string | null;
}

export interface OrgMember {
  user_id: string;
  name: string;
  email: string;
  role: AppRole;
  assigned_at: string;
  avatarInitials?: string;
}

export interface AssignRolePayload {
  userId: string;
  orgId: string;
  role: AppRole;
  assignedBy: string;
}

export interface InviteLink {
  url: string;
  role: AppRole;
  orgId: string;
  expiresAt: string;  // ISO 8601 — links expire after 7 days
  token: string;
}

export interface RoleServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Mock org members (external prototype only) ───────────────────────────────

const MOCK_ORG_MEMBERS: OrgMember[] = [
  {
    user_id: 'user-001',
    name: 'Chris Swatish',
    email: 'chris@poweronsolutions.com',
    role: 'owner',
    assigned_at: '2026-01-01T00:00:00.000Z',
    avatarInitials: 'CS',
  },
  {
    user_id: 'user-002',
    name: 'Marco Delgado',
    email: 'marco@poweronsolutions.com',
    role: 'foreman',
    assigned_at: '2026-01-15T08:00:00.000Z',
    avatarInitials: 'MD',
  },
  {
    user_id: 'user-003',
    name: 'Tanya Reeves',
    email: 'tanya@poweronsolutions.com',
    role: 'manager',
    assigned_at: '2026-01-15T08:30:00.000Z',
    avatarInitials: 'TR',
  },
  {
    user_id: 'user-004',
    name: 'Jordan Kim',
    email: 'jordan@poweronsolutions.com',
    role: 'sales',
    assigned_at: '2026-02-01T09:00:00.000Z',
    avatarInitials: 'JK',
  },
  {
    user_id: 'user-005',
    name: 'Marcus R.',
    email: 'marcus@poweronsolutions.com',
    role: 'crew',
    assigned_at: '2026-02-10T07:00:00.000Z',
    avatarInitials: 'MR',
  },
  {
    user_id: 'user-006',
    name: 'Linda Tran',
    email: 'linda@poweronsolutions.com',
    role: 'receptionist',
    assigned_at: '2026-03-01T08:00:00.000Z',
    avatarInitials: 'LT',
  },
];

// In-memory mutation store for prototype
let _mockMembers: OrgMember[] = [...MOCK_ORG_MEMBERS];

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Fetch the role record for a single user within an org.
 *
 * Supabase query:
 *   supabase
 *     .from('user_roles')
 *     .select('*')
 *     .eq('user_id', userId)
 *     .eq('org_id', orgId)
 *     .maybeSingle()
 */
export async function getUserRole(
  userId: string,
  orgId: string
): Promise<RoleServiceResult<UserRoleRecord>> {
  // STUB — replace with real Supabase call
  void orgId;
  const member = _mockMembers.find((m) => m.user_id === userId);
  if (!member) {
    return { success: false, error: 'User not found in org' };
  }
  return {
    success: true,
    data: {
      id: `role-${userId}`,
      user_id: member.user_id,
      org_id: orgId,
      role: member.role,
      assigned_at: member.assigned_at,
      assigned_by: null,
    },
  };
}

/**
 * Assign or update a role for a user within an org.
 * Uses upsert on (user_id, org_id) unique constraint.
 *
 * Supabase query:
 *   supabase
 *     .from('user_roles')
 *     .upsert({
 *       user_id: payload.userId,
 *       org_id: payload.orgId,
 *       role: payload.role,
 *       assigned_by: payload.assignedBy,
 *       assigned_at: new Date().toISOString(),
 *     }, { onConflict: 'user_id,org_id' })
 */
export async function assignRole(
  payload: AssignRolePayload
): Promise<RoleServiceResult<UserRoleRecord>> {
  // STUB — replace with real Supabase call
  const idx = _mockMembers.findIndex((m) => m.user_id === payload.userId);
  const now = new Date().toISOString();

  if (idx >= 0) {
    _mockMembers[idx] = { ..._mockMembers[idx], role: payload.role, assigned_at: now };
  } else {
    return { success: false, error: 'User not found in org' };
  }

  return {
    success: true,
    data: {
      id: `role-${payload.userId}`,
      user_id: payload.userId,
      org_id: payload.orgId,
      role: payload.role,
      assigned_at: now,
      assigned_by: payload.assignedBy,
    },
  };
}

/**
 * Returns all members of an org with their roles.
 *
 * Supabase query (join user_roles + profiles):
 *   supabase
 *     .from('user_roles')
 *     .select(`
 *       user_id,
 *       role,
 *       assigned_at,
 *       profiles:user_id ( name, email, avatar_initials )
 *     `)
 *     .eq('org_id', orgId)
 *     .order('assigned_at', { ascending: true })
 */
export async function getOrgMembers(
  orgId: string
): Promise<RoleServiceResult<OrgMember[]>> {
  // STUB — replace with real Supabase call
  void orgId;
  return { success: true, data: [..._mockMembers] };
}

/**
 * Generates a time-limited invite link for a new org member with a pre-selected role.
 * The token is stored in an `org_invites` table (schema below).
 *
 * Supabase query:
 *   supabase
 *     .from('org_invites')
 *     .insert({
 *       org_id: orgId,
 *       role: role,
 *       invited_by: invitedBy,
 *       token: generatedToken,
 *       expires_at: expiresAt,
 *     })
 *
 * org_invites table schema:
 *   id          uuid         primary key, default gen_random_uuid()
 *   org_id      uuid         not null
 *   role        text         not null
 *   invited_by  uuid         references auth.users(id)
 *   token       text         not null, unique
 *   expires_at  timestamptz  not null
 *   used_at     timestamptz
 *   accepted_by uuid         references auth.users(id)
 */
export async function generateInviteLink(
  orgId: string,
  role: AppRole,
  invitedBy: string
): Promise<RoleServiceResult<InviteLink>> {
  // STUB — replace with real Supabase call + token generation
  void invitedBy;

  const token = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // In production, base URL would come from env: import.meta.env.VITE_APP_URL
  const url = `https://app.poweronhub.com/invite?token=${token}&org=${orgId}&role=${role}`;

  return {
    success: true,
    data: { url, role, orgId, expiresAt, token },
  };
}

/**
 * Resets mock member state to initial data.
 * Used by tests and the "Reset" action in the prototype UI.
 */
export function resetMockMembers(): void {
  _mockMembers = [...MOCK_ORG_MEMBERS];
}
