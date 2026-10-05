import { useState } from 'react'
import type { DebtStructure, LiabilityTermsInput, LiabilityTermsRow, PromoType } from '@/finance/liabilityTermsTypes'
import { upsertLiabilityTerms } from '@/services/liabilityTermsService'

interface Props {
  accountId: string
  accountDisplayName: string
  initialTerms: LiabilityTermsRow | null
  onSave: (terms: LiabilityTermsRow) => void | Promise<void>
  onCancel: () => void
}

interface FormState {
  debt_structure: DebtStructure | ''
  apr_pct: string
  promo_apr_pct: string
  promo_type: PromoType | ''
  promo_started_on: string
  promo_expires_on: string
  min_payment_usd: string
  payment_due_day: string
  next_due_date: string
  scheduled_payment_usd: string
  original_principal_usd: string
  maturity_date: string
  owner_notes: string
}

function bpToPct(bp: number | null): string {
  return bp == null ? '' : String(bp / 100)
}

function minorToUsd(minor: number | null): string {
  return minor == null ? '' : String(minor / 100)
}

function pctToBp(s: string): number | null {
  const v = parseFloat(s)
  return s.trim() && !Number.isNaN(v) ? Math.round(v * 100) : null
}

function usdToMinor(s: string): number | null {
  const v = parseFloat(s)
  return s.trim() && !Number.isNaN(v) ? Math.round(v * 100) : null
}

function emptyNull(s: string): string | null {
  return s.trim() || null
}

function intNull(s: string): number | null {
  const v = parseInt(s, 10)
  return s.trim() && !Number.isNaN(v) ? v : null
}

function initForm(t: LiabilityTermsRow | null): FormState {
  return {
    debt_structure: t?.debt_structure ?? '',
    apr_pct: bpToPct(t?.apr_basis_points ?? null),
    promo_apr_pct: bpToPct(t?.promo_apr_basis_points ?? null),
    promo_type: t?.promo_type ?? '',
    promo_started_on: t?.promo_started_on ?? '',
    promo_expires_on: t?.promo_expires_on ?? '',
    min_payment_usd: minorToUsd(t?.minimum_payment_minor ?? null),
    payment_due_day: t?.payment_due_day != null ? String(t.payment_due_day) : '',
    next_due_date: t?.next_due_date ?? '',
    scheduled_payment_usd: minorToUsd(t?.scheduled_payment_minor ?? null),
    original_principal_usd: minorToUsd(t?.original_principal_minor ?? null),
    maturity_date: t?.maturity_date ?? '',
    owner_notes: t?.owner_notes ?? '',
  }
}

const LABEL = 'block text-[10px] font-bold tracking-[0.14em] text-[var(--text-secondary)] mb-1'
const INPUT = 'w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input,var(--bg-card))] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--border-focus,var(--border-primary))]'
const SELECT = INPUT + ' appearance-none'

const PROMO_TYPE_LABELS: Record<PromoType, string> = {
  intro_apr: 'Intro APR — converts to standard APR after deadline',
  deferred_interest: 'Deferred interest — retroactive if not paid in full by deadline',
  reduced_apr_fixed_payment: 'Promo financing — reduced APR with fixed payments',
  other: 'Other promotional arrangement',
}

export default function CashOsDebtTermsEditor({ accountId, accountDisplayName, initialTerms, onSave, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => initForm(initialTerms))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const input: LiabilityTermsInput = {
        debt_structure: (form.debt_structure || null) as DebtStructure | null,
        apr_basis_points: pctToBp(form.apr_pct),
        promo_apr_basis_points: pctToBp(form.promo_apr_pct),
        promo_type: (form.promo_type || null) as PromoType | null,
        promo_started_on: emptyNull(form.promo_started_on),
        promo_expires_on: emptyNull(form.promo_expires_on),
        minimum_payment_minor: usdToMinor(form.min_payment_usd),
        payment_due_day: intNull(form.payment_due_day),
        next_due_date: emptyNull(form.next_due_date),
        scheduled_payment_minor: usdToMinor(form.scheduled_payment_usd),
        original_principal_minor: usdToMinor(form.original_principal_usd),
        maturity_date: emptyNull(form.maturity_date),
        owner_notes: emptyNull(form.owner_notes),
      }
      const saved = await upsertLiabilityTerms(accountId, input)
      await onSave(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const isInstallment = form.debt_structure === 'installment'
  const hasPromo = form.promo_apr_pct.trim() || form.promo_type

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-subtle,var(--bg-card))] p-4">
      <p className="mb-3 text-[10px] font-bold tracking-[0.14em] text-[var(--text-secondary)]">
        EDIT TERMS · {accountDisplayName.toUpperCase()}
      </p>

      <div className="space-y-3">
        {/* Structure */}
        <div>
          <label className={LABEL}>DEBT STRUCTURE</label>
          <select className={SELECT} value={form.debt_structure} onChange={e => set('debt_structure', e.target.value)}>
            <option value="">— not set</option>
            <option value="revolving">Revolving (credit card)</option>
            <option value="installment">Installment (loan)</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* APR */}
        <div>
          <label className={LABEL}>STANDARD / POST-PROMO APR (%)</label>
          <input className={INPUT} type="number" step="0.01" min="0" placeholder="e.g. 24.99"
            value={form.apr_pct} onChange={e => set('apr_pct', e.target.value)} />
        </div>

        {/* Promo APR */}
        <div>
          <label className={LABEL}>PROMO APR (%) — leave blank if no promotion</label>
          <input className={INPUT} type="number" step="0.01" min="0" placeholder="e.g. 0 or 5.99"
            value={form.promo_apr_pct} onChange={e => set('promo_apr_pct', e.target.value)} />
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            For deferred interest the promo APR may be blank — the standard APR above is the retroactive rate.
          </p>
        </div>

        {/* Promo type — only shown when promotion exists */}
        {hasPromo && (
          <>
            <div>
              <label className={LABEL}>PROMOTIONAL STRUCTURE</label>
              <select className={SELECT} value={form.promo_type} onChange={e => set('promo_type', e.target.value)}>
                <option value="">— not specified</option>
                {(Object.entries(PROMO_TYPE_LABELS) as [PromoType, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>PROMO STARTED ON</label>
                <input className={INPUT} type="date" value={form.promo_started_on}
                  onChange={e => set('promo_started_on', e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>PROMO DEADLINE / EXPIRY</label>
                <input className={INPUT} type="date" value={form.promo_expires_on}
                  onChange={e => set('promo_expires_on', e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* Payment row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>{isInstallment ? 'CONTRACTUAL PAYMENT ($)' : 'MIN. PAYMENT ($)'}</label>
            <input className={INPUT} type="number" step="0.01" min="0" placeholder="e.g. 250"
              value={form.min_payment_usd} onChange={e => set('min_payment_usd', e.target.value)} />
          </div>
          <div>
            <label className={LABEL}>DUE DAY (1–31)</label>
            <input className={INPUT} type="number" min="1" max="31" placeholder="e.g. 15"
              value={form.payment_due_day} onChange={e => set('payment_due_day', e.target.value)} />
          </div>
        </div>

        {/* Next due date */}
        <div>
          <label className={LABEL}>NEXT DUE DATE (if irregular)</label>
          <input className={INPUT} type="date" value={form.next_due_date}
            onChange={e => set('next_due_date', e.target.value)} />
        </div>

        {/* Installment-specific */}
        {isInstallment && (
          <div className="space-y-3 border-t border-[var(--border-primary)] pt-3">
            <p className="text-[10px] font-bold tracking-[0.14em] text-[var(--text-secondary)]">LOAN DETAILS</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>SCHEDULED PAYMENT ($)</label>
                <input className={INPUT} type="number" step="0.01" min="0" placeholder="e.g. 450"
                  value={form.scheduled_payment_usd} onChange={e => set('scheduled_payment_usd', e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>ORIGINAL PRINCIPAL ($)</label>
                <input className={INPUT} type="number" step="0.01" min="0" placeholder="e.g. 28000"
                  value={form.original_principal_usd} onChange={e => set('original_principal_usd', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={LABEL}>MATURITY DATE</label>
              <input className={INPUT} type="date" value={form.maturity_date}
                onChange={e => set('maturity_date', e.target.value)} />
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className={LABEL}>OWNER NOTES</label>
          <textarea className={INPUT + ' resize-none'} rows={2} placeholder="Unusual terms, context…"
            value={form.owner_notes} onChange={e => set('owner_notes', e.target.value)} />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-500">{error}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover,var(--bg-card))]">
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="rounded-lg bg-[var(--accent,#4f46e5)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 hover:opacity-90">
          {saving ? 'Saving…' : 'Save terms'}
        </button>
      </div>
    </div>
  )
}
