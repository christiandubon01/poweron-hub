import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BellRing,
  Building2,
  Download,
  Eye,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  fetchFounderAgreementArtifactAccess,
  fetchFounderContractorAdminReport,
  fetchFounderContractorPresenceDetail,
  fetchFounderContractorPresenceReport,
  type FounderContractorAccount,
  type FounderContractorAdminReport,
  type FounderContractorPresenceDetail,
  type FounderContractorPresenceSummary,
  type FounderContractorPresenceStatus,
  type FounderSecurityAlert,
  type FounderSignedAgreement,
} from '@/services/founderContractorAdminService'
import {
  countUnreadGuardianSecurityAlerts,
  createGuardianPollingLoop,
  FOUNDER_GUARDIAN_POLL_INTERVAL_MS,
  readGuardianSecurityLastSeen,
  writeGuardianSecurityLastSeen,
} from '@/services/guardianFounderPresence'
import { deleteInvite, revokeInvite, sendInvite } from '@/services/inviteService'

export type FounderContractorSection = 'accounts' | 'invites' | 'agreements'
export type GuardianPresenceRefreshReason = 'initial' | 'background' | 'manual'

type AgreementPreviewState = {
  agreementId: string
  title: string
  url: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function formatOptionalDate(value: string | null | undefined): string {
  return value ? formatDate(value) : 'Not available'
}

function Badge({ value }: { value: string }) {
  const positive = ['active', 'complete', 'signed', 'accepted', 'current', 'legacy'].includes(value)
  const negative = ['inactive', 'revoked', 'expired', 'missing', 'unsigned'].includes(value)
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

function PresenceBadge({ status }: { status: FounderContractorPresenceStatus }) {
  const styles: Record<FounderContractorPresenceStatus, string> = {
    active: 'border-green-800/60 bg-green-950/50 text-green-400',
    idle: 'border-amber-800/60 bg-amber-950/50 text-amber-300',
    locked: 'border-blue-800/60 bg-blue-950/40 text-blue-300',
    offline: 'border-gray-700 bg-gray-900 text-gray-400',
    no_history: 'border-gray-700 bg-gray-900 text-gray-500',
  }

  const label = status === 'no_history' ? 'No session history' : status.replace(/_/g, ' ')
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[status]}`}>
      {label}
    </span>
  )
}

function buildAgreementSummary(account: FounderContractorAccount): string {
  if (account.ndaState === 'GRANDFATHERED_LEGACY_ACCESS') {
    return 'Grandfathered access. No signed agreement artifact is on file.'
  }
  if (account.ndaState === 'REVOKED') {
    return 'Agreement access has been revoked.'
  }
  if (!account.signedAt) {
    return 'No signed agreement is currently on file.'
  }

  const parts = [
    account.agreementVersion || 'Signed agreement',
    `signed ${formatDate(account.signedAt)}`,
  ]
  if (account.signer) parts.push(`by ${account.signer}`)
  parts.push(account.artifactAvailable ? 'signed document on file' : 'no signed PDF captured')
  return parts.join(' - ')
}

export function describeAgreementArtifactState(agreement: {
  ndaState: string
  hasPdf: boolean
  artifactStatus: string
}): string {
  if (agreement.ndaState === 'GRANDFATHERED_LEGACY_ACCESS') {
    return 'Access grandfathered - no signed document'
  }
  if (agreement.hasPdf) {
    return 'Signed document on file'
  }
  if (agreement.artifactStatus === 'no_signed_pdf_captured') {
    return 'No signed PDF captured'
  }
  return 'No signed document on file'
}

function agreementHasArtifactActions(agreement: FounderSignedAgreement): boolean {
  return agreement.hasPdf
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#11121a] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 text-sm text-gray-100">{value}</div>
    </div>
  )
}

function SurfaceSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 rounded-xl border border-gray-800 bg-[#11121a]">
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="text-sm font-semibold text-gray-100">{title}</div>
        {description ? <div className="mt-1 text-xs text-gray-500">{description}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

const headerCell = 'px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap'
const bodyCell = 'px-4 py-3 text-xs text-gray-300 align-top'

export function reconcileSelectedOrganizationId(
  currentId: string | null,
  accounts: FounderContractorAccount[],
): string | null {
  if (!currentId) return null
  return accounts.some((account) => account.organizationId === currentId) ? currentId : null
}

function buildEmptyPresenceSummary(organizationId: string): FounderContractorPresenceSummary {
  return {
    organizationId,
    status: 'no_history',
    hasHistory: false,
    liveDeviceCount: 0,
    liveSessionCount: 0,
    lastInteractionAt: null,
    lastHeartbeatAt: null,
    sessionCount: 0,
  }
}

export function hasGuardianPresenceSnapshot(input: {
  summaries: FounderContractorPresenceSummary[]
  alerts: FounderSecurityAlert[]
  serverNow: string | null
}): boolean {
  return Boolean(input.serverNow) || input.summaries.length > 0 || input.alerts.length > 0
}

function presenceNarrative(summary: FounderContractorPresenceSummary | null | undefined): string {
  if (!summary || !summary.hasHistory || summary.status === 'no_history') {
    return 'No session history'
  }
  return `${summary.status.replace(/_/g, ' ')} · ${summary.liveDeviceCount} live device${summary.liveDeviceCount === 1 ? '' : 's'} · ${summary.liveSessionCount} live session${summary.liveSessionCount === 1 ? '' : 's'}`
}

function alertHeadline(alert: FounderSecurityAlert): string {
  return alert.alertKind === 'ip_changed'
    ? 'Public IP changed'
    : 'New device session started'
}

export function FounderContractorAdminSurface({ section }: { section: FounderContractorSection }) {
  const [report, setReport] = useState<FounderContractorAdminReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [industry, setIndustry] = useState('')
  const [sending, setSending] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)
  const [artifactLoadingId, setArtifactLoadingId] = useState<string | null>(null)
  const [agreementPreview, setAgreementPreview] = useState<AgreementPreviewState | null>(null)
  const [presenceSummaries, setPresenceSummaries] = useState<FounderContractorPresenceSummary[]>([])
  const [presenceAlerts, setPresenceAlerts] = useState<FounderSecurityAlert[]>([])
  const [presenceServerNow, setPresenceServerNow] = useState<string | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(false)
  const [presenceManualRefreshing, setPresenceManualRefreshing] = useState(false)
  const [presenceError, setPresenceError] = useState<string | null>(null)
  const [presenceDetailsByOrganizationId, setPresenceDetailsByOrganizationId] = useState<Record<string, FounderContractorPresenceDetail>>({})
  const [presenceDetailLoadingOrganizationId, setPresenceDetailLoadingOrganizationId] = useState<string | null>(null)
  const [presenceDetailError, setPresenceDetailError] = useState<string | null>(null)
  const [securityAlertsOpen, setSecurityAlertsOpen] = useState(false)
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null)
  const reportStateRef = useRef<FounderContractorAdminReport | null>(null)
  const selectedOrganizationIdRef = useRef<string | null>(null)
  const presenceSnapshotRef = useRef({
    summaries: [] as FounderContractorPresenceSummary[],
    alerts: [] as FounderSecurityAlert[],
    serverNow: null as string | null,
  })
  const presenceDetailsRef = useRef<Record<string, FounderContractorPresenceDetail>>({})
  const loadReportRef = useRef<Promise<void> | null>(null)
  const loadPresenceRef = useRef<Promise<void> | null>(null)
  const loadPresenceDetailRef = useRef(new Map<string, Promise<void>>())

  const selectedAccount = section === 'accounts'
    ? (report?.contractorAccounts.find((account) => account.organizationId === selectedOrganizationId) ?? null)
    : null

  const presenceByOrg = useMemo(
    () => new Map(presenceSummaries.map((summary) => [summary.organizationId, summary])),
    [presenceSummaries],
  )
  const presenceHasSnapshot = hasGuardianPresenceSnapshot({
    summaries: presenceSummaries,
    alerts: presenceAlerts,
    serverNow: presenceServerNow,
  })
  const selectedPresenceSummary = selectedAccount
    ? (presenceByOrg.get(selectedAccount.organizationId) ?? buildEmptyPresenceSummary(selectedAccount.organizationId))
    : null
  const selectedPresenceDetail = selectedOrganizationId
    ? (presenceDetailsByOrganizationId[selectedOrganizationId] ?? null)
    : null
  const selectedPresenceDetailLoading = Boolean(
    selectedOrganizationId
    && presenceDetailLoadingOrganizationId === selectedOrganizationId
    && !selectedPresenceDetail,
  )
  const presenceShowingStaleData = Boolean(presenceError) && presenceHasSnapshot
  const presenceDetailShowingStaleData = Boolean(presenceDetailError) && Boolean(selectedPresenceDetail)

  const unreadAlertCount = useMemo(
    () => countUnreadGuardianSecurityAlerts(presenceAlerts, lastSeenAt),
    [presenceAlerts, lastSeenAt],
  )

  useEffect(() => {
    reportStateRef.current = report
  }, [report])

  useEffect(() => {
    selectedOrganizationIdRef.current = selectedOrganizationId
  }, [selectedOrganizationId])

  useEffect(() => {
    presenceSnapshotRef.current = {
      summaries: presenceSummaries,
      alerts: presenceAlerts,
      serverNow: presenceServerNow,
    }
  }, [presenceAlerts, presenceServerNow, presenceSummaries])

  useEffect(() => {
    presenceDetailsRef.current = presenceDetailsByOrganizationId
  }, [presenceDetailsByOrganizationId])

  const loadReport = useCallback(async () => {
    if (loadReportRef.current) return loadReportRef.current

    const promise = (async () => {
      if (!reportStateRef.current) setLoading(true)
      setError(null)
      try {
        setReport(await fetchFounderContractorAdminReport())
      } catch (err) {
        setReport(null)
        setError(err instanceof Error ? err.message : 'Founder contractor report could not be loaded.')
      } finally {
        setLoading(false)
      }
    })()

    loadReportRef.current = promise
    try {
      await promise
    } finally {
      loadReportRef.current = null
    }
  }, [])

  const loadPresence = useCallback(async (reason: GuardianPresenceRefreshReason = 'initial') => {
    if (section !== 'accounts') return
    if (loadPresenceRef.current) return loadPresenceRef.current

    const showLoading = reason === 'initial' && !hasGuardianPresenceSnapshot(presenceSnapshotRef.current)
    const promise = (async () => {
      if (showLoading) setPresenceLoading(true)
      setPresenceError(null)
      try {
        const response = await fetchFounderContractorPresenceReport()
        setPresenceSummaries(response.summaries)
        setPresenceAlerts(response.alerts)
        setPresenceServerNow(response.serverNow)
      } catch (err) {
        setPresenceError(err instanceof Error ? err.message : 'Presence unavailable.')
      } finally {
        if (showLoading) setPresenceLoading(false)
      }
    })()

    loadPresenceRef.current = promise
    try {
      await promise
    } finally {
      loadPresenceRef.current = null
    }
  }, [section])

  const loadPresenceDetail = useCallback(async (
    organizationId: string,
    reason: GuardianPresenceRefreshReason = 'initial',
  ) => {
    if (section !== 'accounts') return
    const inFlight = loadPresenceDetailRef.current.get(organizationId)
    if (inFlight) return inFlight

    const showLoading = reason === 'initial' && !presenceDetailsRef.current[organizationId]
    const promise = (async () => {
      if (showLoading) setPresenceDetailLoadingOrganizationId(organizationId)
      setPresenceDetailError(null)
      try {
        const detail = await fetchFounderContractorPresenceDetail(organizationId)
        setPresenceDetailsByOrganizationId((current) => ({
          ...current,
          [organizationId]: detail,
        }))
      } catch (err) {
        setPresenceDetailError(err instanceof Error ? err.message : 'Presence unavailable.')
      } finally {
        if (showLoading) {
          setPresenceDetailLoadingOrganizationId((current) => current === organizationId ? null : current)
        }
      }
    })()

    loadPresenceDetailRef.current.set(organizationId, promise)
    try {
      await promise
    } finally {
      loadPresenceDetailRef.current.delete(organizationId)
    }
  }, [section])

  const refreshAccounts = useCallback(async (reason: GuardianPresenceRefreshReason) => {
    await Promise.all([loadReport(), loadPresence(reason)])
    if (selectedOrganizationIdRef.current) {
      await loadPresenceDetail(selectedOrganizationIdRef.current, reason)
    }
  }, [loadPresence, loadPresenceDetail, loadReport])

  useEffect(() => {
    if (section !== 'accounts') {
      void loadReport()
      return
    }

    let firstRun = true
    const polling = createGuardianPollingLoop(async () => {
      await refreshAccounts(firstRun ? 'initial' : 'background')
      firstRun = false
    }, FOUNDER_GUARDIAN_POLL_INTERVAL_MS)

    polling.start()
    return () => polling.stop()
  }, [loadReport, refreshAccounts, section])

  useEffect(() => {
    if (section !== 'accounts') return
    setSelectedOrganizationId((current) => reconcileSelectedOrganizationId(current, report?.contractorAccounts ?? []))
  }, [report, section])

  useEffect(() => {
    if (section !== 'accounts') return
    try {
      setLastSeenAt(readGuardianSecurityLastSeen(window.localStorage))
    } catch {
      setLastSeenAt(null)
    }
  }, [section])

  useEffect(() => {
    if (section !== 'accounts') return
    if (!selectedOrganizationId) {
      setPresenceDetailError(null)
      setPresenceDetailLoadingOrganizationId(null)
      return
    }
    void loadPresenceDetail(selectedOrganizationId, 'initial')
  }, [loadPresenceDetail, section, selectedOrganizationId])

  useEffect(() => {
    if (section !== 'agreements') setAgreementPreview(null)
  }, [section])

  const markAlertsSeen = useCallback(() => {
    if (!presenceServerNow) return
    try {
      writeGuardianSecurityLastSeen(window.localStorage, presenceServerNow)
      setLastSeenAt(presenceServerNow)
    } catch {
      // ignore storage failures
    }
  }, [presenceServerNow])

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
    await loadReport()
  }

  async function handleRevoke(inviteId: string) {
    if (!window.confirm('This invitation will no longer be usable. Revoke it?')) return
    setRevoking(inviteId)
    setError(null)
    const result = await revokeInvite(inviteId)
    setRevoking(null)
    if (!result.success) {
      setError(result.error || 'Beta invite could not be revoked.')
      return
    }
    await loadReport()
  }

  async function handleDelete(inviteId: string, effectiveStatus: string) {
    const msg = effectiveStatus === 'pending'
      ? 'Deleting this pending invitation will immediately invalidate its invite link and remove it from the invitation list.'
      : `Remove this ${effectiveStatus} invitation from the list?`
    if (!window.confirm(msg)) return
    setDeleting(inviteId)
    setError(null)
    const result = await deleteInvite(inviteId)
    setDeleting(null)
    if (!result.success) {
      setError(result.error || 'Beta invite could not be deleted.')
      return
    }
    await loadReport()
  }

  async function resolveAgreementArtifact(agreement: FounderSignedAgreement) {
    setArtifactLoadingId(agreement.id)
    setError(null)
    try {
      return await fetchFounderAgreementArtifactAccess(agreement.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agreement artifact could not be opened.')
      return null
    } finally {
      setArtifactLoadingId(null)
    }
  }

  async function handleQuickView(agreement: FounderSignedAgreement) {
    const artifact = await resolveAgreementArtifact(agreement)
    if (!artifact) return
    setAgreementPreview({
      agreementId: agreement.id,
      title: agreement.organizationName || agreement.signer || 'Signed agreement',
      url: artifact.url,
    })
  }

  async function handleDownload(agreement: FounderSignedAgreement) {
    const artifact = await resolveAgreementArtifact(agreement)
    if (!artifact) return

    const link = document.createElement('a')
    link.href = artifact.url
    link.download = artifact.filename
    link.target = '_blank'
    link.rel = 'noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const title = section === 'accounts'
    ? 'Contractor Accounts'
    : section === 'invites'
      ? 'Contractor Beta Invites'
      : 'Signed NDAs / Agreements'
  const Icon = section === 'accounts' ? Building2 : section === 'invites' ? Mail : FileText
  const showContractorDetail = section === 'accounts' && !!selectedAccount
  const refreshing = section === 'accounts' ? presenceManualRefreshing : loading

  async function handleRefresh() {
    if (section !== 'accounts') {
      await loadReport()
      return
    }

    setPresenceManualRefreshing(true)
    try {
      await refreshAccounts('manual')
    } finally {
      setPresenceManualRefreshing(false)
    }
  }

  return (
    <>
      <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-gray-800 bg-[#0d0e14]">
        <div className="flex items-center justify-between border-b border-gray-800 bg-[#11121a] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
            <Icon size={14} className="text-green-500" />
            {title}
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
              <ShieldCheck size={11} /> Founder only
            </span>
          </div>
          <div className="flex items-center gap-2">
            {section === 'accounts' && (
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !securityAlertsOpen
                  setSecurityAlertsOpen(nextOpen)
                  if (!securityAlertsOpen) markAlertsSeen()
                }}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300"
              >
                <BellRing size={11} />
                Security Alerts
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${unreadAlertCount > 0 ? 'bg-red-950/60 text-red-300' : 'bg-gray-800 text-gray-500'}`}>
                  {unreadAlertCount}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-400"
            >
              {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Refresh
            </button>
          </div>
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
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading founder data...</div>
        ) : !report ? null : section === 'accounts' ? (
          <div className="flex flex-1 flex-col xl:flex-row">
            <div className={`min-w-0 flex-1 overflow-auto ${showContractorDetail ? 'border-b border-gray-800 xl:border-b-0 xl:border-r xl:border-gray-800' : ''}`}>
              {securityAlertsOpen && (
                <div className="border-b border-gray-800 bg-[#0f1018] p-4">
                  <div className="rounded-xl border border-gray-800 bg-[#11121a]">
                    <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-100">Security Alerts</div>
                        <div className="mt-1 text-xs text-gray-500">Unread noise is limited to public IP changes and newly seen devices. History remains in the account drawer.</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSecurityAlertsOpen(false)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-gray-300"
                      >
                        <X size={12} /> Close
                      </button>
                    </div>
                    <div className="p-4">
                      {presenceError && presenceAlerts.length === 0 ? (
                        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                          Security alerts unavailable
                        </div>
                      ) : presenceAlerts.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                          No new-device or public-IP change alerts recorded yet.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {presenceAlerts.map((alert) => (
                            <div key={`${alert.organizationId}-${alert.sessionId}-${alert.occurredAt}-${alert.alertKind}`} className="rounded-lg border border-gray-800 bg-[#0f1018] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-gray-100">{alertHeadline(alert)}</div>
                                  <div className="mt-1 text-xs text-gray-500">{alert.organizationName} · {alert.userLabel} · {alert.deviceLabel}</div>
                                </div>
                                <PresenceBadge status={alert.alertKind === 'ip_changed' ? 'offline' : 'locked'} />
                              </div>
                              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <DetailItem label="Occurred" value={formatDate(alert.occurredAt)} />
                                <DetailItem label="Public IP" value={alert.publicIp || 'Not recorded'} />
                                <DetailItem label="Previous public IP" value={alert.previousPublicIp || 'Not applicable'} />
                                <DetailItem label="Alert type" value={alert.alertKind === 'ip_changed' ? 'Public IP changed' : 'New device detected'} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {presenceError && (
                <div className="m-4 mb-0 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                  {presenceShowingStaleData
                    ? 'Showing the last successful live presence snapshot while Guardian refresh is temporarily unavailable.'
                    : 'Presence unavailable'}
                </div>
              )}

              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-[#0f1018]"><tr>{['Company / Org', 'Owner Email', 'Created', 'Onboarding', 'NDA State', 'Classification', 'Account Status'].map((label) => <th key={label} className={headerCell}>{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-800">
                  {report.contractorAccounts.map((account) => {
                    const isSelected = account.organizationId === selectedOrganizationId
                    const summary = presenceByOrg.get(account.organizationId)
                    return (
                      <tr
                        key={account.organizationId}
                        onClick={() => setSelectedOrganizationId(account.organizationId)}
                        className={`cursor-pointer transition-colors ${isSelected ? 'bg-green-950/20' : 'hover:bg-white/5'}`}
                        aria-label={`Open contractor account details for ${account.organizationName || account.organizationId}`}
                      >
                        <td className={bodyCell}>
                          <span className="font-semibold text-gray-100">{account.organizationName || 'Unnamed organization'}</span>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <PresenceBadge status={summary?.status ?? 'no_history'} />
                            <span className="text-[11px] text-gray-500">{presenceNarrative(summary)}</span>
                          </div>
                          {summary?.hasHistory && (
                            <div className="mt-1 text-[11px] text-gray-600">
                              Last interaction {formatOptionalDate(summary.lastInteractionAt)} · Last heartbeat {formatOptionalDate(summary.lastHeartbeatAt)}
                            </div>
                          )}
                        </td>
                        <td className={bodyCell}>{account.ownerEmail || 'Not available'}</td>
                        <td className={bodyCell}>{formatDate(account.createdAt)}</td>
                        <td className={bodyCell}><Badge value={account.onboardingStatus} /></td>
                        <td className={bodyCell}><Badge value={account.ndaState} /></td>
                        <td className={bodyCell}><Badge value={account.classification} /></td>
                        <td className={bodyCell}><Badge value={account.accountStatus} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {showContractorDetail && selectedAccount && (
              <aside className="w-full shrink-0 border-t border-gray-800 bg-[#10121a] xl:w-[520px] xl:border-l xl:border-t-0 xl:border-gray-800">
                <div className="h-full overflow-auto p-4">
                  <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-gray-800 bg-[#11121a] p-4">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">Selected contractor</div>
                      <div className="mt-2 text-lg font-semibold text-gray-100">{selectedAccount.organizationName || 'Unnamed organization'}</div>
                      <div className="mt-1 text-xs text-gray-400">{selectedAccount.organizationId}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedOrganizationId(null)}
                      aria-label="Close contractor details"
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-gray-800"
                    >
                      <X size={12} /> Close
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DetailItem label="Company / Organization" value={selectedAccount.organizationName || 'Unnamed organization'} />
                    <DetailItem label="Owner full name" value={selectedAccount.ownerFullName || 'Unknown'} />
                    <DetailItem label="Owner email" value={selectedAccount.ownerEmail || 'Not available'} />
                    <DetailItem label="Organization ID" value={selectedAccount.organizationId} />
                    <DetailItem label="Created date" value={formatDate(selectedAccount.createdAt)} />
                    <DetailItem label="Account status" value={selectedAccount.accountStatus.replace(/_/g, ' ')} />
                    <DetailItem label="Onboarding status" value={selectedAccount.onboardingStatus.replace(/_/g, ' ')} />
                    <DetailItem label="Pilot / beta classification" value={selectedAccount.classification.replace(/_/g, ' ')} />
                    <DetailItem label="NDA state" value={selectedAccount.ndaState.replace(/_/g, ' ')} />
                    <DetailItem label="Signed agreement summary" value={buildAgreementSummary(selectedAccount)} />
                    <DetailItem label="Employee count" value={String(selectedAccount.employeeCount)} />
                    <DetailItem label="User / member count" value={String(selectedAccount.memberCount)} />
                    <DetailItem label="Last activity" value={formatOptionalDate(selectedAccount.lastActivityAt)} />
                    <DetailItem label="Last login" value={formatOptionalDate(selectedAccount.lastLoginAt)} />
                  </div>

                  <SurfaceSection
                    title="Live Presence / Sessions"
                    description="Status is derived from server time using fresh heartbeat, visibility, and recent human interaction. Last interaction stays separate from last heartbeat."
                  >
                    {presenceLoading && !presenceHasSnapshot ? (
                      <div className="rounded-lg border border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        <div className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" /> Loading live presence...
                        </div>
                      </div>
                    ) : presenceError && !presenceHasSnapshot ? (
                      <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                        Presence unavailable
                      </div>
                    ) : !selectedPresenceSummary || selectedPresenceSummary.status === 'no_history' ? (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No session history
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DetailItem label="Current status" value={selectedPresenceSummary.status.replace(/_/g, ' ')} />
                        <DetailItem label="Live devices" value={String(selectedPresenceSummary.liveDeviceCount)} />
                        <DetailItem label="Live sessions" value={String(selectedPresenceSummary.liveSessionCount)} />
                        <DetailItem label="Recent session rows" value={String(selectedPresenceSummary.sessionCount)} />
                        <DetailItem label="Last interaction" value={formatOptionalDate(selectedPresenceSummary.lastInteractionAt)} />
                        <DetailItem label="Last heartbeat" value={formatOptionalDate(selectedPresenceSummary.lastHeartbeatAt)} />
                      </div>
                    )}

                    {presenceDetailShowingStaleData && (
                      <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                        Showing the last successful session history while Guardian refresh is temporarily unavailable.
                      </div>
                    )}

                    {presenceDetailError && !selectedPresenceDetail && (
                      <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                        Presence unavailable
                      </div>
                    )}
                  </SurfaceSection>

                  <SurfaceSection
                    title="Devices"
                    description="Tabs remain separate sessions. Device counts are based on stable device IDs; missing device IDs stay grouped under a safe Unknown device label."
                  >
                    {selectedPresenceDetailLoading ? (
                      <div className="rounded-lg border border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        <div className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" /> Loading live presence...
                        </div>
                      </div>
                    ) : selectedPresenceDetail && selectedPresenceDetail.deviceGroups.length > 0 ? (
                      <div className="space-y-3">
                        {selectedPresenceDetail.deviceGroups.map((device) => (
                          <div key={device.deviceKey} className="rounded-lg border border-gray-800 bg-[#0f1018] p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-gray-100">{device.deviceLabel}</div>
                              <PresenceBadge status={device.status} />
                              <span className="text-[11px] text-gray-500">{device.liveSessionCount} live tab/session{device.liveSessionCount === 1 ? '' : 's'}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <DetailItem label="Recent module" value={`${device.recentModuleLabel}${device.recentModule ? ` (${device.recentModule})` : ''}`} />
                              <DetailItem label="Device type" value={device.deviceType} />
                              <DetailItem label="First session" value={formatOptionalDate(device.startedAt)} />
                              <DetailItem label="Last interaction" value={formatOptionalDate(device.lastInteractionAt)} />
                              <DetailItem label="Last heartbeat" value={formatOptionalDate(device.lastHeartbeatAt)} />
                              <DetailItem label="Current status" value={device.status.replace(/_/g, ' ')} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No device grouping is available yet for this contractor.
                      </div>
                    )}
                  </SurfaceSection>

                  <SurfaceSection
                    title="Recent Sessions"
                    description="Shows session status, normalized module, visibility, session start, last human interaction, last heartbeat, and ended reason when present."
                  >
                    {selectedPresenceDetailLoading ? (
                      <div className="rounded-lg border border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        <div className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" /> Loading live presence...
                        </div>
                      </div>
                    ) : selectedPresenceDetail && selectedPresenceDetail.sessions.length > 0 ? (
                      <div className="space-y-3">
                        {selectedPresenceDetail.sessions.map((session) => (
                          <div key={session.sessionId} className="rounded-lg border border-gray-800 bg-[#0f1018] p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-gray-100">{session.userLabel}</div>
                              <PresenceBadge status={session.status} />
                              <span className="text-[11px] text-gray-500">{session.deviceLabel}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <DetailItem label="Module" value={`${session.moduleLabel}${session.module ? ` (${session.module})` : ''}`} />
                              <DetailItem label="Visibility" value={session.visibilityState === 'hidden' ? 'Backgrounded' : 'Visible'} />
                              <DetailItem label="Session started" value={formatOptionalDate(session.startedAt)} />
                              <DetailItem label="Last interaction" value={formatOptionalDate(session.lastInteractionAt)} />
                              <DetailItem label="Last heartbeat" value={formatOptionalDate(session.lastHeartbeatAt)} />
                              <DetailItem label="Ended" value={formatOptionalDate(session.endedAt)} />
                              <DetailItem label="Ended reason" value={session.endedReason ? session.endedReason.replace(/_/g, ' ') : 'Live / not ended'} />
                              <DetailItem label="Session ID" value={session.sessionId} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No recent new-runtime sessions found for this contractor.
                      </div>
                    )}
                  </SurfaceSection>

                  <SurfaceSection
                    title="Security History"
                    description="Founder-only trusted public-IP evidence from the server path. Raw IP never leaves Guardian founder surfaces."
                  >
                    {selectedPresenceDetailLoading ? (
                      <div className="rounded-lg border border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        <div className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" /> Loading live presence...
                        </div>
                      </div>
                    ) : presenceDetailError && !selectedPresenceDetail ? (
                      <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                        Security history unavailable
                      </div>
                    ) : selectedPresenceDetail && selectedPresenceDetail.securityHistory.length > 0 ? (
                      <div className="space-y-3">
                        {selectedPresenceDetail.securityHistory.map((event) => (
                          <div key={`${event.sessionId || 'session'}-${event.occurredAt}-${event.eventType}`} className="rounded-lg border border-gray-800 bg-[#0f1018] p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-gray-100">
                                {event.eventType === 'ip_changed' ? 'Public IP changed' : 'Session started'}
                              </div>
                              {event.isAlert ? <PresenceBadge status="locked" /> : null}
                              {event.isNewDevice ? <Badge value="new_device" /> : null}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">{event.userLabel} · {event.deviceLabel}</div>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <DetailItem label="Occurred" value={formatDate(event.occurredAt)} />
                              <DetailItem label="Public IP" value={event.publicIp || 'Not recorded'} />
                              <DetailItem label="Previous public IP" value={event.previousPublicIp || 'Not applicable'} />
                              <DetailItem label="Event type" value={event.eventType === 'ip_changed' ? 'ip_changed' : 'session_started'} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No trusted public-IP security events recorded yet.
                      </div>
                    )}
                  </SurfaceSection>
                </div>
              </aside>
            )}
          </div>
        ) : section === 'invites' ? (
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#0f1018]"><tr>{['Email', 'Industry', 'Status', 'Invited', 'Accepted', 'Resulting Account', 'Actions'].map((label) => <th key={label} className={headerCell}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-800">
                {report.contractorBetaInvites.map((invite) => (
                  <tr key={invite.id}>
                    <td className={bodyCell}>{invite.email}</td>
                    <td className={bodyCell}>{invite.industry || '-'}</td>
                    <td className={bodyCell}><Badge value={invite.status} /></td>
                    <td className={bodyCell}>{formatDate(invite.invitedAt)}</td>
                    <td className={bodyCell}>{formatDate(invite.acceptedAt)}</td>
                    <td className={bodyCell}>{invite.organizationName || '-'}</td>
                    <td className={bodyCell}>
                      {invite.status === 'accepted' ? '—' : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {invite.status === 'pending' && (
                            <button
                              type="button"
                              disabled={revoking === invite.id || deleting === invite.id}
                              onClick={() => void handleRevoke(invite.id)}
                              className="rounded border border-amber-900/60 bg-amber-950/40 px-2 py-1 text-[10px] font-bold text-amber-400 disabled:opacity-50"
                            >
                              {revoking === invite.id ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={revoking === invite.id || deleting === invite.id}
                            onClick={() => void handleDelete(invite.id, invite.status)}
                            className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] font-bold text-red-400 disabled:opacity-50"
                          >
                            {deleting === invite.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#0f1018]">
                <tr>
                  {['Signer', 'Email', 'Organization', 'Version', 'Signed Date', 'State', 'Artifact', 'Actions'].map((label) => (
                    <th key={label} className={headerCell}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {report.signedAgreements.map((agreement) => {
                  const loadingArtifact = artifactLoadingId === agreement.id
                  const canAccessArtifact = agreementHasArtifactActions(agreement)
                  return (
                    <tr key={agreement.id}>
                      <td className={bodyCell}><span className="font-semibold text-gray-100">{agreement.signer || '-'}</span></td>
                      <td className={bodyCell}>{agreement.email || '-'}</td>
                      <td className={bodyCell}>{agreement.organizationName || '-'}</td>
                      <td className={bodyCell}>{agreement.version || '-'}</td>
                      <td className={bodyCell}>{formatDate(agreement.signedAt)}</td>
                      <td className={bodyCell}><Badge value={agreement.ndaState} /></td>
                      <td className={bodyCell}>
                        <span className={canAccessArtifact ? 'text-green-400' : 'text-gray-400'}>
                          {describeAgreementArtifactState(agreement)}
                        </span>
                      </td>
                      <td className={bodyCell}>
                        {canAccessArtifact ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={loadingArtifact}
                              onClick={() => void handleQuickView(agreement)}
                              className="inline-flex items-center gap-1 rounded border border-blue-800/60 bg-blue-950/30 px-2 py-1 text-[10px] font-bold text-blue-300 disabled:opacity-50"
                            >
                              {loadingArtifact ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
                              Quick View
                            </button>
                            <button
                              type="button"
                              disabled={loadingArtifact}
                              onClick={() => void handleDownload(agreement)}
                              className="inline-flex items-center gap-1 rounded border border-green-800/60 bg-green-950/30 px-2 py-1 text-[10px] font-bold text-green-300 disabled:opacity-50"
                            >
                              <Download size={11} />
                              Download
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-600">No artifact actions</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {agreementPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-[#0d0e14] shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 bg-[#11121a] px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">Agreement quick view</div>
                <div className="truncate text-sm font-semibold text-gray-100">{agreementPreview.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setAgreementPreview(null)}
                aria-label="Close agreement quick view"
                className="inline-flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-gray-800"
              >
                <X size={12} /> Close
              </button>
            </div>
            <iframe
              title={`Agreement preview ${agreementPreview.agreementId}`}
              src={agreementPreview.url}
              className="min-h-0 flex-1 bg-white"
            />
          </div>
        </div>
      )}
    </>
  )
}

export default FounderContractorAdminSurface
