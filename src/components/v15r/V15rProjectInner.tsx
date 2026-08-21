// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { getBackupData, saveBackupData, getOverallCompletion, health, fmt } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import V15rEstimateTab from './V15rEstimateTab'
import V15rMTOTab from './V15rMTOTab'
import V15rProgressTab from './V15rProgressTab'
import V15rFrameworkTab from './V15rFrameworkTab'
import V15rRFITab from './V15rRFITab'
import V15rChangeOrdersTab from './V15rChangeOrdersTab'
import V15rCoordinationTab from './V15rCoordinationTab'
import V15rBlueprintsTab from './V15rBlueprintsTab'
import V15rPhaseTimelineTab from './V15rPhaseTimelineTab'
import V15rProjectLogsTab from './V15rProjectLogsTab'
import ProjectSummaryBoxes from '@/components/v15r/ProjectSummaryBoxes'
import { InvoiceDraftsModal } from '@/features/billing-draft/components/InvoiceDraftsModal'
import { PrepareInvoiceModal } from '@/features/billing-draft/components/PrepareInvoiceModal'
import { QuickBooksMenu } from '@/features/billing-draft/components/QuickBooksMenu'
import { useQuickBooksInvoicing } from '@/features/billing-draft/useQuickBooksInvoicing'
import { useQuickBooksCustomerMapping } from '@/features/quickbooks-customer-mapping/useQuickBooksCustomerMapping'
import { useCanonicalCustomerDirectory } from '@/features/quickbooks-customer-mapping/useCanonicalCustomerDirectory'
import { isCanonicalCustomerId } from '@/features/quickbooks-customer-mapping/resolvePowerOnCustomerDirectory'
import { LinkQuickBooksCustomerModal } from '@/features/quickbooks-customer-mapping/components/LinkQuickBooksCustomerModal'
import { ResolvePowerOnCustomerModal } from '@/features/quickbooks-customer-mapping/components/ResolvePowerOnCustomerModal'

interface V15rProjectInnerProps {
  projectId: string
  activeTab?: string
  onTabChange?: (tab: string) => void
  onClose?: () => void
}

// Map external tab IDs (from sidebar nav) to internal tab IDs
function mapExternalToInternalTab(externalTab?: string): string {
  const mapping: Record<string, string> = {
    'estimate': 'estimate',
    'material-takeoff': 'mto',
    'progress': 'progress',
    'project-logs': 'project-logs',
    'framework': 'framework',
    'rfi-tracker': 'rfi',
    'change-orders': 'change-orders',
    'coordination': 'coord',
    'blueprints': 'blueprints',
    'phase-timeline': 'phase-timeline',
  }
  return mapping[externalTab || 'estimate'] || 'estimate'
}

export default function V15rProjectInner({ projectId, activeTab: propActiveTab, onTabChange, onClose }: V15rProjectInnerProps) {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const [localTab, setLocalTab] = useState(mapExternalToInternalTab(propActiveTab))
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [prepareInvoiceOpen, setPrepareInvoiceOpen] = useState(false)
  // QBO-4A.4 Task 11 — contextual QuickBooks customer-mapping entry point. The
  // reconciled customer UUID comes from the project's accountId (verified UUID
  // only — never the project name). The menu item is offered ONLY when that
  // identity is known; the global header never gets this item.
  const [linkCustomerOpen, setLinkCustomerOpen] = useState(false)
  // QBO-4A.5 — Resolve PowerOn Customer modal (STATE 1, unresolved identity).
  // Open ONLY when the project's customer is a name snapshot with no reconciled
  // UUID. Once resolved, the menu switches to the normal "Link QuickBooks Customer"
  // item (STATE 2/3).
  const [resolveOpen, setResolveOpen] = useState(false)
  const qb = useQuickBooksInvoicing()
  const openPrepareInvoice = useCallback(() => {
    qb.clearPrepareDraft()
    setPrepareInvoiceOpen(true)
  }, [qb])
  const closePrepareInvoice = useCallback(() => {
    setPrepareInvoiceOpen(false)
    qb.clearPrepareDraft()
  }, [qb])

  // Sync local tab with prop changes
  React.useEffect(() => {
    const newTab = mapExternalToInternalTab(propActiveTab)
    setLocalTab(newTab)
  }, [propActiveTab])

  // Re-render when remote data sync fires (cross-device realtime updates)
  React.useEffect(() => {
    const handler = () => forceUpdate()
    window.addEventListener('poweron-data-saved', handler)
    return () => window.removeEventListener('poweron-data-saved', handler)
  }, [forceUpdate])

  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()
  // QBO-4A.6: canonical PowerOn customer identity authority (relationship_accounts.id,
  // a TEXT PK — NOT a UUID). Shared fetch (module-cached across surfaces). Called
  // before early returns so the hook order is unconditional.
  const canonicalDirectory = useCanonicalCustomerDirectory()
  const canonicalIds = canonicalDirectory.canonicalIds
  // Canonical customer id for this project (a real relationship_accounts.id only).
  // Looked up before the early returns so the mapping hook is always called unconditionally.
  const projectCustomerId = (() => {
    const proj = backup?.projects.find((x) => x.id === projectId)
    return proj && isCanonicalCustomerId(proj.accountId, canonicalIds) ? proj.accountId : null
  })()
  // QBO-4A.4 — drives the contextual "Link QuickBooks Customer" menu label + modal.
  const customerMapping = useQuickBooksCustomerMapping({ poweronCustomerId: projectCustomerId })
  if (!backup) return <div className="text-red-400 p-4">No backup data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div className="text-red-400 p-4">Project not found</div>

  // QBO-4A.4 Task 11 — contextual menu label reflects the LIVE mapping state.
  // Identity must be a known UUID to offer the item at all (locked rule: never
  // add to the permanent global menu / never match by name).
  const customerLinkLabel =
    customerMapping.state.kind === 'linked'
      ? `QuickBooks Customer: ${customerMapping.state.customer.displayName || 'Linked'}`
      : 'Link QuickBooks Customer'
  const customerDirectory = (backup.gcContacts || []).map((c) => ({
    id: c.id, company: c.company || null, contact: c.contact || null,
    email: c.email || null, phone: c.phone || null,
  }))

  // QBO-4A.5 — persist the owner-confirmed reconciled relationship_accounts UUID
  // onto the CURRENT project's canonical accountId field (the existing path), then
  // refresh local state so the QBO mapping hook receives the UUID without a page
  // reload. Mirrors V15rLeadsPanel's persistence pattern. Resolves ONLY this one
  // record — never backfills other projects, never matches by name.
  const resolveProjectCustomer = useCallback((accountUuid: string) => {
    const b = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()
    if (!b) return
    b.projects = (b.projects || []).map((r) =>
      r.id === projectId ? { ...r, accountId: accountUuid } : r
    )
    pushState()
    saveBackupData(b)
    forceUpdate()
  }, [projectId, hasHydrated, isDemoMode, forceUpdate])

  const h = health(p, backup)
  const completion = Math.round(getOverallCompletion(p, backup))

  const tabs = [
    { id: 'estimate', label: 'Estimate', component: V15rEstimateTab },
    { id: 'mto', label: 'Material Takeoff', component: V15rMTOTab },
    { id: 'progress', label: 'Progress', component: V15rProgressTab },
    { id: 'project-logs', label: 'Project Logs', component: V15rProjectLogsTab },
    { id: 'framework', label: 'Framework', component: V15rFrameworkTab },
    { id: 'rfi', label: 'RFI Tracker', component: V15rRFITab },
    { id: 'change-orders', label: 'Change Orders', component: V15rChangeOrdersTab },
    { id: 'coord', label: 'Coordination', component: V15rCoordinationTab },
    { id: 'blueprints', label: '📐 Blueprints', component: V15rBlueprintsTab },
    { id: 'phase-timeline', label: '📅 Phase Timeline', component: V15rPhaseTimelineTab },
  ]

  const ActiveComponent = tabs.find(t => t.id === localTab)?.component || V15rEstimateTab

  const handleTabClick = (tabId: string) => {
    setLocalTab(tabId)
    if (onTabChange) {
      // Map internal tab IDs back to external names for parent
      const reverseMapping: Record<string, string> = {
        'estimate': 'estimate',
        'mto': 'material-takeoff',
        'progress': 'progress',
        'project-logs': 'project-logs',
        'framework': 'framework',
        'rfi': 'rfi-tracker',
        'change-orders': 'change-orders',
        'coord': 'coordination',
        'blueprints': 'blueprints',
        'phase-timeline': 'phase-timeline',
      }
      onTabChange(reverseMapping[tabId] || tabId)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#1a1d27' }}>
      <div
        className="sticky top-0 z-40 border-b"
        style={{ backgroundColor: '#232738', borderColor: 'rgba(255,255,255,0.05)', paddingBottom: '12px' }}
      >
        <div className="px-4 py-3">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--t1)' }}>
                {p.name}
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>
                {p.type} • Health: <span style={{ color: h.clr }}>{h.sc}%</span> • {completion}% complete
              </p>
            </div>
            <div className="flex items-center gap-2">
              <QuickBooksMenu
                onPrepareInvoice={openPrepareInvoice}
                onOpenDrafts={qb.openDrafts}
                onLinkCustomer={projectCustomerId ? () => setLinkCustomerOpen(true) : undefined}
                customerLinkLabel={customerLinkLabel}
                onResolveCustomer={!projectCustomerId ? () => setResolveOpen(true) : undefined}
              />
              {onClose && (
                <button
                  onClick={onClose}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: 'rgba(59,130,246,0.2)',
                    color: '#3b82f6',
                    border: '1px solid rgba(59,130,246,0.3)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  ← Back to Projects
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className="px-3 text-sm font-medium whitespace-nowrap rounded-t transition-colors flex-shrink-0"
                style={{
                  minHeight: '44px', // iOS touch target minimum
                  backgroundColor: localTab === tab.id ? 'rgba(59,130,246,0.5)' : 'transparent',
                  color: localTab === tab.id ? '#fff' : 'var(--t3)',
                  borderBottom: localTab === tab.id ? '2px solid #3b82f6' : 'none',
                  fontSize: '14px',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Project Summary Boxes: Total Hours / Materials / Miles / Log Count / Remaining / Collected */}
      <ProjectSummaryBoxes projectId={projectId} backup={backup} />

      <div className="flex-1 overflow-auto p-4">
        <ActiveComponent projectId={projectId} onUpdate={forceUpdate} backup={backup} />
      </div>

      <PrepareInvoiceModal
        open={prepareInvoiceOpen}
        source={qb.prepareDraft ? null : { kind: 'project', project: p, backup }}
        initialDraft={qb.prepareDraft}
        onClose={closePrepareInvoice}
        onSaveDraft={qb.handleSaveDraft}
        onApprove={qb.handleApprove}
        // QBO-4A.5 — let Prepare Invoice resolve the project's customer identity
        // in place (NON-GATING: Save Draft / Approve remain usable while unresolved).
        onResolveCustomer={resolveProjectCustomer}
        // QBO-2C: route payment correction to the EXISTING canonical Project Log
        // workflow (where payment logs are added/edited/deleted with `collected`),
        // not a local modal override. No mutation is performed inside Prepare Invoice.
        onReviewPayments={() => {
          setPrepareInvoiceOpen(false)
          setLocalTab('project-logs')
        }}
      />

      {/* QBO-2F: shared organization-wide Invoice Drafts manager (Project + Service). */}
      <InvoiceDraftsModal
        open={qb.draftsOpen}
        onClose={qb.closeDrafts}
        onOpenDraft={(draft) => {
          // Reopen in the Prepare Invoice modal (EDIT mode). rehydrateSource()
          // inside the modal resolves the source live (by id) when the Project/Service
          // still exists, and otherwise falls back to a synthetic source that preserves
          // the saved invoice content. No financial truth is touched.
          qb.openDraftForEdit(draft)
          setPrepareInvoiceOpen(true)
        }}
        refreshKey={qb.refreshDraftsKey}
      />

      {/* QBO-4A.4 Task 11/12 — the single reusable Link QuickBooks Customer modal,
          opened from the contextual menu item. Owns search/create/link/view/unlink/
          change. NON-GATING: nothing in PowerOn waits on this mapping. */}
      <LinkQuickBooksCustomerModal
        open={linkCustomerOpen}
        onClose={() => setLinkCustomerOpen(false)}
        api={customerMapping}
        poweronCustomerId={projectCustomerId}
        customerName={p.name}
        customerDirectory={customerDirectory}
      />

      {/* QBO-4A.5/4A.6 — the explicit "Resolve PowerOn Customer" modal (STATE 1). Opened
          from the contextual menu when the project's customer is a name snapshot with
          no canonical PowerOn identity. The host persists the confirmed canonical id
          onto the project's accountId; this modal owns NO persistence. Directory +
          canonicalIds come from the shared useCanonicalCustomerDirectory fetch. */}
      <ResolvePowerOnCustomerModal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        currentName={p.name}
        directory={canonicalDirectory.directory.length ? canonicalDirectory.directory : customerDirectory}
        canonicalIds={canonicalIds}
        loading={canonicalDirectory.loading}
        onConfirm={(uuid) => {
          resolveProjectCustomer(uuid)
          setResolveOpen(false)
        }}
      />
    </div>
  )
}
