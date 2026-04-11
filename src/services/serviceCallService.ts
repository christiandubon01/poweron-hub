/**
 * serviceCallService.ts
 * Business logic for multi-day service calls with itemized materials and margin calculation.
 *
 * Design rules (from spec):
 *  - Service calls do NOT have remaining balance — only cost vs collected vs margin
 *  - Labor cost = hours × $43 (opCost from settings; $43 default)
 *  - Materials = itemized list, NOT a lump sum
 *  - Scope creep flag: labor hours OR material cost increased > 25% from Day 1
 *  - No "remaining balance" field — service bucket accumulates revenue
 */

import { num } from './backupDataService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServiceMaterialItem {
  id: string
  item_name: string
  quantity: number
  unit_cost: number
  total: number          // quantity × unit_cost (derived)
}

export interface ServiceDayEntry {
  id: string
  service_call_id: string
  day_number: number
  date: string
  labor_hours: number
  labor_cost: number           // hours × labor_rate (derived)
  materials: ServiceMaterialItem[]
  materials_total: number      // sum of all material item totals (derived)
  transportation_miles: number
  transportation_rate: number
  transportation_cost?: number  // miles × rate (derived — optional for partial input)
  daily_total?: number          // labor_cost + materials_total + transportation_cost (derived)
  collection_amount: number    // amount collected this day
  notes?: string
}

export interface ServiceCallRecord {
  service_call_id: string
  customer: string
  address: string
  jtype: string
  /** Legacy flat fields kept for backward compat with BackupServiceLog */
  days: ServiceDayEntry[]
  /** GUARDIAN scope creep flag */
  scope_creep_flag?: boolean
  scope_creep_note?: string
  created_at: string
  /** original BackupServiceLog.id for sync — same value as service_call_id for new calls */
  legacy_id?: string
}

export interface ServiceCallTotals {
  total_hours: number
  total_materials: number       // sum of all day material totals
  total_miles: number
  total_cost: number            // sum of all daily_total
  total_collected: number       // sum of all collection_amount
  net_margin: number            // total_collected - total_cost
  margin_pct: number            // net_margin / total_collected * 100 (0 if no collections)
  day_count: number
  all_material_items: ServiceMaterialItem[]  // flattened with day labels
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Generate a short unique ID */
export function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Compute the total for a single material item */
export function materialItemTotal(item: Omit<ServiceMaterialItem, 'total'>): number {
  return num(item.quantity) * num(item.unit_cost)
}

/** Compute materials_total for a day */
export function dayMaterialsTotal(materials: ServiceMaterialItem[]): number {
  return materials.reduce((s, m) => s + num(m.total), 0)
}

/** Input shape for building a day entry — all derived fields are computed automatically */
export interface DayEntryInput {
  id?: string
  service_call_id: string
  day_number: number
  date?: string
  labor_hours: number
  labor_rate?: number
  materials: ServiceMaterialItem[]
  transportation_miles: number
  transportation_rate: number
  collection_amount: number
  notes?: string
}

/** Build a complete ServiceDayEntry with all derived fields calculated */
export function buildDayEntry(partial: DayEntryInput): ServiceDayEntry {
  const laborRate = num(partial.labor_rate ?? 43)
  const laborCost = num(partial.labor_hours) * laborRate
  const materials = (partial.materials || []).map(m => ({
    ...m,
    total: materialItemTotal(m),
  }))
  const materialsTotal = dayMaterialsTotal(materials)
  const transCost = num(partial.transportation_miles) * num(partial.transportation_rate)
  const dailyTotal = laborCost + materialsTotal + transCost

  return {
    id: partial.id ?? genId('day'),
    service_call_id: partial.service_call_id,
    day_number: partial.day_number,
    date: partial.date || today(),
    labor_hours: num(partial.labor_hours),
    labor_cost: laborCost,
    materials,
    materials_total: materialsTotal,
    transportation_miles: num(partial.transportation_miles),
    transportation_rate: num(partial.transportation_rate),
    transportation_cost: transCost,
    daily_total: dailyTotal,
    collection_amount: num(partial.collection_amount),
    notes: partial.notes ?? '',
  }
}

/** Roll up all daily entries for a service call into summary totals */
export function getServiceCallTotals(call: ServiceCallRecord): ServiceCallTotals {
  const days = call.days || []
  const total_hours = days.reduce((s, d) => s + num(d.labor_hours), 0)
  const total_materials = days.reduce((s, d) => s + num(d.materials_total), 0)
  const total_miles = days.reduce((s, d) => s + num(d.transportation_miles), 0)
  const total_cost = days.reduce((s, d) => s + num(d.daily_total), 0)
  const total_collected = days.reduce((s, d) => s + num(d.collection_amount), 0)
  const net_margin = total_collected - total_cost
  const margin_pct = total_collected > 0.009 ? (net_margin / total_collected) * 100 : 0

  // Flatten all material items with day context for full itemization display
  const all_material_items: ServiceMaterialItem[] = days.flatMap((d, di) =>
    d.materials.map(m => ({
      ...m,
      item_name: `Day ${d.day_number} — ${m.item_name}`,
      // tag with day source for display
      id: m.id,
    }))
  )

  return {
    total_hours,
    total_materials,
    total_miles,
    total_cost,
    total_collected,
    net_margin,
    margin_pct,
    day_count: days.length,
    all_material_items,
  }
}

/**
 * Detect scope creep: labor or material cost increased > 25% compared to Day 1.
 * Returns { flagged, note } for GUARDIAN.
 */
export function detectScopeCreep(call: ServiceCallRecord): { flagged: boolean; note: string } {
  const days = call.days || []
  if (days.length < 2) return { flagged: false, note: '' }

  const day1 = days[0]
  const day1Labor = num(day1.labor_cost)
  const day1Mat = num(day1.materials_total)

  let laborIncrease = 0
  let matIncrease = 0

  for (let i = 1; i < days.length; i++) {
    laborIncrease += num(days[i].labor_cost)
    matIncrease += num(days[i].materials_total)
  }

  const totalLaborAdded = laborIncrease
  const totalMatAdded = matIncrease

  const laborPct = day1Labor > 0 ? (totalLaborAdded / day1Labor) * 100 : 0
  const matPct = day1Mat > 0 ? (totalMatAdded / day1Mat) * 100 : 0

  const THRESHOLD = 25
  const flagged = laborPct > THRESHOLD || matPct > THRESHOLD

  const parts: string[] = []
  if (laborPct > THRESHOLD) parts.push(`labor +${laborPct.toFixed(0)}% above Day 1`)
  if (matPct > THRESHOLD) parts.push(`materials +${matPct.toFixed(0)}% above Day 1`)

  const note = flagged
    ? `Scope creep detected: ${parts.join('; ')}. Verify price adjustment.`
    : ''

  return { flagged, note }
}

/** Input shape for adding a day (without call-managed fields) */
export interface AddDayInput {
  date?: string
  labor_hours: number
  labor_rate?: number
  materials: ServiceMaterialItem[]
  transportation_miles: number
  transportation_rate: number
  collection_amount: number
  notes?: string
}

/**
 * Add a new day entry to a ServiceCallRecord.
 * Automatically assigns next day_number and recalculates scope creep.
 */
export function addDayToServiceCall(
  call: ServiceCallRecord,
  dayData: AddDayInput
): ServiceCallRecord {
  const nextDay = (call.days || []).length + 1
  const newDay = buildDayEntry({
    id: genId('day'),
    service_call_id: call.service_call_id,
    day_number: nextDay,
    labor_hours: dayData.labor_hours,
    labor_rate: dayData.labor_rate ?? 43,
    materials: dayData.materials,
    transportation_miles: dayData.transportation_miles,
    transportation_rate: dayData.transportation_rate,
    collection_amount: dayData.collection_amount,
    date: dayData.date,
    notes: dayData.notes,
  })
  const updatedDays = [...(call.days || []), newDay]
  const updated: ServiceCallRecord = { ...call, days: updatedDays }
  const { flagged, note } = detectScopeCreep(updated)
  return { ...updated, scope_creep_flag: flagged, scope_creep_note: note }
}

/**
 * Update an existing day entry within a ServiceCallRecord.
 */
export function updateDayEntry(
  call: ServiceCallRecord,
  dayId: string,
  updates: Partial<AddDayInput> & { labor_rate?: number }
): ServiceCallRecord {
  const idx = call.days.findIndex(d => d.id === dayId)
  if (idx < 0) return call
  const existing = call.days[idx]
  const merged = buildDayEntry({
    id: existing.id,
    service_call_id: existing.service_call_id,
    day_number: existing.day_number,
    labor_hours: updates.labor_hours ?? existing.labor_hours,
    labor_rate: updates.labor_rate ?? 43,
    materials: updates.materials ?? existing.materials,
    transportation_miles: updates.transportation_miles ?? existing.transportation_miles,
    transportation_rate: updates.transportation_rate ?? existing.transportation_rate,
    collection_amount: updates.collection_amount ?? existing.collection_amount,
    date: updates.date ?? existing.date,
    notes: updates.notes ?? existing.notes,
  })
  const updatedDays = [...call.days]
  updatedDays[idx] = merged
  const updated: ServiceCallRecord = { ...call, days: updatedDays }
  const { flagged, note } = detectScopeCreep(updated)
  return { ...updated, scope_creep_flag: flagged, scope_creep_note: note }
}

/**
 * Create a brand-new ServiceCallRecord from scratch (Day 1).
 */
export function createServiceCallRecord(
  params: {
    customer: string
    address: string
    jtype: string
    day1: AddDayInput
    labor_rate?: number
  }
): ServiceCallRecord {
  const id = genId('svc')
  const day1 = buildDayEntry({
    id: genId('day'),
    service_call_id: id,
    day_number: 1,
    labor_hours: params.day1.labor_hours,
    labor_rate: params.labor_rate ?? params.day1.labor_rate ?? 43,
    materials: params.day1.materials,
    transportation_miles: params.day1.transportation_miles,
    transportation_rate: params.day1.transportation_rate,
    collection_amount: params.day1.collection_amount,
    date: params.day1.date,
    notes: params.day1.notes,
  })
  return {
    service_call_id: id,
    legacy_id: id,
    customer: params.customer,
    address: params.address,
    jtype: params.jtype,
    days: [day1],
    scope_creep_flag: false,
    scope_creep_note: '',
    created_at: today(),
  }
}

/**
 * Convert a legacy BackupServiceLog to a ServiceCallRecord (one-time migration).
 * Preserves all original data in Day 1.
 */
export function migrateServiceLog(legacy: any, laborRate = 43): ServiceCallRecord {
  const id = legacy.id || genId('svc')
  const mat = num(legacy.mat)
  // Build a single material item from the legacy lump-sum mat field
  const day1Materials: ServiceMaterialItem[] = mat > 0
    ? [{ id: genId('mat'), item_name: 'Materials (legacy)', quantity: 1, unit_cost: mat, total: mat }]
    : []

  const day1 = buildDayEntry({
    id: genId('day'),
    service_call_id: id,
    day_number: 1,
    date: legacy.date || today(),
    labor_hours: num(legacy.hrs),
    labor_rate: laborRate,
    materials: day1Materials,
    transportation_miles: num(legacy.miles),
    transportation_rate: num(legacy.mileCost) > 0 && num(legacy.miles) > 0
      ? num(legacy.mileCost) / num(legacy.miles)
      : 0.67,
    collection_amount: num(legacy.collected),
    notes: legacy.notes || '',
  })

  return {
    service_call_id: id,
    legacy_id: id,
    customer: legacy.customer || 'Unknown',
    address: legacy.address || legacy.addr || '',
    jtype: legacy.jtype || 'Service',
    days: [day1],
    scope_creep_flag: false,
    scope_creep_note: '',
    created_at: legacy.date || today(),
  }
}

/** Storage key for multi-day service call records in backup data */
export const MULTIDAY_SVC_KEY = 'multiDayServiceCalls'

/**
 * Load multi-day service call records from the backup data object.
 */
export function loadServiceCallRecords(backupData: any): ServiceCallRecord[] {
  return Array.isArray(backupData?.[MULTIDAY_SVC_KEY])
    ? backupData[MULTIDAY_SVC_KEY]
    : []
}

/**
 * Persist multi-day service call records back into the backup data object.
 */
export function saveServiceCallRecords(backupData: any, records: ServiceCallRecord[]): void {
  backupData[MULTIDAY_SVC_KEY] = records
}
