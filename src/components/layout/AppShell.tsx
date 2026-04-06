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
import Watermark from '@/components/Watermark'
import ConclusionCards from '@/components/ConclusionCards'
import ProactiveAlertCards from '@/components/ProactiveAlertCards'
import SessionDebrief from '@/components/SessionDebrief'
import { hasUserSignedNDA } from '@/services/ndaService'
import { validateInviteToken, markInviteAccepted } from '@/services/inviteService'

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
const DemoModeView = lazy(() => import('@/views/DemoMode').then(m => ({ default: m.DemoMode })).catch(() => { window.location.reload(); return { default: () => null } }))

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

// Lazy-load non-critical overlays
const VoiceActivationButton = lazy(() => import('@/components/voice/VoiceActivationButton').then(m => ({ default: m.VoiceActivationButton })).catch(() => { window.location.reload(); return { default: () => null } }))
const OnboardingModal = lazy(() => chunkRetry(() => import('@/components/onboarding/OnboardingModal')))

// Beta onboarding flow — fires once after NDA, checks orgs.onboarding_complete
const BetaOnboarding = lazy(() => chunkRetry(() => import('@/components/onboarding/BetaOnboarding')))

// Loading fallback for lazy-loaded panels
function PanelLoading() {
  return (
    <div className="flex items-center justify-center w-full h-64">
      <div className="text-gray-500 text-sm">Loading panel...</div>
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
  const { isDemoMode, enableDemoMode, disableDemoMode, setHasHydrated } = useDemoStore()
  const [showExitDemoModal, setShowExitDemoModal] = useState(false)

  // NDA gate — check if current user has signed NDA; show flow if not
  const [ndaSigned, setNdaSigned] = useState<boolean | null>(null)
  const [showNdaGate, setShowNdaGate] = useState(false)

  // Beta onboarding gate — fires once after NDA, before main app loads
  const [showBetaOnboarding, setShowBetaOnboarding] = useState(false)
  const [betaOnboardingChecked, setBetaOnboardingChecked] = useState(false)

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

  // Collection routing "need to follow up" → navigate to Money panel
  useEffect(() => {
    function handleShowMoney() {
      setActiveView('money')
    }
    window.addEventListener('poweron:show-money', handleShowMoney)
    return () => window.removeEventListener('poweron:show-money', handleShowMoney)
  }, [])

  // NDA gate — check on auth. Non-demo, non-read-only sessions only.
  useEffect(() => {
    if (isReadOnly || isDemoMode) return
    if (!profile?.id) return
    hasUserSignedNDA(profile.id)
      .then((signed) => {
        setNdaSigned(signed)
        setShowNdaGate(!signed)
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

      case 'spark-live-call':
        return <Suspense fallback={<PanelLoading />}><SparkLiveCall /></Suspense>

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

      {/* Demo Mode banner — fixed below header, tapping opens exit confirmation */}
      {isDemoMode && (
        <div
          onClick={() => setShowExitDemoModal(true)}
          style={{
            position: 'fixed',
            top: '64px',   /* sits just below the 64px (h-16) header bar */
            left: 0,
            right: 0,
            zIndex: 9990,  /* above content (z-30 header), below modals */
            backgroundColor: '#EF9F27',
            color: '#000',
            textAlign: 'center',
            padding: '6px 16px',
            fontWeight: 700,
            fontSize: '12px',
            letterSpacing: '0.04em',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title="Tap to exit Demo Mode"
        >
          ⚠ DEMO MODE — Sample data only. Tap to exit (sign in required).
        </div>
      )}

      <ErrorBoundary>
        <Suspense fallback={<PanelLoading />}>
          {/* Add top padding when audit/demo banner is visible so content isn't hidden behind it */}
          <div style={isReadOnly || isDemoMode ? { paddingTop: '30px' } : undefined}>
            {renderContent()}
          </div>
        </Suspense>
      </ErrorBoundary>

      {/* Floating NEXUS voice button — bottom right on all panels */}
      <Suspense fallback={null}>
        <VoiceActivationButton />
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
