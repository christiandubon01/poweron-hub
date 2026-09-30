import { useState, type FormEvent } from 'react'
import type { CashOsSessionSetup } from '@/services/cashOsSessionSetup'
import { CASH_OS_TIMEZONE } from '@/services/cashOsReadService'
import type { CashOsReason } from '@/hooks/useCashOsSnapshot'
import { CashCard } from './cashOsUi'

function dollarsToMinor(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, cents = ''] = value.trim().split('.')
  const minor = Number(whole) * 100 + Number(cents.padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

export default function CashOsSetupPanel({ organizationId, storedTimezone, existing, reason, onConfirm }: {
  organizationId: string
  storedTimezone: string | null
  existing: CashOsSessionSetup | null
  reason: CashOsReason | null
  onConfirm: (value: CashOsSessionSetup) => void
}) {
  const [paidThrough, setPaidThrough] = useState(existing?.payrollPaidThroughDate ?? '')
  const [horizon, setHorizon] = useState(existing ? String(existing.protectionHorizonDays) : '')
  const [floor, setFloor] = useState(existing ? String(existing.operatingFloorMinor / 100) : '')
  const [taxKind, setTaxKind] = useState(existing?.taxReserve.kind ?? '')
  const [taxAmount, setTaxAmount] = useState(existing?.taxReserve.kind === 'fixed_amount'
    ? String(existing.taxReserve.amountMinor / 100) : '')
  const [optional, setOptional] = useState(existing ? String(existing.includeOptionalObligations) : '')
  const [openShifts, setOpenShifts] = useState(existing ? String(existing.includeOpenShiftEstimates) : '')
  const [timezoneConfirmed, setTimezoneConfirmed] = useState(existing?.timezoneConfirmed === true)
  const [error, setError] = useState<string | null>(null)
  const mismatch = storedTimezone !== null && storedTimezone !== CASH_OS_TIMEZONE

  function submit(event: FormEvent) {
    event.preventDefault()
    const floorMinor = dollarsToMinor(floor)
    const taxMinor = taxKind === 'fixed_amount' ? dollarsToMinor(taxAmount) : null
    const horizonDays = Number(horizon)
    if (!paidThrough || !/^\d{4}-\d{2}-\d{2}$/.test(paidThrough)
      || !/^\d+$/.test(horizon) || !Number.isSafeInteger(horizonDays)
      || floorMinor === null || !['disabled', 'fixed_amount'].includes(taxKind)
      || (taxKind === 'fixed_amount' && taxMinor === null)
      || !['true', 'false'].includes(optional) || !['true', 'false'].includes(openShifts)
      || !timezoneConfirmed || mismatch) {
      setError('Complete and confirm every assumption with a valid value.')
      return
    }
    try {
      onConfirm({ version: 1, organizationId, payrollPaidThroughDate: paidThrough,
        protectionHorizonDays: horizonDays, operatingFloorMinor: floorMinor,
        taxReserve: taxKind === 'disabled' ? { kind: 'disabled' }
          : { kind: 'fixed_amount', amountMinor: taxMinor! },
        includeOptionalObligations: optional === 'true', includeOpenShiftEstimates: openShifts === 'true',
        timezoneConfirmed: true, confirmedAt: new Date().toISOString() })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save session assumptions.')
    }
  }

  return <CashCard title="Session assumptions" className="max-w-3xl">
    <p className="mb-5 text-sm text-[var(--text-secondary)]">Cash OS needs a few explicit assumptions before it can safely calculate Truly Free Cash. These stay in this browser session for this organization.</p>
    {mismatch && <p className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
      Timekeeping timezone mismatch. The stored organization timezone is {storedTimezone}; timekeeping uses {CASH_OS_TIMEZONE}. Align those authorities before Cash OS can publish protected cash or projections.
    </p>}
    {reason === 'ACCOUNT_SETUP_REQUIRED' && <p className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">No active financial account is configured for cash. Add an included cash account before Outlook can calculate totals.</p>}
    {reason === 'PAYROLL_PAID_THROUGH_REQUIRED' && <p className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">Payroll paid-through authority is required. Enter the last work date whose wages have actually been paid.</p>}
    {reason === 'TIMEZONE_CONFIRMATION_REQUIRED' && <p className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">The organization has no stored timezone. Confirm the current Los Angeles timekeeping date basis for this session.</p>}
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm text-[var(--text-secondary)]">Wages paid through (inclusive work date)
        <input type="date" value={paidThrough} onChange={e => setPaidThrough(e.target.value)} required className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] p-2 text-[var(--text-primary)]" />
      </label>
      <label className="text-sm text-[var(--text-secondary)]">Protection horizon (days)
        <input type="number" min="0" step="1" value={horizon} onChange={e => setHorizon(e.target.value)} required className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] p-2 text-[var(--text-primary)]" />
      </label>
      <label className="text-sm text-[var(--text-secondary)]">Operating floor ($)
        <input inputMode="decimal" value={floor} onChange={e => setFloor(e.target.value)} placeholder="Enter 0 explicitly if disabled" required className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] p-2 text-[var(--text-primary)]" />
      </label>
      <label className="text-sm text-[var(--text-secondary)]">Tax reserve
        <select value={taxKind} onChange={e => setTaxKind(e.target.value)} required className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] p-2 text-[var(--text-primary)]">
          <option value="">Choose explicitly</option><option value="disabled">Disabled</option><option value="fixed_amount">Fixed amount</option>
        </select>
      </label>
      {taxKind === 'fixed_amount' && <label className="text-sm text-[var(--text-secondary)]">Fixed tax reserve ($)
        <input inputMode="decimal" value={taxAmount} onChange={e => setTaxAmount(e.target.value)} required className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] p-2 text-[var(--text-primary)]" />
      </label>}
      <label className="text-sm text-[var(--text-secondary)]">Protect optional obligations?
        <select value={optional} onChange={e => setOptional(e.target.value)} required className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] p-2 text-[var(--text-primary)]">
          <option value="">Choose explicitly</option><option value="true">Yes</option><option value="false">No</option>
        </select>
      </label>
      <label className="text-sm text-[var(--text-secondary)]">Include open shift estimates?
        <select value={openShifts} onChange={e => setOpenShifts(e.target.value)} required className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] p-2 text-[var(--text-primary)]">
          <option value="">Choose explicitly</option><option value="true">Yes</option><option value="false">No</option>
        </select>
      </label>
      <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--text-secondary)] sm:col-span-2">
        <input type="checkbox" checked={timezoneConfirmed} onChange={e => setTimezoneConfirmed(e.target.checked)}
          className="mt-0.5 h-5 w-5 flex-shrink-0 cursor-pointer accent-orange-500" />
        <span>I confirm {CASH_OS_TIMEZONE} is the timekeeping and Cash OS work-date basis{storedTimezone ? ' stored for this organization.' : ' for this session.'}</span>
      </label>
      {error && <p role="alert" className="text-sm text-amber-300 sm:col-span-2">{error}</p>}
      <button disabled={mismatch} type="submit" className="rounded-lg bg-emerald-500 px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2">Confirm session assumptions</button>
    </form>
  </CashCard>
}
