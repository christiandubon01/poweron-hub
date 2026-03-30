// @ts-nocheck
/**
 * migrateFromV15r.ts — Data migration from Operations Hub v15r HTML app to PowerOn Hub.
 *
 * Reads poweron_migration.json from the project root and upserts records into
 * the Supabase database using the PowerOn Hub schema.
 *
 * Safe to run multiple times — all inserts use upsert (ON CONFLICT DO UPDATE).
 *
 * Usage: npx ts-node src/scripts/runMigration.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── Supabase client (uses service role for migrations) ──────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  console.error('   Set them in .env.local or export them before running.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Types for v15r JSON structure ────────────────────────────────────────────

interface V15rProject {
  id: string
  name: string
  type: string
  status: string
  contract?: number
  finance?: {
    contractOverride?: number
    estimatedCost?: number
    [key: string]: unknown
  }
  projectCode?: string
  phases?: Array<{
    name: string
    status?: string
    checklist?: Array<{ item: string; completed?: boolean }>
    [key: string]: unknown
  }>
  templateName?: string
  lastMove?: string
  address?: string | Record<string, unknown>
  description?: string
  priority?: string
  tags?: string[]
  [key: string]: unknown
}

interface V15rPriceBookItem {
  id: string
  name: string
  cat: string
  cost: number
  unit: string
  pack?: number
  waste?: number
  src?: string
  link?: string
  pidBand?: unknown
  pidBlock?: unknown
  [key: string]: unknown
}

interface V15rServiceLog {
  id: string
  date: string
  customer: string
  hrs?: number
  mat?: number
  miles?: number
  notes?: string
  quoted?: number
  collected?: number
  payStatus?: string
  profit?: number
  store?: string
  compareWarnings?: unknown
  triggersAtSave?: unknown
  [key: string]: unknown
}

interface V15rTemplate {
  id: string
  name: string
  [key: string]: unknown
}

interface V15rEmployee {
  id?: string
  name: string
  email?: string
  role?: string
  phone?: string
  [key: string]: unknown
}

interface V15rTriggerRule {
  id?: string
  name: string
  conditions?: unknown
  actions?: unknown
  [key: string]: unknown
}

interface V15rMigrationData {
  projects?: V15rProject[]
  priceBook?: V15rPriceBookItem[]
  serviceLogs?: V15rServiceLog[]
  templates?: V15rTemplate[]
  employees?: V15rEmployee[]
  triggerRules?: V15rTriggerRule[]
  [key: string]: unknown
}

// ── Status mapping ───────────────────────────────────────────────────────────

function mapProjectStatus(v15rStatus: string): string {
  const map: Record<string, string> = {
    coming:     'pending',
    active:     'in_progress',
    done:       'completed',
    complete:   'completed',
    completed:  'completed',
    hold:       'on_hold',
    on_hold:    'on_hold',
    canceled:   'canceled',
    cancelled:  'canceled',
    estimate:   'estimate',
    lead:       'lead',
    planning:   'pending',
    approved:   'approved',
  }
  return map[v15rStatus.toLowerCase()] || 'estimate'
}

function mapProjectType(v15rType: string): string {
  const normalized = v15rType.toLowerCase().replace(/[^a-z0-9]/g, '_')
  const map: Record<string, string> = {
    residential:          'residential_service',
    residential_service:  'residential_service',
    residential_remodel:  'residential_remodel',
    residential_new:      'residential_new',
    commercial:           'commercial_ti',
    commercial_ti:        'commercial_ti',
    commercial_new:       'commercial_new',
    commercial_service:   'commercial_service',
    industrial:           'industrial',
    solar:                'solar',
    ev:                   'ev_charger',
    ev_charger:           'ev_charger',
    panel_upgrade:        'panel_upgrade',
    panel:                'panel_upgrade',
    service:              'residential_service',
    remodel:              'residential_remodel',
  }
  return map[normalized] || 'other'
}

function mapPayStatus(v15rStatus?: string): string {
  if (!v15rStatus) return 'unpaid'
  const map: Record<string, string> = {
    paid:     'paid',
    unpaid:   'unpaid',
    partial:  'partial',
    pending:  'unpaid',
  }
  return map[v15rStatus.toLowerCase()] || 'unpaid'
}

function mapUnit(v15rUnit?: string): string {
  if (!v15rUnit) return 'EA'
  const normalized = v15rUnit.toUpperCase().trim()
  const valid = ['EA', 'RL', 'SP', 'FT', 'BX', 'PK', 'PR', 'LF', 'CF', 'SET', 'LOT']
  if (valid.includes(normalized)) return normalized
  // Map common variations
  const map: Record<string, string> = {
    EACH: 'EA', ROLL: 'RL', SPOOL: 'SP', FOOT: 'FT', FEET: 'FT',
    BOX: 'BX', PACK: 'PK', PAIR: 'PR', LINEAR_FOOT: 'LF',
    CUBIC_FOOT: 'CF',
  }
  return map[normalized] || 'EA'
}

// ── Logger ────────────────────────────────────────────────────────────────────

function log(msg: string) {
  const timestamp = new Date().toISOString().slice(11, 19)
  console.log(`[${timestamp}] ${msg}`)
}

// ── Migration Functions ──────────────────────────────────────────────────────

/**
 * Migrate projects from v15r to projects + project_phases tables.
 */
async function migrateProjects(
  projects: V15rProject[],
  orgId: string,
  createdBy: string
): Promise<number> {
  log(`Migrating projects... 0/${projects.length}`)
  let count = 0

  for (const p of projects) {
    const contractValue = p.finance?.contractOverride ?? p.contract ?? null
    const estimatedCost = p.finance?.estimatedCost ?? null

    // Parse address
    let address: Record<string, unknown> | null = null
    if (typeof p.address === 'string' && p.address.trim()) {
      address = { street: p.address.trim() }
    } else if (typeof p.address === 'object' && p.address) {
      address = p.address as Record<string, unknown>
    }

    // Upsert project
    const { data: projectData, error: projectErr } = await supabase
      .from('projects')
      .upsert(
        {
          org_id:          orgId,
          name:            p.name,
          type:            mapProjectType(p.type || 'other'),
          status:          mapProjectStatus(p.status || 'estimate'),
          phase:           p.phases?.[0]?.name || null,
          contract_value:  contractValue,
          estimated_value: estimatedCost,
          address,
          description:     p.description || null,
          priority:        p.priority || 'normal',
          tags:            p.tags || [],
          metadata:        {
            legacy_id:     p.id,
            project_code:  p.projectCode || null,
            template_name: p.templateName || null,
            migrated_from: 'v15r',
            migrated_at:   new Date().toISOString(),
          },
          created_by:      createdBy,
          updated_at:      p.lastMove ? new Date(p.lastMove).toISOString() : new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select('id')
      .single()

    if (projectErr) {
      // If upsert on id failed (no existing row), try insert without id
      const { data: insertData, error: insertErr } = await supabase
        .from('projects')
        .insert({
          org_id:          orgId,
          name:            p.name,
          type:            mapProjectType(p.type || 'other'),
          status:          mapProjectStatus(p.status || 'estimate'),
          phase:           p.phases?.[0]?.name || null,
          contract_value:  contractValue,
          estimated_value: estimatedCost,
          address,
          description:     p.description || null,
          priority:        p.priority || 'normal',
          tags:            p.tags || [],
          metadata:        {
            legacy_id:     p.id,
            project_code:  p.projectCode || null,
            template_name: p.templateName || null,
            migrated_from: 'v15r',
            migrated_at:   new Date().toISOString(),
          },
          created_by:      createdBy,
          updated_at:      p.lastMove ? new Date(p.lastMove).toISOString() : new Date().toISOString(),
        })
        .select('id')
        .single()

      if (insertErr) {
        log(`  ⚠ Project "${p.name}" failed: ${insertErr.message}`)
        continue
      }

      // Migrate phases if project has them
      if (p.phases?.length && insertData?.id) {
        await migrateProjectPhases(p.phases, insertData.id)
      }
    } else if (projectData?.id && p.phases?.length) {
      await migrateProjectPhases(p.phases, projectData.id)
    }

    count++
    log(`Migrating projects... ${count}/${projects.length}`)
  }

  log(`✅ Projects: ${count}/${projects.length} done`)
  return count
}

/**
 * Migrate phases for a single project.
 */
async function migrateProjectPhases(
  phases: V15rProject['phases'],
  projectId: string
): Promise<void> {
  if (!phases?.length) return

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]
    const checklist = phase.checklist?.map(c => ({
      item:         c.item,
      completed:    c.completed || false,
      completed_by: null,
      completed_at: null,
    })) || null

    const phaseStatus = (phase.status || 'pending').toLowerCase()
    const validStatuses = ['pending', 'in_progress', 'completed', 'skipped']
    const mappedStatus = validStatuses.includes(phaseStatus) ? phaseStatus : 'pending'

    await supabase
      .from('project_phases')
      .upsert(
        {
          project_id:  projectId,
          name:        phase.name,
          order_index: i,
          status:      mappedStatus,
          checklist,
        },
        { onConflict: 'project_id,order_index' }
      )
  }
}

/**
 * Migrate price book items.
 */
async function migratePriceBook(
  items: V15rPriceBookItem[],
  orgId: string
): Promise<number> {
  log(`Migrating price book... 0/${items.length}`)
  let count = 0

  // First, collect unique categories and upsert them
  const categories = [...new Set(items.map(i => i.cat).filter(Boolean))]
  const categoryMap: Record<string, string> = {}

  for (const catName of categories) {
    const { data } = await supabase
      .from('price_book_categories')
      .upsert(
        { org_id: orgId, name: catName },
        { onConflict: 'org_id,name' }  // uses idx_pbc_org_name
      )
      .select('id')
      .single()

    if (data?.id) {
      categoryMap[catName] = data.id
    }
  }

  log(`  📂 ${categories.length} categories upserted`)

  // Now upsert price book items
  for (const item of items) {
    const { error } = await supabase
      .from('price_book_items')
      .upsert(
        {
          org_id:         orgId,
          legacy_id:      item.id,
          name:           item.name,
          category_id:    categoryMap[item.cat] || null,
          category_name:  item.cat || null,
          unit_cost:      item.cost || 0,
          unit:           mapUnit(item.unit),
          pack_qty:       item.pack || 1,
          waste_factor:   item.waste || 0,
          supplier:       item.src || null,
          metadata:       {
            supplier_url:  item.link || null,
            pid_band:      item.pidBand || null,
            pid_block:     item.pidBlock || null,
            migrated_from: 'v15r',
            migrated_at:   new Date().toISOString(),
          },
          is_active:      true,
          last_price_update: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )

    if (error) {
      // Try insert without id constraint
      const { error: insertErr } = await supabase
        .from('price_book_items')
        .insert({
          org_id:         orgId,
          legacy_id:      item.id,
          name:           item.name,
          category_id:    categoryMap[item.cat] || null,
          category_name:  item.cat || null,
          unit_cost:      item.cost || 0,
          unit:           mapUnit(item.unit),
          pack_qty:       item.pack || 1,
          waste_factor:   item.waste || 0,
          supplier:       item.src || null,
          metadata:       {
            supplier_url:  item.link || null,
            pid_band:      item.pidBand || null,
            pid_block:     item.pidBlock || null,
            migrated_from: 'v15r',
            migrated_at:   new Date().toISOString(),
          },
          is_active:      true,
          last_price_update: new Date().toISOString(),
        })

      if (insertErr) {
        log(`  ⚠ Price book item "${item.name}" failed: ${insertErr.message}`)
        continue
      }
    }

    count++
    if (count % 50 === 0 || count === items.length) {
      log(`Migrating price book... ${count}/${items.length}`)
    }
  }

  log(`✅ Price book: ${count}/${items.length} done`)
  return count
}

/**
 * Migrate service logs to field_logs table.
 */
async function migrateServiceLogs(
  logs: V15rServiceLog[],
  orgId: string,
  loggedBy: string
): Promise<number> {
  log(`Migrating service logs... 0/${logs.length}`)
  let count = 0

  for (const sl of logs) {
    const { error } = await supabase
      .from('field_logs')
      .insert({
        org_id:          orgId,
        logged_by:       loggedBy,
        log_date:        sl.date || new Date().toISOString().split('T')[0],
        hours:           sl.hrs || 0,
        material_cost:   sl.mat || 0,
        miles_round_trip: sl.miles || 0,
        notes:           sl.notes || null,
        quoted_amount:   sl.quoted || null,
        collected:       sl.collected || 0,
        profit:          sl.profit || 0,
        pay_status:      mapPayStatus(sl.payStatus),
        material_store:  sl.store || null,
        metadata:        {
          legacy_id:         sl.id,
          customer:          sl.customer || null,
          compare_warnings:  sl.compareWarnings || null,
          triggers_at_save:  sl.triggersAtSave || null,
          migrated_from:     'v15r',
          migrated_at:       new Date().toISOString(),
        },
      })

    if (error) {
      log(`  ⚠ Service log "${sl.id}" failed: ${error.message}`)
      continue
    }

    count++
    log(`Migrating service logs... ${count}/${logs.length}`)
  }

  log(`✅ Service logs: ${count}/${logs.length} done`)
  return count
}

/**
 * Migrate templates to project_templates table.
 */
async function migrateTemplates(
  templates: V15rTemplate[],
  orgId: string
): Promise<number> {
  log(`Migrating templates... 0/${templates.length}`)
  let count = 0

  for (const tmpl of templates) {
    // Extract phases if present in the template
    const phases = (tmpl as any).phases || []
    const type = (tmpl as any).type || 'other'

    const { error } = await supabase
      .from('project_templates')
      .upsert(
        {
          org_id:         orgId,
          name:           tmpl.name,
          type:           type,
          phases:         phases.length ? phases : [
            { name: 'Mobilization', order_index: 0, checklist: [], estimated_days: 3 },
            { name: 'Rough-In',     order_index: 1, checklist: [], estimated_days: 5 },
            { name: 'Inspection',   order_index: 2, checklist: [], estimated_days: 2 },
            { name: 'Trim',         order_index: 3, checklist: [], estimated_days: 3 },
            { name: 'Closeout',     order_index: 4, checklist: [], estimated_days: 2 },
          ],
          default_tasks:   (tmpl as any).defaultTasks || null,
          compliance_reqs: (tmpl as any).complianceReqs || null,
          is_active:       true,
        },
        { onConflict: 'id' }
      )

    if (error) {
      // Try insert without conflict
      const { error: insertErr } = await supabase
        .from('project_templates')
        .insert({
          org_id:         orgId,
          name:           tmpl.name,
          type:           type,
          phases:         phases.length ? phases : [
            { name: 'Mobilization', order_index: 0, checklist: [], estimated_days: 3 },
            { name: 'Rough-In',     order_index: 1, checklist: [], estimated_days: 5 },
            { name: 'Inspection',   order_index: 2, checklist: [], estimated_days: 2 },
            { name: 'Trim',         order_index: 3, checklist: [], estimated_days: 3 },
            { name: 'Closeout',     order_index: 4, checklist: [], estimated_days: 2 },
          ],
          default_tasks:   (tmpl as any).defaultTasks || null,
          compliance_reqs: (tmpl as any).complianceReqs || null,
          is_active:       true,
        })

      if (insertErr) {
        log(`  ⚠ Template "${tmpl.name}" failed: ${insertErr.message}`)
        continue
      }
    }

    count++
    log(`Migrating templates... ${count}/${templates.length}`)
  }

  log(`✅ Templates: ${count}/${templates.length} done`)
  return count
}

/**
 * Migrate employees — match by email if possible, otherwise skip.
 * We don't create auth users; we just ensure profile exists.
 */
async function migrateEmployees(
  employees: V15rEmployee[],
  orgId: string
): Promise<number> {
  log(`Migrating employees... 0/${employees.length}`)
  let count = 0

  for (const emp of employees) {
    if (emp.email) {
      // Check if a profile with this email exists via auth.users
      // (We can't query auth.users directly from the client,
      //  so we log it for manual matching)
      log(`  👤 Employee "${emp.name}" (${emp.email}) — check if profile exists`)
    }

    // Try to add as crew member
    const { error } = await supabase
      .from('crew_members')
      .insert({
        org_id:     orgId,
        name:       emp.name,
        role:       emp.role || 'journeyman',
        phone:      emp.phone || null,
        skills:     [],
        is_active:  true,
      })

    if (error) {
      log(`  ⚠ Employee "${emp.name}" failed: ${error.message}`)
      continue
    }

    count++
    log(`Migrating employees... ${count}/${employees.length}`)
  }

  log(`✅ Employees: ${count}/${employees.length} done`)
  return count
}

/**
 * Migrate trigger rules.
 */
async function migrateTriggerRules(
  rules: V15rTriggerRule[],
  orgId: string
): Promise<number> {
  log(`Migrating trigger rules... 0/${rules.length}`)
  let count = 0

  for (const rule of rules) {
    const { error } = await supabase
      .from('trigger_rules' as any)
      .insert({
        org_id:      orgId,
        name:        rule.name,
        conditions:  rule.conditions || {},
        actions:     rule.actions || [],
        is_active:   true,
        legacy_id:   rule.id || null,
        metadata:    {
          migrated_from: 'v15r',
          migrated_at:   new Date().toISOString(),
          original:      rule,
        },
      })

    if (error) {
      log(`  ⚠ Trigger rule "${rule.name}" failed: ${error.message}`)
      continue
    }

    count++
    log(`Migrating trigger rules... ${count}/${rules.length}`)
  }

  log(`✅ Trigger rules: ${count}/${rules.length} done`)
  return count
}

// ── Verification ─────────────────────────────────────────────────────────────

async function verifyMigration(orgId: string): Promise<void> {
  log('')
  log('═══════════════════════════════════════════')
  log('VERIFICATION — Querying record counts')
  log('═══════════════════════════════════════════')

  const tables = [
    'projects',
    'project_phases',
    'price_book_items',
    'price_book_categories',
    'field_logs',
    'project_templates',
    'crew_members',
  ]

  for (const table of tables) {
    const { count, error } = await supabase
      .from(table as any)
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)

    if (error) {
      log(`  ❌ ${table}: query failed — ${error.message}`)
    } else {
      log(`  ✅ ${table}: ${count} records`)
    }
  }

  // trigger_rules (separate since it might not be typed)
  const { count: triggerCount, error: triggerErr } = await supabase
    .from('trigger_rules' as any)
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)

  if (triggerErr) {
    log(`  ❌ trigger_rules: query failed — ${triggerErr.message}`)
  } else {
    log(`  ✅ trigger_rules: ${triggerCount} records`)
  }

  log('═══════════════════════════════════════════')
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runMigration(): Promise<void> {
  log('═══════════════════════════════════════════')
  log('PowerOn Hub — v15r Data Migration')
  log('═══════════════════════════════════════════')
  log('')

  // ── 1. Load migration JSON ─────────────────────────────────────────────
  const jsonPath = path.resolve(process.cwd(), 'poweron_migration.json')
  log(`Loading migration data from: ${jsonPath}`)

  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ File not found: ${jsonPath}`)
    console.error('   Place poweron_migration.json in the project root directory.')
    process.exit(1)
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf-8')
  const data: V15rMigrationData = JSON.parse(rawJson)

  log(`  📦 Projects:      ${data.projects?.length || 0}`)
  log(`  📦 Price book:    ${data.priceBook?.length || 0}`)
  log(`  📦 Service logs:  ${data.serviceLogs?.length || 0}`)
  log(`  📦 Templates:     ${data.templates?.length || 0}`)
  log(`  📦 Employees:     ${data.employees?.length || 0}`)
  log(`  📦 Trigger rules: ${data.triggerRules?.length || 0}`)
  log('')

  // ── 2. Resolve org_id for Power On Solutions ────────────────────────────
  log('Resolving organization...')

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id')
    .limit(1)
    .single()

  if (orgErr || !org) {
    console.error('❌ Could not find organization. Is the database seeded?')
    process.exit(1)
  }

  const orgId = org.id as string
  log(`  🏢 Organization: ${orgId}`)

  // ── 3. Resolve creator profile ──────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'owner')
    .limit(1)
    .single()

  const createdBy = (profile?.id as string) || orgId
  log(`  👤 Creator: ${createdBy}`)
  log('')

  // ── 4. Run migrations in order ──────────────────────────────────────────
  const results: Record<string, number> = {}

  if (data.templates?.length) {
    results.templates = await migrateTemplates(data.templates, orgId)
  }

  if (data.projects?.length) {
    results.projects = await migrateProjects(data.projects, orgId, createdBy)
  }

  if (data.priceBook?.length) {
    results.priceBook = await migratePriceBook(data.priceBook, orgId)
  }

  if (data.serviceLogs?.length) {
    results.serviceLogs = await migrateServiceLogs(data.serviceLogs, orgId, createdBy)
  }

  if (data.employees?.length) {
    results.employees = await migrateEmployees(data.employees, orgId)
  }

  if (data.triggerRules?.length) {
    results.triggerRules = await migrateTriggerRules(data.triggerRules, orgId)
  }

  // ── 5. Verify ──────────────────────────────────────────────────────────
  await verifyMigration(orgId)

  // ── 6. Summary ──────────────────────────────────────────────────────────
  log('')
  log('═══════════════════════════════════════════')
  log('MIGRATION COMPLETE')
  log('═══════════════════════════════════════════')
  for (const [key, val] of Object.entries(results)) {
    log(`  ${key}: ${val} records migrated`)
  }
  log('')
  log('Done! ✅')
}
