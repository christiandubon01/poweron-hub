// @ts-nocheck
/**
 * AppShell — PowerOn Hub v15r-matching shell.
 *
 * Uses V15rLayout for the top bar + sidebar, renders all v15r panels.
 * AI agent panels are lazy-loaded to prevent import-time crashes.
 *
 * V3 Integration: 14 new views, Watermark, ConclusionCards, SessionDebrief,
 * NDA gate, and role-based sidebar filtering wired in.
 */

import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { getBackupData } from '@/services/backupDataService'
import { useReadOnly } from '@/contexts/ReadOnlyContext'
import { useDemoStore } from '@/store/demoStore'
import { useUIStore } from '@/store/uiStore'
import Watermark from '@/components/Watermark'
import ConclusionCards from '@/components/ConclusionCards'
import ProactiveAlertCards from '@/components/ProactiveAlertCards'
import SessionDebrief from '@/components/SessionDebrief'
import { hasUserSignedNDA } from '@/services/ndaService'
import { validateInviteToken, markInviteAccepted } from '@/services/inviteService'
// INT-1 — Guardian agent connections (registers cross-agent compliance listeners on startup)
import { registerAllListeners } from '@/services/guardian/GuardianAgentConnections'
// INT-1 — Onboarding service (checks user_onboarding table for V4-OB1 first-run check)
import { isOnboardingComplete } from '@/services/onboarding/OnboardingService'

// v15r layout shell
import V15rLayout from '@/components/v15r/V15rLayout'

// ── Chunk-retry helper — reloads page on stale chunk fetch after deployment ───
// If a lazy import fails (e.g. old chunk hash after a redeploy), reload once
// so the browser fetches the latest bundle instead of crashing the whole app.
function chunkRetry(importFn: () => Promise<any>) {
  return importFn().catch(() => {
    window.location.reload()
    return { default: () => null }
  })
}

// v15r panels — all lazy-loaded to keep recharts and heavy deps out of main bundle
const V15rHome = lazy(() => chunkRetry(() => import('@/components/v15r/V15rHome')))
const V15rProjectsPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rProjectsPanel')))
const V15rProjectInner = lazy(() => chunkRetry(() => import('@/components/v15r/V15rProjectInner')))
const V15rFieldLogPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rFieldLogPanel')))
const V15rMoneyPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rMoneyPanel')))
const V15rIncomeCalc = lazy(() => chunkRetry(() => import('@/components/v15r/V15rIncomeCalc')))
const V15rPriceBookPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rPriceBookPanel')))
const V15rLeadsPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rLeadsPanel')))
const V15rTemplatesPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rTemplatesPanel')))
const V15rSettingsPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rSettingsPanel')))
const V15rTeamPanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rTeamPanel')))
const V15rDashboard = lazy(() => chunkRetry(() => import('@/components/v15r/V15rDashboard')))
const V15rPricingIntelligencePanel = lazy(() => chunkRetry(() => import('@/components/v15r/V15rPricingIntelligencePanel')))

// AI agent panels — lazy-loaded so import errors don't crash the main shell
const NexusChatPanel = lazy(() => import('@/components/nexus/NexusChatPanel').then(m => ({ default: m.NexusChatPanel })).catch(() => { window.location.reload(); return { default: () => null } }))
const MarketingPanel = lazy(() => import('@/components/spark/MarketingPanel').then(m => ({ default: m.MarketingPanel })).catch(() => { window.location.reload(); return { default: () => null } }))
const SchedulePanel  = lazy(() => import('@/components/chrono/SchedulePanel').then(m => ({ default: m.SchedulePanel })).catch(() => { window.location.reload(); return { default: () => null } }))
const CodePanel      = lazy(() => import('@/components/ohm/CodePanel').then(m => ({ default: m.CodePanel })).catch(() => { window.location.reload(); return { default: () => null } }))
const OhmCalculator  = lazy(() => import('@/components/ohm/Calculator').then(m => ({ default: m.Calculator })).catch(() => { window.location.reload(); return { default: () => null } }))
const ProposalFeed   = lazy(() => import('@/components/proposals/ProposalFeed').then(m => ({ default: m.ProposalFeed })).catch(() => { window.location.reload(); return { default: () => null } }))
const VoiceSettings  = lazy(() => import('@/components/voice/VoiceSettings').then(m => ({ default: m.VoiceSettings })).catch(() => { window.location.reload(); return { default: () => null } }))

// Activity log panel (lazy-loaded)
const ActivityPanel = lazy(() => import('@/components/ActivityPanel').then(m => ({ default: m.ActivityPanel })).catch(() => { window.location.reload(); return { default: () => null } }))

// GUARDIAN panel (lazy-loaded)
const GuardianPanel = lazy(() => import('@/components/guardian/GuardianPanel').then(m => ({ default: m.GuardianPanel })).catch(() => { window.location.reload(); return { default: () => null } }))

// Voice journal panel (lazy-loaded)
const JournalPanel = lazy(() => import('@/components/JournalPanel').then(m => ({ default: m.JournalPanel })).catch(() => { window.location.reload(); return { default: () => null } }))

// Agent Mode Selector view (lazy-loaded) — uses default export (not named)
const AgentModeSelector = lazy(() => chunkRetry(() => import('@/views/AgentModeSelector')))

// Demo Mode view (lazy-loaded) — E3 | Demo Mode
// B15 fix: use chunkRetry + default export (m.DemoMode was undefined — only default export exists)
const DemoModeView = lazy(() => chunkRetry(() => import('@/views/DemoMode')))

// ── V3 Views — lazy-loaded ────────────────────────────────────────────────────
const BlueprintAI       = lazy(() => chunkRetry(() => import('@/views/BlueprintAI')))
const DebtKiller        = lazy(() => chunkRetry(() => import('@/views/DebtKiller')))
const GuardianView      = lazy(() => chunkRetry(() => import('@/views/GuardianView')))
const LeadRollingTrend  = lazy(() => chunkRetry(() => import('@/views/LeadRollingTrend')))
const MaterialIntel     = lazy(() => chunkRetry(() => import('@/views/MaterialIntelligence')))
const N8nAutomation     = lazy(() => chunkRetry(() => import('@/views/N8nAutomation')))
const NDASigningFlow    = lazy(() => chunkRetry(() => import('@/views/NDASigningFlow')))
const SparkLiveCall     = lazy(() => chunkRetry(() => import('@/views/SparkLiveCall')))
const VaultEstimatePanel = lazy(() => chunkRetry(() => import('@/views/VaultEstimatePanel')))
const VoiceJournalingV2 = lazy(() => chunkRetry(() => import('@/views/VoiceJournalingV2')))
const VoiceHub          = lazy(() => chunkRetry(() => import('@/components/voice/VoiceHub')))
const CrewPortalV3      = lazy(() => chunkRetry(() => import('@/views/CrewPortal')))
const SettingsV3        = lazy(() => chunkRetry(() => import('@/views/Settings')))

// B33 — Admin Visualization Lab (lazy-loaded)
const AdminVisualizationLab = lazy(() => chunkRetry(() => import('@/views/AdminVisualizationLab')))

// B64 — Business Overview placeholder (lazy-loaded)
const BusinessOverview = lazy(() => chunkRetry(() => import('@/views/BusinessOverview')))

// B68 — Business Overview split view (full build)
const BusinessOverviewView = lazy(() => chunkRetry(() => import('@/views/BusinessOverviewView')))

// B50 — Visual Suite Standalone (fullscreen 43-mode display)
const VisualSuiteStandalone = lazy(() => chunkRetry(() => import('@/views/VisualSuiteStandalone')))

// B36 — Admin Command Center (lazy-loaded)
const AdminCommandCenter = lazy(() => chunkRetry(() => import('@/views/AdminCommandCenter')))

// NW1 — Neural World (lazy-loaded)
const NeuralWorldView = lazy(() => chunkRetry(() => import('@/views/NeuralWorldView')))

// NAV1-FIX-VS2 — Neural Map views for Visual Suite sub-tabs
const CommandCenterNeuralMap = lazy(() => chunkRetry(() => import('@/views/CommandCenterNeuralMap')))
const CombinedNeuralMap = lazy(() => chunkRetry(() => import('@/views/CombinedNeuralMap')))

// ── INT-1: New feature views — all lazy-loaded ────────────────────────────────

// Sales Intelligence — unified 5-tab panel (Practice/Live Call/Leads/Pipeline/Coach)
const SalesIntelligenceView = lazy(() => chunkRetry(() => import('@/views/SalesIntelligenceView')))

// Guardian Dashboard — GRD1-6 compliance command center
const GuardianDashboardView = lazy(() => chunkRetry(() => import('@/views/GuardianDashboardView')))

// Diagnostics — lead pipeline diagnostics, scenario simulator, report
const DiagnosticsView = lazy(() => chunkRetry(() => import('@/views/DiagnosticsView')))

// Security — admin-only pen test, threat monitor, key rotation, compliance
const SecurityView = lazy(() => chunkRetry(() => import('@/views/SecurityView')))

// Billing — Stripe billing & subscription management
const BillingView = lazy(() => chunkRetry(() => import('@/views/BillingView')))

// Customer Portal — public-facing service request form
const CustomerPortalView = lazy(() => chunkRetry(() => import('@/views/CustomerPortalView')))

// Portal Lead Inbox — owner-side view of portal submissions
const PortalLeadInboxView = lazy(() => chunkRetry(() => import('@/views/PortalLeadInboxView')))

// Solar Training — quiz engine, NEM 3.0 visualizer, retention heatmap
const SolarTrainingView = lazy(() => chunkRetry(() => import('@/views/SolarTrainingView')))

// NAV1 — New views
// NexusAdminView — merged ORB Lab + NEXUS Admin (route: nexus-admin)
const NexusAdminView = lazy(() => chunkRetry(() => import('@/views/NexusAdminView')))
// AdminToolsView — Agent Intelligence panel (route: admin-tools, owner only)
const AdminToolsView = lazy(() => chunkRetry(() => import('@/views/AdminToolsView')))
// AbsoluteDashboardView — all key metrics in one place (route: absolute-dashboard, sub-tab of business-overview)
const AbsoluteDashboardView = lazy(() => chunkRetry(() => import('@/views/AbsoluteDashboardView')))
// AgentSystemMapView — agent pyramid (route: agent-system-map, embedded in AbsoluteDashboard)
const AgentSystemMapView = lazy(() => chunkRetry(() => import('@/views/AgentSystemMapView')))

// Lazy-load non-critical overlays
const VoiceActivationButton = lazy(() => import('@/components/voice/VoiceActivationButton').then(m => ({ default: m.VoiceActivationButton })).catch(() => { window.location.reload(); return { default: () => null } }))
// B51 — Wins Log floating button + drawer
const WinsLogPanel = lazy(() => import('@/components/v15r/WinsLog/WinsLogPanel').then(m => ({ default: m.WinsLogPanel })).catch(() => ({ default: () => null })))
// B52 — Pinned Insights floating button + panel
const PinnedInsightsButton = lazy(() => import('@/components/v15r/PinnedInsights/PinnedInsightsButton').then(m => ({ default: m.PinnedInsightsButton })).catch(() => ({ default: () => null })))
const OnboardingModal = lazy(() => chunkRetry(() => import('@/components/onboarding/OnboardingModal')))

// Beta onboarding flow — fires once after NDA, checks orgs.onboarding_complete
const BetaOnboarding = lazy(() => chunkRetry(() => import('@/components/onboarding/BetaOnboarding')))

// INT-1 — V4-OB1 OnboardingFlow — AI-driven first-run interview (checks user_onboarding table)
const OnboardingFlow = lazy(() => chunkRetry(() => import('@/components/onboarding/OnboardingFlow')))

// Loading fallback for lazy-loaded panels
function PanelLoading() {
  return (
    <div className="flex items-center justify-center w-full h-64">
      <div className="text-gray-500 text-sm">Loading panel...</div>
    </div>
  )
}

// NAV1 — SparkHunterTabShell: wraps SPARK Live Call + Lead Inbox sub-tab navigation
// Sub-tabs: Live Call | Lead Inbox | Hunter Leads | Scripts
// Pill-style navigation, mobile responsive.
function SparkHunterTabShell() {
  const [tab, setTab] = React.useState<'live-call' | 'lead-inbox' | 'hunter-leads' | 'scripts'>('live-call')
  const tabs = [
    { id: 'live-call' as const,     label: 'Live Call' },
    { id: 'lead-inbox' as const,    label: 'Lead Inbox' },
    { id: 'hunter-leads' as const,  label: 'Hunter Leads' },
    { id: 'scripts' as const,       label: 'Scripts' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, backgroundColor: 'var(--bg-secondary, #111827)' }}>
      {/* Pill tab bar */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 14px', borderRadius: 20,
              border: tab === t.id ? '1.5px solid rgba(245,158,11,0.7)' : '1.5px solid rgba(255,255,255,0.12)',
              background: tab === t.id ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
              color: tab === t.id ? '#fbbf24' : '#9ca3af',
              fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
              cursor: 'pointer', transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'live-call' && (
          <Suspense fallback={<PanelLoading />}><SparkLiveCall /></Suspense>
        )}
        {tab === 'lead-inbox' && (
          <Suspense fallback={<PanelLoading />}><PortalLeadInboxView /></Suspense>
        )}
        {tab === 'hunter-leads' && (
          // HUNTER-B1-NAV-ENTRY-APR23-2026-1 — canonical HUNTER path is Sales Intelligence → Leads.
          // This sub-tab redirects; actual rendering lives in src/components/salesIntel/tabs/LeadsTab.tsx.
          <div style={{ padding: '40px 24px', color: '#6b7280', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#9ca3af' }}>Hunter Leads moved</div>
            <div style={{ fontSize: 12, marginBottom: 16 }}>HUNTER leads now live in Sales Intelligence → Leads tab.</div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('poweron:show-sales-intelligence'))}
              style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: 'var(--accent, #10b981)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Take me there
            </button>
          </div>
        )}
        {tab === 'scripts' && (
          <div style={{ padding: '40px 24px', color: '#6b7280', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#9ca3af' }}>Scripts</div>
            <div style={{ fontSize: 12 }}>Call script library — wire to Supabase call_scripts table.</div>
          </div>
        )}
      </div>
    </div>
  )
}

// NAV1 — BusinessOverviewTabShell: wraps existing BusinessOverviewView + new AbsoluteDashboard tab
// Tab 1: Business Overview (existing, untouched)
// Tab 2: Absolute Dashboard (NEW — all key numbers in one place)
function BusinessOverviewTabShell() {
  const [tab, setTab] = React.useState<'overview' | 'absolute'>('overview')
  const tabs = [
    { id: 'overview' as const, label: 'Business Overview' },
    { id: 'absolute' as const, label: 'Absolute Dashboard' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        paddingLeft: 20, flexShrink: 0,
        backgroundColor: 'var(--bg-secondary, #0f1117)',
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? '#f9fafb' : '#6b7280',
              borderBottom: tab === t.id ? '2px solid #22c55e' : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
              marginBottom: -1, whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'overview' && (
          <Suspense fallback={<PanelLoading />}><BusinessOverviewView /></Suspense>
        )}
        {tab === 'absolute' && (
          <Suspense fallback={<PanelLoading />}><AbsoluteDashboardView /></Suspense>
        )}
      </div>
    </div>
  )
}


// NAV1-FIX-VS2 — VisualSuiteNeuralTabShell: Visual Suite = Electrical Neural Map + Ecosystem Neural Map
// Tab 1: Electrical Neural Map → CommandCenterNeuralMap.tsx
// Tab 2: Ecosystem Neural Map → CombinedNeuralMap.tsx
// Desktop: sidebar stays open/collapsible. Mobile: collapsed by default.
function VisualSuiteNeuralTabShell() {
  const [tab, setTab] = React.useState<'electrical' | 'ecosystem'>('electrical')
  const tabs = [
    { id: 'electrical' as const, label: 'Electrical Neural Map' },
    { id: 'ecosystem' as const,  label: 'Ecosystem Neural Map' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, backgroundColor: 'var(--bg-secondary, #0f1117)' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        paddingLeft: 20, flexShrink: 0,
        backgroundColor: 'var(--bg-secondary, #0f1117)',
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? '#f9fafb' : '#6b7280',
              borderBottom: tab === t.id ? '2px solid #22c55e' : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
              marginBottom: -1, whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'electrical' && (
          <Suspense fallback={<PanelLoading />}><CommandCenterNeuralMap /></Suspense>
        )}
        {tab === 'ecosystem' && (
          <Suspense fallback={<PanelLoading />}><CombinedNeuralMap /></Suspense>
        )}
      </div>
    </div>
  )
}


// ── AppShell ─────────────────────────────────────────────────────────────────

interface AppShellProps {
  children?: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [activeView, setActiveView] = useState('home')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [projectTab, setProjectTab] = useState('estimate')
  const [showOnboarding, setShowOnboarding] = useState(false)

  const { isReadOnly } = useReadOnly()
  const { isDemoMode, enableDemoMode, disableDemoMode, setHasHydrated, getDemoCompanyName } = useDemoStore()
  // B62: hide floating NEXUS mic while ORB LAB is mounted (inline mic takes over)
  const orbLabActive = useUIStore((s) => s.orbLabActive)
  const [showExitDemoModal, setShowExitDemoModal] = useState(false)

  // NDA gate — check if current user has signed NDA; show flow if not.
  // NDA-FIX: Cache key must match the key written by ndaService.setNdaCacheAccepted().
  // ndaService uses 'poweron_nda_accepted_{userId}'; previously AppShell used a different
  // key ('poweron_nda_signed_{userId}') which meant the fast path never hit after signing.
  const [ndaSigned, setNdaSigned] = useState<boolean | null>(null)
  const [showNdaGate, setShowNdaGate] = useState(false)

  function getNdaCacheKey(userId: string) {
    // MUST match getNdaCacheKey() in ndaService.ts: 'poweron_nda_accepted_{userId}'
    return `poweron_nda_accepted_${userId}`
  }

  function isNdaCachedSigned(userId: string): boolean {
    try { return localStorage.getItem(getNdaCacheKey(userId)) === '1' } catch { return false }
  }

  function setNdaCached(userId: string): void {
    try { localStorage.setItem(getNdaCacheKey(userId), '1') } catch { /* storage unavailable */ }
  }

  // Beta onboarding gate — fires once after NDA, before main app loads
  const [showBetaOnboarding, setShowBetaOnboarding] = useState(false)
  const [betaOnboardingChecked, setBetaOnboardingChecked] = useState(false)

  // INT-1: V4-OB1 OnboardingFlow — AI-driven first-run interview
  // Fires after NDA + beta onboarding, checks user_onboarding table
  const [showV4Onboarding, setShowV4Onboarding] = useState(false)
  const [v4OnboardingChecked, setV4OnboardingChecked] = useState(false)

  // Beta invite token — read from ?invite=[token] on mount
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null)

  // Session Debrief overlay state
  const [showSessionDebrief, setShowSessionDebrief] = useState(false)
  const [debriefConclusions, setDebriefConclusions] = useState<any[]>([])

  let profile = null
  try {
    const auth = useAuth()
    profile = auth.profile
  } catch (e) {
    console.warn('[AppShell] useAuth failed, continuing without profile:', e)
  }

  // Signal that demo store hydration is complete.
  // Panels gate their data-source decision on `hasHydrated` to avoid rendering
  // real data on the first paint when demo mode is persisted in localStorage.
  useEffect(() => {
    useDemoStore.getState().setHasHydrated()
  }, [])

  // INT-1 — Register GUARDIAN cross-agent compliance listeners on startup.
  // Returns a cleanup function that unsubscribes all listeners on unmount.
  useEffect(() => {
    const unregister = registerAllListeners()
    return () => { unregister() }
  }, [])

  // Auto-enable Demo Mode when URL contains ?demo=true (Flow B — remote sharing)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === 'true') {
      enableDemoMode()
    }
  }, [])

  // Beta invite token — check URL for ?invite=[token] on mount
  // If valid: store in sessionStorage so it survives auth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('invite')
    if (!token) return

    validateInviteToken(token).then((result) => {
      if (result.valid) {
        sessionStorage.setItem('poweron_invite_token', token)
        setPendingInviteToken(token)
        console.log('[AppShell] Valid invite token stored:', token)
      } else {
        console.warn('[AppShell] Invalid invite token:', result.reason)
      }
    }).catch((err) => {
      console.warn('[AppShell] Invite token validation failed:', err)
    })
  }, [])

  // Show onboarding modal for new users (legacy profile-level check)
  useEffect(() => {
    if (profile && profile.onboarding_completed === false) {
      setShowOnboarding(true)
    }
  }, [profile])

  // Beta onboarding gate — check orgs.onboarding_complete after NDA is signed.
  // Only runs once per session, only for non-demo, non-read-only users.
  useEffect(() => {
    if (isReadOnly || isDemoMode) return
    if (betaOnboardingChecked) return
    // Wait until NDA has been confirmed signed before checking onboarding
    if (ndaSigned !== true) return
    if (!profile?.org_id) return

    setBetaOnboardingChecked(true)

    import('@/lib/supabase').then(({ supabase }) => {
      supabase
        .from('orgs' as never)
        .select('onboarding_complete')
        .eq('id', profile.org_id)
        .single()
        .then(({ data, error }: { data: any; error: any }) => {
          if (error) {
            console.warn('[AppShell] onboarding_complete check failed:', error)
            return
          }
          if (data && data.onboarding_complete === false) {
            setShowBetaOnboarding(true)
          }
        })
    })
  }, [ndaSigned, profile?.org_id, isReadOnly, isDemoMode, betaOnboardingChecked])

  // INT-1 — V4-OB1 OnboardingFlow: check user_onboarding table after NDA signed.
  // Runs once per session; shows AI-driven interview overlay if user hasn't completed it.
  useEffect(() => {
    if (isReadOnly || isDemoMode) return
    if (v4OnboardingChecked) return
    if (ndaSigned !== true) return
    if (!profile?.id) return

    setV4OnboardingChecked(true)

    isOnboardingComplete(profile.id).then((complete) => {
      if (!complete) {
        setShowV4Onboarding(true)
      }
    }).catch((err) => {
      console.warn('[AppShell] V4 onboarding check failed:', err)
    })
  }, [ndaSigned, profile?.id, isReadOnly, isDemoMode, v4OnboardingChecked])

  // NEXUS command "show snapshots" → navigate to settings panel
  useEffect(() => {
    function handleSnapshotCommand() {
      setActiveView('settings')
    }
    window.addEventListener('poweron:show-snapshots', handleSnapshotCommand)
    return () => window.removeEventListener('poweron:show-snapshots', handleSnapshotCommand)
  }, [])

  // NEXUS command "show activity" → navigate to activity panel
  useEffect(() => {
    function handleShowActivity() {
      setActiveView('activity')
    }
    window.addEventListener('poweron:show-activity', handleShowActivity)
    return () => window.removeEventListener('poweron:show-activity', handleShowActivity)
  }, [])

  // NEXUS command "show guardian" → navigate to guardian panel
  useEffect(() => {
    function handleShowGuardian() {
      setActiveView('guardian')
    }
    window.addEventListener('poweron:show-guardian', handleShowGuardian)
    return () => window.removeEventListener('poweron:show-guardian', handleShowGuardian)
  }, [])

  // NEXUS command "show journal" → navigate to voice journal panel
  useEffect(() => {
    function handleShowJournal() {
      setActiveView('journal')
    }
    window.addEventListener('poweron:show-journal', handleShowJournal)
    return () => window.removeEventListener('poweron:show-journal', handleShowJournal)
  }, [])

  // HUNTER-B1-NAV-ENTRY-APR23-2026-1 — route SparkHunterTabShell "Hunter Leads moved" button → Sales Intelligence.
  useEffect(() => {
    function handleShowSalesIntelligence() {
      setActiveView('sales-intelligence')
    }
    window.addEventListener('poweron:show-sales-intelligence', handleShowSalesIntelligence)
    return () => window.removeEventListener('poweron:show-sales-intelligence', handleShowSalesIntelligence)
  }, [])

  // Collection routing "need to follow up" → navigate to Money panel
  useEffect(() => {
    function handleShowMoney() {
      setActiveView('money')
    }
    window.addEventListener('poweron:show-money', handleShowMoney)
    return () => window.removeEventListener('poweron:show-money', handleShowMoney)
  }, [])

  // NDA gate — check on auth. Non-demo, non-read-only sessions only.
  // B24: Check localStorage cache first — if the user signed before, skip the
  // Supabase call entirely so the NDA flow never re-triggers after signing.
  useEffect(() => {
    if (isReadOnly || isDemoMode) return
    if (!profile?.id) return

    // Fast path: cached signed status (set after first confirmed sign)
    if (isNdaCachedSigned(profile.id)) {
      setNdaSigned(true)
      setShowNdaGate(false)
      return
    }

    // Slow path: verify with Supabase
    hasUserSignedNDA(profile.id)
      .then((signed) => {
        setNdaSigned(signed)
        setShowNdaGate(!signed)
        // Persist so future loads skip the Supabase call
        if (signed) setNdaCached(profile.id)
      })
      .catch(() => {
        // On error, don't block the app
        setNdaSigned(true)
        setShowNdaGate(false)
      })
  }, [profile?.id, isReadOnly, isDemoMode])

  // Session Debrief listener — NEXUS publishes debrief conclusions via custom event
  useEffect(() => {
    function handleSessionDebrief(e: Event) {
      const detail = (e as CustomEvent).detail
      if (Array.isArray(detail?.conclusions) && detail.conclusions.length > 0) {
        setDebriefConclusions(detail.conclusions)
        setShowSessionDebrief(true)
      }
    }
    window.addEventListener('poweron:session-debrief', handleSessionDebrief)
    return () => window.removeEventListener('poweron:session-debrief', handleSessionDebrief)
  }, [])

  // Handle navigation
  function handleNav(view: string) {
    // Project tab views that should NOT clear activeProjectId
    const projectTabViews = ['estimate', 'material-takeoff', 'progress', 'framework', 'rfi-tracker', 'coordination']
    if (!view.startsWith('project-') && !projectTabViews.includes(view)) {
      setActiveProjectId(null)
    }
    setActiveView(view)
  }

  // Handle project selection (opens project inner view)
  function handleSelectProject(projectId: string) {
    setActiveProjectId(projectId)
    setActiveView('project-inner')
    setProjectTab('estimate')
  }

  // Handle project close
  function handleCloseProject() {
    setActiveProjectId(null)
    setActiveView('projects')
  }

  // Look up active project name for sidebar display
  const activeProjectName = useMemo(() => {
    if (!activeProjectId) return null
    const backup = getBackupData()
    if (!backup) return null
    const project = (backup.projects || []).find(p => p.id === activeProjectId)
    return project ? project.name : null
  }, [activeProjectId])

  // ── Content routing ──────────────────────────────────────────────────────
  function renderContent() {
    if (children) return children

    // Project inner view (has its own tab routing)
    if (activeView === 'project-inner' && activeProjectId) {
      return (
        <V15rProjectInner
          projectId={activeProjectId}
          onClose={handleCloseProject}
          activeTab={projectTab}
          onTabChange={setProjectTab}
        />
      )
    }

    switch (activeView) {
      // v15r Workspace
      case 'home':            return (
        <>
          {/* B12 — Proactive NEXUS alerts at the top of Home */}
          <ProactiveAlertCards />
          {/* ConclusionCards — pinned session insights at the top of Home */}
          <ConclusionCards userId={profile?.id ?? ''} />
          <V15rHome />
        </>
      )
      case 'projects':        return <V15rProjectsPanel onSelectProject={handleSelectProject} />
      case 'leads':           return <V15rLeadsPanel />
      case 'templates':       return <V15rTemplatesPanel />
      case 'pricing-intelligence': return <V15rPricingIntelligencePanel />
      case 'pricing-intel':        return <V15rPricingIntelligencePanel />

      // v15r Business
      case 'graph-dashboard': return <V15rDashboard />
      case 'field-log':       return <V15rFieldLogPanel />
      case 'money':           return <V15rMoneyPanel />
      case 'income-calc':     return <V15rIncomeCalc />
      case 'price-book':      return <V15rPriceBookPanel />
      case 'team':            return <V15rTeamPanel />
      case 'settings':        return <V15rSettingsPanel />

      // Project inner tabs (when navigated from sidebar)
      case 'estimate':
      case 'material-takeoff':
      case 'progress':
      case 'framework':
      case 'rfi-tracker':
      case 'coordination':
        if (activeProjectId) {
          return (
            <V15rProjectInner
              projectId={activeProjectId}
              onClose={handleCloseProject}
              activeTab={activeView}
              onTabChange={setProjectTab}
            />
          )
        }
        return <V15rProjectsPanel onSelectProject={handleSelectProject} />

      // AI agent panels (lazy-loaded with Suspense)
      case 'nexus':           return <Suspense fallback={<PanelLoading />}><NexusChatPanel /></Suspense>
      case 'marketing':       return <Suspense fallback={<PanelLoading />}><MarketingPanel /></Suspense>
      case 'calendar':        return <Suspense fallback={<PanelLoading />}><SchedulePanel /></Suspense>
      case 'compliance':      return <Suspense fallback={<PanelLoading />}><CodePanel /></Suspense>
      case 'calculator':      return <Suspense fallback={<PanelLoading />}><OhmCalculator /></Suspense>
      case 'scout':           return <Suspense fallback={<PanelLoading />}><ProposalFeed /></Suspense>
      case 'voice-settings':  return <Suspense fallback={<PanelLoading />}><VoiceSettings /></Suspense>
      case 'activity':        return <Suspense fallback={<PanelLoading />}><ActivityPanel /></Suspense>
      case 'guardian':        return <Suspense fallback={<PanelLoading />}><GuardianPanel /></Suspense>
      case 'journal':         return <Suspense fallback={<PanelLoading />}><JournalPanel /></Suspense>
      case 'agent-mode-selector': return <Suspense fallback={<PanelLoading />}><AgentModeSelector /></Suspense>

      // E3 | Demo Mode settings view
      case 'demo-mode':       return <Suspense fallback={<PanelLoading />}><DemoModeView /></Suspense>

      // ── V3 Views ────────────────────────────────────────────────────────────
      case 'blueprint-ai':
        return <Suspense fallback={<PanelLoading />}><BlueprintAI /></Suspense>

      case 'debt-killer':
        return <Suspense fallback={<PanelLoading />}><DebtKiller /></Suspense>

      case 'guardian-view':
        return <Suspense fallback={<PanelLoading />}><GuardianView /></Suspense>

      case 'lead-rolling-trend':
        return <Suspense fallback={<PanelLoading />}><LeadRollingTrend /></Suspense>

      case 'material-intelligence':
        return <Suspense fallback={<PanelLoading />}><MaterialIntel /></Suspense>

      case 'n8n-automation':
        return <Suspense fallback={<PanelLoading />}><N8nAutomation /></Suspense>

      case 'nda-signing':
        return (
          <Suspense fallback={<PanelLoading />}>
            <NDASigningFlow
              userId={profile?.id ?? 'anonymous'}
              onSigned={() => {
                setNdaSigned(true)
                setShowNdaGate(false)
                // B24: Cache signed status so this never re-triggers
                if (profile?.id) setNdaCached(profile.id)
                // Mark invite as accepted after NDA is signed
                const token = pendingInviteToken || sessionStorage.getItem('poweron_invite_token')
                if (token) {
                  markInviteAccepted(token).catch(console.warn)
                  sessionStorage.removeItem('poweron_invite_token')
                  setPendingInviteToken(null)
                }
                setActiveView('home')
              }}
            />
          </Suspense>
        )

      // NAV1: SPARK Live Call wrapped with tab shell (Live Call | Lead Inbox | Hunter Leads | Scripts)
      case 'spark-live-call':
        return <SparkHunterTabShell />

      case 'vault-estimate':
        return <Suspense fallback={<PanelLoading />}><VaultEstimatePanel /></Suspense>

      case 'voice-hub':
        return <Suspense fallback={<PanelLoading />}><VoiceHub /></Suspense>
      case 'voice-journaling-v2':
        return <Suspense fallback={<PanelLoading />}><VoiceJournalingV2 /></Suspense>

      case 'crew-portal':
      case 'crew-portal-v3':
        return <Suspense fallback={<PanelLoading />}><CrewPortalV3 /></Suspense>

      case 'settings-v3':
        return (
          <Suspense fallback={<PanelLoading />}>
            <SettingsV3
              userTier="solo"
              watermarkSettings={{ showOnExports: true }}
              onWatermarkSettingsChange={() => {}}
            />
          </Suspense>
        )

      // B52 — Visual Suite Standalone (fullscreen 43-mode ambient display)
      // NAV1-FIX-VS2: 'visual-suite' now renders Neural Map sub-tabs (Electrical + Ecosystem)
      // 'viz-lab' legacy key preserved for backwards compat (same view)
      case 'viz-lab':
      case 'visual-suite':
        return <VisualSuiteNeuralTabShell />

      // B36 — Admin Command Center
      case 'admin-command-center':
        return <Suspense fallback={<PanelLoading />}><AdminCommandCenter /></Suspense>

      // NW1 — Neural World (3D immersive visualization)
      case 'neural-world':
        return <Suspense fallback={<PanelLoading />}><NeuralWorldView /></Suspense>

      // B68 + NAV1 — Business Overview (Tab 1: existing) + Absolute Dashboard (Tab 2: NEW)
      case 'business-overview':
        return <BusinessOverviewTabShell />

      // ── INT-1: New feature routes ──────────────────────────────────────────

      // Sales Intelligence — unified 5-tab panel (Practice/Live Call/Leads/Pipeline/Coach)
      case 'sales-intelligence':
        return <Suspense fallback={<PanelLoading />}><SalesIntelligenceView /></Suspense>

      // Guardian Dashboard — GRD1-6 compliance command center (TEAM section)
      case 'guardian-dashboard':
        return <Suspense fallback={<PanelLoading />}><GuardianDashboardView /></Suspense>

      // Diagnostics — pipeline, scenario simulator, report
      case 'diagnostics':
        return <Suspense fallback={<PanelLoading />}><DiagnosticsView /></Suspense>

      // Security — admin-only: pen test, threat monitor, key rotation, compliance
      case 'security':
        return <Suspense fallback={<PanelLoading />}><SecurityView /></Suspense>

      // Billing — Stripe subscription management
      case 'billing':
        return <Suspense fallback={<PanelLoading />}><BillingView /></Suspense>

      // Customer Portal — public-facing service request form
      case 'customer-portal':
        return <Suspense fallback={<PanelLoading />}><CustomerPortalView /></Suspense>

      // Portal Lead Inbox — owner-side view of portal submissions
      case 'portal-lead-inbox':
        return <Suspense fallback={<PanelLoading />}><PortalLeadInboxView /></Suspense>

      // Solar Training — quiz engine, NEM 3.0 visualizer, retention heatmap
      case 'solar-training':
        return <Suspense fallback={<PanelLoading />}><SolarTrainingView /></Suspense>

      // INT-1 — V4-OB1 OnboardingFlow as a navigable view
      case 'onboarding-flow':
        return (
          <Suspense fallback={<PanelLoading />}>
            <OnboardingFlow onComplete={() => { setActiveView('home') }} />
          </Suspense>
        )

      // NAV1 — NEXUS Admin (merged ORB Lab + NEXUS Admin)
      case 'nexus-admin':
        return <Suspense fallback={<PanelLoading />}><NexusAdminView /></Suspense>

      // NAV1-FIX-VS2 — ORB LAB: renders AdminVisualizationLab (restored from nexus-admin redirect)
      case 'orb-lab':
        return <Suspense fallback={<PanelLoading />}><AdminVisualizationLab /></Suspense>

      // NAV1 — Admin Tools (Agent Intelligence panel, owner only)
      case 'admin-tools':
        return <Suspense fallback={<PanelLoading />}><AdminToolsView /></Suspense>

      // NAV1 — Absolute Dashboard (aggregates all key metrics + agent system map)
      case 'absolute-dashboard':
        return <Suspense fallback={<PanelLoading />}><AbsoluteDashboardView /></Suspense>

      // NAV1 — Agent System Map standalone
      case 'agent-system-map':
        return <Suspense fallback={<PanelLoading />}><AgentSystemMapView /></Suspense>

      default:                return <V15rHome />
    }
  }

  // NDA gate: block access until NDA is signed (non-demo, non-read-only)
  if (showNdaGate && !isReadOnly && !isDemoMode) {
    return (
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-screen bg-gray-950">
          <div className="text-gray-500 text-sm">Loading…</div>
        </div>
      }>
        <NDASigningFlow
          userId={profile?.id ?? 'anonymous'}
          onSigned={() => {
            setNdaSigned(true)
            setShowNdaGate(false)
            // B24: Cache signed status so this never re-triggers
            if (profile?.id) setNdaCached(profile.id)
            // Mark invite as accepted after NDA is signed
            const token = pendingInviteToken || sessionStorage.getItem('poweron_invite_token')
            if (token) {
              markInviteAccepted(token).catch(console.warn)
              sessionStorage.removeItem('poweron_invite_token')
              setPendingInviteToken(null)
            }
          }}
        />
      </Suspense>
    )
  }

  // Beta onboarding gate: fires once after NDA, before main app loads.
  // Checks orgs.onboarding_complete — if false, show BetaOnboarding full-screen.
  if (showBetaOnboarding && !isReadOnly && !isDemoMode) {
    return (
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-screen bg-gray-950">
          <div className="text-gray-500 text-sm">Setting up your workspace…</div>
        </div>
      }>
        <BetaOnboarding
          onComplete={() => setShowBetaOnboarding(false)}
        />
      </Suspense>
    )
  }

  return (
    <V15rLayout
      activeView={activeView}
      onNav={handleNav}
      activeProjectId={activeProjectId}
      activeProjectName={activeProjectName}
    >
      {/* Audit Mode banner — shown when app is opened via audit URL (read-only) */}
      {isReadOnly && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            backgroundColor: '#f59e0b',
            color: '#000',
            textAlign: 'center',
            padding: '8px 16px',
            fontWeight: 700,
            fontSize: '13px',
            letterSpacing: '0.05em',
          }}
        >
          🔒 Audit Mode — Read Only
        </div>
      )}

      {/* Demo Mode banner — in normal document flow so it pushes content down */}
      {isDemoMode && (
        <div
          style={{
            position: 'relative',
            backgroundColor: '#EF9F27',
            color: '#000',
            textAlign: 'center',
            padding: '6px 16px',
            fontWeight: 700,
            fontSize: '12px',
            letterSpacing: '0.04em',
            userSelect: 'none',
            flexShrink: 0,
          }}
        >
          ⚠ DEMO MODE ACTIVE — {getDemoCompanyName()} — Sample data only
        </div>
      )}

      {/* Template Preview chip — shown when admin has loaded a preview industry */}
      {(() => {
        try {
          const previewIndustry = sessionStorage.getItem('poweron_preview_industry')
          if (!previewIndustry) return null
          const INDUSTRY_LABELS: Record<string, string> = {
            'electrical': 'Electrical',
            'plumbing': 'Plumbing',
            'gc': 'General Contractor',
            'medical-billing': 'Medical Billing',
            'mechanic': 'Mechanic',
            'electrical-supplier': 'Electrical Supplier',
          }
          const label = INDUSTRY_LABELS[previewIndustry] || previewIndustry
          return (
            <div
              style={{
                position: 'relative',
                backgroundColor: '#FACC15',
                color: '#000',
                textAlign: 'center',
                padding: '4px 16px',
                fontWeight: 700,
                fontSize: '11px',
                letterSpacing: '0.04em',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              🔍 TEMPLATE PREVIEW: {label.toUpperCase()} — Admin only. Real data unchanged.
            </div>
          )
        } catch { return null }
      })()}

      <ErrorBoundary>
        <Suspense fallback={<PanelLoading />}>
          <div>
            {renderContent()}
          </div>
        </Suspense>
      </ErrorBoundary>

      {/* B51 — Wins Log floating button (above NEXUS orb) — bottom right */}
      <Suspense fallback={null}>
        <div style={{ position: 'fixed', bottom: '164px', right: '24px', zIndex: 58, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <WinsLogPanel />
        </div>
      </Suspense>

      {/* B52 — Pinned Insights floating button (above Wins Log) — bottom right */}
      <Suspense fallback={null}>
        <div style={{ position: 'fixed', bottom: '224px', right: '24px', zIndex: 58, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PinnedInsightsButton />
        </div>
      </Suspense>

      {/* Floating NEXUS voice button — bottom right on all panels */}
      {/* B62: hideFloatingOrb=true when ORB LAB is mounted (orbLabActive zustand flag) */}
      <Suspense fallback={null}>
        <VoiceActivationButton hideFloatingOrb={orbLabActive} />
      </Suspense>

      {/* Watermark — fixed bottom-right, always visible */}
      <Watermark isDemoMode={isDemoMode} theme="dark" />

      {/* Session Debrief overlay — slide-up panel triggered by NEXUS */}
      {showSessionDebrief && (
        <SessionDebrief
          isOpen={showSessionDebrief}
          conclusions={debriefConclusions}
          userId={profile?.id ?? 'anonymous'}
          sessionId={`session-${Date.now()}`}
          onClose={() => {
            setShowSessionDebrief(false)
            setDebriefConclusions([])
          }}
        />
      )}

      {/* Onboarding modal — shown for new users */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingModal onComplete={() => setShowOnboarding(false)} />
        </Suspense>
      )}

      {/* INT-1 — V4-OB1 OnboardingFlow overlay — AI-driven first-run interview */}
      {showV4Onboarding && !isReadOnly && !isDemoMode && (
        <Suspense fallback={null}>
          <OnboardingFlow
            onComplete={() => setShowV4Onboarding(false)}
          />
        </Suspense>
      )}

      {/* Demo Mode exit confirmation modal — intercepts all exit attempts */}
      {showExitDemoModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid #374151',
              borderRadius: '12px',
              padding: '28px 24px',
              maxWidth: '360px',
              width: '100%',
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            }}
          >
            <h2 style={{ color: '#f9fafb', fontSize: '18px', fontWeight: 700, marginBottom: '10px' }}>
              Exit Demo Mode?
            </h2>
            <p style={{ color: '#d1d5db', fontSize: '14px', lineHeight: '1.5', marginBottom: '8px' }}>
              Exiting Demo Mode will reload the app and require you to sign in again.
            </p>
            <p style={{ color: '#9ca3af', fontSize: '12px', lineHeight: '1.5', marginBottom: '24px' }}>
              Anyone currently viewing this demo will lose access.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowExitDemoModal(false)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid #4b5563',
                  backgroundColor: 'transparent',
                  color: '#d1d5db',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Stay in Demo
              </button>
              <button
                onClick={() => {
                  disableDemoMode()
                  try { localStorage.removeItem('poweron-demo-mode') } catch { /* ignore */ }
                  window.location.reload()
                }}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Exit &amp; Sign In
              </button>
            </div>
          </div>
        </div>
      )}
    </V15rLayout>
  )
}
