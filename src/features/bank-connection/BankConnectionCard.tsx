import { useState } from 'react'
import type { BankAccountSummary, BankConnectionSummary, BankSyncSummary, CashAccountOption } from './useBankConnection'
import { useBankConnection } from './useBankConnection'

const STATUS: Record<BankConnectionSummary['status'], { label: string; color: string; glyph: string }> = {
  healthy: { label: 'Connected', color: 'var(--fin-cash)', glyph: '●' },
  connecting: { label: 'Connecting', color: 'var(--fin-warning)', glyph: '◐' },
  login_required: { label: 'Sign-in needed', color: 'var(--fin-warning)', glyph: '▲' },
  error: { label: 'Needs attention', color: 'var(--fin-negative)', glyph: '▲' },
  disconnected: { label: 'Disconnected', color: 'var(--text-secondary)', glyph: '○' },
}
const btn = 'min-h-[44px] rounded-lg px-4 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/5 disabled:opacity-50'
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)

const TYPE_LABEL: Record<string, string> = { checking: 'Checking', savings: 'Savings', cash: 'Cash', credit_card: 'Credit card', loan: 'Loan', other_asset: 'Other asset', other_liability: 'Other liability' }
const titleCase = (v: string) => v.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const bankKind = (a: BankAccountSummary) => titleCase(a.subtype ?? a.type ?? 'Account')
const bankLabel = (a: BankAccountSummary) => `${a.name ?? a.officialName ?? 'Bank account'}${a.mask ? ` ••••${a.mask}` : ''}`
const cashLabel = (c: CashAccountOption) => `${c.displayName} · ${TYPE_LABEL[c.accountType] ?? titleCase(c.accountType)} · ${c.ownershipContext === 'personal' ? 'Personal' : 'Business'}`

/** One bank account row: shows the BANK side and the CASH OS side separately. Mapping is always an explicit owner choice. */
function AccountRow({ account, cashAccounts, mappedElsewhere, busy, onMap, onUnmap }: {
  account: BankAccountSummary; cashAccounts: CashAccountOption[]; mappedElsewhere: Set<string>; busy: boolean
  onMap: (providerAccountId: string, financialAccountId: string) => Promise<void>; onUnmap: (providerAccountId: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState('')
  const m = account.mapping
  return <li data-testid="bank-account-row" data-mapped={m ? 'true' : 'false'} className="py-2 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate font-semibold"><span className="text-xs font-normal text-[var(--text-secondary)]">Bank account · </span>{bankLabel(account)}</p>
        <p className="text-xs text-[var(--text-secondary)]">{bankKind(account)}{account.live ? '' : ' · No longer connected'}</p>
        <p className="text-xs" data-testid="bank-account-mapping">{m
          ? <><span className="text-[var(--text-secondary)]">Cash OS account → </span><span className="font-semibold">{m.financialAccountName}</span><span style={{ color: 'var(--fin-cash)' }}> · Mapped</span></>
          : <span className="text-[var(--text-secondary)]">Not mapped</span>}</p>
      </div>
      {account.live && !editing && <div className="flex gap-2">
        <button type="button" className={btn} disabled={busy} onClick={() => { setChoice(m?.financialAccountId ?? ''); setEditing(true) }}>{m ? 'Change mapping' : 'Map account'}</button>
        {m && <button type="button" className={btn} disabled={busy} onClick={() => { if (window.confirm('Remove this mapping? Your records and balances are not changed.')) void onUnmap(account.id) }}>Remove mapping</button>}
      </div>}
    </div>
    {editing && <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="bank-account-map-editor">
      <label className="text-xs text-[var(--text-secondary)]" htmlFor={`map-${account.id}`}>Cash OS account</label>
      <select id={`map-${account.id}`} value={choice} onChange={e => setChoice(e.target.value)} className="min-h-[44px] min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm ring-1 ring-[var(--border-primary)]">
        <option value="">Choose a Cash OS account…</option>
        {cashAccounts.map(c => <option key={c.id} value={c.id} disabled={mappedElsewhere.has(c.id) && c.id !== m?.financialAccountId}>{cashLabel(c)}{mappedElsewhere.has(c.id) && c.id !== m?.financialAccountId ? ' (already mapped)' : ''}</option>)}
      </select>
      <button type="button" className={btn} disabled={busy || !choice || choice === m?.financialAccountId} onClick={() => void onMap(account.id, choice).then(() => setEditing(false))}>Save mapping</button>
      <button type="button" className={btn} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
    </div>}
  </li>
}

const SYNC_LABEL: Record<BankSyncSummary['state'], string> = {
  not_synced: 'Not synced yet', syncing: 'Syncing…', waiting: 'Waiting for the bank to prepare your transactions',
  unconfirmed: 'No transactions came back yet. That does not confirm there are none. Try again later.',
  synced: 'Synced', error: 'Last sync failed. You can try again.', login_required: 'Sign-in needed. Use Reconnect.',
}

/** Compact bank-evidence status. It is NOT the ledger: nothing here changes a balance, report or Outlook number. */
function SyncSection({ connectionId, sync, busy, onSync }: { connectionId: string; sync: BankSyncSummary | undefined; busy: boolean; onSync: (id: string) => Promise<void> }) {
  const state = sync?.state ?? 'not_synced'
  const when = sync?.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  return <div className="w-full" data-testid="bank-sync-section" data-state={state}>
    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Transactions · bank evidence</p>
    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
      <div className="min-w-0 text-xs">
        <p data-testid="bank-sync-state">{SYNC_LABEL[state]}{state === 'synced' && when ? <span className="text-[var(--text-secondary)]"> · Last synced {when}</span> : null}</p>
        {sync && (sync.counts.posted > 0 || sync.counts.pending > 0) && <p className="text-[var(--text-secondary)]" data-testid="bank-sync-counts">{sync.counts.posted} posted · {sync.counts.pending} pending</p>}
        {sync?.updatesAvailable && <p style={{ color: 'var(--fin-warning)' }} data-testid="bank-sync-updates">New bank updates are available.</p>}
        <p className="text-[var(--text-secondary)]">Bank evidence only. It does not change your balances, ledger or reports.</p>
      </div>
      <button type="button" className={btn} disabled={busy || state === 'syncing' || state === 'login_required'} onClick={() => void onSync(connectionId)}>{state === 'not_synced' ? 'Sync transactions' : 'Sync again'}</button>
    </div>
  </div>
}

/**
 * Minimal bank connection surface (Sandbox or Production, per server configuration). It renders nothing when the caller cannot manage bank connections or the feature is
 * not configured. Connecting a bank does not change any balance, project, obligation, debt or Outlook number.
 */
export default function BankConnectionCard() {
  const { load, connections, accounts, cashAccounts, findAccounts, mapAccount, unmapAccount, syncs, syncNow, environment, busy, message, connect, reconnect, disconnect } = useBankConnection()
  if (load !== 'ready') return null
  // Only Items of THIS environment are active here. An Item of the other environment (e.g. the earlier Sandbox test) is kept, shown for clarity, and has no actions.
  const here = connections.filter(c => (c.environment ?? 'sandbox') === (environment ?? 'sandbox'))
  const active = here.filter(c => c.status !== 'disconnected')
  const otherEnvironment = connections.filter(c => (c.environment ?? 'sandbox') !== (environment ?? 'sandbox') && c.status !== 'disconnected')
  return <section data-testid="bank-connection-card" aria-label="Bank connection" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Bank connection{environment ? ` · ${environment}` : ''}</h3>
      {active.length === 0 && <button type="button" className={btn} disabled={busy} onClick={() => void connect()} data-testid="bank-connect">{busy ? 'Connecting…' : 'Connect bank'}</button>}
      {active.length > 0 && <button type="button" className={btn} disabled={busy} onClick={() => void connect()} data-testid="bank-connect-another">{busy ? 'Connecting…' : 'Connect another bank'}</button>}
    </div>
    {active.length > 0 && environment === 'production' && <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="bank-connect-another-note">Each connection is billed by Plaid. Connect a bank only once.</p>}
    {active.length === 0 && <p className="mt-2 text-sm text-[var(--text-secondary)]" data-testid="bank-not-connected">Not connected. Connecting a bank does not change any balance or report.</p>}
    <div className="mt-2 divide-y divide-[var(--border-primary)]">{active.map(c => {
      const s = STATUS[c.status]
      return <div key={c.id} data-testid="bank-connection-row" data-status={c.status} className="flex flex-wrap items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{c.institutionName ?? 'Connected bank'}</p>
          <p className="text-xs" style={{ color: s.color }}><span aria-hidden="true">{s.glyph} </span>{s.label}{date(c.connectedAt) ? <span className="text-[var(--text-secondary)]"> · since {date(c.connectedAt)}</span> : null}</p>
        </div>
        <div className="flex gap-2">
          {(c.status === 'login_required' || c.status === 'error') && <button type="button" className={btn} disabled={busy} onClick={() => void reconnect(c.id)}>Reconnect</button>}
          <button type="button" className={btn} disabled={busy} onClick={() => { if (window.confirm('Disconnect this bank? Your history and records are kept.')) void disconnect(c.id) }}>Disconnect</button>
        </div>
        <SyncSection connectionId={c.id} sync={syncs.find(x => x.connectionId === c.id)} busy={busy} onSync={syncNow} />
        <div className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Accounts</p>
            {accounts.some(a => a.connectionId === c.id && a.live) && <button type="button" className={btn} disabled={busy} onClick={() => void findAccounts(c.id)}>Refresh accounts</button>}
          </div>
          {(() => {
            const mine = accounts.filter(a => a.connectionId === c.id && a.live)
            const mappedElsewhere = new Set(accounts.filter(a => a.live && a.mapping).map(a => a.mapping!.financialAccountId))
            return mine.length === 0
              ? <div className="flex flex-wrap items-center gap-2 py-1"><p className="text-xs text-[var(--text-secondary)]" data-testid="bank-no-accounts">No bank accounts loaded yet.</p><button type="button" className={btn} disabled={busy} onClick={() => void findAccounts(c.id)}>Find bank accounts</button></div>
              : <ul className="divide-y divide-[var(--border-primary)]" data-testid="bank-account-list">{mine.map(a => <AccountRow key={a.id} account={a} cashAccounts={cashAccounts} mappedElsewhere={mappedElsewhere} busy={busy} onMap={mapAccount} onUnmap={unmapAccount} />)}</ul>
          })()}
        </div>
      </div>
    })}</div>
    {otherEnvironment.map(c => <div key={c.id} data-testid="bank-other-environment" className="mt-2 border-t border-[var(--border-primary)] pt-2 text-xs text-[var(--text-secondary)]">
      <p>{c.institutionName ?? 'Bank'} · {(c.environment ?? 'sandbox') === 'production' ? 'Production' : 'Sandbox'} test connection. Its history is kept but it is not active here and is never used for your business numbers.</p>
      {/* An account of this connection that still points at a Cash OS account can have that mapping removed (an explicit owner choice, no provider call), so the real account can be mapped instead. */}
      {accounts.filter(a => a.connectionId === c.id && a.mapping).map(a => <p key={a.id} className="mt-1 flex flex-wrap items-center justify-between gap-2" data-testid="bank-other-environment-mapping">
        <span>{bankLabel(a)} → <span className="font-semibold">{a.mapping!.financialAccountName}</span></span>
        <button type="button" className={btn} disabled={busy} onClick={() => { if (window.confirm('Remove this test mapping? Your records, balances and the test history are not changed.')) void unmapAccount(a.id) }}>Remove mapping</button>
      </p>)}
    </div>)}
    {message && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--fin-negative)' }}>{message}</p>}
  </section>
}
