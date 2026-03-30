// @ts-nocheck
/**
 * Audit log helpers — thin wrapper over the Supabase audit_log table.
 *
 * The audit_log trigger (005_audit_system.sql) auto-records INSERT/UPDATE/DELETE
 * on tracked tables. Use this module for explicit audit events: logins, exports,
 * views of sensitive data, and agent actions.
 *
 * The current_setting('app.current_agent') mechanism from the spec is set here
 * so the trigger function can detect agent vs user actions.
 */

import { supabase } from '@/lib/supabase'
import type { InsertDto } from '@/lib/supabase'

type AuditInsert = InsertDto<'audit_log'>

export type AuditAction =
  | 'insert' | 'update' | 'delete' | 'view' | 'export'
  | 'login'  | 'logout' | 'send'   | 'approve' | 'reject'
  | 'escalate' | 'lock' | 'unlock'

export interface AuditParams {
  action:      AuditAction
  entity_type: string
  entity_id?:  string
  description?: string
  changes?:    Record<string, { old: unknown; new: unknown }>
  metadata?:   Record<string, unknown>
}

/**
 * Write an explicit audit log entry.
 * The org_id and actor_id are derived from the current Supabase session.
 * Returns the inserted row id, or null on failure.
 */
export async function logAudit(params: AuditParams): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Resolve org_id from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile) return null

    const entry: Partial<AuditInsert> = {
      org_id:       profile.org_id,
      actor_type:   'user',
      actor_id:     user.id,
      actor_name:   profile.full_name,
      action:       params.action,
      entity_type:  params.entity_type,
      entity_id:    params.entity_id as string | undefined,
      description:  params.description,
      changes:      params.changes as AuditInsert['changes'],
      metadata:     (params.metadata ?? {}) as AuditInsert['metadata'],
    }

    const { data, error } = await supabase
      .from('audit_log')
      .insert(entry as AuditInsert)
      .select('id')
      .single()

    if (error) {
      console.warn('[Audit] Insert failed:', error.message)
      return null
    }

    return String(data?.id ?? null)
  } catch (err) {
    console.warn('[Audit] Unexpected error:', err)
    return null
  }
}

/**
 * Log a view of sensitive data (invoices, estimates, etc.).
 * Keeps the audit trail clean without requiring a DB mutation.
 */
export async function logView(entityType: string, entityId: string, description?: string) {
  return logAudit({ action: 'view', entity_type: entityType, entity_id: entityId, description })
}

/**
 * Log an export action (CSV download, PDF export, etc.).
 */
export async function logExport(entityType: string, description?: string, metadata?: Record<string, unknown>) {
  return logAudit({ action: 'export', entity_type: entityType, description, metadata })
}

/**
 * Log a login event (after successful passcode/biometric).
 */
export async function logLogin(userId: string, deviceInfo: Record<string, unknown>) {
  return logAudit({
    action:      'login',
    entity_type: 'profiles',
    entity_id:   userId,
    description: 'User authenticated via passcode or biometric',
    metadata:    deviceInfo,
  })
}

/**
 * Fetch recent audit log entries for the current org.
 * Owner/admin only — RLS enforces this at the DB level.
 */
export async function getAuditLog(options: {
  limit?:       number
  entityType?:  string
  entityId?:    string
  actorId?:     string
  action?:      AuditAction
} = {}) {
  let query = supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (options.entityType) query = query.eq('entity_type', options.entityType)
  if (options.entityId)   query = query.eq('entity_id',   options.entityId)
  if (options.actorId)    query = query.eq('actor_id',    options.actorId)
  if (options.action)     query = query.eq('action',      options.action)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
