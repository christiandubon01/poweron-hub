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
  type FounderContractorUserAccess,
  type FounderGlobalSecurityHistoryEntry,
  type FounderSecurityAlert,
  type FounderSignedAgreement,
  restoreFounderUserAccess,
  revokeFounderUserAccess,
} from '@/services/founderContractorAdminService'
import {
  buildFounderSecurityCenterMetrics,
  countUnreadGuardianSecurityAlerts,
  createGuardianPollingLoop,
  filterIpChangeSecurityEvents,
  filterNewDeviceSecurityEvents,
  filterUnreadGuardianSecurityAlerts,
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

/** Compact label-value row for the modal header metadata grid. */
function CompactMeta({ label, value, badge }: { label: string; value?: string; badge?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-600">{label}:</span>
      {badge
        ? <Badge value={badge} />
        : <span className="truncate text-xs text-gray-300">{value ?? '-'}</span>
      }
    </div>
  )
}

/** Card used in the 2×2 modal grid. */
function ModalCard({ title, description, scrollable, children }: {
  title: string
  description?: string
  scrollable?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-800 bg-[#11121a]">
      <div className="shrink-0 border-b border-gray-800 px-4 py-3">
        <div className="text-sm font-semibold text-gray-100">{title}</div>
        {description ? <div className="mt-0.5 text-[11px] text-gray-500">{description}</div> : null}
      </div>
      <div className={`p-4${scrollable ? ' max-h-72 overflow-auto' : ''}`}>{children}</div>
    </div>
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
  securityHistory?: FounderGlobalSecurityHistoryEntry[]
}): boolean {
  return Boolean(input.serverNow)
    || input.summaries.length > 0
    || input.alerts.length > 0
    || Boolean(input.securityHistory && input.securityHistory.length > 0)
}

function presenceNarrative(summary: FounderContractorPresenceSummary | null | undefined): string {
  if (!summary || !summary.hasHistory || summary.status === 'no_history') {
    return 'No session history'
  }
  return `${summary.status.replace(/_/g, ' ')} · ${summary.liveDeviceCount} live device${summary.liveDeviceCount === 1 ? '' : 's'} · ${summary.liveSessionCount} live session${summary.liveSessionCount === 1 ? '' : 's'}`
}

function alertHeadline(alert: Pick<FounderSecurityAlert, 'alertKind'>): string {
  return alert.alertKind === 'ip_changed'
    ? 'Public IP Changed'
    : 'New Device'
}

function timelineEventLabel(event: Pick<FounderGlobalSecurityHistoryEntry, 'eventType' | 'isNewDevice'>): string {
  if (event.eventType === 'ip_changed') return 'Public IP Changed'
  if (event.isNewDevice) return 'New Device Session'
  return 'Known Device Session'
}

export function openContractorFromSecurityCenter(
  organizationId: string,
  closeSecurityCenter: () => void,
  openContractor: (organizationId: string) => void,
): void {
  closeSecurityCenter()
  openContractor(organizationId)
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
  const [userAccessMutatingUserId, setUserAccessMutatingUserId] = useState<string | null>(null)
  const [userAccessNotice, setUserAccessNotice] = useState<string | null>(null)
  const [securityAlertsOpen, setSecurityAlertsOpen] = useState(false)
  const [needsAttentionSnapshot, setNeedsAttentionSnapshot] = useState<FounderSecurityAlert[]>([])
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null)
  const [presenceSecurityHistory, setPresenceSecurityHistory] = useState<FounderGlobalSecurityHistoryEntry[]>([])
  const reportStateRef = useRef<FounderContractorAdminReport | null>(null)
  const selectedOrganizationIdRef = useRef<string | null>(null)
  const presenceSnapshotRef = useRef({
    summaries: [] as FounderContractorPresenceSummary[],
    alerts: [] as FounderSecurityAlert[],
    securityHistory: [] as FounderGlobalSecurityHistoryEntry[],
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
    securityHistory: presenceSecurityHistory,
    serverNow: presenceServerNow,
  })
  const selectedPresenceSummary = selectedAccount
    ? (presenceByOrg.get(selectedAccount.organizationId) ?? buildEmptyPresenceSummary(selectedAccount.organizationId))
    : null
  const selectedPresenceDetail = selectedOrganizationId
    ? (presenceDetailsByOrganizationId[selectedOrganizationId] ?? null)
    : null
  const selectedUserAccess = selectedPresenceDetail?.userAccess ?? []
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
  const securityCenterMetrics = useMemo(
    () => buildFounderSecurityCenterMetrics(presenceAlerts, presenceSecurityHistory, lastSeenAt),
    [lastSeenAt, presenceAlerts, presenceSecurityHistory],
  )
  const newDeviceEvents = useMemo(
    () => filterNewDeviceSecurityEvents(presenceSecurityHistory),
    [presenceSecurityHistory],
  )
  const ipChangeEvents = useMemo(
    () => filterIpChangeSecurityEvents(presenceSecurityHistory),
    [presenceSecurityHistory],
  )
  const needsAttentionEvents = securityAlertsOpen
    ? needsAttentionSnapshot
    : filterUnreadGuardianSecurityAlerts(presenceAlerts, lastSeenAt)

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
      securityHistory: presenceSecurityHistory,
      serverNow: presenceServerNow,
    }
  }, [presenceAlerts, presenceSecurityHistory, presenceServerNow, presenceSummaries])

  useEffect(() => {
    presenceDetailsRef.current = presenceDetailsByOrganizationId
  }, [presenceDetailsByOrganizationId])

  // Close Security Center on Escape (before contractor modal when open)
  useEffect(() => {
    if (!securityAlertsOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSecurityAlertsOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [securityAlertsOpen])

  // Close contractor detail modal on Escape
  const showContractorDetail = section === 'accounts' && !!selectedAccount
  useEffect(() => {
    if (!showContractorDetail || securityAlertsOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedOrganizationId(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [securityAlertsOpen, showContractorDetail])

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
        setPresenceSecurityHistory(response.securityHistory ?? [])
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

  const closeSecurityCenter = useCallback(() => {
    setSecurityAlertsOpen(false)
  }, [])

  const openSecurityCenter = useCallback(() => {
    setNeedsAttentionSnapshot(filterUnreadGuardianSecurityAlerts(presenceAlerts, lastSeenAt))
    setSecurityAlertsOpen(true)
    markAlertsSeen()
  }, [lastSeenAt, markAlertsSeen, presenceAlerts])

  const openContractorFromAlert = useCallback((organizationId: string) => {
    openContractorFromSecurityCenter(
      organizationId,
      closeSecurityCenter,
      (id) => setSelectedOrganizationId(id),
    )
  }, [closeSecurityCenter])

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

  async function handleUserAccessAction(userAccess: FounderContractorUserAccess) {
    if (!selectedAccount) return

    const userLabel = userAccess.email || userAccess.name || userAccess.userId
    const confirmed = userAccess.isActive
      ? window.confirm(
        `Revoke PowerOn Hub access for ${userLabel}?\n\nThis will end their active app sessions and prevent new access until restored.`,
      )
      : window.confirm(
        `Restore PowerOn Hub access for ${userLabel}?\n\nThey will be able to authenticate normally again.`,
      )
    if (!confirmed) return

    setUserAccessMutatingUserId(userAccess.userId)
    setUserAccessNotice(null)
    setError(null)
    try {
      const result = userAccess.isActive
        ? await revokeFounderUserAccess(userAccess.userId, selectedAccount.organizationId)
        : await restoreFounderUserAccess(userAccess.userId, selectedAccount.organizationId)

      await refreshAccounts('manual')
      if (result.cleanupWarning) {
        setUserAccessNotice(result.cleanupWarning)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'User access could not be updated.')
    } finally {
      setUserAccessMutatingUserId(null)
    }
  }

  return (
    <>
      {/* ── Main surface container ─────────────────────────────────────────── */}
      <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-gray-800 bg-[#0d0e14]">
        {/* Outer header */}
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
                  if (securityAlertsOpen) {
                    closeSecurityCenter()
                    return
                  }
                  openSecurityCenter()
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

        {userAccessNotice && (
          <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{userAccessNotice}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading founder data...</div>
        ) : !report ? null : section === 'accounts' ? (
          // ── Contractor Accounts — full-width table (detail opens as modal) ──
          <div className="flex-1 overflow-auto">
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

      {/* ── Agreement quick-view modal ─────────────────────────────────────── */}
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

      {/* ── Security Center modal — 2×2 grid layout ───────────────────────── */}
      {section === 'accounts' && securityAlertsOpen && (
        <div
          data-testid="security-center-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeSecurityCenter() }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Security Center"
            className="flex max-h-[90vh] w-[90vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-gray-800 bg-[#0d0e14] shadow-2xl"
          >
            <div className="shrink-0 border-b border-gray-800 bg-[#11121a] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">Founder security</div>
                  <div className="mt-0.5 text-xl font-semibold leading-tight text-gray-100">Security Center</div>
                </div>
                <button
                  type="button"
                  onClick={closeSecurityCenter}
                  aria-label="Close Security Center"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-gray-800"
                >
                  <X size={12} /> Close
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                <CompactMeta label="Unread Alerts" value={String(securityCenterMetrics.unreadAlerts)} />
                <CompactMeta label="New Devices 30D" value={String(securityCenterMetrics.newDevices30d)} />
                <CompactMeta label="IP Changes 30D" value={String(securityCenterMetrics.ipChanges30d)} />
                <CompactMeta label="Last Security Event" value={formatOptionalDate(securityCenterMetrics.lastSecurityEventAt)} />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {presenceError && presenceAlerts.length === 0 && presenceSecurityHistory.length === 0 ? (
                <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                  Security alerts unavailable
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* TOP LEFT — Needs Attention */}
                  <ModalCard
                    title="Needs Attention"
                    description="Unread public-IP changes and newly observed devices only."
                    scrollable
                  >
                    {needsAttentionEvents.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No unread security alerts.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {needsAttentionEvents.map((alert) => (
                          <button
                            key={`${alert.organizationId}-${alert.sessionId}-${alert.occurredAt}-${alert.alertKind}`}
                            type="button"
                            onClick={() => openContractorFromAlert(alert.organizationId)}
                            className="w-full rounded-lg border border-gray-800 bg-[#0f1018] p-3 text-left transition-colors hover:bg-white/5"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-gray-100">{alertHeadline(alert)}</div>
                              <PresenceBadge status={alert.alertKind === 'ip_changed' ? 'offline' : 'locked'} />
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {alert.organizationName} · {alert.userLabel} · {alert.deviceLabel}
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <DetailItem label="Occurred" value={formatDate(alert.occurredAt)} />
                              <DetailItem label="Public IP" value={alert.publicIp || 'Not recorded'} />
                              {alert.alertKind === 'ip_changed' ? (
                                <DetailItem
                                  label="IP change"
                                  value={`${alert.previousPublicIp || 'Unknown'} → ${alert.publicIp || 'Unknown'}`}
                                />
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ModalCard>

                  {/* TOP RIGHT — New Devices */}
                  <ModalCard
                    title="New Devices"
                    description="Bounded recent session_started events where the device was newly observed."
                    scrollable
                  >
                    {newDeviceEvents.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No newly observed devices.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {newDeviceEvents.map((event) => (
                          <button
                            key={`${event.organizationId}-${event.sessionId}-${event.occurredAt}-new-device`}
                            type="button"
                            onClick={() => openContractorFromAlert(event.organizationId)}
                            className="w-full rounded-lg border border-gray-800 bg-[#0f1018] p-3 text-left transition-colors hover:bg-white/5"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-gray-100">{event.organizationName}</div>
                              <Badge value="new_device" />
                            </div>
                            <div className="mt-1 text-xs text-gray-500">{event.userLabel} · {event.deviceLabel}</div>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <DetailItem label="First seen" value={formatDate(event.occurredAt)} />
                              <DetailItem label="Trusted public IP" value={event.publicIp || 'Not recorded'} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ModalCard>

                  {/* BOTTOM LEFT — Public IP Changes */}
                  <ModalCard
                    title="Public IP Changes"
                    description="Bounded trusted public-IP change evidence across contractor accounts."
                    scrollable
                  >
                    {ipChangeEvents.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No public-IP changes recorded.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {ipChangeEvents.map((event) => (
                          <button
                            key={`${event.organizationId}-${event.sessionId}-${event.occurredAt}-ip`}
                            type="button"
                            onClick={() => openContractorFromAlert(event.organizationId)}
                            className="w-full rounded-lg border border-gray-800 bg-[#0f1018] p-3 text-left transition-colors hover:bg-white/5"
                          >
                            <div className="text-sm font-semibold text-gray-100">{event.organizationName}</div>
                            <div className="mt-1 text-xs text-gray-500">{event.userLabel} · {event.deviceLabel}</div>
                            <div className="mt-3 grid grid-cols-1 gap-2">
                              <DetailItem
                                label="OLD IP → NEW IP"
                                value={`${event.previousPublicIp || 'Unknown'} → ${event.publicIp || 'Unknown'}`}
                              />
                              <DetailItem label="Occurred" value={formatDate(event.occurredAt)} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ModalCard>

                  {/* BOTTOM RIGHT — Security Timeline */}
                  <ModalCard
                    title="Security Timeline"
                    description="Bounded cross-account security history. Marking alerts viewed does not delete history."
                    scrollable
                  >
                    {presenceSecurityHistory.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                        No trusted public-IP security events recorded yet.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {presenceSecurityHistory.map((event) => (
                          <button
                            key={`${event.organizationId}-${event.sessionId}-${event.occurredAt}-${event.eventType}-timeline`}
                            type="button"
                            onClick={() => openContractorFromAlert(event.organizationId)}
                            className="w-full rounded-lg border border-gray-800 bg-[#0f1018] p-3 text-left transition-colors hover:bg-white/5"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-gray-100">{timelineEventLabel(event)}</div>
                              {event.isNewDevice ? <Badge value="new_device" /> : null}
                              {event.eventType === 'ip_changed' ? <PresenceBadge status="offline" /> : null}
                              {!event.isAlert && event.eventType === 'session_started' ? <Badge value="known_device" /> : null}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {event.organizationName} · {event.userLabel} · {event.deviceLabel}
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <DetailItem label="Occurred" value={formatDate(event.occurredAt)} />
                              <DetailItem label="Public IP" value={event.publicIp || 'Not recorded'} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ModalCard>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Contractor detail modal — 2×2 grid layout ─────────────────────── */}
      {showContractorDetail && selectedAccount && (
        <div
          data-testid="contractor-detail-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedOrganizationId(null) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Contractor details: ${selectedAccount.organizationName || selectedAccount.organizationId}`}
            className="flex max-h-[90vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-gray-800 bg-[#0d0e14] shadow-2xl"
          >
            {/* Modal header — compact metadata */}
            <div className="shrink-0 border-b border-gray-800 bg-[#11121a] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">Contractor account</div>
                  <div className="mt-0.5 truncate text-xl font-semibold leading-tight text-gray-100">
                    {selectedAccount.organizationName || 'Unnamed organization'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrganizationId(null)}
                  aria-label="Close contractor details"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-gray-800"
                >
                  <X size={12} /> Close
                </button>
              </div>

              {/* Compact metadata grid */}
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                <CompactMeta label="Owner full name" value={selectedAccount.ownerFullName || 'Unknown'} />
                <CompactMeta label="Owner email" value={selectedAccount.ownerEmail || 'Not available'} />
                <CompactMeta label="Organization ID" value={selectedAccount.organizationId} />
                <CompactMeta label="Account status" badge={selectedAccount.accountStatus} />
                <CompactMeta label="Onboarding status" badge={selectedAccount.onboardingStatus} />
                <CompactMeta label="NDA state" badge={selectedAccount.ndaState} />
                <CompactMeta label="Classification" badge={selectedAccount.classification} />
                <CompactMeta label="Last activity" value={formatOptionalDate(selectedAccount.lastActivityAt)} />
                <CompactMeta label="Last login" value={formatOptionalDate(selectedAccount.lastLoginAt)} />
                <CompactMeta label="Employee count" value={String(selectedAccount.employeeCount)} />
                <CompactMeta label="User / member count" value={String(selectedAccount.memberCount)} />
                <CompactMeta label="Agreement" value={buildAgreementSummary(selectedAccount)} />
              </div>

              <div className="mt-4 rounded-xl border border-gray-800 bg-[#0f1018] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">Users / Access</div>
                    <div className="mt-1 text-[11px] text-gray-500">Canonical profile-backed users for this contractor organization.</div>
                  </div>
                </div>

                {selectedPresenceDetailLoading && !selectedPresenceDetail ? (
                  <div className="mt-3 text-xs text-gray-500">Loading user access...</div>
                ) : selectedUserAccess.length === 0 ? (
                  <div className="mt-3 text-xs text-gray-500">No canonical profile-backed users were returned for this contractor.</div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {selectedUserAccess.map((userAccess) => (
                      <div key={userAccess.userId} className="flex flex-col gap-2 rounded-lg border border-gray-800 bg-[#11121a] px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-gray-100">{userAccess.name || userAccess.email || userAccess.userId}</div>
                          <div className="truncate text-[11px] text-gray-500">
                            {[userAccess.email || 'No email', userAccess.role || 'No role'].join(' · ')}
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500">
                            {userAccess.isActive
                              ? (userAccess.restoredAt ? `Restored ${formatOptionalDate(userAccess.restoredAt)}` : 'Access is active')
                              : `Revoked ${formatOptionalDate(userAccess.revokedAt)}`}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge value={userAccess.isActive ? 'active' : 'revoked'} />
                          <button
                            type="button"
                            disabled={userAccessMutatingUserId === userAccess.userId}
                            onClick={() => void handleUserAccessAction(userAccess)}
                            className={`inline-flex items-center rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50 ${
                              userAccess.isActive
                                ? 'border-red-900/60 bg-red-950/40 text-red-300'
                                : 'border-green-900/60 bg-green-950/30 text-green-300'
                            }`}
                          >
                            {userAccessMutatingUserId === userAccess.userId
                              ? (userAccess.isActive ? 'Revoking...' : 'Restoring...')
                              : (userAccess.isActive ? 'Revoke Access' : 'Restore Access')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedPresenceDetail?.employeeOnlyIdentityNotice && (
                  <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
                    {selectedPresenceDetail.employeeOnlyIdentityNotice}
                  </div>
                )}
              </div>
            </div>

            {/* 2×2 operational grid */}
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

                {/* TOP LEFT — Live Presence / Sessions */}
                <ModalCard
                  title="Live Presence / Sessions"
                  description="Status derived from server time using heartbeat, visibility, and recent human interaction."
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
                    <div className="grid grid-cols-2 gap-3">
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
                </ModalCard>

                {/* TOP RIGHT — Devices */}
                <ModalCard
                  title="Devices"
                  description="Tabs remain separate sessions. Device counts based on stable device IDs; unknown device IDs grouped safely."
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
                          <div className="mt-3 grid grid-cols-2 gap-2">
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
                </ModalCard>

                {/* BOTTOM LEFT — Recent Sessions */}
                <ModalCard
                  title="Recent Sessions"
                  description="Session status, module, visibility, start, last interaction, last heartbeat, and ended reason."
                  scrollable
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
                          <div className="mt-3 grid grid-cols-2 gap-2">
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
                </ModalCard>

                {/* BOTTOM RIGHT — Security History */}
                <ModalCard
                  title="Security History"
                  description="Founder-only trusted public-IP evidence from the server path. Raw IP never leaves Guardian founder surfaces."
                  scrollable
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
                          <div className="mt-3 grid grid-cols-2 gap-2">
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
                </ModalCard>

              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default FounderContractorAdminSurface
