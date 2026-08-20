import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Activity,
  Headset,
  Loader2,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
} from 'lucide-react'
import {
  fetchFounderContractorAdminReport,
  type FounderContractorAccount,
} from '@/services/founderContractorAdminService'
import {
  fetchFounderPilotReport,
  logFounderSupportIncident,
  setOrganizationPilotClassification,
  type FounderPilotRecentActivity,
  type FounderPilotReport,
} from '@/services/pilotTelemetryClient'

export type FounderPilotOperationsSection = 'activity' | 'support'

const editableClassifications = new Set(['customer_zero', 'design_partner', 'normal'])

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function formatEventLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

function formatMetadataValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => `${key}: ${formatMetadataValue(nestedValue)}`)
      .join(' | ')
  }
  return String(value)
}

function classificationForEditor(value: string | null | undefined): 'customer_zero' | 'design_partner' | 'normal' {
  return editableClassifications.has(String(value || '')) ? value as 'customer_zero' | 'design_partner' | 'normal' : 'normal'
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-[#11121a] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-100">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#11121a] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 text-sm text-gray-100">{value}</div>
    </div>
  )
}

export interface FounderSupportOrganizationOption {
  organizationId: string
  organizationName: string
  createdAt: string
  classification: string
}

export function buildSupportOrganizationOptions(
  accounts: Array<Pick<FounderContractorAccount, 'organizationId' | 'organizationName' | 'createdAt' | 'classification'>>,
): FounderSupportOrganizationOption[] {
  return accounts.map((account) => ({
    organizationId: account.organizationId,
    organizationName: account.organizationName,
    createdAt: account.createdAt,
    classification: account.classification,
  }))
}

export function reconcileSelectedOrganizationId(
  currentId: string | null,
  organizations: Array<{ organizationId: string }>,
): string | null {
  if (!currentId) return null
  return organizations.some((organization) => organization.organizationId === currentId) ? currentId : null
}

export function FounderPilotOperationsSurface({ section }: { section: FounderPilotOperationsSection }) {
  const [report, setReport] = useState<FounderPilotReport | null>(null)
  const [supportOrganizations, setSupportOrganizations] = useState<FounderSupportOrganizationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)
  const [classificationValue, setClassificationValue] = useState<'customer_zero' | 'design_partner' | 'normal'>('design_partner')
  const [classificationStatus, setClassificationStatus] = useState<string | null>(null)
  const [classificationSaving, setClassificationSaving] = useState(false)
  const [supportCategory, setSupportCategory] = useState('onboarding')
  const [supportNote, setSupportNote] = useState('')
  const [supportMinutes, setSupportMinutes] = useState('')
  const [supportStatus, setSupportStatus] = useState<string | null>(null)
  const [supportSaving, setSupportSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (section === 'activity') {
        setReport(await fetchFounderPilotReport())
        setSupportOrganizations([])
      } else {
        const [contractorReport, pilotReport] = await Promise.all([
          fetchFounderContractorAdminReport(),
          fetchFounderPilotReport().catch(() => null),
        ])
        setSupportOrganizations(buildSupportOrganizationOptions(contractorReport.contractorAccounts))
        setReport(pilotReport)
      }
    } catch (err) {
      setReport(null)
      setSupportOrganizations([])
      setError(err instanceof Error ? err.message : 'Founder pilot report could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [section])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const organizations = section === 'support' ? supportOrganizations : (report?.allOrganizations ?? [])
    setSelectedOrganizationId((current) => reconcileSelectedOrganizationId(current, organizations))
  }, [report, section, supportOrganizations])

  const selectedOrganization = useMemo(
    () => (
      section === 'support'
        ? supportOrganizations.find((organization) => organization.organizationId === selectedOrganizationId) ?? null
        : report?.allOrganizations.find((organization) => organization.organizationId === selectedOrganizationId) ?? null
    ),
    [report, section, selectedOrganizationId, supportOrganizations],
  )
  const selectedOrganizationReport = useMemo(
    () => report?.organizations.find((organization) => organization.organizationId === selectedOrganizationId) ?? null,
    [report, selectedOrganizationId],
  )

  useEffect(() => {
    setClassificationStatus(null)
    setSupportStatus(null)
    setSupportCategory('onboarding')
    setSupportNote('')
    setSupportMinutes('')
    setClassificationValue(classificationForEditor(selectedOrganization?.classification))
  }, [selectedOrganization?.organizationId, selectedOrganization?.classification])

  async function handleClassificationSave() {
    if (!selectedOrganizationId) return
    setClassificationSaving(true)
    setClassificationStatus(null)
    const result = await setOrganizationPilotClassification({
      organizationId: selectedOrganizationId,
      classification: classificationValue,
    })
    setClassificationSaving(false)
    if (!result.ok) {
      setClassificationStatus(result.error || 'Classification update failed.')
      return
    }
    setClassificationStatus('Classification updated.')
    await load()
  }

  async function handleSupportSave() {
    if (!selectedOrganizationId) return
    setSupportSaving(true)
    setSupportStatus(null)
    const result = await logFounderSupportIncident({
      organizationId: selectedOrganizationId,
      category: supportCategory,
      note: supportNote,
      minutesSpent: supportMinutes ? Number(supportMinutes) : null,
    })
    setSupportSaving(false)
    if (!result.ok) {
      setSupportStatus(result.error || 'Support incident failed.')
      return
    }
    setSupportStatus('Support incident recorded.')
    setSupportNote('')
    setSupportMinutes('')
    await load()
  }

  const title = section === 'activity' ? 'Pilot Activity' : 'Support'
  const Icon = section === 'activity' ? Activity : Headset

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

      {error && (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error.includes('403') || error.includes('Founder access') ? 'Founder access is required for this cross-organization dataset.' : error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading founder data...</div>
      ) : section === 'activity' ? (!report ? null : (
        <div className="flex h-full flex-col gap-4 overflow-auto p-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <SummaryCard label="Pilot orgs" value={String(report.summary.totalPilotOrganizations)} />
            <SummaryCard label="Activated orgs" value={String(report.summary.activatedOrganizations)} />
            <SummaryCard label="Weekly active orgs" value={String(report.summary.weeklyActiveOrganizations)} />
            <SummaryCard label="Weekly active users" value={String(report.summary.weeklyActiveUsers)} />
          </div>

          <div className="rounded-xl border border-gray-800 bg-[#10121a]">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="text-sm font-semibold text-gray-100">Recent pilot activity</div>
              <div className="mt-1 text-xs text-gray-500">Founder-visible operational telemetry only. Customer, project, estimate, and Blueprint content stays excluded.</div>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-[#0f1018]">
                  <tr>
                    {['Organization', 'Classification', 'Activity', 'Module / Feature', 'Timestamp', 'Metadata'].map((label) => (
                      <th key={label} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {report.recentActivity.map((entry: FounderPilotRecentActivity) => {
                    const metadataEntries = Object.entries(entry.metadata)
                    return (
                      <tr key={`${entry.organizationId}-${entry.eventName}-${entry.occurredAt}`}>
                        <td className="px-4 py-3 align-top text-xs text-gray-300">
                          <div className="font-semibold text-gray-100">{entry.organizationName}</div>
                          <div className="mt-1 text-[11px] text-gray-500">{entry.organizationId}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-gray-300">{entry.classification}</td>
                        <td className="px-4 py-3 align-top text-xs text-gray-300">{formatEventLabel(entry.eventName)}</td>
                        <td className="px-4 py-3 align-top text-xs text-gray-300">
                          {[entry.module, entry.feature].filter(Boolean).join(' / ') || '-'}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-gray-300">{formatDate(entry.occurredAt)}</td>
                        <td className="px-4 py-3 align-top text-xs text-gray-300">
                          {metadataEntries.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {metadataEntries.map(([key, value]) => (
                                <span key={key} className="rounded-full border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] text-gray-400">
                                  {key}: {formatMetadataValue(value)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {report.recentActivity.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                        No pilot activity is available for the current pilot cohort.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )) : (
        <div className="flex h-full flex-col gap-4 overflow-auto p-4 xl:flex-row">
          <div className="w-full xl:max-w-[340px]">
            <div className="rounded-xl border border-gray-800 bg-[#10121a] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">Selected contractor context</div>
              <label className="mt-3 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-gray-600">
                Contractor organization
                <select
                  value={selectedOrganizationId ?? ''}
                  onChange={(event) => setSelectedOrganizationId(event.target.value || null)}
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm normal-case text-gray-200 outline-none"
                >
                  <option value="">Select organization</option>
                  {supportOrganizations.map((organization) => (
                    <option key={organization.organizationId} value={organization.organizationId}>
                      {organization.organizationName}
                    </option>
                  ))}
                </select>
              </label>

              {selectedOrganization ? (
                <div className="mt-4 grid grid-cols-1 gap-3">
                  <DetailRow label="Organization" value={selectedOrganization.organizationName} />
                  <DetailRow label="Organization ID" value={selectedOrganization.organizationId} />
                  <DetailRow label="Classification" value={selectedOrganization.classification} />
                  <DetailRow label="Created" value={formatDate(selectedOrganization.createdAt)} />
                  <DetailRow
                    label="Pilot summary"
                    value={selectedOrganizationReport
                      ? `${selectedOrganizationReport.projectsCreated} projects, ${selectedOrganizationReport.estimatesCreated} estimates, ${selectedOrganizationReport.founderSupportIncidentCount} support incidents`
                      : 'Not currently in the pilot activity summary cohort.'}
                  />
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-gray-800 bg-[#0f1018] px-4 py-6 text-center text-sm text-gray-500">
                  Select a contractor to manage classification and support operations.
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="rounded-xl border border-gray-800 bg-[#10121a] p-4">
              <div className="text-sm font-semibold text-gray-100">Pilot classification</div>
              <div className="mt-1 text-xs text-gray-500">Uses the existing canonical organization pilot classification authority.</div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-gray-600">
                  Classification
                  <select
                    value={classificationValue}
                    onChange={(event) => setClassificationValue(event.target.value as 'customer_zero' | 'design_partner' | 'normal')}
                    disabled={!selectedOrganizationId || classificationSaving}
                    className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm normal-case text-gray-200 outline-none disabled:opacity-50"
                  >
                    <option value="design_partner">design_partner</option>
                    <option value="customer_zero">customer_zero</option>
                    <option value="normal">normal</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!selectedOrganizationId || classificationSaving}
                  onClick={() => void handleClassificationSave()}
                  className="inline-flex h-[38px] items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-bold text-slate-950 disabled:opacity-50"
                >
                  {classificationSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save Classification
                </button>
              </div>
              {classificationStatus && (
                <div className={`mt-3 text-xs ${classificationStatus.includes('updated') ? 'text-green-400' : 'text-red-300'}`}>
                  {classificationStatus}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-800 bg-[#10121a] p-4">
              <div className="text-sm font-semibold text-gray-100">Founder support incident</div>
              <div className="mt-1 text-xs text-gray-500">Logs a founder-only support event through the existing pilot telemetry path.</div>
              <div className="mt-4 grid grid-cols-1 gap-3">
                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-gray-600">
                  Category
                  <select
                    value={supportCategory}
                    onChange={(event) => setSupportCategory(event.target.value)}
                    disabled={!selectedOrganizationId || supportSaving}
                    className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm normal-case text-gray-200 outline-none disabled:opacity-50"
                  >
                    {['onboarding', 'login/auth', 'employee', 'blueprint', 'estimate', 'project', 'data/sync', 'bug', 'how-to', 'other'].map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-gray-600">
                  Minutes spent
                  <input
                    value={supportMinutes}
                    onChange={(event) => setSupportMinutes(event.target.value)}
                    disabled={!selectedOrganizationId || supportSaving}
                    className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm normal-case text-gray-200 outline-none disabled:opacity-50"
                    placeholder="Optional"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-gray-600">
                  Short non-sensitive note
                  <textarea
                    value={supportNote}
                    onChange={(event) => setSupportNote(event.target.value)}
                    disabled={!selectedOrganizationId || supportSaving}
                    rows={4}
                    className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm normal-case text-gray-200 outline-none disabled:opacity-50"
                    placeholder="Keep this operational and non-sensitive."
                  />
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!selectedOrganizationId || supportSaving}
                    onClick={() => void handleSupportSave()}
                    className="inline-flex h-[38px] items-center justify-center gap-2 rounded-lg bg-green-600 px-4 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {supportSaving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Record Incident
                  </button>
                  {supportStatus && (
                    <span className={`text-xs ${supportStatus.includes('recorded') ? 'text-green-400' : 'text-red-300'}`}>
                      {supportStatus}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FounderPilotOperationsSurface
