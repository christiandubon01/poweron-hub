// @ts-nocheck
/**
 * adaptV15rBackup.ts — Reads the raw v15r Operations Hub backup JSON and
 * transforms it into the shape expected by migrateFromV15r.ts (poweron_migration.json).
 *
 * Usage: npx ts-node src/scripts/adaptV15rBackup.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Source file ──────────────────────────────────────────────────────────────

const BACKUP_FILENAME = 'PowerOn_Backup_2026-03-27_20-28-16.json'
const OUTPUT_FILENAME = 'poweron_migration.json'

const backupPath = path.resolve(process.cwd(), BACKUP_FILENAME)
const outputPath = path.resolve(process.cwd(), OUTPUT_FILENAME)

if (!fs.existsSync(backupPath)) {
  console.error(`❌ Backup file not found: ${backupPath}`)
  process.exit(1)
}

console.log('╔═══════════════════════════════════════════╗')
console.log('║  PowerOn Hub — v15r Backup Adapter        ║')
console.log('╚═══════════════════════════════════════════╝')
console.log()

const raw = JSON.parse(fs.readFileSync(backupPath, 'utf-8'))

const unmapped: string[] = []

// ── 1. Projects ──────────────────────────────────────────────────────────────

function adaptProjects(rawProjects: any[]): any[] {
  return rawProjects.map((p: any) => {
    // v15r phases are an object: { "Planning": 70, "Rough-in": 0, ... }
    // Migration expects an array: [{ name, status, checklist }]
    let phases: any[] = []
    if (p.phases && typeof p.phases === 'object' && !Array.isArray(p.phases)) {
      // Determine phase order from template tasks or a sensible default
      const phaseOrder = ['Estimating', 'Planning', 'Site Prep', 'Rough-in', 'Trim', 'Finish']
      const phaseNames = Object.keys(p.phases)
      const ordered = phaseOrder.filter(n => phaseNames.includes(n))
      // Add any phases not in the default order
      phaseNames.forEach(n => { if (!ordered.includes(n)) ordered.push(n) })

      phases = ordered.map((name: string) => {
        const pct = p.phases[name] ?? 0
        let status = 'pending'
        if (pct >= 100) status = 'completed'
        else if (pct > 0) status = 'in_progress'

        // Pull checklist items from tasks if available
        const taskItems = p.tasks?.[name] || []
        const checklist = taskItems.map((item: string) => ({
          item,
          completed: pct >= 100,
        }))

        return { name, status, checklist }
      })
    }

    // Map project type from v15r display names to migration-expected keys
    const typeMap: Record<string, string> = {
      'New Construction':     'residential_new',
      'Commercial TI':        'commercial_ti',
      'Service':              'residential_service',
      'Solar':                'solar',
      'EV Charger':           'ev_charger',
      'Panel Upgrade':        'panel_upgrade',
      'Residential Remodel':  'residential_remodel',
      'Commercial':           'commercial_ti',
      'Industrial':           'industrial',
    }

    const adapted: any = {
      id:          p.id,
      name:        p.name,
      type:        typeMap[p.type] || p.type || 'other',
      status:      p.status || 'estimate',
      contract:    p.contract || null,
      finance:     p.finance || {},
      projectCode: p.projectCode || null,
      phases,
      templateName: p.templateName || null,
      lastMove:    p.lastMove || null,
      address:     null,
      description: null,
      priority:    'normal',
      tags:        [],
    }

    // Log fields we're dropping
    const knownFields = new Set([
      'id', 'name', 'type', 'status', 'contract', 'finance', 'projectCode',
      'phases', 'templateName', 'lastMove', 'tasks', 'logs', 'paid', 'rfis',
      'coord', 'billed', 'miDays', 'mileRT', 'ohRows', 'matRows', 'mtoRows',
      'laborHrs', 'laborRows', 'templateId', 'lastCollectedAt', 'estimateReference',
      'phaseEstimateRows', 'lastEstimateSyncAt', 'completionPromptSig',
      'lastCollectedAmount', 'completionDeclinedSig',
    ])
    Object.keys(p).forEach(k => {
      if (!knownFields.has(k)) {
        unmapped.push(`projects.${p.id}.${k}`)
      }
    })

    return adapted
  })
}

// ── 2. Price Book (already matches expected shape) ───────────────────────────

function adaptPriceBook(rawItems: any[]): any[] {
  return rawItems.map((item: any) => ({
    id:       item.id,
    name:     item.name,
    cat:      item.cat,
    cost:     item.cost ?? 0,
    unit:     item.unit || 'EA',
    pack:     item.pack || 1,
    waste:    item.waste || 0,
    src:      item.src || null,
    link:     item.link || null,
    pidBand:  item.pidBand || null,
    pidBlock: item.pidBlock || null,
  }))
}

// ── 3. Service Logs ──────────────────────────────────────────────────────────

function adaptServiceLogs(rawLogs: any[], projectLogs: any[]): any[] {
  // Combine top-level serviceLogs AND project work logs (the `logs` array)
  const adapted: any[] = []

  // serviceLogs → field_logs
  for (const sl of rawLogs) {
    // v15r payStatus uses "N"/"Y"/"P" — map to expected strings
    let payStatus = 'unpaid'
    if (sl.payStatus === 'Y' || sl.payStatus === 'paid') payStatus = 'paid'
    else if (sl.payStatus === 'P' || sl.payStatus === 'partial') payStatus = 'partial'

    adapted.push({
      id:              sl.id,
      date:            sl.date || new Date().toISOString().split('T')[0],
      customer:        sl.customer || 'Unknown',
      hrs:             sl.hrs || 0,
      mat:             sl.mat || 0,
      miles:           sl.miles || 0,
      notes:           sl.notes || '',
      quoted:          sl.quoted || 0,
      collected:       sl.collected || 0,
      payStatus,
      profit:          sl.profit || 0,
      store:           sl.store || null,
      compareWarnings: sl.compareWarnings || null,
      triggersAtSave:  sl.triggersAtSave || null,
    })
  }

  // Top-level `logs` array → also field_logs (these are project work logs)
  for (const wl of projectLogs) {
    adapted.push({
      id:              wl.id,
      date:            wl.date || new Date().toISOString().split('T')[0],
      customer:        wl.projName || 'Project Work',
      hrs:             wl.hrs || 0,
      mat:             wl.mat || 0,
      miles:           wl.miles || 0,
      notes:           `[${wl.phase || 'General'}] ${wl.notes || ''}`.trim(),
      quoted:          wl.quoted || wl.projectQuote || 0,
      collected:       wl.collected || 0,
      payStatus:       'unpaid',
      profit:          wl.profit || 0,
      store:           wl.store || null,
      compareWarnings: null,
      triggersAtSave:  null,
    })
  }

  return adapted
}

// ── 4. Templates ─────────────────────────────────────────────────────────────

function adaptTemplates(rawTemplates: any[]): any[] {
  return rawTemplates.map((t: any) => {
    // Convert tasks object to phases array
    const phaseOrder = ['Estimating', 'Planning', 'Site Prep', 'Rough-in', 'Trim', 'Finish']
    const taskPhases = t.tasks ? Object.keys(t.tasks) : []
    const ordered = phaseOrder.filter(n => taskPhases.includes(n))
    taskPhases.forEach(n => { if (!ordered.includes(n)) ordered.push(n) })

    const phases = ordered.map((name: string, idx: number) => ({
      name,
      order_index: idx,
      checklist: (t.tasks?.[name] || []).map((item: string) => item),
      estimated_days: t.phaseDefaults?.[name]?.days || 3,
    }))

    const adapted: any = {
      id:   t.id,
      name: t.name,
      type: t.projectType || 'other',
      phases,
      defaultTasks:   t.defaults || null,
      complianceReqs: t.riskChecklist || null,
    }

    const knownFields = new Set([
      'id', 'name', 'tasks', 'defaults', 'exclusions', 'description',
      'projectType', 'phaseDefaults', 'riskChecklist', 'billingMilestones',
    ])
    Object.keys(t).forEach(k => {
      if (!knownFields.has(k)) {
        unmapped.push(`templates.${t.id}.${k}`)
      }
    })

    return adapted
  })
}

// ── 5. Employees ─────────────────────────────────────────────────────────────

function adaptEmployees(rawEmployees: any[]): any[] {
  return rawEmployees.map((e: any) => ({
    id:    e.id || null,
    name:  e.name,
    email: e.email || null,
    role:  e.role || 'journeyman',
    phone: e.phone || null,
  }))
}

// ── 6. Trigger Rules ─────────────────────────────────────────────────────────

function adaptTriggerRules(rawRules: any[]): any[] {
  return rawRules.map((tr: any) => ({
    id:   tr.id || null,
    name: tr.name,
    // Pack the v15r single-string condition into a JSONB conditions object
    conditions: {
      type:           tr.type || 'unknown',
      expression:     tr.condition || '',
      threshold:      tr.threshold ?? null,
      thresholdLabel: tr.thresholdLabel || null,
      situation:      tr.situation || '',
    },
    // Pack solution/review/reflection into an actions array
    actions: [
      { type: 'review',     value: tr.review || '' },
      { type: 'solution',   value: tr.solution || '' },
      { type: 'reflection', value: tr.reflection || '' },
    ],
    is_active: tr.active !== false,
    color:     tr.color || null,
  }))
}

// ── Run the adaptation ───────────────────────────────────────────────────────

const projects    = adaptProjects(raw.projects || [])
const priceBook   = adaptPriceBook(raw.priceBook || [])
const serviceLogs = adaptServiceLogs(raw.serviceLogs || [], raw.logs || [])
const templates   = adaptTemplates(raw.templates || [])
const employees   = adaptEmployees(raw.employees || [])
const triggerRules = adaptTriggerRules(raw.triggerRules || [])

const output = {
  projects,
  priceBook,
  serviceLogs,
  templates,
  employees,
  triggerRules,
}

// ── Write output ─────────────────────────────────────────────────────────────

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8')

// ── Report ───────────────────────────────────────────────────────────────────

console.log('✅ Adaptation complete!\n')
console.log('Record counts:')
console.log(`  projects:      ${projects.length}`)
console.log(`  priceBook:     ${priceBook.length}`)
console.log(`  serviceLogs:   ${serviceLogs.length}  (${(raw.serviceLogs || []).length} service + ${(raw.logs || []).length} project work logs)`)
console.log(`  templates:     ${templates.length}`)
console.log(`  employees:     ${employees.length}`)
console.log(`  triggerRules:  ${triggerRules.length}`)
console.log()

// Log top-level backup keys that were NOT used
const usedKeys = new Set([
  'projects', 'priceBook', 'serviceLogs', 'logs', 'templates',
  'employees', 'triggerRules',
  // Known config/UI keys we intentionally skip
  'view', 'theme', 'activeId', 'calcRefs', 'settings', 'calOffset',
  'customers', 'dailyJobs', 'fieldLogs', 'gcalCache', 'gcContacts',
  'gcalOnline', 'weeklyData', '_lastSavedAt', 'serviceLeads',
  'taskSchedule', 'gcalLastError', 'gcalLastFetch', 'weeklyReviews',
  '_schemaVersion', 'agendaSections', 'completedArchive', 'currentProjectId',
  'serviceEstimates', 'projectDashboards', 'activeServiceCalls',
  'blueprintSummaries', 'quotes', 'catalog', 'history', 'vendors',
])

const skippedTopLevel = Object.keys(raw).filter(k => !usedKeys.has(k))
if (skippedTopLevel.length) {
  console.log('⚠  Top-level keys not mapped (skipped):')
  skippedTopLevel.forEach(k => {
    const val = raw[k]
    const desc = Array.isArray(val) ? `Array[${val.length}]` : typeof val
    console.log(`   → ${k} (${desc})`)
  })
  console.log()
}

if (unmapped.length) {
  console.log('⚠  Per-record fields not mapped (dropped):')
  // Deduplicate by field path pattern
  const patterns = new Set(unmapped.map(f => {
    const parts = f.split('.')
    return `${parts[0]}.*.${parts[2]}`
  }))
  patterns.forEach(p => console.log(`   → ${p}`))
  console.log()
}

console.log(`📄 Output written to: ${outputPath}`)
console.log()
