import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Building2, FileText, Loader2, Mail, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import {
  fetchFounderContractorAdminReport,
  type FounderContractorAdminReport,
} from '@/services/founderContractorAdminService'
import { revokeInvite, sendInvite } from '@/services/inviteService'

export type FounderContractorSection = 'accounts' | 'invites' | 'agreements'

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function Badge({ value }: { value: string }) {
  const positive = ['active', 'complete', 'signed', 'accepted'].includes(value)
  const negative = ['inactive', 'revoked', 'expired', 'missing'].includes(value)
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
      positive
        ? 'border-green-800/60 bg-green-950/50 text-green-400'
        : negative
          ? 'border-red-800/60 bg-red-950/40 text-red-400'
          : 'border-blue-800/60 bg-blue-950/40 text-blue-400'
    }`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

const headerCell = 'px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap'
const bodyCell = 'px-4 py-3 text-xs text-gray-300 align-top'

export function FounderContractorAdminSurface({ section }: { section: FounderContractorSection }) {
  const [report, setReport] = useState<FounderContractorAdminReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [industry, setIndustry] = useState('')
  const [sending, setSending] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await fetchFounderContractorAdminReport())
    } catch (err) {
      setReport(null)
      setError(err instanceof Error ? err.message : 'Founder contractor report could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSend() {
    const target = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError('Enter a valid contractor email address.')
      return
    }
    setSending(true)
    setError(null)
    const result = await sendInvite(target, industry.trim() || undefined)
    setSending(false)
    if (!result.success) {
      setError(result.error || 'Beta invite could not be sent.')
      return
    }
    setEmail('')
    setIndustry('')
    await load()
  }

  async function handleRevoke(inviteId: string) {
    setRevoking(inviteId)
    setError(null)
    const result = await revokeInvite(inviteId)
    setRevoking(null)
    if (!result.success) {
      setError(result.error || 'Beta invite could not be revoked.')
      return
    }
    await load()
  }

  const title = section === 'accounts'
    ? 'Contractor Accounts'
    : section === 'invites'
      ? 'Contractor Beta Invites'
      : 'Signed NDAs / Agreements'
  const Icon = section === 'accounts' ? Building2 : section === 'invites' ? Mail : FileText

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-gray-800 bg-[#0d0e14]">
      <div className="flex items-center justify-between border-b border-gray-800 bg-[#11121a] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Icon size={14} className="text-green-500" />
          {title}
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
            <ShieldCheck size={11} /> Founder only
          </span>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-400">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {section === 'invites' && (
        <div className="flex flex-wrap items-end gap-2 border-b border-gray-800 px-4 py-4">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-gray-600">
            Contractor email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm normal-case text-gray-200 outline-none" />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-gray-600">
            Industry
            <input value={industry} onChange={(event) => setIndustry(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm normal-case text-gray-200 outline-none" />
          </label>
          <button type="button" disabled={sending} onClick={() => void handleSend()} className="flex h-[38px] items-center gap-2 rounded-lg bg-green-600 px-4 text-xs font-bold text-white disabled:opacity-50">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send Invite
          </button>
        </div>
      )}

      {error && (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error.includes('403') || error.includes('Founder access') ? 'Founder access is required for this cross-organization dataset.' : error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading founder data…</div>
      ) : !report ? null : section === 'accounts' ? (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#0f1018]"><tr>{['Company / Org', 'Owner Email', 'Created', 'Onboarding', 'NDA / Agreement', 'Classification', 'Account'].map((label) => <th key={label} className={headerCell}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-800">
              {report.contractorAccounts.map((account) => (
                <tr key={account.organizationId}>
                  <td className={bodyCell}><span className="font-semibold text-gray-100">{account.organizationName || 'Unnamed organization'}</span></td>
                  <td className={bodyCell}>{account.ownerEmail || '—'}</td>
                  <td className={bodyCell}>{formatDate(account.createdAt)}</td>
                  <td className={bodyCell}><Badge value={account.onboardingStatus} /></td>
                  <td className={bodyCell}><Badge value={account.agreementStatus} /></td>
                  <td className={bodyCell}><Badge value={account.classification} /></td>
                  <td className={bodyCell}><Badge value={account.accountStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : section === 'invites' ? (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#0f1018]"><tr>{['Email', 'Industry', 'Status', 'Invited', 'Accepted', 'Resulting Account', 'Action'].map((label) => <th key={label} className={headerCell}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-800">
              {report.contractorBetaInvites.map((invite) => (
                <tr key={invite.id}>
                  <td className={bodyCell}>{invite.email}</td>
                  <td className={bodyCell}>{invite.industry || '—'}</td>
                  <td className={bodyCell}><Badge value={invite.status} /></td>
                  <td className={bodyCell}>{formatDate(invite.invitedAt)}</td>
                  <td className={bodyCell}>{formatDate(invite.acceptedAt)}</td>
                  <td className={bodyCell}>{invite.organizationName || '—'}</td>
                  <td className={bodyCell}>{invite.status === 'pending' ? <button type="button" disabled={revoking === invite.id} onClick={() => void handleRevoke(invite.id)} className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] font-bold text-red-400 disabled:opacity-50">{revoking === invite.id ? 'Revoking…' : 'Revoke'}</button> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#0f1018]"><tr>{['Signer', 'Email', 'Organization', 'Version', 'Signed Date', 'Status', 'Verified'].map((label) => <th key={label} className={headerCell}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-800">
              {report.signedAgreements.map((agreement) => (
                <tr key={agreement.id}>
                  <td className={bodyCell}><span className="font-semibold text-gray-100">{agreement.signer || '—'}</span></td>
                  <td className={bodyCell}>{agreement.email || '—'}</td>
                  <td className={bodyCell}>{agreement.organizationName || '—'}</td>
                  <td className={bodyCell}>{agreement.version || '—'}</td>
                  <td className={bodyCell}>{formatDate(agreement.signedAt)}</td>
                  <td className={bodyCell}><Badge value={agreement.status} /></td>
                  <td className={bodyCell}>{agreement.pinVerified ? 'PIN verified' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default FounderContractorAdminSurface
