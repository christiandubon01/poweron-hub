import { useState } from 'react'
import { upsertCashProjectFacts } from '@/services/cashProjectFactsService'
import { createCashCommitment } from '@/services/cashObligationService'
import type { CashProjectFactsRow, CollectionConfidence, ProjectBillingType, ProjectReadiness } from '@/finance/cashProjectFacts'
import { money } from './cashOsUi'

export interface LinkedSpend { id: string; title: string; amountMinor: number }

const input = 'mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm'
const label = 'block text-xs font-semibold text-[var(--text-secondary)]'
const hint = 'mt-1 block text-[11px] text-[var(--text-muted)]'

function today(): string { return new Date().toISOString().slice(0, 10) }

function friendly(message: string): string {
  return /cash_project_facts|relation .* does not exist|schema cache/i.test(message)
    ? 'Job details need the latest Cash OS database update before they can be saved.'
    : message
}

/**
 * Plain-question editor for the few things only the owner knows about a job. It saves facts, never money:
 * the remaining balance still comes from the project, and spending is recorded as a real required commitment.
 */
export default function CashOsProjectFactsEditor({ projectId, projectName, facts, linkedSpend, onSaved, onCancel }: {
  projectId: string
  projectName: string
  facts: CashProjectFactsRow | null
  linkedSpend: LinkedSpend[]
  onSaved: () => void | Promise<void>
  onCancel: () => void
}) {
  const [billing, setBilling] = useState<ProjectBillingType | ''>(facts?.billing_type ?? '')
  const [readiness, setReadiness] = useState<ProjectReadiness | ''>(facts?.readiness ?? (facts?.completion_requirement ? 'work_required' : ''))
  const [requirement, setRequirement] = useState(facts?.completion_requirement ?? '')
  const [blocked, setBlocked] = useState(!!facts?.blocked_reason)
  const [blockedReason, setBlockedReason] = useState(facts?.blocked_reason ?? '')
  const [needsSpend, setNeedsSpend] = useState<'' | 'yes' | 'no'>(facts?.needs_spend === true ? 'yes' : facts?.needs_spend === false ? 'no' : '')
  const [hours, setHours] = useState(facts?.work_hours_remaining != null ? String(facts.work_hours_remaining) : '')
  const [expected, setExpected] = useState(facts?.expected_collection_date ?? '')
  const [confidence, setConfidence] = useState<CollectionConfidence | ''>(facts?.collection_confidence ?? '')
  const [nextAction, setNextAction] = useState(facts?.next_action ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [spendTitle, setSpendTitle] = useState('')
  const [spendAmount, setSpendAmount] = useState('')
  const [spendDate, setSpendDate] = useState(today())
  const [spendSaving, setSpendSaving] = useState(false)
  const linkedMinor = linkedSpend.reduce((sum, s) => sum + s.amountMinor, 0)

  async function save() {
    setSaving(true); setError(null)
    const hoursNumber = hours.trim() === '' ? null : Number(hours)
    try {
      await upsertCashProjectFacts(projectId, {
        billingType: billing || null,
        readiness: readiness || null,
        completionRequirement: readiness === 'work_required' ? requirement : null,
        blockedReason: blocked ? blockedReason : null,
        needsSpend: needsSpend === '' ? null : needsSpend === 'yes',
        workHoursRemaining: hoursNumber,
        expectedCollectionDate: expected || null,
        collectionConfidence: confidence || null,
        nextAction,
      })
      await onSaved()
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)))
      setSaving(false)
    }
  }

  async function addSpend() {
    const amount = Math.round(parseFloat(spendAmount.replace(/[^0-9.]/g, '')) * 100)
    if (!spendTitle.trim() || !Number.isFinite(amount) || amount <= 0) { setError('Say what it is and how much.'); return }
    setSpendSaving(true); setError(null)
    try {
      await createCashCommitment({ title: spendTitle.trim(), amountMinor: amount, expectedDate: spendDate,
        isRequired: true, confidence: 'expected', category: 'Materials', projectId })
      setSpendTitle(''); setSpendAmount('')
      await onSaved()
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)))
    } finally {
      setSpendSaving(false)
    }
  }

  return (
    <div data-testid="project-facts-editor" className="mt-3 space-y-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
      <h5 className="text-sm font-semibold">About {projectName}</h5>

      <label className="block">
        <span className={label}>How is this job billed?</span>
        <select value={billing} onChange={e => setBilling(e.target.value as ProjectBillingType | '')} className={input}>
          <option value="">Not sure</option>
          <option value="fixed">Fixed price</option>
          <option value="time_and_material">Time &amp; material</option>
        </select>
        {billing === 'time_and_material' && <span className={hint}>You only earn on work that is done and billed. Future hours are never counted as money owed.</span>}
      </label>

      <label className="block">
        <span className={label}>Can you collect what's left on this job right now?</span>
        <select value={readiness} onChange={e => setReadiness(e.target.value as ProjectReadiness | '')} className={input}>
          <option value="">Not sure</option>
          <option value="work_required">Not yet — something has to happen first</option>
          <option value="ready_to_bill">Yes — it's ready to bill</option>
        </select>
      </label>
      {readiness === 'work_required' && (
        <label className="block">
          <span className={label}>What needs to happen before you can collect?</span>
          <input type="text" maxLength={500} value={requirement} onChange={e => setRequirement(e.target.value)}
            placeholder="e.g. Install remaining lights and receptacles" className={input} />
        </label>
      )}

      <div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
          <input type="checkbox" checked={blocked} onChange={e => setBlocked(e.target.checked)} className="h-4 w-4 accent-orange-500" />
          <span className="text-sm">Something is stopping me from working on this right now</span>
        </label>
        {blocked && (
          <input type="text" maxLength={500} value={blockedReason} onChange={e => setBlockedReason(e.target.value)}
            placeholder="e.g. Waiting on other trades" className={input} aria-label="What is in the way?" />
        )}
      </div>

      <label className="block">
        <span className={label}>Do you need to spend money to finish this job?</span>
        <select value={needsSpend} onChange={e => setNeedsSpend(e.target.value as '' | 'yes' | 'no')} className={input}>
          <option value="">Not sure</option>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </label>
      {needsSpend === 'yes' && (
        <div className="space-y-2 rounded-lg border border-dashed border-[var(--border-primary)] p-3">
          {linkedSpend.length > 0 ? <>
            <p className="text-xs text-[var(--text-secondary)]">Spending already tied to this job ({money(linkedMinor)} total):</p>
            <ul className="list-disc pl-5 text-xs text-[var(--text-secondary)]">
              {linkedSpend.map(s => <li key={s.id}>{s.title} — {money(s.amountMinor)}</li>)}
            </ul>
          </> : <p className="text-xs text-amber-300">Nothing is tied to this job yet, so Cash OS doesn't know how much.</p>}
          <p className={hint}>Add what you'll need to buy. It becomes a required cost for this job (it is a cost, never revenue).</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="text" value={spendTitle} onChange={e => setSpendTitle(e.target.value)} placeholder="What (e.g. Materials)" className={input} aria-label="What will you buy?" />
            <input type="text" inputMode="decimal" value={spendAmount} onChange={e => setSpendAmount(e.target.value)} placeholder="About how much ($)" className={input} aria-label="About how much?" />
            <input type="date" value={spendDate} onChange={e => setSpendDate(e.target.value)} className={input} aria-label="When will you buy it?" />
          </div>
          <button type="button" onClick={addSpend} disabled={spendSaving}
            className="rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs font-semibold hover:bg-white/5 disabled:opacity-50">
            {spendSaving ? 'Adding…' : 'Add this spend'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={label}>About how many hours of work are left?</span>
          <input type="number" min="0" step="0.5" value={hours} onChange={e => setHours(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className={label}>When do you realistically expect to collect?</span>
          <input type="date" value={expected} onChange={e => setExpected(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className={label}>How sure are you?</span>
          <select value={confidence} onChange={e => setConfidence(e.target.value as CollectionConfidence | '')} className={input}>
            <option value="">Not sure</option>
            <option value="high">Very sure</option>
            <option value="medium">Fairly sure</option>
            <option value="low">Not very sure</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className={label}>Next step (optional)</span>
        <input type="text" maxLength={500} value={nextAction} onChange={e => setNextAction(e.target.value)} className={input} />
      </label>

      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className="rounded-lg border border-[var(--border-primary)] px-4 py-2 text-sm hover:bg-white/5">Cancel</button>
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">These answers only help Cash OS explain and suggest. Nothing is moved, paid, or marked collected for you.</p>
    </div>
  )
}
