/**
 * SparkDataBridge.ts
 * SP6 — SPARK Live Call Data Bridge
 *
 * Connects SPARK to real PowerOn Hub business data so it can reference
 * live business context during active conversations.
 *
 * Data sources:
 *   1. VAULT floor prices        — minimum hourly rate, job minimum, material markups
 *   2. Past quotes               — client name → previous rates, accepted/rejected
 *   3. Client payment history    — avg days to pay, total business value, reliability score
 *   4. Material costs            — current prices for common items (wire, panels, breakers)
 *   5. Active projects           — what's booked this week, crew availability
 *   6. Lead database             — GC names, fit scores, margin quality, last contact date
 *
 * Cache: loaded on SPARK activation, refreshed every 30 minutes.
 * Fallback: if Supabase unavailable, falls back to last cached data from localStorage.
 *
 * Context injection: appends BUSINESS CONTEXT block to every Claude analysis call.
 * Cost calculator: runs on every dollar-amount mention; triggers alerts when margin drops.
 */

import { supabase } from '@/lib/supabase'
import { getBackupData, type BackupGCContact, type BackupSettings } from '@/services/backupDataService'

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_KEY         = 'spark_data_bridge_cache'
const CACHE_TTL_MS      = 30 * 60 * 1000 // 30 minutes
const MARGIN_ALERT_PCT  = 25              // trigger MARGIN_ALERT below this
const EMERGENCY_COST_PCT = 10            // trigger COST_ALERT below this

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultFloorPrices {
  minimumHourlyRate:   number   // e.g. 85
  minimumJobAmount:    number   // e.g. 350
  materialMarkupPct:   number   // e.g. 30 (= 30% markup over cost)
}

export interface PastQuote {
  clientName:   string
  amount:       number
  ratePerHour?: number
  accepted:     boolean
  date:         string
  jobType?:     string
  notes?:       string
}

export interface ClientPaymentHistory {
  clientName:        string
  avgDaysToPay:      number
  totalBusinessValue: number
  reliabilityScore:  number   // 0–100 derived from payment speed + completion rate
  jobCount:          number
  lastJobDate?:      string
}

export interface MaterialCost {
  name:     string
  unit:     string
  costEach: number
  category: string
}

export interface ActiveProject {
  id:         string
  name:       string
  status:     string
  startDate?: string
  endDate?:   string
  crew?:      string[]
  hoursBooked?: number
}

export interface WeekSchedule {
  bookedProjects:      number
  availableHours:      number
  crewNames:           string[]
}

export interface GCLeadProfile {
  id:              string
  name:            string
  company:         string
  fitScore:        number    // 0–100 (maps from BackupGCContact.fit)
  marginQuality:   'high' | 'medium' | 'low'
  lastContactDate: string
  phase:           string    // pipeline stage
  awarded:         number    // total $ awarded
  notes:           string
}

export interface SparkBusinessContext {
  vaultFloors:       VaultFloorPrices
  pastQuotes:        PastQuote[]
  paymentHistories:  ClientPaymentHistory[]
  materialCosts:     MaterialCost[]
  weekSchedule:      WeekSchedule
  gcLeads:           GCLeadProfile[]
  loadedAt:          number   // epoch ms
}

export interface CostBreakdown {
  laborCost:     number
  truckCost:     number
  overheadCost:  number
  materialCost:  number
  totalCost:     number
  revenue:       number
  margin:        number      // 0–1 (e.g. 0.35 = 35%)
  breakevenRate: number
  alert:         'NONE' | 'MARGIN_ALERT' | 'EMERGENCY_COST_ALERT'
  alertMessage?: string
}

export interface ClientMatch {
  found:          boolean
  profile?:       ClientPaymentHistory
  gcProfile?:     GCLeadProfile
  pastQuotes?:    PastQuote[]
  contextSummary: string
}

// ── Module-level cache ────────────────────────────────────────────────────────

let _cache: SparkBusinessContext | null = null
let _cacheLoadedAt  = 0
let _refreshTimer: ReturnType<typeof setInterval> | null = null

// ── Vault floor price derivation from local settings ─────────────────────────

function deriveVaultFloors(settings: BackupSettings): VaultFloorPrices {
  const hourlyRate = settings.billRate ?? 85
  const markupPct  = settings.markup   ?? 30
  // Minimum job = 4 hours at floor rate, or dayTarget / 2, whichever is higher
  const minJob     = Math.max(hourlyRate * 4, (settings.amBlock ?? 350))
  return {
    minimumHourlyRate: hourlyRate,
    minimumJobAmount:  minJob,
    materialMarkupPct: markupPct,
  }
}

// ── Past quotes from serviceLogs ──────────────────────────────────────────────

function buildPastQuotes(data: ReturnType<typeof getBackupData>): PastQuote[] {
  if (!data) return []
  const quotes: PastQuote[] = []

  for (const log of data.serviceLogs ?? []) {
    if (!log.customer || !log.quoted) continue
    const collected = Number(log.collected ?? 0)
    const quoted    = Number(log.quoted ?? 0)
    const accepted  = quoted > 0 && collected > 0
    quotes.push({
      clientName:  log.customer,
      amount:      quoted,
      ratePerHour: log.hrs > 0 ? quoted / log.hrs : undefined,
      accepted,
      date:        log.date ?? '',
      jobType:     log.jtype ?? undefined,
      notes:       log.notes ?? undefined,
    })
  }

  // Also pull from estimates if available
  for (const est of data.serviceEstimates ?? []) {
    if (!est.customer) continue
    quotes.push({
      clientName:  est.customer,
      amount:      Number(est.total ?? est.quoted ?? 0),
      accepted:    false, // estimates haven't been converted yet
      date:        est.date ?? '',
      jobType:     est.jtype ?? undefined,
    })
  }

  return quotes
}

// ── Client payment histories from serviceLogs ─────────────────────────────────

function buildPaymentHistories(data: ReturnType<typeof getBackupData>): ClientPaymentHistory[] {
  if (!data) return []

  const clientMap = new Map<string, {
    totalQuoted: number; totalCollected: number; jobCount: number
    dateDiffs: number[]; lastDate: string
  }>()

  for (const log of data.serviceLogs ?? []) {
    const name = log.customer?.trim()
    if (!name) continue
    const quoted    = Number(log.quoted    ?? 0)
    const collected = Number(log.collected ?? 0)

    const entry = clientMap.get(name) ?? {
      totalQuoted: 0, totalCollected: 0, jobCount: 0, dateDiffs: [], lastDate: ''
    }
    entry.totalQuoted    += quoted
    entry.totalCollected += collected
    entry.jobCount       += 1
    if (log.date && (!entry.lastDate || log.date > entry.lastDate)) {
      entry.lastDate = log.date
    }
    clientMap.set(name, entry)
  }

  const histories: ClientPaymentHistory[] = []
  for (const [clientName, data] of clientMap) {
    const collectionRate   = data.totalQuoted > 0
      ? data.totalCollected / data.totalQuoted : 0
    // Reliability score: 70% from collection rate, 30% from job volume
    const volumeBonus      = Math.min(data.jobCount * 5, 30)
    const reliabilityScore = Math.min(
      Math.round(collectionRate * 70 + volumeBonus), 100
    )
    // Avg days to pay — estimated at 7 days for full payers, 30+ for partial
    const avgDaysToPay = collectionRate >= 0.95 ? 7
      : collectionRate >= 0.5 ? 21
      : 45

    histories.push({
      clientName,
      avgDaysToPay,
      totalBusinessValue: data.totalCollected,
      reliabilityScore,
      jobCount:    data.jobCount,
      lastJobDate: data.lastDate || undefined,
    })
  }

  return histories
}

// ── Material costs from priceBook ─────────────────────────────────────────────

function buildMaterialCosts(data: ReturnType<typeof getBackupData>): MaterialCost[] {
  if (!data) return []
  const costs: MaterialCost[] = []
  const priceBook = data.priceBook ?? {}

  for (const item of Object.values(priceBook)) {
    const pb = item as { name?: string; unit?: string; cost?: number; category?: string }
    if (!pb.name || !pb.cost) continue
    costs.push({
      name:     pb.name,
      unit:     pb.unit ?? 'ea',
      costEach: Number(pb.cost ?? 0),
      category: pb.category ?? 'general',
    })
  }

  return costs
}

// ── Active project schedule from projects ─────────────────────────────────────

function buildWeekSchedule(data: ReturnType<typeof getBackupData>): WeekSchedule {
  if (!data) return { bookedProjects: 0, availableHours: 40, crewNames: [] }

  const activeProjects = (data.projects ?? []).filter(p => p.status === 'active')
  const crewNames      = (data.employees ?? []).map(e => e.name).filter(Boolean)

  // Estimate booked hours: each active project consumes some crew hours this week
  const bookedHours = activeProjects.reduce((sum, p) => {
    return sum + (Number((p as any).laborHrs ?? 0) || 8) // fallback 8h/project if unknown
  }, 0)

  // Available hours: crew count × 40h minus booked
  const totalCapacity  = Math.max(crewNames.length, 1) * 40
  const availableHours = Math.max(totalCapacity - bookedHours, 0)

  return {
    bookedProjects: activeProjects.length,
    availableHours,
    crewNames,
  }
}

// ── GC lead profiles from gcContacts ─────────────────────────────────────────

function buildGCLeads(data: ReturnType<typeof getBackupData>): GCLeadProfile[] {
  if (!data) return []

  return (data.gcContacts ?? []).map((gc: BackupGCContact): GCLeadProfile => {
    const awarded  = Number(gc.awarded ?? 0)
    const fit      = Number(gc.fit ?? 0)
    // Margin quality derived from fit score and average deal size
    const marginQuality: 'high' | 'medium' | 'low' =
      fit >= 75 ? 'high'
      : fit >= 45 ? 'medium'
      : 'low'

    return {
      id:              gc.id,
      name:            gc.contact ?? '',
      company:         gc.company ?? '',
      fitScore:        fit,
      marginQuality,
      lastContactDate: gc.due ?? gc.created ?? '',
      phase:           gc.phase ?? '',
      awarded,
      notes:           gc.notes ?? '',
    }
  })
}

// ── Supabase fetch helpers ────────────────────────────────────────────────────

/**
 * Attempt to load additional VAULT floor overrides from Supabase.
 * Falls back gracefully if the table doesn't exist yet.
 */
async function fetchVaultFloorsFromSupabase(
  localFloors: VaultFloorPrices
): Promise<VaultFloorPrices> {
  try {
    const { data, error } = await supabase
      .from('vault_settings' as never)
      .select('minimum_hourly_rate, minimum_job_amount, material_markup_pct')
      .limit(1)
      .maybeSingle()

    if (error || !data) return localFloors

    const row = data as Record<string, unknown>
    return {
      minimumHourlyRate:  Number(row['minimum_hourly_rate']  ?? localFloors.minimumHourlyRate),
      minimumJobAmount:   Number(row['minimum_job_amount']   ?? localFloors.minimumJobAmount),
      materialMarkupPct:  Number(row['material_markup_pct']  ?? localFloors.materialMarkupPct),
    }
  } catch {
    return localFloors
  }
}

/**
 * Attempt to load leads/GC data from Supabase `leads` table.
 * Merges with local gcContacts. Falls back gracefully.
 */
async function fetchSupabaseLeads(local: GCLeadProfile[]): Promise<GCLeadProfile[]> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, status, notes, created_at, follow_up_date')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error || !data) return local

    const supabaseLeads: GCLeadProfile[] = (data as Record<string, unknown>[]).map(row => ({
      id:              String(row['id'] ?? ''),
      name:            String(row['name'] ?? ''),
      company:         '',
      fitScore:        50,     // default fit when not in local gcContacts
      marginQuality:   'medium' as const,
      lastContactDate: String(row['follow_up_date'] ?? row['created_at'] ?? ''),
      phase:           String(row['status'] ?? ''),
      awarded:         0,
      notes:           String(row['notes'] ?? ''),
    }))

    // Merge: prefer local profiles over Supabase duplicates by name
    const localNames = new Set(local.map(l => l.name.toLowerCase()))
    const merged     = [...local]
    for (const sl of supabaseLeads) {
      if (!localNames.has(sl.name.toLowerCase())) {
        merged.push(sl)
      }
    }
    return merged
  } catch {
    return local
  }
}

// ── Cache persistence via localStorage ───────────────────────────────────────

function saveContextToLocalStorage(ctx: SparkBusinessContext): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(ctx))
  } catch {
    // localStorage may be full — non-critical
  }
}

function loadContextFromLocalStorage(): SparkBusinessContext | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SparkBusinessContext
  } catch {
    return null
  }
}

// ── Main context loader ───────────────────────────────────────────────────────

/**
 * Load full business context for SPARK.
 * - Reads local backup state (always available)
 * - Enriches with Supabase data where possible
 * - Falls back to last localStorage cache if Supabase is unavailable
 */
export async function loadSparkBusinessContext(): Promise<SparkBusinessContext> {
  const backup        = getBackupData()
  const localSettings = backup?.settings

  // Build from local backup data (always available, even offline)
  const localFloors      = localSettings ? deriveVaultFloors(localSettings) : {
    minimumHourlyRate: 85, minimumJobAmount: 350, materialMarkupPct: 30
  }
  const pastQuotes       = buildPastQuotes(backup)
  const paymentHistories = buildPaymentHistories(backup)
  const materialCosts    = buildMaterialCosts(backup)
  const weekSchedule     = buildWeekSchedule(backup)
  const localGCLeads     = buildGCLeads(backup)

  // Attempt to enrich from Supabase (non-blocking — fallback if unavailable)
  let vaultFloors = localFloors
  let gcLeads     = localGCLeads

  try {
    const [enrichedFloors, enrichedLeads] = await Promise.all([
      fetchVaultFloorsFromSupabase(localFloors),
      fetchSupabaseLeads(localGCLeads),
    ])
    vaultFloors = enrichedFloors
    gcLeads     = enrichedLeads
  } catch {
    // Supabase unavailable — check localStorage fallback
    const cached = loadContextFromLocalStorage()
    if (cached) {
      vaultFloors = cached.vaultFloors
      gcLeads     = cached.gcLeads
    }
  }

  const ctx: SparkBusinessContext = {
    vaultFloors,
    pastQuotes,
    paymentHistories,
    materialCosts,
    weekSchedule,
    gcLeads,
    loadedAt: Date.now(),
  }

  // Persist to localStorage so we have a fallback next time
  saveContextToLocalStorage(ctx)

  _cache       = ctx
  _cacheLoadedAt = Date.now()

  return ctx
}

// ── SPARK activation & auto-refresh ──────────────────────────────────────────

/**
 * Activate the data bridge when SPARK starts a live call session.
 * Loads context immediately, then schedules a refresh every 30 minutes.
 */
export async function activateSparkDataBridge(): Promise<SparkBusinessContext> {
  // Clear any existing refresh timer
  if (_refreshTimer !== null) {
    clearInterval(_refreshTimer)
    _refreshTimer = null
  }

  // Load immediately
  const ctx = await loadSparkBusinessContext()

  // Schedule background refresh every 30 minutes
  _refreshTimer = setInterval(async () => {
    try {
      await loadSparkBusinessContext()
    } catch {
      // Refresh failed — keep using last good cache
    }
  }, CACHE_TTL_MS)

  return ctx
}

/**
 * Deactivate the data bridge (call when SPARK session ends).
 */
export function deactivateSparkDataBridge(): void {
  if (_refreshTimer !== null) {
    clearInterval(_refreshTimer)
    _refreshTimer = null
  }
}

/**
 * Get the current cached context (synchronous, no network call).
 * Returns null if context has never been loaded.
 */
export function getCachedSparkContext(): SparkBusinessContext | null {
  if (_cache) return _cache
  return loadContextFromLocalStorage()
}

// ── Client identification ─────────────────────────────────────────────────────

/**
 * Fuzzy-match a name against the lead database and payment histories.
 * Returns the best match with full profile context.
 */
export function identifyClient(nameHint: string): ClientMatch {
  const ctx = getCachedSparkContext()
  if (!ctx || !nameHint.trim()) {
    return { found: false, contextSummary: 'No client data available.' }
  }

  const query = nameHint.toLowerCase().trim()

  // 1. Check GC lead database
  const gcMatch = ctx.gcLeads.find(gc =>
    gc.name.toLowerCase().includes(query) ||
    gc.company.toLowerCase().includes(query) ||
    query.includes(gc.name.toLowerCase())
  )

  // 2. Check payment histories (local serviceLogs)
  const payMatch = ctx.paymentHistories.find(ph =>
    ph.clientName.toLowerCase().includes(query) ||
    query.includes(ph.clientName.toLowerCase())
  )

  // 3. Gather past quotes for this client
  const pastQ = ctx.pastQuotes.filter(q =>
    q.clientName.toLowerCase().includes(query) ||
    query.includes(q.clientName.toLowerCase())
  )

  if (!gcMatch && !payMatch && pastQ.length === 0) {
    return { found: false, contextSummary: `No records found for "${nameHint}".` }
  }

  // Build summary
  const lines: string[] = []

  if (payMatch) {
    lines.push(
      `${payMatch.clientName}: ${payMatch.jobCount} job(s), ` +
      `$${payMatch.totalBusinessValue.toFixed(0)} collected, ` +
      `avg ${payMatch.avgDaysToPay} days to pay, ` +
      `reliability ${payMatch.reliabilityScore}/100`
    )
  }

  if (gcMatch) {
    lines.push(
      `GC profile — ${gcMatch.company || gcMatch.name}: ` +
      `fit ${gcMatch.fitScore}/100, margin ${gcMatch.marginQuality}, ` +
      `phase: ${gcMatch.phase}, awarded $${gcMatch.awarded.toFixed(0)}`
    )
  }

  if (pastQ.length > 0) {
    const lastQ   = pastQ.sort((a, b) => b.date.localeCompare(a.date))[0]
    const accepted = pastQ.filter(q => q.accepted).length
    lines.push(
      `${pastQ.length} quote(s) on record, ${accepted} accepted. ` +
      `Last quote: $${lastQ.amount.toFixed(0)} on ${lastQ.date}`
    )
  }

  return {
    found:          true,
    profile:        payMatch,
    gcProfile:      gcMatch,
    pastQuotes:     pastQ,
    contextSummary: lines.join(' | '),
  }
}

// ── Cost calculator ───────────────────────────────────────────────────────────

/**
 * Calculate real cost and margin for a job.
 *
 * Formula:
 *   labor     = hours × rate
 *   truck     = hours × $8   (truck/gas/insurance per hour)
 *   overhead  = hours × $12  (insurance, license, tools)
 *   materials = materials × 1.0 (at cost, no markup)
 *   totalCost = labor + truck + overhead + materials
 *   revenue   = rate × hours
 *   margin    = (revenue - totalCost) / revenue
 *
 * Alerts:
 *   margin < 25%  → MARGIN_ALERT
 *   margin < 10%  → EMERGENCY_COST_ALERT
 */
export function calculateRealCost(
  hours:     number,
  rate:      number,
  materials: number
): CostBreakdown {
  const laborCost    = hours * rate
  const truckCost    = hours * 8
  const overheadCost = hours * 12
  const materialCost = materials          // at cost, no markup
  const totalCost    = laborCost + truckCost + overheadCost + materialCost
  const revenue      = rate * hours
  const margin       = revenue > 0 ? (revenue - totalCost) / revenue : 0
  const marginPct    = margin * 100

  // Breakeven rate: what rate per hour covers all costs
  const breakevenRate = hours > 0
    ? (truckCost + overheadCost + materialCost) / hours
    : 0

  let alert: CostBreakdown['alert']   = 'NONE'
  let alertMessage: string | undefined

  if (marginPct < EMERGENCY_COST_PCT) {
    alert        = 'EMERGENCY_COST_ALERT'
    alertMessage = `🚨 EMERGENCY: Margin is ${marginPct.toFixed(1)}% — below ${EMERGENCY_COST_PCT}% floor. ` +
                   `You need at least $${breakevenRate.toFixed(0)}/hr to break even. ` +
                   `Do NOT take this job at this rate.`
  } else if (marginPct < MARGIN_ALERT_PCT) {
    alert        = 'MARGIN_ALERT'
    alertMessage = `⚠️ MARGIN ALERT: ${marginPct.toFixed(1)}% margin is below the ${MARGIN_ALERT_PCT}% target. ` +
                   `Consider increasing rate or reducing scope.`
  }

  return {
    laborCost,
    truckCost,
    overheadCost,
    materialCost,
    totalCost,
    revenue,
    margin,
    breakevenRate,
    alert,
    alertMessage,
  }
}

// ── Context injection for Claude analysis ─────────────────────────────────────

/**
 * Build the BUSINESS CONTEXT block to inject into a Claude prompt.
 *
 * Called by SPARK before sending a transcript chunk to Claude for analysis.
 * If a client has been identified, their full profile is included.
 *
 * @param clientNameHint   Optional: name identified from caller ID or transcript
 * @param materialsMentioned Optional: material keywords found in transcript
 */
export function buildBusinessContextBlock(
  clientNameHint?: string,
  materialsMentioned?: string[]
): string {
  const ctx = getCachedSparkContext()

  if (!ctx) {
    return [
      'BUSINESS CONTEXT:',
      '  [Context not loaded — Supabase unavailable and no cached data]',
    ].join('\n')
  }

  const { vaultFloors, weekSchedule, materialCosts } = ctx

  const lines: string[] = [
    'BUSINESS CONTEXT:',
    `  Floor rate: $${vaultFloors.minimumHourlyRate}/hr. ` +
    `Floor job minimum: $${vaultFloors.minimumJobAmount}. ` +
    `Material markup: ${vaultFloors.materialMarkupPct}%.`,
  ]

  // Client context
  if (clientNameHint) {
    const match = identifyClient(clientNameHint)
    if (match.found) {
      lines.push(`  This client (${clientNameHint}): ${match.contextSummary}`)
    } else {
      lines.push(`  This client (${clientNameHint}): No prior history on record — new client.`)
    }
  }

  // Week schedule
  lines.push(
    `  This week: ${weekSchedule.bookedProjects} project(s) booked, ` +
    `~${Math.round(weekSchedule.availableHours)} crew-hours available` +
    (weekSchedule.crewNames.length > 0
      ? `. Crew: ${weekSchedule.crewNames.slice(0, 3).join(', ')}` : '.')
  )

  // Relevant materials
  if (materialsMentioned && materialsMentioned.length > 0 && materialCosts.length > 0) {
    const relevantMaterials = materialCosts.filter(m =>
      materialsMentioned.some(keyword =>
        m.name.toLowerCase().includes(keyword.toLowerCase()) ||
        m.category.toLowerCase().includes(keyword.toLowerCase())
      )
    ).slice(0, 5)

    if (relevantMaterials.length > 0) {
      const matLines = relevantMaterials
        .map(m => `${m.name}: $${m.costEach.toFixed(2)}/${m.unit}`)
        .join(', ')
      lines.push(`  Current material costs: ${matLines}.`)
    }
  }

  return lines.join('\n')
}

/**
 * Inject business context into a transcript analysis prompt.
 * Appends the BUSINESS CONTEXT block before the final user message.
 *
 * @param basePrompt         The base prompt or transcript chunk to analyze
 * @param clientNameHint     Optional client name from caller ID / transcript
 * @param materialsMentioned Optional material keywords found in transcript
 * @param dollarAmount       Optional dollar amount mentioned — triggers cost calc
 * @param estimatedHours     Optional hours estimate for cost calc
 */
export function injectContextIntoPrompt(
  basePrompt:          string,
  clientNameHint?:     string,
  materialsMentioned?: string[],
  dollarAmount?:       number,
  estimatedHours?:     number
): string {
  const contextBlock = buildBusinessContextBlock(clientNameHint, materialsMentioned)

  const parts: string[] = [basePrompt, '', contextBlock]

  // If a dollar amount + hours are present, run the cost calculator inline
  if (dollarAmount !== undefined && estimatedHours !== undefined && estimatedHours > 0) {
    const ctx        = getCachedSparkContext()
    const rate       = dollarAmount / estimatedHours
    const materials  = 0  // unknown from transcript alone — conservative
    const breakdown  = calculateRealCost(estimatedHours, rate, materials)
    const marginPct  = (breakdown.margin * 100).toFixed(1)

    parts.push('')
    parts.push(
      `COST ANALYSIS (auto-calculated for $${dollarAmount} / ${estimatedHours}h):\n` +
      `  Effective rate: $${rate.toFixed(0)}/hr | ` +
      `Floor: $${ctx?.vaultFloors.minimumHourlyRate ?? 85}/hr\n` +
      `  Labor: $${breakdown.laborCost.toFixed(0)} | ` +
      `Truck: $${breakdown.truckCost.toFixed(0)} | ` +
      `Overhead: $${breakdown.overheadCost.toFixed(0)}\n` +
      `  Total cost: $${breakdown.totalCost.toFixed(0)} | ` +
      `Margin: ${marginPct}% | ` +
      `Breakeven rate: $${breakdown.breakevenRate.toFixed(0)}/hr` +
      (breakdown.alert !== 'NONE' ? `\n  ${breakdown.alertMessage}` : '')
    )
  }

  return parts.join('\n')
}

// ── Utility exports ───────────────────────────────────────────────────────────

/**
 * Check if the context cache is stale (older than 30 minutes).
 */
export function isContextStale(): boolean {
  if (!_cache) return true
  return Date.now() - _cacheLoadedAt > CACHE_TTL_MS
}

/**
 * Force a manual context refresh.
 * Use when the user navigates back to SPARK after a long pause.
 */
export async function refreshSparkContext(): Promise<SparkBusinessContext> {
  return loadSparkBusinessContext()
}

/**
 * Get the VAULT floor prices from the current cache (synchronous).
 * Returns safe defaults if cache is not yet loaded.
 */
export function getVaultFloors(): VaultFloorPrices {
  const ctx = getCachedSparkContext()
  return ctx?.vaultFloors ?? {
    minimumHourlyRate: 85,
    minimumJobAmount:  350,
    materialMarkupPct: 30,
  }
}

/**
 * Get all GC leads sorted by fit score (best leads first).
 */
export function getTopGCLeads(limit = 10): GCLeadProfile[] {
  const ctx = getCachedSparkContext()
  if (!ctx) return []
  return [...ctx.gcLeads]
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, limit)
}

/**
 * Get relevant material costs for keywords found in a transcript.
 */
export function getMaterialsForKeywords(keywords: string[]): MaterialCost[] {
  const ctx = getCachedSparkContext()
  if (!ctx || keywords.length === 0) return []
  return ctx.materialCosts.filter(m =>
    keywords.some(kw =>
      m.name.toLowerCase().includes(kw.toLowerCase()) ||
      m.category.toLowerCase().includes(kw.toLowerCase())
    )
  )
}
