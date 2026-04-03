// @ts-nocheck
/**
 * AppShell — PowerOn Hub v15r-matching shell.
 *
 * Uses V15rLayout for the top bar + sidebar, renders all v15r panels.
 * AI agent panels are lazy-loaded to prevent import-time crashes.
 */

import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { getBackupData } from '@/services/backupDataService'
import { useReadOnly } from '@/contexts/ReadOnlyContext'
import { useDemoStore } from '@/store/demoStore'

// v15r layout shell
import V15rLayout from '@/components/v15r/V15rLayout'

// v15r panels — all lazy-loaded to keep recharts and heavy deps out of main bundle
const V15rHome = lazy(() => import('@/components/v15r/V15rHome'))
const V15rProjectsPanel = lazy(() => import('@/components/v15r/V15rProjectsPanel'))
const V15rProjectInner = lazy(() => import('@/components/v15r/V15rProjectInner'))
const V15rFieldLogPanel = lazy(() => import('@/components/v15r/V15rFieldLogPanel'))
const V15rMoneyPanel = lazy(() => import('@/components/v15r/V15rMoneyPanel'))
const V15rIncomeCalc = lazy(() => import('@/components/v15r/V15rIncomeCalc'))
const V15rPriceBookPanel = lazy(() => import('@/components/v15r/V15rPriceBookPanel'))
const V15rLeadsPanel = lazy(() => import('@/components/v15r/V15rLeadsPanel'))
const V15rTemplatesPanel = lazy(() => import('@/components/v15r/V15rTemplatesPanel'))
const V15rSettingsPanel = lazy(() => import('@/components/v15r/V15rSettingsPanel'))
const V15rTeamPanel = lazy(() => import('@/components/v15r/V15rTeamPanel'))
const V15rDashboard = lazy(() => import('@/components/v15r/V15rDashboard'))
const V15rPricingIntelligencePanel = lazy(() => import('@/components/v15r/V15rPricingIntelligencePanel'))

// AI agent panels — lazy-loaded so import errors don't crash the main shell
const NexusChatPanel = lazy(() => import('@/components/nexus/NexusChatPanel').then(m => ({ default: m.NexusChatPanel })))
const MarketingPanel = lazy(() => import('@/components/spark/MarketingPanel').then(m => ({ default: m.MarketingPanel })))
const SchedulePanel  = lazy(() => import('@/components/chrono/SchedulePanel').then(m => ({ default: m.SchedulePanel })))
const CodePanel      = lazy(() => import('@/components/ohm/CodePanel').then(m => ({ default: m.CodePanel })))
const OhmCalculator  = lazy(() => import('@/components/ohm/Calculator').then(m => ({ default: m.Calculator })))
const ProposalFeed   = lazy(() => import('@/components/proposals/ProposalFeed').then(m => ({ default: m.ProposalFeed })))
const VoiceSettings  = lazy(() => import('@/components/voice/VoiceSettings').then(m => ({ default: m.VoiceSettings })))

// Activity log panel (lazy-loaded)
const ActivityPanel = lazy(() => import('@/components/ActivityPanel').then(m => ({ default: m.ActivityPanel })))

// GUARDIAN panel (lazy-loaded)
const GuardianPanel = lazy(() => import('@/components/guardian/GuardianPanel').then(m => ({ default: m.GuardianPanel })))

// Voice journal panel (lazy-loaded)
const JournalPanel = lazy(() => import('@/components/JournalPanel').then(m => ({ default: m.JournalPanel })))

// Agent Mode Selector view (lazy-loaded)
const AgentModeSelector = lazy(() => import('@/views/AgentModeSelector').then(m => ({ default: m.AgentModeSelector })))

// Demo Mode view (lazy-loaded) — E3 | Demo Mode
const DemoModeView = lazy(() => import('@/views/DemoMode').then(m => ({ default: m.DemoMode })))

// Lazy-load non-critical overlays
const VoiceActivationButton = lazy(() => import('@/components/voice/VoiceActivationButton').then(m => ({ default: m.VoiceActivationButton })))
const OnboardingModal = lazy(() => import('@/components/onboarding/OnboardingModal'))

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

  // Show onboarding modal for new users
  useEffect(() => {
    if (profile && profile.onboarding_completed === false) {
      setShowOnboarding(true)
    }
  }, [profile])

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
      case 'home':            return <V15rHome />
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

      default:                return <V15rHome />
    }
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
