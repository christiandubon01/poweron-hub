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
import { useRemoteDataRefresh } from '@/hooks/useRemoteDataRefresh'
import {
  Plus, ChevronDown, ChevronUp, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Calendar, Package, Truck, Clock,
  Zap, Filter, Layers,
} from 'lucide-react'
import { InvoiceDraftsModal } from '@/features/billing-draft/components/InvoiceDraftsModal'
import { PrepareInvoiceModal, type PrepareInvoiceSource } from '@/features/billing-draft/components/PrepareInvoiceModal'
import { QuickBooksMenu } from '@/features/billing-draft/components/QuickBooksMenu'
import { useQuickBooksInvoicing } from '@/features/billing-draft/useQuickBooksInvoicing'
import { useQuickBooksCustomerMapping } from '@/features/quickbooks-customer-mapping/useQuickBooksCustomerMapping'
import { useCanonicalCustomerDirectory } from '@/features/quickbooks-customer-mapping/useCanonicalCustomerDirectory'
import { isCanonicalCustomerId } from '@/features/quickbooks-customer-mapping/resolvePowerOnCustomerDirectory'
import { LinkQuickBooksCustomerModal } from '@/features/quickbooks-customer-mapping/components/LinkQuickBooksCustomerModal'
import { ResolvePowerOnCustomerModal } from '@/features/quickbooks-customer-mapping/components/ResolvePowerOnCustomerModal'
import type { CustomerDirectoryEntry } from '@/features/quickbooks-customer-mapping/qboCustomerMappingTypes'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  fetchLatestRemoteBackup,
  saveBackupWithRemoteBaselineSync,
  num,
  resolveCanonicalCustomerName,
  type BackupData,
  type BackupServiceLog,
} from '@/services/backupDataService'
import {
  type ServiceCallRecord,
  type ServiceDayEntry,
  getServiceCallTotals,
  loadServiceCallRecords,
  saveServiceCallRecords,
  migrateServiceLog,
} from '@/services/serviceCallService'
import {
  getLiveMultiDayServiceCalls,
  mergeMultiDayServiceCallsIntoRemote,
  mergeServiceLogsIntoRemote,
} from '@/services/serviceScopeMerge'
import { pushState } from '@/services/undoRedoService'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import MultiDayServiceCallModal, { type MultiDayModalConfig } from './MultiDayServiceCallModal'
import { internalLaborRate } from './employeeCostUtils'
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

async function saveMultiDayServiceCallsScoped(incomingBackup: BackupData): Promise<void> {
  const mergeSource = 'service-multiDayCalls-remote-merge'
  try {
    const remote = await fetchLatestRemoteBackup()
    if (remote.hasRemoteRow && remote.remoteData) {
      const merged = mergeMultiDayServiceCallsIntoRemote(remote.remoteData, incomingBackup)
      await saveBackupWithRemoteBaselineSync(
        merged,
        { remoteUpdatedAt: remote.remoteUpdatedAt, remoteDataLastSavedAt: remote.remoteDataLastSavedAt },
        {
          source: mergeSource,
          changedKey: 'service.multiDayCalls',
          _scopes: ['service.multiDayCalls'],
        },
      )
      return
    }
    await saveBackupDataAndSync(incomingBackup, 'service.multiDayCalls', {
      source: 'service.multiDayCalls',
      _scopes: ['service.multiDayCalls'],
    })
  } catch (err) {
    if ((err as Error)?.name === 'BackupStorageWriteError') return
    console.warn('[saveMultiDayServiceCallsScoped] Scoped sync failed; local changes preserved', err)
    try {
      await saveBackupDataAndSync(incomingBackup, 'service.multiDayCalls', {
        source: 'service.multiDayCalls',
        _scopes: ['service.multiDayCalls'],
      })
    } catch (fallbackErr) {
      if ((fallbackErr as Error)?.name === 'BackupStorageWriteError') return
      throw fallbackErr
    }
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function V15rServiceCallsV2() {
  const { isDemoMode: demoMode } = useDemoMode()
  const rawBackup = demoMode ? getDemoBackupData() : getBackupData()
  const backup = rawBackup

  const [activeTab, setActiveTab] = useState<TabId>('Multi-Day Calls')
  const [filterType, setFilterType] = useState<string>('all')
  const [modalConfig, setModalConfig] = useState<MultiDayModalConfig | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // QBO-4A.5-RUN-2 — legacy service logs are read straight from backup.serviceLogs
  // each render (no React state array, unlike multi-day `records`). A identity-only
  // resolve mutates that array in place + saveBackupData, so a tick is needed to
  // re-render and recompute `legacyLogs` / each card's customerUuid from the fresh
  // getBackupData() snapshot. Mirrors V15rProjectInner's forceUpdate pattern.
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick((t) => t + 1), [])
  // QBO-2F: shared QuickBooks menu + organization-wide Invoice Drafts manager.
  // `prepareSource` unifies the Service Call AND Legacy Service Log billing surfaces into
  // ONE Prepare Invoice modal + ONE shared Draft Manager (no per-surface managers).
  const [prepareSource, setPrepareSource] = useState<PrepareInvoiceSource | null>(null)
  const qb = useQuickBooksInvoicing()
  const openPrepareCall = useCallback((call: ServiceCallRecord) => {
    qb.clearPrepareDraft()
    setPrepareSource({ kind: 'serviceCall', call })
  }, [qb])
  const openPrepareLog = useCallback((log: BackupServiceLog) => {
    qb.clearPrepareDraft()
    setPrepareSource({ kind: 'service', serviceLog: log })
  }, [qb])
  const closePrepare = useCallback(() => {
    setPrepareSource(null)
    qb.clearPrepareDraft()
  }, [qb])

  // ── Load multi-day records ──────────────────────────────────────────────────
  const [records, setRecords] = useState<ServiceCallRecord[]>(() => {
    if (!backup) return []
    return getLiveMultiDayServiceCalls(loadServiceCallRecords(backup)) as ServiceCallRecord[]
  })

  useRemoteDataRefresh({
    scopeId: 'serviceCallsV2',
    label: 'Service Calls',
    isDirty: !!modalConfig,
    onRemoteDataApplied: () => {
      const fresh = demoMode ? getDemoBackupData() : getBackupData()
      if (!fresh) return
      setRecords(getLiveMultiDayServiceCalls(loadServiceCallRecords(fresh)) as ServiceCallRecord[])
    },
  })

  // Sync records from backup on backup change
  useEffect(() => {
    if (!backup) return
    setRecords(getLiveMultiDayServiceCalls(loadServiceCallRecords(backup)) as ServiceCallRecord[])
  }, [backup])

  // Legacy service logs for the legacy tab
  const legacyLogs: BackupServiceLog[] = backup?.serviceLogs || []
  const gcContacts = backup?.gcContacts || []

  // Settings for rate defaults
  // COST-TRUTH-3: internal labor cost authority is opCost, NEVER billRate.
  // No invented fallback — 0 means opCost is unset; downstream surfaces "Rate not set".
  const laborRate = internalLaborRate(backup?.settings)
  const mileRate = num(backup?.settings?.mileRate || 0.67)

  // ── Persist helper ─────────────────────────────────────────────────────────
  const persist = useCallback((updated: ServiceCallRecord[]) => {
    if (!backup) return
    pushState()
    saveServiceCallRecords(backup, updated)
    saveBackupData(backup)
    setRecords(getLiveMultiDayServiceCalls(updated) as ServiceCallRecord[])
    void saveMultiDayServiceCallsScoped(backup)
  }, [backup])

  // QBO-4A.5 — bind ONE explicitly-resolved PowerOn relationship account UUID onto
  // the current Service Call's canonical accountId field via the EXISTING persist
  // path (saveServiceCallRecords + scoped sync). Resolves ONLY the call the owner
  // chose — no name matching, no bulk backfill, no parallel identity field.
  const resolveCallCustomer = useCallback((callId: string, accountUuid: string) => {
    const updated = records.map(r =>
      r.service_call_id === callId ? { ...r, accountId: accountUuid } : r
    )
    persist(updated)
  }, [records, persist])

  // QBO-4A.5-RUN-2 — bind ONE explicitly-resolved PowerOn relationship account UUID
  // onto the current LEGACY service log's canonical accountId field. The legacy log
  // (BackupServiceLog) gains the SAME canonical accountId used by ServiceCallRecord
  // / BackupProject — no parallel QBO-only identity field. Resolves ONLY the log the
  // owner chose: predicate-scoped map (no name matching, no bulk backfill).
  // IDENTITY-ONLY: financial fields (quoted/collected/mat/payments/status/…) are
  // never touched. Persisted through the existing service.calls scoped-save path
  // (mergeServiceLogsIntoRemote) so a concurrent remote FINANCIAL edit on this same
  // log is NOT clobbered — accountId is layered onto the LWW winner post-merge, and
  // that layering sets only accountId (financial-neutral).
  const resolveLegacyLogCustomer = useCallback(async (logId: string, accountUuid: string) => {
    if (!backup) return
    // 1. Local instant UI: predicate-scoped — ONLY the chosen log gets accountId.
    //    IDENTITY-ONLY: updatedAt is intentionally NOT bumped. Bumping it would make
    //    a stale-local row win LWW over a newer remote FINANCIAL edit on this same
    //    log (clobbering collected/payments/status). Touching only accountId means
    //    the existing LWW winner (by the row's real updatedAt) keeps financial truth;
    //    accountId is layered onto that winner post-merge (step 2) so identity still
    //    persists without ever risking a financial revert.
    backup.serviceLogs = (backup.serviceLogs || []).map((l) =>
      l.id === logId ? { ...l, accountId: accountUuid } : l
    )
    pushState()
    saveBackupData(backup)
    forceUpdate()
    // 2. Remote-baseline scoped sync (service.calls). Fetch latest remote, merge
    //    serviceLogs by id (LWW on financial fields preserved — winner chosen by the
    //    row's real updatedAt, never by this identity edit), then FORCE accountId
    //    onto the chosen log's merged row so identity survives even when the remote
    //    row won LWW. Financial-neutral: only accountId is layered on; no other field
    //    is touched, so quoted/collected/mat/payStatus/payments/balanceDue are the
    //    LWW winner's values verbatim.
    try {
      const remote = await fetchLatestRemoteBackup()
      if (remote.hasRemoteRow && remote.remoteData) {
        const incoming = getBackupData() || backup
        const merged = mergeServiceLogsIntoRemote(remote.remoteData, incoming)
        merged.serviceLogs = (merged.serviceLogs || []).map((l) =>
          l.id === logId ? { ...l, accountId: accountUuid } : l
        )
        await saveBackupWithRemoteBaselineSync(
          merged,
          { remoteUpdatedAt: remote.remoteUpdatedAt, remoteDataLastSavedAt: remote.remoteDataLastSavedAt },
          { source: 'service-logs-remote-merge', changedKey: 'serviceLogs', _scopes: ['service.calls'] },
        )
        return
      }
      saveBackupDataAndSync(getBackupData() || backup, 'serviceLogs', {
        source: 'service.calls', _scopes: ['service.calls'],
      })
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') return
      console.warn('[resolveLegacyLogCustomer] Scoped serviceLogs sync failed; local changes preserved', err)
      try {
        saveBackupDataAndSync(getBackupData() || backup, 'serviceLogs', {
          source: 'service.calls', _scopes: ['service.calls'],
        })
      } catch (fallbackErr) {
        if ((fallbackErr as Error)?.name === 'BackupStorageWriteError') return
        throw fallbackErr
      }
    }
  }, [backup, forceUpdate])

  // Prepare Invoice in-modal Resolve. Both the Service Call source AND the legacy
  // Service Log source now have a safe canonical accountId persistence path
  // (RUN-2 added the legacy path), so in-modal Resolve is wired for both. The
  // Project source is handled in its own host (V15rProjectInner).
  const prepareOnResolveCustomer = useCallback((accountUuid: string) => {
    if (prepareSource?.kind === 'serviceCall') {
      resolveCallCustomer(prepareSource.call.service_call_id, accountUuid)
    } else if (prepareSource?.kind === 'service') {
      void resolveLegacyLogCustomer(prepareSource.serviceLog.id, accountUuid)
    }
  }, [prepareSource, resolveCallCustomer, resolveLegacyLogCustomer])

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
                accounts={gcContacts}
                expanded={expandedIds.has(call.service_call_id)}
                onToggle={() => toggleExpand(call.service_call_id)}
                onAddDay={() => openAddDay(call)}
                onPrepareInvoice={() => openPrepareCall(call)}
                onOpenDrafts={qb.openDrafts}
                laborRate={laborRate}
                onResolveCustomer={(uuid) => resolveCallCustomer(call.service_call_id, uuid)}
              />
            ))
          )}
        </div>
      )}

      {/* Tab: Legacy Log */}
      {activeTab === 'Legacy Log' && (
        <LegacyServiceLogList
          logs={legacyLogs}
          accounts={gcContacts}
          onPrepareInvoice={openPrepareLog}
          onOpenDrafts={qb.openDrafts}
          onResolveCustomer={(logId, accountUuid) => { void resolveLegacyLogCustomer(logId, accountUuid) }}
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

      {/* QBO-2C/2F: ONE Prepare Invoice modal for both Service Call and Legacy Service Log
          billing surfaces. Rehydrates a persisted draft (EDIT mode) when one is selected
          from the shared Draft Manager; rehydrateSource() resolves the source live (by id)
          and falls back to a synthetic source that preserves the saved invoice if it is gone. */}
      <PrepareInvoiceModal
        open={prepareSource != null || qb.prepareDraft != null}
        source={qb.prepareDraft ? null : prepareSource}
        initialDraft={qb.prepareDraft}
        onClose={closePrepare}
        onSaveDraft={qb.handleSaveDraft}
        onApprove={qb.handleApprove}
        onResolveCustomer={(prepareSource?.kind === 'serviceCall' || prepareSource?.kind === 'service') ? prepareOnResolveCustomer : undefined}
      />

      {/* QBO-2F: ONE shared organization-wide Invoice Drafts manager (Project + Service). */}
      <InvoiceDraftsModal
        open={qb.draftsOpen}
        onClose={qb.closeDrafts}
        onOpenDraft={(draft) => {
          // Reopen in the Prepare Invoice modal (EDIT mode) above.
          qb.openDraftForEdit(draft)
        }}
        refreshKey={qb.refreshDraftsKey}
      />

      <div className="text-[10px] text-gray-600 flex items-center gap-1 pb-4">
        <Zap size={10} /> NEXUS AI can analyze service call patterns and margin trends — ask in the chat panel
      </div>
    </div>
  )
}

// ─── ServiceCallCard ──────────────────────────────────────────────────────────

interface CardProps {
  call: ServiceCallRecord
  accounts: any[]
  expanded: boolean
  onToggle: () => void
  onAddDay: () => void
  onPrepareInvoice: () => void
  onOpenDrafts: () => void
  laborRate: number
  /** QBO-4A.5 — persist an explicitly-resolved PowerOn account UUID to this call. */
  onResolveCustomer: (accountUuid: string) => void
}

function ServiceCallCard({ call, accounts, expanded, onToggle, onAddDay, onPrepareInvoice, onOpenDrafts, laborRate, onResolveCustomer }: CardProps) {
  const totals = useMemo(() => getServiceCallTotals(call), [call])
  const scopeFlag = call.scope_creep_flag

  // QBO-4A.4 Task 11 / QBO-4A.6 — contextual QuickBooks customer mapping for this
  // service call. The canonical customer id comes from the call's accountId/customerId
  // (a real relationship_accounts.id — verified against the canonical set, NOT by UUID
  // format; matches serviceBillingAdapter). Name-only calls (no canonical id) get NO
  // menu item; their unresolved state is shown inside Prepare Invoice.
  const canonicalDirectory = useCanonicalCustomerDirectory()
  const canonicalIds = canonicalDirectory.canonicalIds
  const customerUuid = isCanonicalCustomerId(call.accountId, canonicalIds)
    ? call.accountId
    : isCanonicalCustomerId(call.customerId, canonicalIds)
      ? call.customerId
      : null
  const customerMapping = useQuickBooksCustomerMapping({ poweronCustomerId: customerUuid })
  const [linkCustomerOpen, setLinkCustomerOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const customerDirectory: readonly CustomerDirectoryEntry[] = useMemo(
    () => (accounts || []).map((c: any) => ({
      id: String(c.id ?? ''),
      company: c.company || null,
      contact: c.contact || null,
      email: c.email || null,
      phone: c.phone || null,
    })),
    [accounts],
  )
  const customerLinkLabel =
    customerMapping.state.kind === 'linked'
      ? `QuickBooks Customer: ${customerMapping.state.customer.displayName || 'Linked'}`
      : 'Link QuickBooks Customer'

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
              <span className="text-xs font-bold text-gray-200">{resolveCanonicalCustomerName(call, accounts)}</span>
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

        <div className="ml-3 flex shrink-0 items-center gap-2">
          <div onClick={e => e.stopPropagation()}>
            <QuickBooksMenu
              onPrepareInvoice={onPrepareInvoice}
              onOpenDrafts={onOpenDrafts}
              align="right"
              onLinkCustomer={customerUuid ? () => setLinkCustomerOpen(true) : undefined}
              customerLinkLabel={customerLinkLabel}
              onResolveCustomer={!customerUuid ? () => setResolveOpen(true) : undefined}
            />
          </div>
          <div className="text-gray-500">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
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

      {/* QBO-4A.4 Task 11/12 — single reusable Link QuickBooks Customer modal,
          opened from the contextual menu item. NON-GATING. */}
      <LinkQuickBooksCustomerModal
        open={linkCustomerOpen}
        onClose={() => setLinkCustomerOpen(false)}
        api={customerMapping}
        poweronCustomerId={customerUuid}
        customerName={resolveCanonicalCustomerName(call, accounts)}
        customerDirectory={customerDirectory}
      />

      {/* QBO-4A.5/4A.6 — explicit PowerOn customer resolution for a name-only call.
          STATE 1 → owner binds an existing canonical relationship_accounts.id to this
          call's canonical accountId; then the QBO Link workflow above unlocks.
          Directory + canonicalIds come from the shared useCanonicalCustomerDirectory fetch. */}
      <ResolvePowerOnCustomerModal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        currentName={resolveCanonicalCustomerName(call, accounts)}
        directory={canonicalDirectory.directory.length ? canonicalDirectory.directory : customerDirectory}
        canonicalIds={canonicalIds}
        loading={canonicalDirectory.loading}
        onConfirm={(uuid) => { onResolveCustomer(uuid); setResolveOpen(false) }}
      />
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
              {laborRate > 0
                ? <>{day.labor_hours}h × ${laborRate.toFixed(2)} = {fmtMoney(day.labor_cost)}</>
                : <>{day.labor_hours}h · <span className="text-amber-400">Rate not set</span></>}
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
  accounts,
  onPrepareInvoice,
  onOpenDrafts,
  onMigrate,
  onResolveCustomer,
}: {
  logs: BackupServiceLog[]
  accounts: any[]
  onPrepareInvoice: (log: BackupServiceLog) => void
  onOpenDrafts: () => void
  onMigrate: (log: BackupServiceLog) => void
  /** QBO-4A.5-RUN-2 — persist an explicitly-resolved PowerOn account UUID to ONE log. */
  onResolveCustomer: (logId: string, accountUuid: string) => void
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
      {logs.map((l, idx) => (
        <LegacyServiceLogCard
          key={l.id || idx}
          log={l}
          index={idx}
          accounts={accounts}
          onPrepareInvoice={onPrepareInvoice}
          onOpenDrafts={onOpenDrafts}
          onMigrate={onMigrate}
          onResolveCustomer={(uuid) => onResolveCustomer(l.id, uuid)}
        />
      ))}
    </div>
  )
}

// ─── LegacyServiceLogCard ─────────────────────────────────────────────────────

interface LegacyCardProps {
  log: BackupServiceLog
  index: number
  accounts: any[]
  onPrepareInvoice: (log: BackupServiceLog) => void
  onOpenDrafts: () => void
  onMigrate: (log: BackupServiceLog) => void
  /** QBO-4A.5-RUN-2 — persist an explicitly-resolved PowerOn account UUID to this log. */
  onResolveCustomer: (accountUuid: string) => void
}

function LegacyServiceLogCard({ log, index, accounts, onPrepareInvoice, onOpenDrafts, onMigrate, onResolveCustomer }: LegacyCardProps) {
  // QBO-4A.5-RUN-2 / QBO-4A.6 — contextual QuickBooks customer mapping for a legacy
  // service log. The canonical customer id comes from the log's canonical accountId
  // (a real relationship_accounts.id — verified against the canonical set, NOT by
  // UUID format; mirrors ServiceCallCard / the billing adapter). Name-only logs (no
  // canonical id) get the "Resolve Customer for QuickBooks" item (STATE 1); once
  // resolved the menu switches to "Link QuickBooks Customer" (STATE 2). The owner
  // explicitly chooses — no name matching, no auto-select.
  const canonicalDirectory = useCanonicalCustomerDirectory()
  const canonicalIds = canonicalDirectory.canonicalIds
  const customerUuid = isCanonicalCustomerId(log.accountId, canonicalIds) ? log.accountId : null
  const customerMapping = useQuickBooksCustomerMapping({ poweronCustomerId: customerUuid })
  const [linkCustomerOpen, setLinkCustomerOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const customerDirectory: readonly CustomerDirectoryEntry[] = useMemo(
    () => (accounts || []).map((c: any) => ({
      id: String(c.id ?? ''),
      company: c.company || null,
      contact: c.contact || null,
      email: c.email || null,
      phone: c.phone || null,
    })),
    [accounts],
  )
  const customerLinkLabel =
    customerMapping.state.kind === 'linked'
      ? `QuickBooks Customer: ${customerMapping.state.customer.displayName || 'Linked'}`
      : 'Link QuickBooks Customer'

  const balanceDue = num(log.balanceDue) || Math.max(0, num(log.quoted) - num(log.collected))

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-gray-500">SVC-{String(index + 1).padStart(3, '0')}</span>
          <span className="text-xs font-semibold text-gray-300">{resolveCanonicalCustomerName(log, accounts)}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">{log.jtype}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-mono">{log.date}</span>
          <div onClick={e => e.stopPropagation()}>
            <QuickBooksMenu
              onPrepareInvoice={() => onPrepareInvoice(log)}
              onOpenDrafts={onOpenDrafts}
              align="right"
              onLinkCustomer={customerUuid ? () => setLinkCustomerOpen(true) : undefined}
              customerLinkLabel={customerLinkLabel}
              onResolveCustomer={!customerUuid ? () => setResolveOpen(true) : undefined}
            />
          </div>
          <button
            onClick={() => onMigrate(log)}
            className="px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-[9px] font-semibold hover:bg-blue-600/30 transition-colors"
          >
            Migrate →
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] text-center">
        <div>
          <div className="text-gray-500">Hours</div>
          <div className="font-mono text-gray-200">{log.hrs || 0}</div>
        </div>
        <div>
          <div className="text-gray-500">Quoted</div>
          <div className="font-mono text-cyan-400">{fmtMoney(log.quoted || 0)}</div>
        </div>
        <div>
          <div className="text-gray-500">Materials</div>
          <div className="font-mono text-orange-400">{fmtMoney(log.mat || 0)}</div>
        </div>
        <div>
          <div className="text-gray-500">Collected</div>
          <div className="font-mono text-emerald-400">{fmtMoney(log.collected || 0)}</div>
        </div>
        <div>
          <div className="text-gray-500">Balance Due</div>
          <div className={`font-mono font-bold ${balanceDue > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
            {fmtMoney(balanceDue)}
          </div>
        </div>
      </div>
      {log.notes && (
        <div className="mt-2 text-[9px] text-gray-500 italic">{log.notes}</div>
      )}

      {/* QBO-4A.5-RUN-2 — single reusable Link QuickBooks Customer modal, opened from
          the contextual menu item. NON-GATING (mirrors ServiceCallCard). */}
      <LinkQuickBooksCustomerModal
        open={linkCustomerOpen}
        onClose={() => setLinkCustomerOpen(false)}
        api={customerMapping}
        poweronCustomerId={customerUuid}
        customerName={resolveCanonicalCustomerName(log, accounts)}
        customerDirectory={customerDirectory}
      />

      {/* QBO-4A.5-RUN-2/4A.6 — explicit PowerOn customer resolution for a name-only
          legacy log. STATE 1 → owner binds an existing canonical relationship_accounts.id
          to this log's canonical accountId; then the QBO Link workflow above unlocks.
          Directory + canonicalIds come from the shared useCanonicalCustomerDirectory fetch. */}
      <ResolvePowerOnCustomerModal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        currentName={resolveCanonicalCustomerName(log, accounts)}
        directory={canonicalDirectory.directory.length ? canonicalDirectory.directory : customerDirectory}
        canonicalIds={canonicalIds}
        loading={canonicalDirectory.loading}
        onConfirm={(uuid) => { onResolveCustomer(uuid); setResolveOpen(false) }}
      />
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
