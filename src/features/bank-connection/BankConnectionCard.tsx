import type { BankConnectionSummary } from './useBankConnection'
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

/**
 * Minimal bank connection surface (Sandbox). It renders nothing when the caller cannot manage bank connections or the feature is
 * not configured. Connecting a bank does not change any balance, project, obligation, debt or Outlook number.
 */
export default function BankConnectionCard() {
  const { load, connections, environment, busy, message, connect, reconnect, disconnect } = useBankConnection()
  if (load !== 'ready') return null
  const active = connections.filter(c => c.status !== 'disconnected')
  return <section data-testid="bank-connection-card" aria-label="Bank connection" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Bank connection{environment ? ` · ${environment}` : ''}</h3>
      {active.length === 0 && <button type="button" className={btn} disabled={busy} onClick={() => void connect()} data-testid="bank-connect">{busy ? 'Connecting…' : 'Connect bank'}</button>}
    </div>
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
      </div>
    })}</div>
    {message && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--fin-negative)' }}>{message}</p>}
  </section>
}
