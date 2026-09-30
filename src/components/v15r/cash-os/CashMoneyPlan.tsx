import { useEffect, useState } from 'react'
import type { CashOsBucket, CashOsEnvelope, CashOsEnvelopeBalance } from '@/finance/cashOsAllocationTypes'
import {
  listCashOsBuckets, createCashOsBucket, updateCashOsBucket, archiveCashOsBucket,
  listCashOsEnvelopes, createCashOsEnvelope, updateCashOsEnvelope, archiveCashOsEnvelope,
  allocateToEnvelope, releaseFromEnvelope, transferBetweenEnvelopes,
  readEnvelopeBalances,
} from '@/services/cashOsAllocationService'
import { CashCard, CashEmpty, money } from './cashOsUi'

// ─── Exported pure helpers (tested independently) ────────────────────────────

export function computeMoneyPlanSummary(totalCashMinor: number, balances: CashOsEnvelopeBalance[]) {
  const allocatedMinor = balances.reduce((s, b) => s + b.balanceMinor, 0)
  const unallocatedMinor = totalCashMinor - allocatedMinor
  const hasDeficit = allocatedMinor > totalCashMinor
  return { allocatedMinor, unallocatedMinor, hasDeficit, deficitMinor: hasDeficit ? allocatedMinor - totalCashMinor : 0 }
}

export function validateRelease(amountMinor: number, balanceMinor: number): string | null {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 'Enter a valid positive amount'
  if (amountMinor > balanceMinor) return 'Cannot release more than the current balance'
  return null
}

export function validateEnvelopeTransfer(
  fromId: string, toId: string, amountMinor: number, sourceBalanceMinor: number,
): string | null {
  if (!toId) return 'Choose a destination envelope'
  if (fromId === toId) return 'Source and destination must differ'
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 'Enter a valid positive amount'
  if (amountMinor > sourceBalanceMinor) return 'Cannot transfer more than the source balance'
  return null
}

export function validateEnvelopeArchive(balanceMinor: number): string | null {
  if (balanceMinor > 0) return `Release the ${money(balanceMinor)} balance before archiving this envelope.`
  return null
}

// ─── Shared UI constants ─────────────────────────────────────────────────────

const inputCls = 'mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm'
const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]'
const btnPrimary = 'rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
const btnGhost = 'rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm hover:bg-white/5'
const btnMicro = 'rounded px-2 py-1 text-xs border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-white/5'

const PRESET_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#a855f7','#ec4899']

function parseDollarsMinor(raw: string): number {
  const v = parseFloat(raw.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(v) || v <= 0) throw new Error('Enter a valid positive amount')
  return Math.round(v * 100)
}

// ─── ColorPicker ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {PRESET_COLORS.map(c => (
        <button type="button" key={c} onClick={() => onChange(value === c ? null : c)}
          title={c}
          className={`h-6 w-6 rounded-full transition-shadow ${value === c ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-[var(--bg-secondary)]' : 'opacity-70 hover:opacity-100'}`}
          style={{ background: c }} />
      ))}
    </div>
  )
}

// ─── Inline confirm strip ─────────────────────────────────────────────────────

function ArchiveConfirm({ label, onConfirm, onCancel, pending }: {
  label: string; onConfirm: () => void; onCancel: () => void; pending: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <span className="flex-1 text-amber-300">Archive {label}?</span>
      <button type="button" onClick={onConfirm} disabled={pending}
        className="rounded px-2 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50">
        {pending ? 'Archiving…' : 'Archive'}
      </button>
      <button type="button" onClick={onCancel} className={btnMicro}>Cancel</button>
    </div>
  )
}

// ─── BucketForm ───────────────────────────────────────────────────────────────

function BucketForm({ bucket, onSuccess, onCancel }: {
  bucket?: CashOsBucket; onSuccess: () => void; onCancel: () => void
}) {
  const [name, setName] = useState(bucket?.name ?? '')
  const [desc, setDesc] = useState(bucket?.description ?? '')
  const [color, setColor] = useState<string | null>(bucket?.color ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setPending(true); setError(null)
    try {
      bucket
        ? await updateCashOsBucket(bucket.id, { name: name.trim(), description: desc || null, color })
        : await createCashOsBucket({ name: name.trim(), description: desc || null, color })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setPending(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
      <label className="block">
        <span className={labelCls}>Name</span>
        <input type="text" required placeholder="e.g. Operations" value={name}
          onChange={e => setName(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Description (optional)</span>
        <input type="text" placeholder="What this bucket is for"
          value={desc} onChange={e => setDesc(e.target.value)} className={inputCls} />
      </label>
      <div>
        <span className={`${labelCls} block mb-1`}>Color (optional)</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending || !name.trim()} className={btnPrimary}>
          {pending ? 'Saving…' : bucket ? 'Save' : 'Create bucket'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}

// ─── EnvelopeForm ─────────────────────────────────────────────────────────────

function EnvelopeForm({ envelope, buckets, onSuccess, onCancel }: {
  envelope?: CashOsEnvelope; buckets: CashOsBucket[]; onSuccess: () => void; onCancel: () => void
}) {
  const [name, setName] = useState(envelope?.name ?? '')
  const [desc, setDesc] = useState(envelope?.description ?? '')
  const [target, setTarget] = useState(
    envelope?.targetAmountMinor != null ? String(envelope.targetAmountMinor / 100) : ''
  )
  const [bucketId, setBucketId] = useState<string | null>(envelope?.bucketId ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    let targetAmountMinor: number | null = null
    if (target.trim()) {
      const v = parseFloat(target.replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(v) || v < 0) { setError('Target must be a non-negative amount'); return }
      targetAmountMinor = Math.round(v * 100)
    }
    setPending(true)
    try {
      const input = { name: name.trim(), description: desc || null, targetAmountMinor, bucketId: bucketId || null }
      envelope ? await updateCashOsEnvelope(envelope.id, input) : await createCashOsEnvelope(input)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setPending(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
      <label className="block">
        <span className={labelCls}>Name</span>
        <input type="text" required placeholder="e.g. Equipment fund"
          value={name} onChange={e => setName(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Description (optional)</span>
        <input type="text" value={desc} onChange={e => setDesc(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Target amount (optional)</span>
        <input type="text" inputMode="decimal" placeholder="0.00"
          value={target} onChange={e => setTarget(e.target.value)} className={inputCls} />
        <span className="mt-1 block text-[10px] text-[var(--text-muted)]">Planning target only — does not affect Total Cash</span>
      </label>
      {buckets.length > 0 && (
        <label className="block">
          <span className={labelCls}>Bucket (optional)</span>
          <select value={bucketId ?? ''} onChange={e => setBucketId(e.target.value || null)} className={inputCls}>
            <option value="">No bucket</option>
            {buckets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending || !name.trim()} className={btnPrimary}>
          {pending ? 'Saving…' : envelope ? 'Save' : 'Create envelope'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}

// ─── AllocateForm ─────────────────────────────────────────────────────────────

function AllocateForm({ envelope, onSuccess, onCancel }: {
  envelope: CashOsEnvelope; onSuccess: () => void; onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    let minor: number
    try { minor = parseDollarsMinor(amount) } catch (err) { setError(err instanceof Error ? err.message : String(err)); return }
    setPending(true)
    try {
      await allocateToEnvelope(envelope.id, minor, note || null)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setPending(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
      <p className="text-xs text-[var(--text-muted)]">Allocate to <strong className="text-[var(--text-primary)]">{envelope.name}</strong>. Total Cash is not affected.</p>
      <label className="block">
        <span className={labelCls}>Amount</span>
        <input type="text" inputMode="decimal" placeholder="0.00" required
          value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Note (optional)</span>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} className={inputCls} />
      </label>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending || !amount} className={btnPrimary}>
          {pending ? 'Allocating…' : 'Allocate'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}

// ─── ReleaseForm ──────────────────────────────────────────────────────────────

function ReleaseForm({ envelope, balanceMinor, onSuccess, onCancel }: {
  envelope: CashOsEnvelope; balanceMinor: number; onSuccess: () => void; onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    let minor: number
    try { minor = parseDollarsMinor(amount) } catch (err) { setError(err instanceof Error ? err.message : String(err)); return }
    const validationError = validateRelease(minor, balanceMinor)
    if (validationError) { setError(validationError); return }
    setPending(true)
    try {
      await releaseFromEnvelope(envelope.id, minor, note || null)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setPending(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
      <p className="text-xs text-[var(--text-muted)]">Release from <strong className="text-[var(--text-primary)]">{envelope.name}</strong>. Balance: {money(balanceMinor)}</p>
      <label className="block">
        <span className={labelCls}>Amount</span>
        <input type="text" inputMode="decimal" placeholder="0.00" required
          value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Note (optional)</span>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} className={inputCls} />
      </label>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending || !amount} className={btnPrimary}>
          {pending ? 'Releasing…' : 'Release'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}

// ─── EnvelopeTransferForm ─────────────────────────────────────────────────────

function EnvelopeTransferForm({ fromEnvelope, envelopes, balanceMap, onSuccess, onCancel }: {
  fromEnvelope: CashOsEnvelope; envelopes: CashOsEnvelope[];
  balanceMap: Map<string, CashOsEnvelopeBalance>; onSuccess: () => void; onCancel: () => void
}) {
  const others = envelopes.filter(e => e.id !== fromEnvelope.id)
  const [toId, setToId] = useState(others[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const srcBalance = balanceMap.get(fromEnvelope.id)?.balanceMinor ?? 0

  if (!others.length) {
    return (
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 space-y-2">
        <p className="text-xs text-[var(--text-muted)]">Create at least one other envelope to transfer allocation between them.</p>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    let minor: number
    try { minor = parseDollarsMinor(amount) } catch (err) { setError(err instanceof Error ? err.message : String(err)); return }
    const validationError = validateEnvelopeTransfer(fromEnvelope.id, toId, minor, srcBalance)
    if (validationError) { setError(validationError); return }
    setPending(true)
    try {
      await transferBetweenEnvelopes(fromEnvelope.id, toId, minor, note || null)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setPending(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
      <p className="text-xs text-[var(--text-muted)]">Transfer from <strong className="text-[var(--text-primary)]">{fromEnvelope.name}</strong>. Balance: {money(srcBalance)}</p>
      <label className="block">
        <span className={labelCls}>To envelope</span>
        <select value={toId} onChange={e => setToId(e.target.value)} className={inputCls}>
          {others.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>Amount</span>
        <input type="text" inputMode="decimal" placeholder="0.00" required
          value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Note (optional)</span>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} className={inputCls} />
      </label>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending || !amount || !toId} className={btnPrimary}>
          {pending ? 'Transferring…' : 'Transfer'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}

// ─── CashMoneyPlan ────────────────────────────────────────────────────────────

type EnvAction = { id: string; mode: 'allocate' | 'release' | 'transfer' }

export default function CashMoneyPlan({ totalCashMinor }: { totalCashMinor: number }) {
  const [buckets, setBuckets] = useState<CashOsBucket[]>([])
  const [envelopes, setEnvelopes] = useState<CashOsEnvelope[]>([])
  const [balances, setBalances] = useState<CashOsEnvelopeBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [addingBucket, setAddingBucket] = useState(false)
  const [editBucket, setEditBucket] = useState<CashOsBucket | null>(null)
  const [archiveBucketId, setArchiveBucketId] = useState<string | null>(null)
  const [archiveBucketPending, setArchiveBucketPending] = useState(false)

  const [addingEnvelope, setAddingEnvelope] = useState(false)
  const [editEnvelope, setEditEnvelope] = useState<CashOsEnvelope | null>(null)
  const [archiveEnvelopeId, setArchiveEnvelopeId] = useState<string | null>(null)
  const [archiveEnvPending, setArchiveEnvPending] = useState(false)

  const [envelopeAction, setEnvelopeAction] = useState<EnvAction | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    Promise.all([listCashOsBuckets(), listCashOsEnvelopes(), readEnvelopeBalances()])
      .then(([b, e, bal]) => { setBuckets(b); setEnvelopes(e); setBalances(bal) })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load Money Plan'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function refresh() {
    setAddingBucket(false); setEditBucket(null); setArchiveBucketId(null)
    setAddingEnvelope(false); setEditEnvelope(null); setArchiveEnvelopeId(null)
    setEnvelopeAction(null)
    load()
  }

  async function confirmArchiveBucket(id: string) {
    setArchiveBucketPending(true)
    try { await archiveCashOsBucket(id); refresh() }
    catch { setArchiveBucketPending(false) }
  }

  async function confirmArchiveEnvelope(id: string) {
    const guard = validateEnvelopeArchive(balanceMap.get(id)?.balanceMinor ?? 0)
    if (guard) { setError(guard); setArchiveEnvelopeId(null); return }
    setArchiveEnvPending(true)
    try { await archiveCashOsEnvelope(id); refresh() }
    catch { setArchiveEnvPending(false) }
  }

  function toggleEnvAction(id: string, mode: EnvAction['mode']) {
    setEnvelopeAction(prev => prev?.id === id && prev.mode === mode ? null : { id, mode })
  }

  const balanceMap = new Map(balances.map(b => [b.envelopeId, b]))
  const { allocatedMinor, unallocatedMinor, hasDeficit } = computeMoneyPlanSummary(totalCashMinor, balances)

  if (loading) return null

  return (
    <CashCard title="Money Plan">
      {error ? (
        <div className="space-y-3">
          <p className="text-sm text-red-300">{error}</p>
          <button type="button" onClick={load} className={btnGhost}>Retry</button>
        </div>
      ) : (
        <>
          {/* Summary row */}
          <div className="mb-5 flex flex-wrap gap-4 rounded-xl border border-[var(--border-primary)] px-4 py-3">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Total Cash</span>
              <strong className="font-mono text-sm">{money(totalCashMinor)}</strong>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Allocated</span>
              <strong className="font-mono text-sm">{money(allocatedMinor)}</strong>
            </div>
            <div>
              {hasDeficit ? (
                <>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-amber-400">Allocation Deficit</span>
                  <strong className="font-mono text-sm text-amber-300">{money(-unallocatedMinor)}</strong>
                </>
              ) : (
                <>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Unallocated</span>
                  <strong className="font-mono text-sm">{money(unallocatedMinor)}</strong>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* ── Buckets ── */}
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Buckets</h4>
                {!addingBucket && (
                  <button type="button" onClick={() => { setEditBucket(null); setAddingBucket(true) }}
                    className={btnMicro}>+ Bucket</button>
                )}
              </div>
              {addingBucket && (
                <div className="mb-3">
                  <BucketForm onSuccess={refresh} onCancel={() => setAddingBucket(false)} />
                </div>
              )}
              {buckets.length ? (
                <div className="space-y-2">
                  {buckets.map(bucket => {
                    const bucketEnvs = envelopes.filter(e => e.bucketId === bucket.id)
                    const bucketTotal = bucketEnvs.reduce((s, e) => s + (balanceMap.get(e.id)?.balanceMinor ?? 0), 0)
                    if (editBucket?.id === bucket.id) {
                      return (
                        <div key={bucket.id}>
                          <BucketForm bucket={bucket} onSuccess={refresh} onCancel={() => setEditBucket(null)} />
                        </div>
                      )
                    }
                    if (archiveBucketId === bucket.id) {
                      return (
                        <div key={bucket.id}>
                          <ArchiveConfirm label={`"${bucket.name}"`}
                            onConfirm={() => confirmArchiveBucket(bucket.id)}
                            onCancel={() => setArchiveBucketId(null)}
                            pending={archiveBucketPending} />
                        </div>
                      )
                    }
                    return (
                      <div key={bucket.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          {bucket.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: bucket.color }} />}
                          <span className="truncate font-medium">{bucket.name}</span>
                          <span className="shrink-0 text-xs text-[var(--text-muted)]">{bucketEnvs.length} env</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="font-mono text-xs">{money(bucketTotal)}</span>
                          <button type="button" onClick={() => { setAddingBucket(false); setEditBucket(bucket) }} className={btnMicro}>Edit</button>
                          <button type="button" onClick={() => setArchiveBucketId(bucket.id)} className={btnMicro}>Archive</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : !addingBucket && <CashEmpty>No buckets yet.</CashEmpty>}
            </div>

            {/* ── Envelopes ── */}
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Envelopes</h4>
                {!addingEnvelope && (
                  <button type="button" onClick={() => { setEditEnvelope(null); setAddingEnvelope(true) }}
                    className={btnMicro}>+ Envelope</button>
                )}
              </div>
              {addingEnvelope && (
                <div className="mb-3">
                  <EnvelopeForm buckets={buckets} onSuccess={refresh} onCancel={() => setAddingEnvelope(false)} />
                </div>
              )}
              {envelopes.length ? (
                <div className="space-y-2">
                  {envelopes.map(env => {
                    const bal = balanceMap.get(env.id)
                    const balMinor = bal?.balanceMinor ?? 0
                    const hasTarget = env.targetAmountMinor != null && env.targetAmountMinor > 0
                    const pct = hasTarget ? Math.min(100, Math.round((balMinor / env.targetAmountMinor!) * 100)) : null
                    const action = envelopeAction?.id === env.id ? envelopeAction.mode : null

                    if (editEnvelope?.id === env.id) {
                      return (
                        <div key={env.id}>
                          <EnvelopeForm envelope={env} buckets={buckets} onSuccess={refresh} onCancel={() => setEditEnvelope(null)} />
                        </div>
                      )
                    }
                    if (archiveEnvelopeId === env.id) {
                      return (
                        <div key={env.id}>
                          <ArchiveConfirm label={`"${env.name}"`}
                            onConfirm={() => confirmArchiveEnvelope(env.id)}
                            onCancel={() => setArchiveEnvelopeId(null)}
                            pending={archiveEnvPending} />
                        </div>
                      )
                    }

                    return (
                      <div key={env.id} className="rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="truncate font-medium">{env.name}</span>
                            {env.bucketId && (() => {
                              const b = buckets.find(bk => bk.id === env.bucketId)
                              return b ? <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">in {b.name}</span> : null
                            })()}
                          </div>
                          <span className="shrink-0 font-mono text-xs">
                            {money(balMinor)}{hasTarget ? ` / ${money(env.targetAmountMinor)}` : ''}
                          </span>
                        </div>
                        {pct !== null && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--border-primary)]">
                            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        {/* Action buttons */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <button type="button" onClick={() => toggleEnvAction(env.id, 'allocate')}
                            className={`${btnMicro} ${action === 'allocate' ? 'border-orange-400/60 text-orange-300' : ''}`}>
                            Allocate
                          </button>
                          <button type="button" onClick={() => toggleEnvAction(env.id, 'release')}
                            className={`${btnMicro} ${action === 'release' ? 'border-orange-400/60 text-orange-300' : ''}`}
                            disabled={balMinor <= 0}>
                            Release
                          </button>
                          <button type="button" onClick={() => toggleEnvAction(env.id, 'transfer')}
                            className={`${btnMicro} ${action === 'transfer' ? 'border-orange-400/60 text-orange-300' : ''}`}>
                            Transfer
                          </button>
                          <button type="button" onClick={() => { setAddingEnvelope(false); setEditEnvelope(env) }}
                            className={btnMicro}>Edit</button>
                          <button type="button" onClick={() => setArchiveEnvelopeId(env.id)}
                            className={btnMicro} disabled={balMinor > 0}>Archive</button>
                        </div>
                        {/* Inline action forms */}
                        {action === 'allocate' && (
                          <div className="mt-2">
                            <AllocateForm envelope={env}
                              onSuccess={refresh}
                              onCancel={() => setEnvelopeAction(null)} />
                          </div>
                        )}
                        {action === 'release' && (
                          <div className="mt-2">
                            <ReleaseForm envelope={env} balanceMinor={balMinor}
                              onSuccess={refresh}
                              onCancel={() => setEnvelopeAction(null)} />
                          </div>
                        )}
                        {action === 'transfer' && (
                          <div className="mt-2">
                            <EnvelopeTransferForm fromEnvelope={env} envelopes={envelopes}
                              balanceMap={balanceMap}
                              onSuccess={refresh}
                              onCancel={() => setEnvelopeAction(null)} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : !addingEnvelope && <CashEmpty>No envelopes yet.</CashEmpty>}
              {envelopes.length > 0 && (
                <p className="mt-3 text-xs text-[var(--text-muted)]">Total allocated: {money(allocatedMinor)}</p>
              )}
            </div>
          </div>
        </>
      )}
    </CashCard>
  )
}
