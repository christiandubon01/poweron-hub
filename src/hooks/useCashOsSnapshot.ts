import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { buildCashOsSnapshot, type CashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { CashProjectionConfidenceMode, CashProjectionHorizon } from '@/finance/cashProjectionTypes'
import { readCashOsSources, resolveCashOsScope, CASH_OS_TIMEZONE,
  type CashOsScope, type CashOsSourceBundle } from '@/services/cashOsReadService'
import { cashOsTimezoneReason, clearCashOsSessionSetup, loadCashOsSessionSetup,
  missingCashOsSessionReason, saveCashOsSessionSetup,
  type CashOsSessionSetup } from '@/services/cashOsSessionSetup'

export type CashOsReadiness = 'loading' | 'ready' | 'empty' | 'setup_required' | 'partial' | 'error'
export type CashOsReason =
  | 'SESSION_SETUP_REQUIRED' | 'PAYROLL_PAID_THROUGH_REQUIRED' | 'TIMEZONE_CONFIRMATION_REQUIRED'
  | 'TIMEZONE_MISMATCH' | 'ACCOUNT_SETUP_REQUIRED' | 'BACKUP_NOT_HYDRATED'
  | 'LEDGER_READ_FAILED' | 'OBLIGATION_READ_FAILED' | 'PAYROLL_READ_FAILED'
  | 'PAYROLL_DATA_PARTIAL' | 'SOURCE_READ_FAILED' | 'DEMO_UNAVAILABLE'
  | 'LEDGER_EMPTY'

export interface CashOsState {
  status: CashOsReadiness
  reason: CashOsReason | null
  error: string | null
  scope: CashOsScope | null
  setup: CashOsSessionSetup | null
  sources: CashOsSourceBundle | null
  snapshot: CashOsSnapshot | null
  lastRefreshedAt: string | null
  /** True while a mutation-triggered refresh is reading; the previous state stays mounted. */
  refreshing: boolean
}

const INITIAL: CashOsState = { status: 'loading', reason: null, error: null,
  scope: null, setup: null, sources: null, snapshot: null, lastRefreshedAt: null, refreshing: false }

function initialHorizon(): CashProjectionHorizon {
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 14 : 30
}

function errorReason(message: string): CashOsReason {
  for (const code of ['LEDGER_READ_FAILED', 'OBLIGATION_READ_FAILED', 'PAYROLL_READ_FAILED',
    'BACKUP_NOT_HYDRATED'] as const) if (message.includes(code)) return code
  return 'SOURCE_READ_FAILED'
}

export function useCashOsSnapshot(demoUnavailable: boolean) {
  const [state, setState] = useState<CashOsState>(INITIAL)
  const [horizonDays, setHorizonDays] = useState<CashProjectionHorizon>(initialHorizon)
  const [confidenceMode, setConfidenceMode] = useState<CashProjectionConfidenceMode>('conservative')
  const [refreshSerial, setRefreshSerial] = useState(0)
  const [editing, setEditing] = useState(false)
  const generation = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waiters = useRef<Array<() => void>>([])
  const softRefresh = useRef(false)
  const bump = useCallback(() => setRefreshSerial(n => n + 1), [])
  const settle = useCallback(() => {
    const pending = waiters.current
    waiters.current = []
    for (const resolve of pending) resolve()
  }, [])
  /**
   * Shared mutation-success refresh contract. Resolves once the refreshed Cash OS data (or its
   * terminal error state) has been committed to state, so a mutation surface can `await` it before
   * closing its UI. A refresh superseded by a newer read stays pending until that read lands. The
   * previous workspace stays mounted while reading; it is replaced only by the authoritative result.
   */
  const refresh = useCallback((): Promise<void> => new Promise<void>(resolve => {
    waiters.current.push(resolve)
    softRefresh.current = true
    setRefreshSerial(n => n + 1)
  }), [])

  useEffect(() => {
    if (demoUnavailable) {
      generation.current++
      setState({ ...INITIAL, status: 'setup_required', reason: 'DEMO_UNAVAILABLE' })
      settle()
      return
    }
    const token = ++generation.current
    if (softRefresh.current) setState(prev => ({ ...prev, refreshing: true }))
    else setState({ ...INITIAL, status: 'loading' })
    softRefresh.current = false
    const commit = (next: CashOsState) => { setState(next); settle() }
    const run = async () => {
      let scope: CashOsScope | null = null
      let setup: CashOsSessionSetup | null = null
      let sources: CashOsSourceBundle | null = null
      try {
        const now = new Date()
        scope = await resolveCashOsScope()
        if (token !== generation.current) return
        setup = loadCashOsSessionSetup(scope.context.organizationId)
        const timezoneReason = cashOsTimezoneReason(scope.storedTimezone, setup)
        // Only TIMEZONE_MISMATCH is a hard conflict (stored timezone doesn't match engine).
        // TIMEZONE_CONFIRMATION_REQUIRED is an assumption gap — sources still load,
        // but snapshot is blocked below alongside the missing-setup check.
        if (timezoneReason === 'TIMEZONE_MISMATCH') {
          commit({ ...INITIAL, status: 'setup_required', reason: 'TIMEZONE_MISMATCH', scope, setup })
          return
        }
        // Pass null when payrollPaidThroughDate is unknown — the read service skips
        // payroll queries rather than treating "today" as a meaningful sentinel date.
        const payrollCutoff = setup?.payrollPaidThroughDate ?? null
        sources = await readCashOsSources(scope, payrollCutoff, now)
        if (token !== generation.current) return
        if (!setup || timezoneReason) {
          commit({ ...INITIAL, status: 'setup_required',
            reason: timezoneReason ?? missingCashOsSessionReason(scope.context.organizationId),
            scope, sources })
          return
        }
        if (!sources.accounts.some(a => a.status === 'active' && a.account_class === 'asset' && a.include_in_cash)) {
          commit({ ...INITIAL, status: 'setup_required', reason: 'ACCOUNT_SETUP_REQUIRED', scope, setup, sources })
          return
        }
        const included = new Set(sources.accounts.filter(a => a.status === 'active'
          && a.account_class === 'asset' && a.include_in_cash).map(a => a.id))
        if (!sources.transactions.some(tx => tx.status === 'posted' && included.has(tx.account_id))) {
          commit({ ...INITIAL, status: 'empty', reason: 'LEDGER_EMPTY', scope, setup, sources })
          return
        }
        const snapshot = buildCashOsSnapshot({ ...sources, setup, horizonDays, confidenceMode })
        const payrollPartial = snapshot.payrollDiagnostics.some(d =>
          ['missing_employee_bridge', 'missing_employee_record', 'missing_cash_wage',
            'invalid_time_quantity', 'invalid_work_date', 'invalid_open_session_time',
            'potential_manual_payroll_overlap', 'incomplete_time_entry'].includes(d.kind))
        commit({ status: payrollPartial ? 'partial' : 'ready', refreshing: false,
          reason: payrollPartial ? 'PAYROLL_DATA_PARTIAL' : null, error: null,
          scope, setup, sources, snapshot, lastRefreshedAt: new Date().toISOString() })
      } catch (error) {
        if (token !== generation.current) return
        const message = error instanceof Error ? error.message : String(error)
        commit({ ...INITIAL, status: 'error', reason: errorReason(message),
          error: message, scope, setup, sources })
      }
    }
    void run()
    return () => { generation.current++ }
  }, [demoUnavailable, refreshSerial, horizonDays, confidenceMode, settle])

  // Never leave a mutation surface awaiting a refresh that can no longer land.
  useEffect(() => settle, [settle])

  useEffect(() => {
    if (demoUnavailable) return
    const schedule = () => {
      generation.current++
      setState({ ...INITIAL, status: 'loading' })
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(bump, 120)
    }
    window.addEventListener('poweron-data-saved', schedule)
    window.addEventListener('poweron-remote-data-refreshed', schedule)
    const { data } = supabase.auth.onAuthStateChange(schedule)
    return () => {
      window.removeEventListener('poweron-data-saved', schedule)
      window.removeEventListener('poweron-remote-data-refreshed', schedule)
      data.subscription.unsubscribe()
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [demoUnavailable, bump])

  const confirmSetup = useCallback((setup: CashOsSessionSetup) => {
    if (setup.organizationId !== state.scope?.context.organizationId) throw new Error('Cash OS scope changed')
    saveCashOsSessionSetup(setup)
    setEditing(false)
    bump()
  }, [bump, state.scope?.context.organizationId])

  const resetSetup = useCallback(() => {
    if (!state.scope) return
    clearCashOsSessionSetup(state.scope.context.organizationId)
    setEditing(false)
    bump()
  }, [bump, state.scope])

  return { ...state, horizonDays, setHorizonDays, confidenceMode, setConfidenceMode,
    refresh, editing, setEditing, confirmSetup, resetSetup }
}
