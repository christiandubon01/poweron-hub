import { useState } from 'react'
import type { AccountAdditionPreview, BankAccountSummary, BankBalanceSummary, BankConnectionSummary, BankSyncSummary, CashAccountOption, HistoryRecoverySummary, SharedAccountView } from './useBankConnection'
import { useBankConnection } from './useBankConnection'
import { buildAttention } from '../../services/bankProvider/attention'

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

const sharedLabel = (a: SharedAccountView) => `${a.name ?? a.officialName ?? 'Bank account'}${a.mask ? ` ••••${a.mask}` : ''} · ${titleCase(a.subtype ?? a.type ?? 'Account')}`

/**
 * PLAID-1A: what the bank shares now for ONE existing connection versus what Cash OS stores. Read-only until the owner presses Save, which stores
 * only the newly shared accounts as bank evidence, unmapped (so they stay out of every report until the owner maps them).
 */
function AddAccountsPreview({ preview, busy, onSave, onClose }: { preview: AccountAdditionPreview; busy: boolean; onSave: () => Promise<void>; onClose: () => void }) {
  const list = (items: SharedAccountView[], testid: string, extra?: (a: SharedAccountView) => string) => <ul className="mt-1 space-y-1 text-xs" data-testid={testid}>
    {items.map((a, i) => <li key={`${testid}-${i}`}>{sharedLabel(a)}{extra ? extra(a) : ''}</li>)}
  </ul>
  return <div className="mt-2 w-full rounded-lg p-3 ring-1 ring-[var(--border-primary)]" data-testid="bank-add-preview">
    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Shared accounts at this bank</p>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">{preview.itemPreserved ? 'Same connection confirmed. Existing accounts, history and decisions are unchanged.' : 'The connection could not be confirmed.'}</p>
    <p className="mt-2 text-sm font-semibold">Already connected ({preview.connected.length})</p>
    {preview.connected.length ? list(preview.connected, 'bank-add-connected', a => a.mapped ? ' · Mapped' : ' · Not mapped') : <p className="text-xs text-[var(--text-secondary)]">None.</p>}
    <p className="mt-2 text-sm font-semibold">Newly shared ({preview.available.length})</p>
    {preview.available.length
      ? <>{list(preview.available, 'bank-add-available', a => a.previouslyConnected ? ' · Connected before' : '')}<p className="mt-1 text-xs text-[var(--text-secondary)]">Saving adds them as bank evidence only. They are not mapped and are not included in any report until you map them. No transactions are imported or categorized by saving.</p></>
      : <p className="text-xs text-[var(--text-secondary)]">No new accounts are shared yet.</p>}
    {preview.noLongerShared.length > 0 && <div className="mt-2" role="alert" style={{ color: 'var(--fin-warning)' }} data-testid="bank-add-no-longer-shared">
      <p className="text-sm font-semibold">No longer shared ({preview.noLongerShared.length})</p>
      {list(preview.noLongerShared, 'bank-add-no-longer-shared-list', a => a.mapped ? ' · Mapped' : '')}
      <p className="mt-1 text-xs">These were not removed. Add accounts again and keep them selected at the bank, so they keep updating.</p>
    </div>}
    {preview.skipped > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]">{preview.skipped} account(s) in another currency are not supported and were left out.</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {preview.available.length > 0 && <button type="button" className={btn} disabled={busy || !preview.itemPreserved} onClick={() => void onSave()} data-testid="bank-add-save">Save {preview.available.length} new account{preview.available.length === 1 ? '' : 's'}</button>}
      <button type="button" className={btn} disabled={busy} onClick={onClose}>Close</button>
    </div>
  </div>
}

const SYNC_LABEL: Record<BankSyncSummary['state'], string> = {
  not_synced: 'Not synced yet', syncing: 'Syncing…', waiting: 'Waiting for the bank to prepare your transactions',
  unconfirmed: 'No transactions came back yet. That does not confirm there are none. Try again later.',
  synced: 'Synced', error: 'Last sync failed. You can try again.', login_required: 'Sign-in needed. Use Reconnect.',
  partial: 'Sync paused partway. Press Sync to continue; nothing from it appears in Cash OS until it finishes.',
}

/** Compact bank-evidence status. It is NOT the ledger: nothing here changes a balance, report or Outlook number. */
function SyncSection({ connectionId, sync, busy, onSync, onDiscard }: { connectionId: string; sync: BankSyncSummary | undefined; busy: boolean; onSync: (id: string) => Promise<void>; onDiscard?: (id: string, runId: string) => Promise<void> }) {
  const state = sync?.state ?? 'not_synced'
  const when = sync?.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  return <div className="w-full" data-testid="bank-sync-section" data-state={state}>
    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Transactions · bank evidence</p>
    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
      <div className="min-w-0 text-xs">
        <p data-testid="bank-sync-state">{SYNC_LABEL[state]}{state === 'synced' && when ? <span className="text-[var(--text-secondary)]"> · Last synced {when}</span> : null}</p>
        {sync && (sync.counts.posted > 0 || sync.counts.pending > 0) && <p className="text-[var(--text-secondary)]" data-testid="bank-sync-counts">{sync.counts.posted} posted · {sync.counts.pending} pending</p>}
        {state === 'partial' && sync?.progress && <p className="text-[var(--text-secondary)]" data-testid="bank-sync-progress">{sync.progress.pagesStaged} page(s) received so far{sync.progress.phase === 'ready_to_apply' ? ' · ready to finish' : ''}.</p>}
        {sync?.blocked && <div role="alert" style={{ color: 'var(--fin-warning)' }} data-testid="bank-sync-blocked">
          <p className="font-semibold">This bank update is waiting for your review</p>
          <p>{sync.blocked.reason === 'RUN_TOO_LARGE'
            ? `It holds ${sync.blocked.stagedRows.toLocaleString('en-US')} changes (${sync.blocked.pagesStaged} pages), more than Cash OS applies in one step. Nothing from it was saved.`
            : `Saving it failed ${sync.blocked.applyFailures} times. Nothing from it was saved.`} Your saved position and records are unchanged.</p>
          <p>{sync.blocked.reason === 'RUN_TOO_LARGE'
            ? 'Discarding it will not make it smaller: syncing again fetches the same update and stops at the same limit until a larger limit is approved separately.'
            : 'You can discard it and sync again to fetch it fresh.'}</p>
          {onDiscard && <button type="button" className={btn} disabled={busy} data-testid="bank-sync-discard" onClick={() => { if (window.confirm('Discard this unsaved bank update? Your saved records and position are not changed.')) void onDiscard(connectionId, sync.blocked!.runId) }}>Discard this update</button>}
        </div>}
        {sync?.updatesAvailable && <p style={{ color: 'var(--fin-warning)' }} data-testid="bank-sync-updates">New bank updates are available.</p>}
        {state === 'error' && sync?.recoveryText && <p style={{ color: 'var(--fin-warning)' }} data-testid="bank-sync-recovery">{sync.recoveryText}{sync.lastErrorCode ? ` (code ${sync.lastErrorCode})` : ''}</p>}
        {state !== 'synced' && sync?.lastSyncedAt && <p className="text-[var(--text-secondary)]" data-testid="bank-sync-last-success">Last successful sync {new Date(sync.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
        <p className="text-[var(--text-secondary)]">Bank evidence only. It does not change your balances, ledger or reports.</p>
      </div>
      <button type="button" className={btn} disabled={busy || state === 'syncing' || state === 'login_required'} onClick={() => void onSync(connectionId)}>{state === 'not_synced' ? 'Sync transactions' : 'Sync again'}</button>
    </div>
  </div>
}

const usd = (minor: number) => `${minor < 0 ? '-' : ''}$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const FRESH: Record<BankBalanceSummary['freshness'], { label: string; color: string }> = {
  fresh: { label: 'Fresh', color: 'var(--fin-cash)' }, aging: { label: 'Getting old', color: 'var(--fin-warning)' },
  stale: { label: 'Stale', color: 'var(--fin-negative)' }, unknown: { label: 'No balance yet', color: 'var(--text-secondary)' },
}
const asOf = (b: BankBalanceSummary) => b.observedAt ? `${b.observedIsProvider ? 'bank-reported' : 'retrieved'} ${new Date(b.observedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : null

/**
 * PLAID-2E: the bank's own balances, kept in three different kinds. Bank cash is money in the account; a card balance is DEBT; unused credit is
 * borrowing capacity. None of them is added to another, and none of them is profit. Shown only when the server has balances switched on.
 */
function BalancesSection({ connectionId, balances, busy, onRefresh }: { connectionId: string; balances: BankBalanceSummary[]; busy: boolean; onRefresh: (id: string) => Promise<void> }) {
  const mine = balances.filter(b => b.connectionId === connectionId)
  const label = (b: BankBalanceSummary) => `${b.name ?? 'Account'}${b.mask ? ` ••••${b.mask}` : ''}`
  const meta = (b: BankBalanceSummary) => <span className="text-xs" style={{ color: FRESH[b.freshness].color }} data-testid="bank-balance-freshness"><span aria-hidden="true">● </span>{FRESH[b.freshness].label}{asOf(b) ? <span className="text-[var(--text-secondary)]"> · {asOf(b)}</span> : null}</span>
  const cash = mine.filter(b => b.accountClass === 'bank_cash'), cards = mine.filter(b => b.accountClass === 'credit_card'), loans = mine.filter(b => b.accountClass === 'loan')
  return <div className="w-full" data-testid="bank-balances-section">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Balances · bank evidence</p>
      <button type="button" className={btn} disabled={busy} onClick={() => void onRefresh(connectionId)} data-testid="bank-balances-refresh">Refresh balances</button>
    </div>
    {mine.length === 0 && <p className="py-1 text-xs text-[var(--text-secondary)]" data-testid="bank-balances-empty">No balances yet. Refresh to read what the bank reports.</p>}
    {cash.length > 0 && <div className="py-1" data-testid="bank-balances-cash"><p className="text-sm font-semibold">Bank cash</p><ul>{cash.map(b => <li key={b.accountRef} className="text-xs" data-testid="bank-balance-row">
      <span className="font-semibold">{label(b)}</span>{b.restricted ? <span className="text-[var(--text-secondary)]"> · restricted (not spendable cash)</span> : null}: {b.bankBalanceMinor === null ? 'unknown' : usd(b.bankBalanceMinor)} in the account
      · available {b.availableMinor === null ? 'not reported by the bank' : usd(b.availableMinor)} · {meta(b)}</li>)}</ul></div>}
    {cards.length > 0 && <div className="py-1" data-testid="bank-balances-cards"><p className="text-sm font-semibold">Credit cards · what you owe</p><ul>{cards.map(b => <li key={b.accountRef} className="text-xs" data-testid="bank-balance-row">
      <span className="font-semibold">{label(b)}</span>: owe {b.owedMinor === null ? 'unknown' : usd(b.owedMinor)}{b.creditInFavourMinor ? ` (credit in your favour ${usd(b.creditInFavourMinor)})` : ''}
      {b.unusedCreditMinor !== null ? <> · unused credit {usd(b.unusedCreditMinor)} <span className="text-[var(--text-secondary)]">(not cash)</span></> : null} · {meta(b)}</li>)}</ul></div>}
    {loans.length > 0 && <div className="py-1" data-testid="bank-balances-loans"><p className="text-sm font-semibold">Loans · what you owe</p><ul>{loans.map(b => <li key={b.accountRef} className="text-xs" data-testid="bank-balance-row">
      <span className="font-semibold">{label(b)}</span>: owe {b.owedMinor === null ? 'unknown' : usd(b.owedMinor)} · {meta(b)}</li>)}</ul></div>}
    <p className="text-xs text-[var(--text-secondary)]">Account balances are not profit. They do not change your ledger, Cash OS accounts or reports.</p>
  </div>
}

const RECOVERY_LABEL: Record<HistoryRecoverySummary['state'], string> = {
  link_pending: 'Waiting for Wells Fargo authorization', accounts_pending: 'Loading replacement accounts', account_review: 'Account confirmation required',
  syncing: 'Importing available history', transaction_review: 'Overlap review required', ready: 'Verified and ready to activate',
  activated: 'Recovered history active', error: 'Recovery needs attention', cancelled: 'Recovery cancelled',
}

function HistoryRecoveryPanel({ recovery, accounts, busy, balancesEnabled, onConfirmAccount, onConfirmTransaction, onSync, onRefreshBalances, onReconcile, onActivate }: {
  recovery: HistoryRecoverySummary; accounts: BankAccountSummary[]; busy: boolean
  balancesEnabled: boolean
  onConfirmAccount: (recoveryId: string, matchId: string, replacementAccountId: string) => Promise<void>
  onConfirmTransaction: (recoveryId: string, matchId: string) => Promise<void>
  onSync: (itemId: string) => Promise<void>; onRefreshBalances: (itemId: string) => Promise<void>; onReconcile: (recoveryId: string) => Promise<void>; onActivate: (recoveryId: string) => Promise<void>
}) {
  const replacementAccounts = accounts.filter(a => a.connectionId === recovery.replacementItemId)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const allAccountsConfirmed = recovery.accounts.length > 0 && recovery.accounts.every(a => a.status === 'confirmed')
  return <div className="w-full rounded-lg p-3 ring-1 ring-[var(--border-primary)]" data-testid="bank-history-recovery" data-state={recovery.state}>
    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Older bank history · up to 730 days</p>
    <p className="mt-1 text-sm font-semibold">{RECOVERY_LABEL[recovery.state]}</p>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">Wells Fargo may return less history. Your existing connection, mappings, classifications and evidence remain in place until verified activation. The original connection is never removed automatically.</p>
    <p className="mt-1 text-xs" style={{ color: 'var(--fin-warning)' }}>A replacement Item may affect Plaid billing.</p>
    {recovery.errorCode && <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--fin-negative)' }}>Recovery error: {recovery.errorCode}</p>}
    {recovery.accounts.length > 0 && <ul className="mt-2 divide-y divide-[var(--border-primary)]" data-testid="bank-history-coverage">{recovery.accounts.map(a => <li key={a.id} className="py-2 text-xs">
      <p className="font-semibold">{a.oldLabel} → {a.financialAccountName}</p>
      <p className="text-[var(--text-secondary)]">Replacement: {a.newLabel ?? 'Needs owner selection'} · {a.status === 'confirmed' ? 'Identity confirmed' : 'Confirm this account'}</p>
      <p data-testid="bank-history-dates">Actual imported coverage: {a.oldestDate ?? 'not imported yet'} to {a.newestDate ?? 'not imported yet'} · {a.transactionCount.toLocaleString('en-US')} transaction(s)</p>
      {a.status === 'review' && a.newAccountId && <button type="button" className={`${btn} mt-1`} disabled={busy} onClick={() => void onConfirmAccount(recovery.id, a.id, a.newAccountId!)}>Confirm account match</button>}
      {a.status === 'review' && !a.newAccountId && replacementAccounts.length > 0 && <div className="mt-1 flex flex-wrap items-center gap-2">
        <span style={{ color: 'var(--fin-warning)' }}>More than one account could match.</span>
        <select aria-label={`Replacement for ${a.oldLabel}`} value={choices[a.id] ?? ''} onChange={e => setChoices(v => ({ ...v, [a.id]: e.target.value }))} className="min-h-[44px] rounded-lg bg-transparent px-2 ring-1 ring-[var(--border-primary)]">
          <option value="">Choose replacement account…</option>
          {replacementAccounts.map(candidate => <option key={candidate.id} value={candidate.id}>{bankLabel(candidate)}</option>)}
        </select>
        <button type="button" className={btn} disabled={busy || !choices[a.id]} onClick={() => void onConfirmAccount(recovery.id, a.id, choices[a.id])}>Confirm selected account</button>
      </div>}
    </li>)}</ul>}
    {(recovery.overlap.confirmed > 0 || recovery.overlap.review > 0 || recovery.overlap.missingFromReplacement > 0) && <p className="mt-2 text-xs" data-testid="bank-history-overlap">
      Overlap: {recovery.overlap.confirmed} conservatively matched · {recovery.overlap.review} ambiguous · {recovery.overlap.missingFromReplacement} existing transaction(s) not returned by the replacement.
    </p>}
    {recovery.transactionReview?.length > 0 && <div className="mt-2" data-testid="bank-history-transaction-review">
      <p className="text-xs font-semibold">Ambiguous overlap · owner confirmation required</p>
      <p className="text-xs text-[var(--text-secondary)]">These full provider facts are identical but the provider identities differ. Confirm only the one-to-one pair you recognize; nothing is merged or deleted.</p>
      <ul className="mt-1 divide-y divide-[var(--border-primary)]">{recovery.transactionReview.map(t => <li key={t.id} className="py-1 text-xs">
        <span className="font-semibold">{t.accountLabel}</span> · {t.date} · {t.name} · {usd(t.amountMinor)} · evidence {t.sourceRef} → {t.replacementRef}
        <button type="button" className={`${btn} ml-2`} disabled={busy} onClick={() => void onConfirmTransaction(recovery.id, t.id)}>Confirm this pair</button>
      </li>)}</ul>
    </div>}
    <div className="mt-2 flex flex-wrap gap-2">
      {recovery.replacementItemId && allAccountsConfirmed && !['ready', 'activated'].includes(recovery.state) && <button type="button" className={btn} disabled={busy} data-testid="bank-history-sync" onClick={() => void onSync(recovery.replacementItemId!).then(() => onReconcile(recovery.id))}>Sync and verify older history</button>}
      {balancesEnabled && recovery.replacementItemId && recovery.state !== 'activated' && <button type="button" className={btn} disabled={busy} data-testid="bank-history-balances" onClick={() => void onRefreshBalances(recovery.replacementItemId!).then(() => onReconcile(recovery.id))}>Refresh replacement balances</button>}
      {recovery.replacementItemId && recovery.state === 'transaction_review' && <button type="button" className={btn} disabled={busy} onClick={() => void onReconcile(recovery.id)}>Recheck overlap</button>}
      {recovery.state === 'ready' && <button type="button" className={btn} disabled={busy} data-testid="bank-history-activate" onClick={() => {
        if (window.confirm('Activate the verified replacement mappings? The original connection and all of its evidence will be retained. It will not be disconnected.')) void onActivate(recovery.id)
      }}>Activate recovered history</button>}
    </div>
  </div>
}

/**
 * Minimal bank connection surface (Sandbox or Production, per server configuration). It renders nothing when the caller cannot manage bank connections or the feature is
 * not configured. Connecting a bank does not change any balance, project, obligation, debt or Outlook number.
 */
export default function BankConnectionCard() {
  const { load, connections, accounts, cashAccounts, findAccounts, mapAccount, unmapAccount, syncs, syncNow, environment, busy, message, connect, reconnect, disconnect,
    accountAdditionsEnabled, addPreview, addAccounts, reviewSharedAccounts, saveNewAccounts, dismissPreview, syncProgress, balancesEnabled, balances, refreshBalancesNow, discardBlocked,
    historyRecoveryEnabled, recoveries, recoverHistory, confirmRecoveryAccount, confirmRecoveryTransaction, reconcileRecovery, activateRecovery } = useBankConnection()
  if (load !== 'ready') return null
  // Only Items of THIS environment are active here. An Item of the other environment (e.g. the earlier Sandbox test) is kept, shown for clarity, and has no actions.
  const here = connections.filter(c => (c.environment ?? 'sandbox') === (environment ?? 'sandbox'))
  const hiddenReplacementIds = new Set(recoveries.filter(r => r.state !== 'activated').map(r => r.replacementItemId).filter((v): v is string => !!v))
  const active = here.filter(c => c.status !== 'disconnected' && !hiddenReplacementIds.has(c.id))
  const otherEnvironment = connections.filter(c => (c.environment ?? 'sandbox') !== (environment ?? 'sandbox') && c.status !== 'disconnected')
  return <section data-testid="bank-connection-card" aria-label="Bank connection" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Bank connection{environment ? ` · ${environment}` : ''}</h3>
      {active.length === 0 && <button type="button" className={btn} disabled={busy} onClick={() => void connect()} data-testid="bank-connect">{busy ? 'Connecting…' : 'Connect bank'}</button>}
      {active.length > 0 && <button type="button" className={btn} disabled={busy} data-testid="bank-connect-another" onClick={() => {
        // PLAID-1A: a second connection to a bank that is already connected would duplicate it. The server refuses that too.
        const names = active.map(c => c.institutionName ?? 'a bank').join(', ')
        if (window.confirm(`You are already connected to ${names}. To add more accounts from the same bank login, use “Add accounts” on that connection instead. Continue only to connect a DIFFERENT bank.`)) void connect(true)
      }}>{busy ? 'Connecting…' : 'Connect another bank'}</button>}
    </div>
    {(() => {
      const items = buildAttention({ connections: active, syncs, balances: balancesEnabled ? balances : undefined, nowMs: Date.now() })
      return items.length > 0 ? <ul className="mt-2 space-y-1 text-xs" data-testid="bank-attention" aria-label="Needs attention">{items.map(i => <li key={i.id} data-severity={i.severity}
        style={{ color: i.severity === 'action' ? 'var(--fin-negative)' : i.severity === 'warning' ? 'var(--fin-warning)' : 'var(--text-secondary)' }}><span aria-hidden="true">{i.severity === 'info' ? '○ ' : '▲ '}</span>{i.message}</li>)}</ul> : null
    })()}
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
          {accountAdditionsEnabled && c.status === 'healthy' && <button type="button" className={btn} disabled={busy} onClick={() => void addAccounts(c.id)} data-testid="bank-add-accounts">Add accounts at this bank</button>}
          {accountAdditionsEnabled && c.status === 'healthy' && <button type="button" className={btn} disabled={busy} onClick={() => void reviewSharedAccounts(c.id)} data-testid="bank-review-shared">Review shared accounts</button>}
          {historyRecoveryEnabled && environment === 'production' && c.status === 'healthy' && !recoveries.some(r => r.sourceItemId === c.id && !['activated', 'cancelled'].includes(r.state)) && <button type="button" className={btn} disabled={busy} onClick={() => {
            if (window.confirm('Recover older bank history by authorizing Wells Fargo again? This requests up to 730 days, may affect Plaid billing, and will not remove the current connection.')) void recoverHistory(c.id)
          }} data-testid="bank-history-start">Recover older bank history</button>}
          <button type="button" className={btn} disabled={busy} onClick={() => { if (window.confirm('Disconnect this bank? Your history and records are kept.')) void disconnect(c.id) }}>Disconnect</button>
        </div>
        {recoveries.filter(r => r.sourceItemId === c.id && r.state !== 'cancelled').map(r => <HistoryRecoveryPanel key={r.id} recovery={r} accounts={accounts} busy={busy} balancesEnabled={balancesEnabled} onConfirmAccount={confirmRecoveryAccount} onConfirmTransaction={confirmRecoveryTransaction} onSync={syncNow} onRefreshBalances={refreshBalancesNow} onReconcile={reconcileRecovery} onActivate={activateRecovery} />)}
        {addPreview?.itemId === c.id && <AddAccountsPreview preview={addPreview} busy={busy} onSave={saveNewAccounts} onClose={dismissPreview} />}
        <SyncSection connectionId={c.id} sync={syncs.find(x => x.connectionId === c.id)} busy={busy} onSync={syncNow} onDiscard={discardBlocked} />
        {balancesEnabled && c.status !== 'disconnected' && <BalancesSection connectionId={c.id} balances={balances} busy={busy} onRefresh={refreshBalancesNow} />}
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
    {syncProgress && <p role="status" className="mt-2 text-sm text-[var(--text-secondary)]" data-testid="bank-sync-step-progress">{syncProgress}</p>}
    {message && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--fin-negative)' }}>{message}</p>}
  </section>
}
