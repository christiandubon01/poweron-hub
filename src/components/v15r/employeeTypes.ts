/**
 * employeeTypes.ts — Extended employee type definitions for the Three-Type
 * Employee System (Migration 048).
 *
 * BackupEmployee from backupDataService is { id, name, role, billRate, costRate }.
 * ExtendedEmployee adds all fields introduced in the employee types system.
 *
 * These records are stored in backup.employees[] in localStorage — the same
 * array as before. Old records without the new fields are treated as 'permanent'
 * with defaults applied at read time.
 *
 * CONSTRAINT: backupDataService.ts must NOT be modified.
 */

export type EmployeeType = 'permanent' | 'per_project' | 'hypothetical'
export type Classification = 'W-2' | '1099'
export type EmployeeStatus = 'Active' | 'Inactive' | 'Closed'

export interface ExtendedEmployee {
  // ── Original BackupEmployee fields (always present) ──────────────────────
  id: string
  name: string
  role: string
  billRate: number
  costRate: number

  // ── Type system (new — default to 'permanent' for legacy records) ────────
  employee_type: EmployeeType
  classification: Classification
  hourly_rate: number

  // ── Status & dates ────────────────────────────────────────────────────────
  status: EmployeeStatus
  hire_date?: string          // YYYY-MM-DD
  separation_date?: string    // YYYY-MM-DD  — set when permanent goes Inactive
  estimated_end_date?: string // YYYY-MM-DD  — per_project estimated close
  start_month?: string        // YYYY-MM     — hypothetical future start month

  // ── Project link (per_project only) ──────────────────────────────────────
  project_id?: string

  // ── Cost modifiers (existing) ─────────────────────────────────────────────
  isOwner?: boolean
  applyMultiplier?: boolean

  // ── OHM compliance tracking ───────────────────────────────────────────────
  compliance_acknowledged?: boolean
}

/**
 * Normalize a raw employee record (old or new) into an ExtendedEmployee.
 * Provides safe defaults for all new fields so old data always loads correctly.
 */
export function normalizeEmployee(raw: any): ExtendedEmployee {
  return {
    id: raw.id ?? '',
    name: raw.name ?? '',
    role: raw.role ?? '',
    billRate: Number(raw.billRate ?? raw.bill_rate ?? 0),
    costRate: Number(raw.costRate ?? raw.cost_rate ?? 0),
    employee_type: raw.employee_type ?? 'permanent',
    classification: raw.classification ?? 'W-2',
    hourly_rate: Number(raw.hourly_rate ?? raw.costRate ?? raw.cost_rate ?? 0),
    status: raw.status ?? 'Active',
    hire_date: raw.hire_date,
    separation_date: raw.separation_date,
    estimated_end_date: raw.estimated_end_date,
    start_month: raw.start_month,
    project_id: raw.project_id,
    isOwner: raw.isOwner ?? false,
    applyMultiplier: raw.applyMultiplier !== false,
    compliance_acknowledged: raw.compliance_acknowledged ?? false,
  }
}
