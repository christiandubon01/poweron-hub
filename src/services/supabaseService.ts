/**
 * supabaseService.ts
 * V3 — Generic Supabase table helpers.
 *
 * Provides table-level syncToSupabase() and fetchFromSupabase() used by
 * V3 services (ndaService, sessionConclusionService, katsuroHandoffService,
 * auditTrailService, materialIntelligence, etc.)
 *
 * These are DIFFERENT from the full-state syncToSupabase() in backupDataService.ts,
 * which syncs the entire app_state blob.
 */

import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Supabase table name */
  table: string;
  /** Record data to insert or upsert */
  data: Record<string, unknown>;
  /** Operation type */
  operation: 'insert' | 'upsert' | 'update';
  /** For upsert/update: the column to match on (default: 'id') */
  matchColumn?: string;
}

// ── sync ──────────────────────────────────────────────────────────────────────

/**
 * Write a single record to a Supabase table.
 * Returns the inserted/upserted row (including generated id).
 */
export async function syncToSupabase(
  options: SyncOptions
): Promise<Record<string, unknown>> {
  const { table, data, operation } = options;

  try {
    let result;
    if (operation === 'insert') {
      result = await (supabase as any)
        .from(table)
        .insert(data)
        .select()
        .single();
    } else {
      // upsert or update
      result = await (supabase as any)
        .from(table)
        .upsert(data)
        .select()
        .single();
    }

    if (result.error) {
      console.warn(`[supabaseService] ${operation} error on "${table}":`, result.error.message);
      // Return data with a local id so callers don't crash
      return { ...data, id: data.id ?? `local-${Date.now()}` };
    }

    return result.data ?? { ...data, id: `local-${Date.now()}` };
  } catch (err) {
    console.warn(`[supabaseService] ${operation} failed on "${table}":`, err);
    return { ...data, id: data.id ?? `local-${Date.now()}` };
  }
}

// ── fetch ─────────────────────────────────────────────────────────────────────

/**
 * Fetch records from a Supabase table, optionally filtered by column equality.
 * Returns an empty array on error rather than throwing.
 */
export async function fetchFromSupabase<T = Record<string, unknown>>(
  table: string,
  filters?: Record<string, unknown>
): Promise<T[]> {
  try {
    let query = (supabase as any).from(table).select('*');

    if (filters) {
      for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.warn(`[supabaseService] fetch error on "${table}":`, error.message);
      return [];
    }

    return (data ?? []) as T[];
  } catch (err) {
    console.warn(`[supabaseService] fetch failed on "${table}":`, err);
    return [];
  }
}
