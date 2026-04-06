// @ts-nocheck
/**
 * writeDebounce.ts — Non-critical write batching helper.
 *
 * DB1 Supabase Disk IO Optimization (v2v3-beta):
 *   Previously, every call to saveBackupDataAndSync() immediately fired
 *   syncToSupabase(), causing disk IO spikes on Supabase for every user action.
 *
 *   This module provides nonCriticalWrite() as a replacement for
 *   saveBackupDataAndSync() on non-critical data (serviceEstimates,
 *   activeServiceCalls, priceBook, leads, weeklyData).
 *
 * HOW IT WORKS:
 *   nonCriticalWrite(data, key)
 *     → saveBackupData() immediately (localStorage — cheap, local)
 *     → markChanged(key) (sets _dataChanged = true)
 *     → V15rLayout's startPeriodicSync() picks up _dataChanged and
 *       calls syncToSupabase() after 30 seconds of data being dirty.
 *
 * CRITICAL WRITES (project status, serviceLogs, payments, new RFI):
 *   Continue to use saveBackupDataAndSync() directly — those fire immediately.
 *
 * RESULT:
 *   Non-critical writes batch into at most one Supabase call per 30 seconds
 *   instead of one call per user action.
 */

import {
  saveBackupData,
  markChanged,
  type BackupData,
} from '@/services/backupDataService'

/**
 * Write data to localStorage immediately, then let the 30-second
 * periodic sync (V15rLayout → startPeriodicSync) handle the Supabase write.
 *
 * Use this for non-critical data changes:
 *   - serviceEstimates
 *   - activeServiceCalls
 *   - priceBook
 *   - leads / gcContacts / serviceLeads
 *   - weeklyData (hours, notes)
 *
 * Do NOT use for critical writes — use saveBackupDataAndSync() instead:
 *   - serviceLogs (job completion)
 *   - projects (status change, creation)
 *   - payments (marked paid)
 *   - new RFI
 */
export function nonCriticalWrite(data: BackupData, changedKey?: string): void {
  data._lastSavedAt = new Date().toISOString()
  if (changedKey) markChanged(changedKey)
  saveBackupData(data)
  // _dataChanged is now true via markChanged — startPeriodicSync in
  // V15rLayout will pick this up and call syncToSupabase after 30 seconds.
}
