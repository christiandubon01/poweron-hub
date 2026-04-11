/**
 * V15rServiceCallsV2.tsx
 * Multi-day service call tracker with itemized materials, running totals, and margin tracking.
 *
 * Key fixes vs V1:
 *  ✅ Multi-day entries: each call can have Day 1, Day 2, Day 3 etc.
 *  ✅ Itemized materials: [Item] [Qty] [Unit $] [Total] — NOT a lump sum
 *  ✅ Running totals: hours, materials, miles, cost, collected, margin after each day
 *  ✅ "Add Day" button on every existing call
 *  ✅ Net margin = collected - total cost; Margin % displayed
 *  ✅ No "remaining balance" field — service calls feed revenue bucket only
 *  ✅ Scope creep flag from GUARDIAN if labor or materials grew > 25% vs Day 1
 *
 * Design:
 *  - Calls are stored in backupData[MULTIDAY_SVC_KEY]
 *  - Legacy serviceLogs are shown in a separate "Legacy" tab (read-only migration view)
 *  - New calls go into the multi-day store
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Plus, ChevronDown, ChevronUp, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Calendar, Package, Truck, Clock,
  Zap, Filter, Layers,
} from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  num,
  type BackupServiceLog,
} from '@/services/backupDataService'
import {
  type ServiceCallRecord,
  type ServiceDayEntry,
  getServiceCallTotals,
  loadServiceCallRecords,
  saveServiceCallRecords,
  migrateServiceLog,
  MULTIDAY_SVC_KEY,
} from '@/services/serviceCallService'
import { pushState } from '@/services/undoRedoService'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import MultiDayServiceCallModal, { type MultiDayModalConfig } from './MultiDayServiceCallModal'
import ImportBackupButton from '@/components/ImportBackupButton'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (!n && n !== 0) return '$0'
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(0)
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

const TABS = ['Multi-Day Calls', 'Legacy Log'] as const
type TabId = typeof TABS[number]

// ─── Component ───────────────────────────────────────────────────────────────

export default function V15rServiceCallsV2() {
  const { isDemoMode: demoMode } = useDemoMode()
  const rawBackup = demoMode ? getDemoBackupData() : getBackupData()
  const backup = rawBackup

  const [activeTab, setActiveTab] = useState<TabId>('Multi-Day Calls')
  const [filterType, setFilterType] = useState<string>('all')
  const [modalConfig, setModalConfig] = useState<MultiDayModalConfig | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // ── Load multi-day records ──────────────────────────────────────────────────
  const [records, setRecords] = useState<ServiceCallRecord[]>(() => {
    if (!backup) return []
    return loadServiceCallRecords(backup)
  })

  // Sync records from backup on backup change
  useEffect(() => {
    if (!backup) return
    setRecords(loadServiceCallRecords(backup))
  }, [backup])

  // Legacy service logs for the legacy tab
  const legacyLogs: BackupServiceLog[] = backup?.serviceLogs || []

  // Settings for rate defaults
  const laborRate = num(backup?.settings?.opCost || backup?.settings?.billRate || 43)
  const mileRate = num(backup?.settings?.mileRate || 0.67)

  // ── Persist helper ─────────────────────────────────────────────────────────
  const persist = useCallback((updated: ServiceCallRecord[]) => {
    if (!backup) return
    pushState()
    saveServiceCallRecords(backup, updated)
    saveBackupData(backup)
    setRecords(updated)
  }, [backup])

  // ── Modal handlers ─────────────────────────────────────────────────────────
  function openNewCall() {
    setModalConfig({ type: 'new_call', laborRate, mileRate })
  }

  function openAddDay(call: ServiceCallRecord) {
    setModalConfig({ type: 'add_day', call, laborRate, mileRate })
  }

  function handleModalSave(result: ServiceCallRecord) {
    let updated: ServiceCallRecord[]
    if (modalConfig?.type === 'new_call') {
      updated = [...records, result]
    } else {
      updated = records.map(r =>
        r.service_call_id === result.service_call_id ? result : r
      )
    }
    persist(updated)
    setModalConfig(null)
    // Auto-expand the saved call
    setExpandedIds(prev => new Set([...prev, result.service_call_id]))
  }

  // ── Toggle expand ──────────────────────────────────────────────────────────
  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Job type filter ────────────────────────────────────────────────────────
  const allTypes = useMemo(() => {
    const t = new Set(records.map(r => r.jtype).filter(Boolean))
    return ['all', ...Array.from(t)]
  }, [records])

  const filteredRecords = useMemo(() => {
    return records.filter(r => filterType === 'all' || r.jtype === filterType)
  }, [records, filterType])

  // ── Summary KPIs across all filtered records ───────────────────────────────
  const summary = useMemo(() => {
    let totalHours = 0, totalMaterials = 0, totalMiles = 0
    let totalCost = 0, totalCollected = 0

    for (const r of filteredRecords) {
      const t = getServiceCallTotals(r)
      totalHours += t.total_hours
      totalMaterials += t.total_materials
      totalMiles += t.total_miles
      totalCost += t.total_cost
      totalCollected += t.total_collected
    }
    const netMargin = totalCollected - totalCost
    const marginPct = totalCollected > 0.009 ? (netMargin / totalCollected) * 100 : 0

    return { totalHours, totalMaterials, totalMiles, totalCost, totalCollected, netMargin, marginPct }
  }, [filteredRecords])

  if (!backup) return <NoData />

  return (
    <div className="space-y-5 p-5 min-h-screen">
      <ImportBackupButton />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
            <Layers size={16} className="text-emerald-400" />
            Service Calls
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5">
            Multi-day tracking · Itemized materials · Margin analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Job type filter */}
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-gray-500" />
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {allTypes.map(t => (
                <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>
              ))}
            </select>
          </div>
          <button
            onClick={openNewCall}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors"
          >
            <Plus size={12} /> New Call
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Hours" value={summary.totalHours.toFixed(1)} color="text-cyan-400" />
        <KPI label="Materials" value={fmtMoney(summary.totalMaterials)} color="text-orange-400" />
        <KPI label="Miles" value={summary.totalMiles.toString()} color="text-purple-400" />
        <KPI label="Total Cost" value={fmtMoney(summary.totalCost)} color="text-red-400" />
        <KPI label="Collected" value={fmtMoney(summary.totalCollected)} color="text-emerald-400" />
        <KPI
          label="Net Margin"
          value={fmtMoney(summary.netMargin)}
          sub={fmtPct(summary.marginPct)}
          color={summary.netMargin >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-700">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-semibold transition-colors rounded-t-lg ${
              activeTab === tab
                ? 'text-emerald-400 border-b-2 border-emerald-400 bg-gray-800/60'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
            {tab === 'Multi-Day Calls' && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-400 text-[9px]">
                {filteredRecords.length}
              </span>
            )}
            {tab === 'Legacy Log' && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-400 text-[9px]">
                {legacyLogs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Multi-Day Calls */}
      {activeTab === 'Multi-Day Calls' && (
        <div className="space-y-3">
          {filteredRecords.length === 0 ? (
            <EmptyState onNew={openNewCall} />
          ) : (
            filteredRecords.map(call => (
              <ServiceCallCard
                key={call.service_call_id}
                call={call}
                expanded={expandedIds.has(call.service_call_id)}
                onToggle={() => toggleExpand(call.service_call_id)}
                onAddDay={() => openAddDay(call)}
                laborRate={laborRate}
              />
            ))
          )}
        </div>
      )}

      {/* Tab: Legacy Log */}
      {activeTab === 'Legacy Log' && (
        <LegacyServiceLogList
          logs={legacyLogs}
          laborRate={laborRate}
          onMigrate={(log) => {
            const migrated = migrateServiceLog(log, laborRate)
            const updated = [...records, migrated]
            persist(updated)
            setActiveTab('Multi-Day Calls')
            setExpandedIds(prev => new Set([...prev, migrated.service_call_id]))
          }}
        />
      )}

      {/* Modal */}
      {modalConfig && (
        <MultiDayServiceCallModal
          config={modalConfig}
          onSave={handleModalSave}
          onClose={() => setModalConfig(null)}
        />
      )}

      <div className="text-[10px] text-gray-600 flex items-center gap-1 pb-4">
        <Zap size={10} /> NEXUS AI can analyze service call patterns and margin trends — ask in the chat panel
      </div>
    </div>
  )
}

// ─── ServiceCallCard ──────────────────────────────────────────────────────────

interface CardProps {
  call: ServiceCallRecord
  expanded: boolean
  onToggle: () => void
  onAddDay: () => void
  laborRate: number
}

function ServiceCallCard({ call, expanded, onToggle, onAddDay, laborRate }: CardProps) {
  const totals = useMemo(() => getServiceCallTotals(call), [call])
  const scopeFlag = call.scope_creep_flag

  return (
    <div className={`rounded-xl border bg-gray-800/40 overflow-hidden transition-colors ${
      scopeFlag ? 'border-yellow-500/50' : 'border-gray-700'
    }`}>
      {/* Card Header — always visible */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-700/20 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            {/* Customer + type */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-200">{call.customer}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">
                {call.jtype}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
                {totals.day_count} {totals.day_count === 1 ? 'day' : 'days'}
              </span>
              {scopeFlag && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 flex items-center gap-1">
                  <AlertTriangle size={9} /> Scope Creep
                </span>
              )}
            </div>
            {/* Address */}
            {call.address && (
              <div className="text-[10px] text-gray-500 mt-0.5 truncate">{call.address}</div>
            )}
          </div>

          {/* Quick financials */}
          <div className="hidden sm:grid grid-cols-3 gap-4 text-right text-[10px] shrink-0">
            <div>
              <div className="text-gray-500">Cost</div>
              <div className="font-mono text-red-400 font-bold">{fmtMoney(totals.total_cost)}</div>
            </div>
            <div>
              <div className="text-gray-500">Collected</div>
              <div className="font-mono text-emerald-400 font-bold">{fmtMoney(totals.total_collected)}</div>
            </div>
            <div>
              <div className="text-gray-500">Margin</div>
              <div className={`font-mono font-bold ${totals.net_margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtMoney(totals.net_margin)}
              </div>
            </div>
          </div>
        </div>

        <div className="ml-3 shrink-0 text-gray-500">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-700 p-4 space-y-4">
          {/* Running totals summary */}
          <RunningTotalsBar totals={totals} />

          {/* Scope creep note */}
          {scopeFlag && call.scope_creep_note && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[10px] text-yellow-300 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{call.scope_creep_note}</span>
            </div>
          )}

          {/* Day entries */}
          <div className="space-y-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
              Daily Entries
            </div>
            {call.days.map((day, idx) => (
              <DayEntryRow
                key={day.id}
                day={day}
                isFirst={idx === 0}
                isLast={idx === call.days.length - 1}
                laborRate={laborRate}
              />
            ))}
          </div>

          {/* Add Day button */}
          <button
            onClick={e => { e.stopPropagation(); onAddDay() }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-500/30 bg-emerald-600/15 text-emerald-400 text-xs font-semibold hover:bg-emerald-600/25 transition-colors w-full justify-center"
          >
            <Plus size={12} /> Add Day {totals.day_count + 1}
          </button>

          {/* Full itemized materials list */}
          {totals.all_material_items.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold flex items-center gap-1.5">
                <Package size={10} /> All Materials (Itemized)
              </div>
              <div className="rounded-lg border border-gray-700 overflow-hidden">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-800/60">
                      <th className="text-left py-1.5 px-3 text-gray-500 font-semibold">Item</th>
                      <th className="text-right py-1.5 px-3 text-gray-500 font-semibold">Qty</th>
                      <th className="text-right py-1.5 px-3 text-gray-500 font-semibold">Unit $</th>
                      <th className="text-right py-1.5 px-3 text-gray-500 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.all_material_items.map((m, i) => (
                      <tr key={m.id + i} className="border-b border-gray-700/50 last:border-0">
                        <td className="py-1.5 px-3 text-gray-300">{m.item_name}</td>
                        <td className="py-1.5 px-3 text-right text-gray-400 font-mono">{m.quantity}</td>
                        <td className="py-1.5 px-3 text-right text-gray-400 font-mono">{fmtMoney(m.unit_cost)}</td>
                        <td className="py-1.5 px-3 text-right text-orange-400 font-mono font-bold">{fmtMoney(m.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-800/40 border-t border-gray-700">
                      <td colSpan={3} className="py-1.5 px-3 text-gray-400 font-semibold">Total Materials</td>
                      <td className="py-1.5 px-3 text-right text-orange-400 font-mono font-bold">
                        {fmtMoney(totals.total_materials)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── RunningTotalsBar ─────────────────────────────────────────────────────────

function RunningTotalsBar({ totals }: { totals: ReturnType<typeof getServiceCallTotals> }) {
  const marginColor = totals.net_margin >= 0 ? 'text-emerald-400' : 'text-red-400'
  const MarginIcon = totals.net_margin >= 0 ? TrendingUp : TrendingDown

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-3">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-2 font-bold">
        Running Totals — All {totals.day_count} {totals.day_count === 1 ? 'Day' : 'Days'}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
        <MiniMetric
          icon={<Clock size={9} />}
          label="Hours"
          value={totals.total_hours.toFixed(1)}
          color="text-cyan-400"
        />
        <MiniMetric
          icon={<Package size={9} />}
          label="Materials"
          value={fmtMoney(totals.total_materials)}
          color="text-orange-400"
        />
        <MiniMetric
          icon={<Truck size={9} />}
          label="Miles"
          value={totals.total_miles.toString()}
          color="text-purple-400"
        />
        <MiniMetric
          icon={<span className="text-[9px]">$</span>}
          label="Total Cost"
          value={fmtMoney(totals.total_cost)}
          color="text-red-400"
        />
        <MiniMetric
          icon={<CheckCircle size={9} />}
          label="Collected"
          value={fmtMoney(totals.total_collected)}
          color="text-emerald-400"
        />
        <MiniMetric
          icon={<MarginIcon size={9} />}
          label={`Margin ${fmtPct(totals.margin_pct)}`}
          value={fmtMoney(totals.net_margin)}
          color={marginColor}
          bold
        />
      </div>
    </div>
  )
}

// ─── DayEntryRow ──────────────────────────────────────────────────────────────

function DayEntryRow({
  day,
  isFirst,
  isLast,
  laborRate,
}: {
  day: ServiceDayEntry
  isFirst: boolean
  isLast: boolean
  laborRate: number
}) {
  const [showMaterials, setShowMaterials] = useState(false)

  return (
    <div className={`rounded-lg border ${isLast ? 'border-emerald-500/30 bg-emerald-900/10' : 'border-gray-700 bg-gray-800/30'}`}>
      <div className="p-3">
        {/* Day header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              isFirst
                ? 'bg-blue-500/20 text-blue-400'
                : isLast
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-gray-700 text-gray-400'
            }`}>
              Day {day.day_number}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">{day.date}</span>
          </div>
          <div className="text-xs font-bold font-mono text-yellow-400">
            {fmtMoney(day.daily_total ?? 0)}
          </div>
        </div>

        {/* Day stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
          <div>
            <span className="text-gray-500">Labor: </span>
            <span className="text-cyan-400 font-mono">
              {day.labor_hours}h × ${laborRate} = {fmtMoney(day.labor_cost)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Materials: </span>
            <span className="text-orange-400 font-mono">{fmtMoney(day.materials_total)}</span>
            {day.materials.length > 0 && (
              <button
                onClick={() => setShowMaterials(v => !v)}
                className="ml-1 text-gray-500 hover:text-gray-300 text-[9px] underline"
              >
                ({day.materials.length} items)
              </button>
            )}
          </div>
          <div>
            <span className="text-gray-500">Transport: </span>
            <span className="text-purple-400 font-mono">
              {day.transportation_miles}mi = {fmtMoney(day.transportation_cost ?? 0)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Collected: </span>
            <span className="text-emerald-400 font-mono">{fmtMoney(day.collection_amount)}</span>
          </div>
        </div>

        {/* Notes */}
        {day.notes && (
          <div className="mt-2 text-[9px] text-gray-500 italic">{day.notes}</div>
        )}
      </div>

      {/* Inline material breakdown */}
      {showMaterials && day.materials.length > 0 && (
        <div className="border-t border-gray-700/50 px-3 pb-3">
          <div className="rounded-lg border border-gray-700 overflow-hidden mt-2">
            <table className="w-full text-[9px]">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-800/60">
                  <th className="text-left py-1 px-2 text-gray-500">Item</th>
                  <th className="text-right py-1 px-2 text-gray-500">Qty</th>
                  <th className="text-right py-1 px-2 text-gray-500">Unit $</th>
                  <th className="text-right py-1 px-2 text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {day.materials.map(m => (
                  <tr key={m.id} className="border-b border-gray-700/30 last:border-0">
                    <td className="py-1 px-2 text-gray-300">{m.item_name}</td>
                    <td className="py-1 px-2 text-right text-gray-400 font-mono">{m.quantity}</td>
                    <td className="py-1 px-2 text-right text-gray-400 font-mono">{fmtMoney(m.unit_cost)}</td>
                    <td className="py-1 px-2 text-right text-orange-400 font-mono">{fmtMoney(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── LegacyServiceLogList ─────────────────────────────────────────────────────

function LegacyServiceLogList({
  logs,
  laborRate,
  onMigrate,
}: {
  logs: BackupServiceLog[]
  laborRate: number
  onMigrate: (log: BackupServiceLog) => void
}) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No legacy service log entries found.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2 text-[10px] text-blue-300">
        These are single-entry service logs from the original system. Click "Migrate" to convert any entry
        to the multi-day format where you can add more days and itemize materials.
      </div>
      {logs.map((l, idx) => {
        const balanceDue = num(l.balanceDue) || Math.max(0, num(l.quoted) - num(l.collected))
        return (
          <div key={l.id || idx} className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-gray-500">SVC-{String(idx + 1).padStart(3, '0')}</span>
                <span className="text-xs font-semibold text-gray-300">{l.customer}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">{l.jtype}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 font-mono">{l.date}</span>
                <button
                  onClick={() => onMigrate(l)}
                  className="px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-[9px] font-semibold hover:bg-blue-600/30 transition-colors"
                >
                  Migrate →
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] text-center">
              <div>
                <div className="text-gray-500">Hours</div>
                <div className="font-mono text-gray-200">{l.hrs || 0}</div>
              </div>
              <div>
                <div className="text-gray-500">Quoted</div>
                <div className="font-mono text-cyan-400">{fmtMoney(l.quoted || 0)}</div>
              </div>
              <div>
                <div className="text-gray-500">Materials</div>
                <div className="font-mono text-orange-400">{fmtMoney(l.mat || 0)}</div>
              </div>
              <div>
                <div className="text-gray-500">Collected</div>
                <div className="font-mono text-emerald-400">{fmtMoney(l.collected || 0)}</div>
              </div>
              <div>
                <div className="text-gray-500">Balance Due</div>
                <div className={`font-mono font-bold ${balanceDue > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                  {fmtMoney(balanceDue)}
                </div>
              </div>
            </div>
            {l.notes && (
              <div className="mt-2 text-[9px] text-gray-500 italic">{l.notes}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPI({
  label, value, color, sub,
}: {
  label: string; value: string; color: string; sub?: string
}) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 text-center">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-base font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className={`text-[9px] font-mono ${color} opacity-75`}>{sub}</div>}
    </div>
  )
}

function MiniMetric({
  icon, label, value, color, bold,
}: {
  icon: React.ReactNode; label: string; value: string; color: string; bold?: boolean
}) {
  return (
    <div className="text-center">
      <div className="text-gray-600 flex justify-center mb-0.5">{icon}</div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider leading-tight">{label}</div>
      <div className={`text-xs font-mono ${color} ${bold ? 'font-bold' : ''}`}>{value}</div>
    </div>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="text-center py-16 space-y-4">
      <Calendar size={32} className="mx-auto text-gray-600" />
      <div>
        <p className="text-sm font-semibold text-gray-400">No multi-day service calls yet</p>
        <p className="text-xs text-gray-600 mt-1">
          Create a new call to start tracking days, itemized materials, and margin.
        </p>
      </div>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors"
      >
        <Plus size={14} /> Create First Service Call
      </button>
    </div>
  )
}

function NoData() {
  return (
    <div className="p-6 space-y-4">
      <ImportBackupButton />
      <div className="text-center text-gray-500 py-20">
        <p className="text-lg font-semibold mb-2">No data available</p>
        <p className="text-sm">Import your backup file to get started</p>
      </div>
    </div>
  )
}
